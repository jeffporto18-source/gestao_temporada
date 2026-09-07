import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router, adminProcedure } from "./_core/trpc";
import { empresaProcedure, escritaProcedure, financeiroProcedure, TENANT_COOKIE } from "./tenant";
import { NIVEIS_ACESSO } from "../drizzle/schema";
import * as db from "./db";
import { processarOperacao, emitirNfse, COD_LOCACAO, COD_INTERMEDIACAO } from "./fiscal";
import { ENV } from "./_core/env";

// Plano de contas (chart_accounts): árvore de profundidade livre. Contas principais
// (parentId nulo) definem a natureza (grupo); sub-contas em qualquer nível herdam a
// natureza da conta principal ancestral. Usado pelos lançamentos e pelo desconto de aluguel.

type ChartAccountGrupo = "conta_principal" | "despesa_fixa" | "despesa_variavel" | "receita" | "aporte_capital";
// Naturezas lançáveis (usadas em Receitas/Despesas/Aportes); "conta_principal" é apenas um contêiner sem natureza definida.
const CHART_ACCOUNT_GRUPOS: Exclude<ChartAccountGrupo, "conta_principal">[] = ["despesa_fixa", "despesa_variavel", "receita", "aporte_capital"];
const CHART_ACCOUNT_MAX_DEPTH = 3; // 4 níveis: 0=conta principal, 1=conta, 2=subconta, 3=sub-subconta

const num = (v: number | string | null) => Number(v ?? 0);

/** Resolve uma conta do plano de contas, validando que pertence a um dos grupos permitidos, e monta o caminho exibido ("Principal > Conta > Sub-conta"). */
async function resolveChartAccount<T extends ChartAccountGrupo>(ownerId: number, chartAccountId: number, gruposPermitidos: T[]) {
  const contas = await db.listChartAccounts(ownerId);
  const conta = contas.find((c) => c.id === chartAccountId);
  if (!conta) throw new Error("Conta do plano de contas não encontrada.");
  if (!gruposPermitidos.includes(conta.grupo as T)) throw new Error("Conta selecionada não pertence ao grupo esperado.");
  const porId = new Map(contas.map((c) => [c.id, c]));
  const caminho: string[] = [conta.nome];
  let atual = conta;
  while (atual.parentId) {
    const pai = porId.get(atual.parentId);
    if (!pai) break;
    caminho.unshift(pai.nome);
    atual = pai;
  }
  return { conta: { ...conta, grupo: conta.grupo as T }, nome: caminho.join(" > ") };
}

/** Profundidade de uma conta (0 = conta principal), contando os ancestrais via parentId. */
function depthOf(contas: { id: number; parentId: number | null }[], accountId: number): number {
  const porId = new Map(contas.map((c) => [c.id, c]));
  let depth = 0;
  let atual = porId.get(accountId);
  while (atual?.parentId) {
    depth++;
    atual = porId.get(atual.parentId);
  }
  return depth;
}

const competenciaSchema = z.string().regex(/^\d{4}-\d{2}$/);

/** Soma meses a uma data "AAAA-MM-DD", retornando "AAAA-MM" da competência resultante */
function addMonthsToCompetencia(competencia: string, months: number): string {
  const [y, m] = competencia.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/** Data de vencimento: dia informado no mês seguinte à competência (ajustado para o fim do mês se necessário) */
function calcularVencimento(competencia: string, dia: number): string {
  const proxima = addMonthsToCompetencia(competencia, 1);
  const [y, m] = proxima.split("-").map(Number);
  const ultimoDiaDoMes = new Date(y, m, 0).getDate();
  const diaAjustado = Math.min(dia, ultimoDiaDoMes);
  return `${proxima}-${String(diaAjustado).padStart(2, "0")}`;
}

/** Data dentro do PRÓPRIO mês da competência (diferente do aluguel, que cobra postecipado). */
function vencimentoNaCompetencia(competencia: string, dia: number): string {
  const [y, m] = competencia.split("-").map(Number);
  const ultimoDiaDoMes = new Date(y, m, 0).getDate();
  const diaAjustado = Math.min(dia, ultimoDiaDoMes);
  return `${competencia}-${String(diaAjustado).padStart(2, "0")}`;
}

/**
 * Gera as ocorrências mensais (ledgerCharges) "em aberto" que faltam para cobrir o período do
 * lançamento — o "contas a pagar/receber" de fato. Nunca toca nos meses já pagos ou cancelados:
 * apaga só os "aberto" e recria a partir do cadastro atualizado, preservando baixa e comprovante.
 */
async function sincronizarLedgerCharges(ownerId: number, entry: NonNullable<Awaited<ReturnType<typeof db.getLedgerEntry>>>) {
  const existentes = await db.listLedgerCharges(ownerId, { ledgerEntryId: entry.id });
  const competenciasJaResolvidas = new Set(existentes.filter((c) => c.status !== "aberto").map((c) => c.competencia));
  await db.deleteLedgerChargesAbertas(ownerId, entry.id);
  for (let i = 0; i < entry.qtdMeses; i++) {
    const competencia = addMonthsToCompetencia(entry.competenciaInicio, i);
    if (competenciasJaResolvidas.has(competencia)) continue;
    await db.createLedgerCharge({
      ownerId,
      ledgerEntryId: entry.id,
      propertyId: entry.propertyId,
      grupo: entry.grupo,
      categoria: entry.categoria,
      descricao: entry.descricao,
      contraparte: entry.contraparte,
      competencia,
      dataVencimento: vencimentoNaCompetencia(competencia, entry.dia),
      valor: entry.valor,
      status: "aberto",
    });
  }
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const costResponsibilitySchema = z.enum(["proprietario", "inquilino_direto", "inquilino_via_repasse"]);

/**
 * Reconstrói tudo que deriva dos custos do imóvel: os lançamentos de despesa no razão (quando o
 * proprietário paga) e os valores de repasse nas parcelas de aluguel (quando vêm junto com ele).
 *
 * É uma reconstrução completa, não um ajuste incremental, porque a responsabilidade por um custo
 * depende de haver contrato cobrindo cada mês — então criar, editar ou apagar um contrato muda o
 * resultado de custos que ninguém tocou. Recalcular do zero é o que mantém os dois lados em
 * sincronia; a alternativa incremental é justamente o que já dessincronizou este sistema antes.
 *
 * Os meses de um mesmo custo com a mesma responsabilidade viram UM lançamento em série
 * (competenciaInicio + qtdMeses), no idioma que o razão já usa, em vez de um lançamento por mês.
 */
async function sincronizarCustosDoImovel(ownerId: number, propertyId: number) {
  const custos = await db.listPropertyCosts(ownerId, propertyId);
  const contratos = await db.listLongTermContracts(ownerId, propertyId);
  const parcelas = await db.listContractRentCharges(ownerId);
  const parcelasDoImovel = parcelas.filter((p) => p.propertyId === propertyId);

  // Zera o repasse antes de recalcular: um custo que deixou de ser do inquilino precisa sumir da
  // cobrança, e isso não acontece se apenas somarmos por cima.
  const repassePorCompetencia = new Map<string, { condominio: number; iptu: number }>();

  for (const custo of custos) {
    await db.deleteLedgerEntriesByPropertyCost(ownerId, custo.id);

    const valor = num(custo.valor);
    let inicioDoTrecho: string | null = null;
    let mesesDoTrecho = 0;

    const gravarTrecho = async () => {
      if (!inicioDoTrecho || mesesDoTrecho === 0) return;
      await db.createLedgerEntry({
        ownerId,
        propertyId,
        chartAccountId: null,
        grupo: "despesa_fixa",
        categoria: custo.tipo === "iptu" ? "IPTU" : "Condomínio",
        valor: String(valor),
        dia: custo.dia,
        competenciaInicio: inicioDoTrecho,
        qtdMeses: mesesDoTrecho,
        descricao:
          custo.tipo === "condominio_extra"
            ? `Despesa automática — ${custo.descricao || "Rateio de condomínio"}`
            : `Despesa automática — ${custo.tipo === "iptu" ? "IPTU" : "Condomínio"}`,
        propertyCostId: custo.id,
      });
      inicioDoTrecho = null;
      mesesDoTrecho = 0;
    };

    for (let i = 0; i < custo.qtdMeses; i++) {
      const competencia = addMonthsToCompetencia(custo.competenciaInicio, i);
      const contrato = contratos.find((c) => db.contratoCobreCompetencia(c, competencia)) ?? null;
      const responsavel = db.responsavelPeloCusto(custo, contrato);

      if (responsavel === "proprietario") {
        if (!inicioDoTrecho) inicioDoTrecho = competencia;
        mesesDoTrecho++;
        continue;
      }

      await gravarTrecho();

      if (responsavel === "inquilino_via_repasse") {
        const atual = repassePorCompetencia.get(competencia) ?? { condominio: 0, iptu: 0 };
        if (custo.tipo === "iptu") atual.iptu += valor;
        else atual.condominio += valor;
        repassePorCompetencia.set(competencia, atual);
      }
    }
    await gravarTrecho();
  }

  for (const parcela of parcelasDoImovel) {
    const repasse = repassePorCompetencia.get(parcela.competencia) ?? { condominio: 0, iptu: 0 };
    const condominio = String(round2(repasse.condominio));
    const iptu = String(round2(repasse.iptu));
    if (num(parcela.condominio) === num(condominio) && num(parcela.iptu) === num(iptu)) continue;
    await db.updateContractRentCharge(ownerId, parcela.id, { condominio, iptu });
  }
}

/** Soma meses a uma data "AAAA-MM-DD", preservando o dia (ajustado para o fim do mês se necessário) */
function addMonthsToDate(data: string, months: number): string {
  const [y, m, d] = data.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const ultimoDiaDoMes = new Date(ny, nm, 0).getDate();
  const diaAjustado = Math.min(d, ultimoDiaDoMes);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(diaAjustado).padStart(2, "0")}`;
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => {
      if (!opts.ctx.user) return null;
      const { passwordHash, ...safeUser } = opts.ctx.user;
      return safeUser;
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // Onboarding: classificação obrigatória no primeiro acesso
  onboarding: router({
    save: protectedProcedure
      .input(
        z.object({
          userType: z.enum(["administradora", "admin_airbnb", "proprietario", "holding", "gestor_temporada_pj", "escritorio_contabil"]),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await db.updateUserProfile(ctx.user.id, {
          userType: input.userType,
        });
        return { success: true };
      }),
  }),

  // ------------------------------------------------------------- profile
  profile: router({
    get: protectedProcedure.query(({ ctx }) => {
      const { passwordHash, ...safeUser } = ctx.user;
      return safeUser;
    }),
    update: protectedProcedure
      .input(
        z.object({
          name: z.string().optional(),
          razaoSocial: z.string().optional(),
          cnpj: z.string().optional(),
          cpfResponsavel: z.string().optional(),
          nomeResponsavel: z.string().optional(),
          telefone: z.string().optional(),
          email: z.string().email().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const data: Record<string, unknown> = {};
        if (input.name !== undefined) data.name = input.name;
        if (input.razaoSocial !== undefined) data.razaoSocial = input.razaoSocial;
        // Numa conta PJ o formulário edita razão social e nome do responsável, mas nunca `name` —
        // que é o campo exibido na barra lateral e nas listas. Sem sincronizar aqui, corrigir a
        // razão social não mudava nada do que aparece na tela, e o nome antigo ficava para sempre.
        if (ctx.user.tipoCadastro === "pj" && input.razaoSocial) data.name = input.razaoSocial.trim();
        if (ctx.user.tipoCadastro === "pf" && input.nomeResponsavel) data.name = input.nomeResponsavel.trim();
        if (input.cnpj !== undefined) data.cnpj = input.cnpj.replace(/\D/g, "");
        if (input.cpfResponsavel !== undefined) data.cpfResponsavel = input.cpfResponsavel.replace(/\D/g, "");
        if (input.nomeResponsavel !== undefined) data.nomeResponsavel = input.nomeResponsavel;
        if (input.telefone !== undefined) data.telefone = input.telefone.replace(/\D/g, "");
        if (input.email !== undefined) {
          const newEmail = input.email.toLowerCase().trim();
          if (newEmail !== ctx.user.email) {
            // Verificar se o e-mail já está em uso por outro usuário
            const { getDb } = await import("./db");
            const database = await getDb();
            if (database) {
              const { users } = await import("../drizzle/schema");
              const existing = await database.select().from(users).where(eq(users.email, newEmail)).limit(1);
              if (existing.length > 0 && existing[0].id !== ctx.user.id) {
                throw new Error("Este e-mail já está em uso por outra conta.");
              }
            }
          }
          data.email = newEmail;
        }
        await db.updateUserProfile(ctx.user.id, data as any);
        return { success: true };
      }),
  }),

  // ------------------------------------------------------- senha do próprio usuário
  senha: router({
    /** Troca a própria senha. Exige a atual, para uma sessão aberta esquecida não virar sequestro. */
    alterar: protectedProcedure
      .input(z.object({ senhaAtual: z.string().min(1), novaSenha: z.string().min(6) }))
      .mutation(async ({ ctx, input }) => {
        const confere = await db.checkUserPassword(ctx.user.id, input.senhaAtual);
        if (!confere) throw new Error("A senha atual está incorreta.");
        if (input.senhaAtual === input.novaSenha) throw new Error("A nova senha precisa ser diferente da atual.");
        await db.setUserPassword(ctx.user.id, input.novaSenha);
        return { success: true };
      }),
  }),

  // ------------------------------------------------------------- team (usuários da empresa)
  /**
   * Usuários da EMPRESA EM OPERAÇÃO, não do usuário logado.
   *
   * Antes esta tela criava o funcionário sob a conta de quem estava logado. Quando o escritório
   * operava um cliente e cadastrava alguém, o funcionário nascia ligado à empresa do escritório —
   * que está vazia — e entrava num sistema sem nada, sem que ninguém entendesse por quê.
   *
   * Só quem tem nível total na empresa pode gerenciar seus usuários: dar acesso a mais alguém é
   * decisão de quem responde pela empresa, não de quem apenas opera o dia a dia dela.
   */
  team: router({
    list: empresaProcedure.query(({ ctx }) => {
      if (ctx.nivel !== "total") throw new Error("Seu acesso nesta empresa não permite gerenciar usuários.");
      return db.listTeamUsers(ctx.ownerId);
    }),
    create: escritaProcedure
      .input(
        z.object({
          name: z.string().min(1),
          email: z.string().email(),
          password: z.string().min(6),
          telefone: z.string().optional(),
          nivel: z.enum(NIVEIS_ACESSO).default("total"),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.nivel !== "total") throw new Error("Seu acesso nesta empresa não permite adicionar usuários.");
        await db.createTeamUser({
          ownerId: ctx.ownerId,
          name: input.name,
          email: input.email,
          password: input.password,
          telefone: input.telefone,
          nivel: input.nivel,
        });
        return { success: true };
      }),
    /** Redefine a senha de um funcionário — o caminho para quem esqueceu a dele. */
    redefinirSenha: escritaProcedure
      .input(z.object({ userId: z.number(), novaSenha: z.string().min(6) }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.nivel !== "total") throw new Error("Seu acesso nesta empresa não permite redefinir senhas.");
        const alvo = await db.getUserById(input.userId);
        if (!alvo || alvo.invitedBy !== ctx.ownerId) throw new Error("Usuário não encontrado nesta empresa.");
        await db.setUserPassword(input.userId, input.novaSenha);
        return { success: true };
      }),
    /** Muda o alcance de um funcionário já cadastrado, sem recriá-lo. */
    alterarNivel: escritaProcedure
      .input(z.object({ userId: z.number(), nivel: z.enum(NIVEIS_ACESSO) }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.nivel !== "total") throw new Error("Seu acesso nesta empresa não permite alterar acessos.");
        const alvo = await db.getUserById(input.userId);
        if (!alvo || alvo.invitedBy !== ctx.ownerId) throw new Error("Usuário não encontrado nesta empresa.");
        await db.grantTenantAccess({ userId: input.userId, tenantOwnerId: ctx.ownerId, nivel: input.nivel });
        return { success: true };
      }),
    delete: escritaProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.nivel !== "total") throw new Error("Seu acesso nesta empresa não permite remover usuários.");
        await db.deleteTeamUser(ctx.ownerId, input.id);
        return { success: true };
      }),
  }),

  // --------------------------------------------------- empresas do usuário
  // Fica em protectedProcedure de propósito: é o que se usa ANTES de haver empresa escolhida.
  empresas: router({
    /** Empresas que o usuário logado pode operar. Uma só = entra direto; mais de uma = escolhe. */
    minhas: protectedProcedure.query(async ({ ctx }) => {
      const acessos = await db.listTenantAccess(ctx.user.id);
      return acessos.map((a) => ({
        id: a.tenantOwnerId,
        nome: a.nome || a.nomeResponsavel || a.nomeUsuario || a.email || `Empresa ${a.tenantOwnerId}`,
        userType: a.userType,
        nivel: a.nivel,
      }));
    }),

    /** Guarda a empresa escolhida no cookie. O acesso é reconferido aqui e a cada requisição. */
    selecionar: protectedProcedure
      .input(z.object({ empresaId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const acesso = await db.getTenantAccess(ctx.user.id, input.empresaId);
        if (!acesso) throw new Error("Você não tem acesso a esta empresa.");
        ctx.res.cookie(TENANT_COOKIE, String(input.empresaId), {
          ...getSessionCookieOptions(ctx.req),
          maxAge: 365 * 24 * 60 * 60 * 1000,
        });
        return { success: true, nivel: acesso.nivel };
      }),

    /**
     * Empresa em operação agora — alimenta o seletor no topo e o filtro do menu lateral.
     *
     * `userType` vem daqui, da empresa, e não do usuário logado: o menu precisa refletir o que
     * ESTA empresa usa. Um contador holding abrindo um cliente administradora tem de ver Clientes
     * e Repasse ao Proprietário, telas que o perfil dele esconderia.
     */
    atual: empresaProcedure.query(async ({ ctx }) => {
      const dono = await db.getUserById(ctx.ownerId);
      return {
        id: ctx.ownerId,
        nome: dono?.razaoSocial || dono?.nomeResponsavel || dono?.name || dono?.email || `Empresa ${ctx.ownerId}`,
        nivel: ctx.nivel,
        userType: dono?.userType ?? null,
      };
    }),
  }),

  // ------------------------------------------- escritório contábil (multiempresa)
  // Só quem tem role=admin opera aqui: é o papel de quem atende várias empresas de terceiros.
  // Nenhum acesso é concedido automaticamente — cada concessão é um ato explícito e registrado,
  // porque significa abrir os dados de um cliente para alguém de fora dele.
  escritorio: router({
    /** Todas as empresas do sistema, com quem já tem acesso a cada uma. */
    empresas: adminProcedure.query(async () => {
      const empresas = await db.listTenants();
      return Promise.all(
        empresas.map(async (e) => ({
          id: e.id,
          nome: e.razaoSocial || e.nomeResponsavel || e.name || e.email || `Empresa ${e.id}`,
          razaoSocial: e.razaoSocial,
          cnpj: e.cnpj,
          email: e.email,
          telefone: e.telefone,
          userType: e.userType,
          acessos: (await db.listAccessOfTenant(e.id)).map((a) => ({
            userId: a.userId,
            nome: a.nome,
            email: a.email,
            nivel: a.nivel,
            ehDonoDaEmpresa: a.ehDono === null,
          })),
        })),
      );
    }),

    /**
     * Cadastra uma empresa cliente nova sem passar pelo formulário público — o escritório fica
     * logado o tempo todo, e o cadastro público exigiria sair da própria sessão para usá-lo.
     *
     * A empresa nasce visível para o escritório automaticamente (listTenants não filtra por
     * tenant_access quando role=admin), então não é preciso conceder acesso depois de criar.
     */
    criarEmpresa: adminProcedure
      .input(
        z.object({
          razaoSocial: z.string().min(1),
          cnpj: z.string().min(11),
          email: z.string().email(),
          telefone: z.string().optional(),
          nomeResponsavel: z.string().optional(),
          userType: z.enum(["administradora", "proprietario", "holding", "admin_airbnb", "gestor_temporada_pj"]),
          senhaInicial: z.string().min(6),
        }),
      )
      .mutation(async ({ input }) => {
        const id = await db.createTenant(input);
        return { success: true, id };
      }),

    /** Corrige os dados de cadastro de uma empresa cliente — o caso comum é um e-mail de teste virando o oficial. */
    editarEmpresa: adminProcedure
      .input(
        z.object({
          empresaId: z.number(),
          razaoSocial: z.string().min(1).optional(),
          cnpj: z.string().min(11).optional(),
          email: z.string().email().optional(),
          telefone: z.string().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const { empresaId, ...dados } = input;
        const dono = await db.getUserById(empresaId);
        if (!dono || dono.invitedBy !== null) throw new Error("Empresa não encontrada.");
        await db.updateTenant(empresaId, dados);
        return { success: true };
      }),

    /**
     * Quem pode receber acesso: apenas os funcionários do escritório.
     *
     * O próprio admin não entra na lista porque já alcança todas as empresas — oferecer "conceder
     * a você mesmo" seria um botão sem efeito.
     */
    pessoas: adminProcedure.query(async ({ ctx }) => {
      const equipe = await db.listTeamUsers(ctx.user.id);
      return equipe.map((u) => ({ id: u.id, nome: u.name, email: u.email, ehVoce: false }));
    }),

    conceder: adminProcedure
      .input(z.object({ userId: z.number(), empresaId: z.number(), nivel: z.enum(NIVEIS_ACESSO) }))
      .mutation(async ({ ctx, input }) => {
        // Só é possível conceder a si mesmo ou a alguém da própria equipe do escritório.
        if (input.userId !== ctx.user.id) {
          const pessoa = await db.getUserById(input.userId);
          if (!pessoa || pessoa.invitedBy !== ctx.user.id) {
            throw new Error("Só é possível conceder acesso a você ou à sua equipe.");
          }
        }
        await db.grantTenantAccess({ userId: input.userId, tenantOwnerId: input.empresaId, nivel: input.nivel });
        return { success: true };
      }),

    /**
     * Redefine a senha do dono de uma empresa cliente.
     *
     * É o que resolve o cliente que esqueceu a senha: hoje isso exigiria alterar o banco à mão,
     * e cada ocorrência custaria uma intervenção técnica.
     */
    redefinirSenhaDaEmpresa: adminProcedure
      .input(z.object({ empresaId: z.number(), novaSenha: z.string().min(6) }))
      .mutation(async ({ input }) => {
        const dono = await db.getUserById(input.empresaId);
        if (!dono || dono.invitedBy !== null) throw new Error("Empresa não encontrada.");
        await db.setUserPassword(input.empresaId, input.novaSenha);
        return { success: true };
      }),

    revogar: adminProcedure
      .input(z.object({ userId: z.number(), empresaId: z.number() }))
      .mutation(async ({ input }) => {
        // Uma empresa não pode ficar sem dono: revogar o acesso do próprio dono a trancaria.
        if (input.userId === input.empresaId) {
          throw new Error("O dono da empresa não pode perder o acesso a ela.");
        }
        await db.revokeTenantAccess(input.userId, input.empresaId);
        return { success: true };
      }),
  }),

  // ------------------------------------------------------------- clients
  clients: router({
    list: empresaProcedure.query(({ ctx }) => db.listClients(ctx.ownerId)),
    get: empresaProcedure.input(z.object({ id: z.number() })).query(({ ctx, input }) => db.getClient(ctx.ownerId, input.id)),
    create: escritaProcedure
      .input(
        z.object({
          tipo: z.enum(["PF", "PJ"]),
          nome: z.string().min(1),
          cpfCnpj: z.string().min(1),
          email: z.string().optional(),
          telefone: z.string().optional(),
          fiscalCategory: z.enum(["pj", "pf_cbs_ibs", "pf_isento"]).default("pj"),
          certificadoA1Nome: z.string().optional(),
          certificadoA1Validade: z.string().optional(), // "AAAA-MM-DD"
        }),
      )
      .mutation(({ ctx, input }) =>
        db.createClient({
          ownerId: ctx.ownerId,
          tipo: input.tipo,
          nome: input.nome,
          cpfCnpj: input.cpfCnpj,
          email: input.email || null,
          telefone: input.telefone || null,
          fiscalCategory: input.fiscalCategory,
          certificadoA1Nome: input.certificadoA1Nome || null,
          certificadoA1Validade: input.certificadoA1Validade ? new Date(input.certificadoA1Validade) : null,
        }),
      ),
    update: escritaProcedure
      .input(
        z.object({
          id: z.number(),
          tipo: z.enum(["PF", "PJ"]).optional(),
          nome: z.string().optional(),
          cpfCnpj: z.string().optional(),
          email: z.string().optional(),
          telefone: z.string().optional(),
          fiscalCategory: z.enum(["pj", "pf_cbs_ibs", "pf_isento"]).optional(),
          certificadoA1Nome: z.string().optional(),
          certificadoA1Validade: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) => {
        const { id, certificadoA1Validade, ...rest } = input;
        return db.updateClient(ctx.ownerId, id, {
          ...rest,
          ...(certificadoA1Validade !== undefined ? { certificadoA1Validade: certificadoA1Validade ? new Date(certificadoA1Validade) : null } : {}),
        });
      }),
    delete: escritaProcedure.input(z.object({ id: z.number() })).mutation(({ ctx, input }) => db.deleteClient(ctx.ownerId, input.id)),
  }),

  // ---------------------------------------------------------- properties
  properties: router({
    list: empresaProcedure.query(({ ctx }) => db.listProperties(ctx.ownerId)),
    get: empresaProcedure.input(z.object({ id: z.number() })).query(({ ctx, input }) => db.getProperty(ctx.ownerId, input.id)),
    create: escritaProcedure
      .input(
        z.object({
          clientId: z.number().optional(),
          apelido: z.string().min(1),
          endereco: z.string().optional(),
          comissaoPct: z.number().min(0).max(100),
          custoFaxina: z.number().min(0).default(0),
          tipoLocacao: z.enum(["curta", "longa"]).default("curta"),
          imobiliariaId: z.number().nullable().optional(),
          tipoAdministracao: z.enum(["propria", "administradora", "gestor_curta_temporada"]).default("propria"),
          gestorId: z.number().nullable().optional(),
          financiado: z.enum(["sim", "nao"]).default("nao"),
          tipoFinanciamento: z.enum(["financiamento", "consorcio"]).optional(),
          valorParcela: z.number().min(0).optional(),
          socioId: z.number().optional(),
          socio2Id: z.number().optional(),
          socio3Id: z.number().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        db.createProperty({
          ownerId: ctx.ownerId,
          clientId: input.clientId ?? null,
          apelido: input.apelido,
          endereco: input.endereco || null,
          comissaoPct: String(input.comissaoPct),
          custoFaxina: String(input.custoFaxina),
          tipoLocacao: input.tipoLocacao,
          imobiliariaId: input.imobiliariaId ?? null,
          tipoAdministracao: input.tipoAdministracao,
          gestorId: input.gestorId ?? null,
          financiado: input.financiado,
          tipoFinanciamento: input.tipoFinanciamento ?? null,
          valorParcela: input.valorParcela !== undefined ? String(input.valorParcela) : null,
          socioId: input.socioId ?? null,
          socio2Id: input.socio2Id ?? null,
          socio3Id: input.socio3Id ?? null,
        }),
      ),
    update: escritaProcedure
      .input(
        z.object({
          id: z.number(),
          clientId: z.number().optional(),
          apelido: z.string().optional(),
          endereco: z.string().optional(),
          comissaoPct: z.number().optional(),
          custoFaxina: z.number().min(0).optional(),
          tipoLocacao: z.enum(["curta", "longa"]).optional(),
          imobiliariaId: z.number().nullable().optional(),
          tipoAdministracao: z.enum(["propria", "administradora", "gestor_curta_temporada"]).optional(),
          gestorId: z.number().nullable().optional(),
          financiado: z.enum(["sim", "nao"]).optional(),
          tipoFinanciamento: z.enum(["financiamento", "consorcio"]).nullable().optional(),
          valorParcela: z.number().min(0).nullable().optional(),
          socioId: z.number().nullable().optional(),
          socio2Id: z.number().nullable().optional(),
          socio3Id: z.number().nullable().optional(),
        }),
      )
      .mutation(({ ctx, input }) => {
        const { id, comissaoPct, custoFaxina, valorParcela, ...rest } = input;
        return db.updateProperty(ctx.ownerId, id, {
          ...rest,
          ...(comissaoPct !== undefined ? { comissaoPct: String(comissaoPct) } : {}),
          ...(custoFaxina !== undefined ? { custoFaxina: String(custoFaxina) } : {}),
          ...(valorParcela !== undefined ? { valorParcela: valorParcela !== null ? String(valorParcela) : null } : {}),
        });
      }),
    delete: escritaProcedure.input(z.object({ id: z.number() })).mutation(({ ctx, input }) => db.deleteProperty(ctx.ownerId, input.id)),
  }),

  // ------------------------------------------------------------- imobiliarias
  imobiliarias: router({
    list: empresaProcedure.query(({ ctx }) => db.listImobiliarias(ctx.ownerId)),
    create: escritaProcedure
      .input(
        z.object({
          nome: z.string().min(1),
          telefone: z.string().optional(),
          celular: z.string().optional(),
          whatsapp: z.string().optional(),
          email: z.string().optional(),
          contato: z.string().optional(),
          endereco: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        db.createImobiliaria({
          ownerId: ctx.ownerId,
          nome: input.nome,
          telefone: input.telefone || null,
          celular: input.celular || null,
          whatsapp: input.whatsapp || null,
          email: input.email || null,
          contato: input.contato || null,
          endereco: input.endereco || null,
        }),
      ),
    update: escritaProcedure
      .input(
        z.object({
          id: z.number(),
          nome: z.string().optional(),
          telefone: z.string().optional(),
          celular: z.string().optional(),
          whatsapp: z.string().optional(),
          email: z.string().optional(),
          contato: z.string().optional(),
          endereco: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) => {
        const { id, ...rest } = input;
        return db.updateImobiliaria(ctx.ownerId, id, rest);
      }),
    delete: escritaProcedure.input(z.object({ id: z.number() })).mutation(({ ctx, input }) => db.deleteImobiliaria(ctx.ownerId, input.id)),
  }),

  // ------------------------------------------------------------- gestores de temporada (curta_managers)
  curtaManagers: router({
    list: empresaProcedure.query(({ ctx }) => db.listCurtaManagers(ctx.ownerId)),
    create: escritaProcedure
      .input(
        z.object({
          nome: z.string().min(1),
          telefone: z.string().optional(),
          email: z.string().optional(),
          contato: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        db.createCurtaManager({
          ownerId: ctx.ownerId,
          nome: input.nome,
          telefone: input.telefone || null,
          email: input.email || null,
          contato: input.contato || null,
        }),
      ),
    update: escritaProcedure
      .input(
        z.object({
          id: z.number(),
          nome: z.string().optional(),
          telefone: z.string().optional(),
          email: z.string().optional(),
          contato: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) => {
        const { id, ...rest } = input;
        return db.updateCurtaManager(ctx.ownerId, id, rest);
      }),
    delete: escritaProcedure.input(z.object({ id: z.number() })).mutation(({ ctx, input }) => db.deleteCurtaManager(ctx.ownerId, input.id)),
  }),

  // ------------------------------------------------------------- plano de contas
  chartAccounts: router({
    list: empresaProcedure
      .input(z.object({ grupo: z.enum(["conta_principal", "despesa_fixa", "despesa_variavel", "receita", "aporte_capital"]).optional() }).optional())
      .query(async ({ ctx, input }) => {
        const all = await db.seedDefaultChartAccountsIfNeeded(ctx.ownerId);
        return input?.grupo ? all.filter((a) => a.grupo === input.grupo) : all;
      }),
    create: escritaProcedure
      .input(
        z.object({
          grupo: z.enum(["conta_principal", "despesa_fixa", "despesa_variavel", "receita", "aporte_capital"]).optional(),
          nome: z.string().min(1),
          parentId: z.number().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        let grupo = input.grupo;
        if (input.parentId) {
          const contas = await db.listChartAccounts(ctx.ownerId);
          const pai = contas.find((c) => c.id === input.parentId);
          if (!pai) throw new Error("Conta-pai não encontrada.");
          // Sub-conta herda a natureza da conta-pai. Plano de contas tem exatamente 4 níveis fixos.
          if (depthOf(contas, pai.id) >= CHART_ACCOUNT_MAX_DEPTH) {
            throw new Error("O plano de contas permite no máximo 4 níveis (conta principal › conta › subconta › sub-subconta).");
          }
          grupo = pai.grupo;
        }
        if (!grupo) throw new Error("Selecione a natureza da conta principal.");
        return db.createChartAccount({ ownerId: ctx.ownerId, grupo, nome: input.nome, parentId: input.parentId ?? null, ativa: 1 });
      }),
    update: escritaProcedure
      .input(z.object({ id: z.number(), nome: z.string().optional(), ativa: z.number().min(0).max(1).optional() }))
      .mutation(({ ctx, input }) => db.updateChartAccount(ctx.ownerId, input.id, { nome: input.nome, ativa: input.ativa })),
    delete: escritaProcedure.input(z.object({ id: z.number() })).mutation(({ ctx, input }) => db.deleteChartAccount(ctx.ownerId, input.id)),
  }),

  // --------------------------------------------------------- lançamentos (receitas, despesas, aportes)
  ledgerEntries: router({
    list: empresaProcedure
      .input(
        z.object({
          propertyId: z.number().optional(),
          grupo: z.enum(["despesa_fixa", "despesa_variavel", "receita", "aporte_capital"]).optional(),
        }),
      )
      .query(({ ctx, input }) => db.listLedgerEntries(ctx.ownerId, input.propertyId, input.grupo)),
    create: escritaProcedure
      .input(
        z.object({
          propertyId: z.number(),
          chartAccountId: z.number(),
          descricao: z.string().optional(),
          contraparte: z.string().optional(),
          valor: z.number().positive(),
          dia: z.number().int().min(1).max(31),
          competenciaInicio: z.string().regex(/^\d{4}-\d{2}$/),
          qtdMeses: z.number().int().positive().default(1),
          observacao: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { conta, nome } = await resolveChartAccount(ctx.ownerId, input.chartAccountId, CHART_ACCOUNT_GRUPOS);
        const id = await db.createLedgerEntry({
          ownerId: ctx.ownerId,
          propertyId: input.propertyId,
          chartAccountId: conta.id,
          grupo: conta.grupo,
          categoria: nome,
          descricao: input.descricao || null,
          contraparte: input.contraparte || null,
          valor: String(input.valor),
          dia: input.dia,
          competenciaInicio: input.competenciaInicio,
          qtdMeses: input.qtdMeses,
          observacao: input.observacao || null,
        });
        const entry = await db.getLedgerEntry(ctx.ownerId, id);
        if (entry) await sincronizarLedgerCharges(ctx.ownerId, entry);
        return { id };
      }),
    update: escritaProcedure
      .input(
        z.object({
          id: z.number(),
          propertyId: z.number().optional(),
          chartAccountId: z.number().optional(),
          descricao: z.string().optional(),
          contraparte: z.string().optional(),
          valor: z.number().positive().optional(),
          dia: z.number().int().min(1).max(31).optional(),
          competenciaInicio: z.string().regex(/^\d{4}-\d{2}$/).optional(),
          qtdMeses: z.number().int().positive().optional(),
          observacao: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { id, valor, chartAccountId, ...rest } = input;
        const entry = await db.getLedgerEntry(ctx.ownerId, id);
        if (entry && (entry.reservationId || entry.contractRentChargeId || entry.propertyCostId)) {
          throw new Error("Este lançamento foi gerado automaticamente por uma reserva, contrato ou custo do imóvel e não pode ser editado aqui.");
        }
        let contaFields = {};
        if (chartAccountId !== undefined) {
          const { conta, nome } = await resolveChartAccount(ctx.ownerId, chartAccountId, CHART_ACCOUNT_GRUPOS);
          contaFields = { chartAccountId: conta.id, grupo: conta.grupo, categoria: nome };
        }
        await db.updateLedgerEntry(ctx.ownerId, id, {
          ...rest,
          ...contaFields,
          ...(valor !== undefined ? { valor: String(valor) } : {}),
        });
        const atualizado = await db.getLedgerEntry(ctx.ownerId, id);
        if (atualizado) await sincronizarLedgerCharges(ctx.ownerId, atualizado);
      }),
    delete: escritaProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      const entry = await db.getLedgerEntry(ctx.ownerId, input.id);
      if (entry && (entry.reservationId || entry.contractRentChargeId || entry.propertyCostId)) {
        throw new Error("Este lançamento foi gerado automaticamente por uma reserva, contrato ou custo do imóvel e não pode ser excluído aqui.");
      }
      if (await db.existeLedgerChargePago(ctx.ownerId, input.id)) {
        throw new Error("Este cadastro tem mês já baixado (com comprovante). Cancele a baixa antes de excluir, se realmente não deveria existir.");
      }
      await db.deleteLedgerChargesByEntry(ctx.ownerId, input.id);
      return db.deleteLedgerEntry(ctx.ownerId, input.id);
    }),
  }),

  // ----------------------------------------- ledger charges (contas a pagar/receber: baixa + comprovante)
  ledgerCharges: router({
    list: empresaProcedure
      .input(
        z.object({
          propertyId: z.number().optional(),
          grupo: z.enum(["despesa_fixa", "despesa_variavel", "receita", "aporte_capital"]).optional(),
          status: z.enum(["aberto", "pago", "cancelado"]).optional(),
        }),
      )
      .query(({ ctx, input }) => db.listLedgerCharges(ctx.ownerId, input)),
    pagar: escritaProcedure
      .input(z.object({ id: z.number(), valorPago: z.number().min(0), dataPagamento: z.string() }))
      .mutation(({ ctx, input }) =>
        db.updateLedgerCharge(ctx.ownerId, input.id, {
          status: "pago",
          valorPago: String(input.valorPago),
          dataPagamento: input.dataPagamento,
        }),
      ),
    reabrir: escritaProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ ctx, input }) => db.updateLedgerCharge(ctx.ownerId, input.id, { status: "aberto", valorPago: null, dataPagamento: null })),
    cancelar: escritaProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ ctx, input }) => db.updateLedgerCharge(ctx.ownerId, input.id, { status: "cancelado" })),
  }),

  // --------------------------------------------------------- guarantee types
  guaranteeTypes: router({
    list: empresaProcedure.query(({ ctx }) => db.seedDefaultGuaranteeTypesIfNeeded(ctx.ownerId)),
    create: escritaProcedure
      .input(z.object({ nome: z.string().min(1) }))
      .mutation(({ ctx, input }) => db.createGuaranteeType({ ownerId: ctx.ownerId, nome: input.nome, ativa: 1 })),
    update: escritaProcedure
      .input(z.object({ id: z.number(), nome: z.string().optional(), ativa: z.number().min(0).max(1).optional() }))
      .mutation(({ ctx, input }) => db.updateGuaranteeType(ctx.ownerId, input.id, { nome: input.nome, ativa: input.ativa })),
    delete: escritaProcedure.input(z.object({ id: z.number() })).mutation(({ ctx, input }) => db.deleteGuaranteeType(ctx.ownerId, input.id)),
  }),

  // ------------------------------------------------------------- fornecedores
  fornecedores: router({
    list: empresaProcedure.query(({ ctx }) => db.listFornecedores(ctx.ownerId)),
    create: escritaProcedure
      .input(
        z.object({
          nome: z.string().min(1),
          cpfCnpj: z.string().optional(),
          telefone: z.string().optional(),
          email: z.string().optional(),
          chartAccountId: z.number().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (input.chartAccountId) {
          await resolveChartAccount(ctx.ownerId, input.chartAccountId, ["despesa_fixa", "despesa_variavel"]);
        }
        return db.createFornecedor({
          ownerId: ctx.ownerId,
          nome: input.nome,
          cpfCnpj: input.cpfCnpj || null,
          telefone: input.telefone || null,
          email: input.email || null,
          chartAccountId: input.chartAccountId || null,
          ativo: 1,
        });
      }),
    update: escritaProcedure
      .input(
        z.object({
          id: z.number(),
          nome: z.string().optional(),
          cpfCnpj: z.string().optional(),
          telefone: z.string().optional(),
          email: z.string().optional(),
          chartAccountId: z.number().nullable().optional(),
          ativo: z.number().min(0).max(1).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...rest } = input;
        if (rest.chartAccountId) {
          await resolveChartAccount(ctx.ownerId, rest.chartAccountId, ["despesa_fixa", "despesa_variavel"]);
        }
        return db.updateFornecedor(ctx.ownerId, id, rest);
      }),
    delete: escritaProcedure.input(z.object({ id: z.number() })).mutation(({ ctx, input }) => db.deleteFornecedor(ctx.ownerId, input.id)),
  }),

  // -------------------------------------------------------------- sócios
  socios: router({
    list: empresaProcedure.query(({ ctx }) => db.listSocios(ctx.ownerId)),
    create: escritaProcedure
      .input(z.object({ nome: z.string().min(1), cpf: z.string().min(1), grupoId: z.number().nullable().optional() }))
      .mutation(({ ctx, input }) => db.createSocio({ ownerId: ctx.ownerId, nome: input.nome, cpf: input.cpf, grupoId: input.grupoId ?? null })),
    update: escritaProcedure
      .input(z.object({ id: z.number(), nome: z.string().optional(), cpf: z.string().optional(), grupoId: z.number().nullable().optional() }))
      .mutation(({ ctx, input }) => {
        const { id, ...rest } = input;
        return db.updateSocio(ctx.ownerId, id, rest);
      }),
    delete: escritaProcedure.input(z.object({ id: z.number() })).mutation(({ ctx, input }) => db.deleteSocio(ctx.ownerId, input.id)),
  }),

  // ------------------------------------------------------------- grupos de sócios
  socioGrupos: router({
    list: empresaProcedure.query(({ ctx }) => db.listSocioGrupos(ctx.ownerId)),
    create: escritaProcedure
      .input(z.object({ nome: z.string().min(1) }))
      .mutation(({ ctx, input }) => db.createSocioGrupo({ ownerId: ctx.ownerId, nome: input.nome })),
    update: escritaProcedure
      .input(z.object({ id: z.number(), nome: z.string().min(1) }))
      .mutation(({ ctx, input }) => db.updateSocioGrupo(ctx.ownerId, input.id, { nome: input.nome })),
    delete: escritaProcedure.input(z.object({ id: z.number() })).mutation(({ ctx, input }) => db.deleteSocioGrupo(ctx.ownerId, input.id)),
  }),

  // -------------------------------------------------------- inventory items
  inventoryItems: router({
    list: empresaProcedure
      .input(z.object({ propertyId: z.number() }))
      .query(({ ctx, input }) => db.listInventoryItems(ctx.ownerId, input.propertyId)),
    create: escritaProcedure
      .input(
        z.object({
          propertyId: z.number(),
          nome: z.string().min(1),
          quantidade: z.number().int().positive().default(1),
          descricao: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        db.createInventoryItem({
          ownerId: ctx.ownerId,
          propertyId: input.propertyId,
          nome: input.nome,
          quantidade: input.quantidade,
          descricao: input.descricao || null,
        }),
      ),
    update: escritaProcedure
      .input(
        z.object({
          id: z.number(),
          nome: z.string().optional(),
          quantidade: z.number().int().positive().optional(),
          descricao: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) => {
        const { id, ...rest } = input;
        return db.updateInventoryItem(ctx.ownerId, id, rest);
      }),
    delete: escritaProcedure.input(z.object({ id: z.number() })).mutation(({ ctx, input }) => db.deleteInventoryItem(ctx.ownerId, input.id)),
  }),

  // --------------------------------------------------------- property costs
  propertyCosts: router({
    list: empresaProcedure
      .input(z.object({ propertyId: z.number() }))
      .query(({ ctx, input }) => db.listPropertyCosts(ctx.ownerId, input.propertyId)),
    create: escritaProcedure
      .input(
        z.object({
          propertyId: z.number(),
          tipo: z.enum(["condominio", "iptu", "condominio_extra"]),
          // Condomínio e extras: valor da parcela. IPTU: valor TOTAL do ano, dividido por qtdMeses.
          valor: z.number().positive(),
          competenciaInicio: z.string().regex(/^\d{4}-\d{2}$/),
          qtdMeses: z.number().int().positive().default(12),
          dia: z.number().int().min(1).max(31).default(10),
          descricao: z.string().optional(),
          responsavel: z.enum(["proprietario", "inquilino"]).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const qtdMeses = input.tipo === "condominio_extra" ? 1 : input.qtdMeses;
        // O IPTU é informado pelo total do ano; guardamos o valor da parcela para que a DRE de
        // cada mês some apenas o que venceu naquele mês.
        const valorParcela = input.tipo === "iptu" ? input.valor / qtdMeses : input.valor;

        // Um condomínio novo encerra o anterior em aberto em vez de sobrescrevê-lo: o valor antigo
        // precisa continuar valendo nos meses já fechados.
        if (input.tipo === "condominio") {
          const anteriores = await db.listPropertyCosts(ctx.ownerId, input.propertyId);
          for (const ant of anteriores) {
            if (ant.tipo !== "condominio") continue;
            if (ant.competenciaInicio >= input.competenciaInicio) continue;
            const novaQtd = db.encerrarSerieAntes(ant.competenciaInicio, input.competenciaInicio);
            if (novaQtd < ant.qtdMeses) await db.updatePropertyCost(ctx.ownerId, ant.id, { qtdMeses: novaQtd });
          }
        }

        await db.createPropertyCost({
          ownerId: ctx.ownerId,
          propertyId: input.propertyId,
          tipo: input.tipo,
          valor: String(round2(valorParcela)),
          competenciaInicio: input.competenciaInicio,
          qtdMeses,
          dia: input.dia,
          descricao: input.descricao || null,
          responsavel: input.tipo === "condominio_extra" ? (input.responsavel ?? "proprietario") : null,
        });
        await sincronizarCustosDoImovel(ctx.ownerId, input.propertyId);
      }),
    update: escritaProcedure
      .input(
        z.object({
          id: z.number(),
          valor: z.number().positive().optional(),
          competenciaInicio: z.string().regex(/^\d{4}-\d{2}$/).optional(),
          qtdMeses: z.number().int().positive().optional(),
          dia: z.number().int().min(1).max(31).optional(),
          descricao: z.string().optional(),
          responsavel: z.enum(["proprietario", "inquilino"]).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const atual = await db.getPropertyCost(ctx.ownerId, input.id);
        if (!atual) throw new Error("Custo não encontrado");
        const { id, valor, ...rest } = input;
        const data: Record<string, unknown> = { ...rest };
        if (valor !== undefined) {
          const qtd = input.qtdMeses ?? atual.qtdMeses;
          data.valor = String(round2(atual.tipo === "iptu" ? valor / qtd : valor));
        }
        if (rest.descricao !== undefined) data.descricao = rest.descricao || null;
        await db.updatePropertyCost(ctx.ownerId, id, data);
        await sincronizarCustosDoImovel(ctx.ownerId, atual.propertyId);
      }),
    delete: escritaProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      const atual = await db.getPropertyCost(ctx.ownerId, input.id);
      if (!atual) return;
      await db.deleteLedgerEntriesByPropertyCost(ctx.ownerId, input.id);
      await db.deletePropertyCost(ctx.ownerId, input.id);
      await sincronizarCustosDoImovel(ctx.ownerId, atual.propertyId);
    }),
  }),

  // -------------------------------------------------- long term contracts (aluguel de longa duração)
  longTermContracts: router({
    list: empresaProcedure
      .input(z.object({ propertyId: z.number().optional() }))
      .query(({ ctx, input }) => db.listLongTermContracts(ctx.ownerId, input.propertyId)),
    get: empresaProcedure.input(z.object({ id: z.number() })).query(({ ctx, input }) => db.getLongTermContract(ctx.ownerId, input.id)),
    create: escritaProcedure
      .input(
        z.object({
          propertyId: z.number(),
          dataInicio: z.string(),
          indiceCorrecao: z.string().default("IGPM"),
          nomeInquilino: z.string().optional(),
          cpfCnpjInquilino: z.string().optional(),
          contatoInquilino: z.string().optional(),
          telefoneInquilino: z.string().optional(),
          celularInquilino: z.string().optional(),
          whatsappInquilino: z.string().optional(),
          emailInquilino: z.string().optional(),
          carenciaInicio: z.string().optional(),
          carenciaFim: z.string().optional(),
          prazoMeses: z.number().int().positive().default(12),
          diaVencimentoAluguel: z.number().int().min(1).max(31).default(10),
          tipoGarantia: z.string().optional(),
          comissaoPct: z.number().min(0).max(100).default(0),
          tipoAdministracao: z.enum(["propria", "administradora", "gestor_curta_temporada"]).default("propria"),
          imobiliariaId: z.number().optional(),
          valorAluguel: z.number().positive(),
          renovacaoAutomatica: z.enum(["novo_contrato", "prazo_indeterminado"]).optional(),
          prazoIndeterminadoDataInicio: z.string().optional(),
          prazoIndeterminadoValor: z.number().positive().optional(),
          prazoIndeterminadoPrazoReajusteMeses: z.number().int().positive().optional(),
          renovacaoNovoContratoDataInicio: z.string().optional(),
          renovacaoNovoContratoPrazoMeses: z.number().int().positive().optional(),
          condominioPor: costResponsibilitySchema.default("proprietario"),
          iptuPor: costResponsibilitySchema.default("proprietario"),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { valorAluguel, ...rest } = input;

        // Fim do contrato: início + prazo em meses. Reajuste: sempre a cada 12 meses a partir do início.
        const dataFim = addMonthsToDate(rest.dataInicio, rest.prazoMeses);
        const dataReajuste = addMonthsToDate(rest.dataInicio, 12);
        // Vigência do novo contrato da renovação, calculada do mesmo jeito.
        const renovacaoNovoContratoDataFim =
          rest.renovacaoNovoContratoDataInicio && rest.renovacaoNovoContratoPrazoMeses
            ? addMonthsToDate(rest.renovacaoNovoContratoDataInicio, rest.renovacaoNovoContratoPrazoMeses)
            : null;
        const renovacaoNovoContratoDataReajuste = rest.renovacaoNovoContratoDataInicio
          ? addMonthsToDate(rest.renovacaoNovoContratoDataInicio, 12)
          : null;

        const contractId = await db.createLongTermContract({
          ownerId: ctx.ownerId,
          propertyId: rest.propertyId,
          dataInicio: rest.dataInicio,
          dataFim,
          dataReajuste,
          indiceCorrecao: rest.indiceCorrecao,
          nomeInquilino: rest.nomeInquilino || null,
          cpfCnpjInquilino: rest.cpfCnpjInquilino || null,
          contatoInquilino: rest.contatoInquilino || null,
          telefoneInquilino: rest.telefoneInquilino || null,
          celularInquilino: rest.celularInquilino || null,
          whatsappInquilino: rest.whatsappInquilino || null,
          emailInquilino: rest.emailInquilino || null,
          carenciaInicio: rest.carenciaInicio || null,
          carenciaFim: rest.carenciaFim || null,
          prazoMeses: rest.prazoMeses,
          diaVencimentoAluguel: rest.diaVencimentoAluguel,
          tipoGarantia: rest.tipoGarantia || null,
          comissaoPct: String(rest.comissaoPct),
          tipoAdministracao: rest.tipoAdministracao,
          imobiliariaId: rest.tipoAdministracao === "administradora" ? (rest.imobiliariaId ?? null) : null,
          renovacaoAutomatica: rest.renovacaoAutomatica || null,
          prazoIndeterminadoDataInicio: rest.prazoIndeterminadoDataInicio || null,
          prazoIndeterminadoValor: rest.prazoIndeterminadoValor !== undefined ? String(rest.prazoIndeterminadoValor) : null,
          prazoIndeterminadoPrazoReajusteMeses: rest.prazoIndeterminadoPrazoReajusteMeses ?? null,
          renovacaoNovoContratoDataInicio: rest.renovacaoNovoContratoDataInicio || null,
          renovacaoNovoContratoPrazoMeses: rest.renovacaoNovoContratoPrazoMeses ?? null,
          renovacaoNovoContratoDataFim,
          renovacaoNovoContratoDataReajuste,
          condominioPor: rest.condominioPor,
          iptuPor: rest.iptuPor,
        });

        // Antes de existir a aba Contratos, o contrato de locação era anexado direto no imóvel.
        // Ao cadastrar o PRIMEIRO contrato de um imóvel que já tem esse anexo antigo, ele passa a
        // ser o anexo do contrato — é o mesmo documento, só migrando de lugar automaticamente, sem
        // exigir reenvio de quem está cadastrando o contrato agora.
        const imovel = await db.getProperty(ctx.ownerId, rest.propertyId);
        if (imovel?.contratoUrl) {
          await db.updateLongTermContract(ctx.ownerId, contractId, {
            contratoLocacaoUrl: imovel.contratoUrl,
            contratoLocacaoKey: imovel.contratoKey,
          });
          await db.updateProperty(ctx.ownerId, rest.propertyId, { contratoUrl: null, contratoKey: null });
        }

        // Primeiro aluguel devido: mês seguinte ao fim da carência (aluguel é pago postecipado).
        // Sem carência, cobra a partir do próprio mês de início.
        const inicioCobranca = rest.carenciaFim
          ? addMonthsToCompetencia(rest.carenciaFim.slice(0, 7), 1)
          : rest.dataInicio.slice(0, 7);
        for (let i = 0; i < rest.prazoMeses; i++) {
          const competencia = addMonthsToCompetencia(inicioCobranca, i);
          // O mês em que o contrato termina não gera cobrança (o contrato já encerrou nesse dia).
          if (competencia >= dataFim.slice(0, 7)) break;
          const dataVencimento = calcularVencimento(competencia, rest.diaVencimentoAluguel);
          const chargeId = await db.createContractRentCharge({
            ownerId: ctx.ownerId,
            contractId,
            propertyId: rest.propertyId,
            valor: String(valorAluguel),
            competencia,
            dataVencimento,
            status: "pendente",
          });

          // Lança a receita do aluguel automaticamente no plano de contas
          await db.createLedgerEntry({
            ownerId: ctx.ownerId,
            propertyId: rest.propertyId,
            chartAccountId: null,
            grupo: "receita",
            categoria: "Aluguel — Longa Duração",
            valor: String(valorAluguel),
            dia: Number(dataVencimento.slice(8, 10)) || 1,
            competenciaInicio: competencia,
            qtdMeses: 1,
            descricao: `Receita automática — Aluguel ${competencia} (${rest.nomeInquilino || "contrato"})`,
            contractRentChargeId: chargeId,
          });
        }

        // O contrato acabou de definir quem paga condomínio/IPTU nos meses que ele cobre, então os
        // custos já cadastrados no imóvel podem ter trocado de dono.
        await sincronizarCustosDoImovel(ctx.ownerId, rest.propertyId);

        return {
          id: contractId,
          // Presente só quando o anexo antigo do imóvel foi herdado — o cliente usa isso para
          // mostrar o documento como já anexado, em vez de oferecer "Anexar" de novo.
          contratoLocacaoUrl: imovel?.contratoUrl ?? null,
        };
      }),
    update: escritaProcedure
      .input(
        z.object({
          id: z.number(),
          dataInicio: z.string().optional(),
          dataFim: z.string().optional(),
          dataReajuste: z.string().optional(),
          indiceCorrecao: z.string().optional(),
          nomeInquilino: z.string().optional(),
          cpfCnpjInquilino: z.string().optional(),
          contatoInquilino: z.string().optional(),
          telefoneInquilino: z.string().optional(),
          celularInquilino: z.string().optional(),
          whatsappInquilino: z.string().optional(),
          emailInquilino: z.string().optional(),
          carenciaInicio: z.string().optional(),
          carenciaFim: z.string().optional(),
          prazoMeses: z.number().int().positive().optional(),
          diaVencimentoAluguel: z.number().int().min(1).max(31).optional(),
          tipoGarantia: z.string().optional(),
          comissaoPct: z.number().min(0).max(100).optional(),
          tipoAdministracao: z.enum(["propria", "administradora", "gestor_curta_temporada"]).optional(),
          imobiliariaId: z.number().nullable().optional(),
          renovacaoAutomatica: z.enum(["novo_contrato", "prazo_indeterminado"]).nullable().optional(),
          prazoIndeterminadoDataInicio: z.string().nullable().optional(),
          prazoIndeterminadoValor: z.number().positive().nullable().optional(),
          prazoIndeterminadoPrazoReajusteMeses: z.number().int().positive().nullable().optional(),
          renovacaoNovoContratoDataInicio: z.string().nullable().optional(),
          renovacaoNovoContratoPrazoMeses: z.number().int().positive().nullable().optional(),
          condominioPor: costResponsibilitySchema.optional(),
          iptuPor: costResponsibilitySchema.optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const {
          id, dataInicio, dataFim, dataReajuste, carenciaInicio, carenciaFim, comissaoPct, prazoIndeterminadoValor, imobiliariaId,
          renovacaoNovoContratoDataInicio, renovacaoNovoContratoPrazoMeses, ...rest
        } = input;
        const contrato = await db.getLongTermContract(ctx.ownerId, id);
        // Recalcula fim/reajuste do novo contrato da renovação sempre que início ou prazo mudam,
        // usando o que já estava salvo quando o campo não veio nesta chamada.
        const novoContratoDataInicio = renovacaoNovoContratoDataInicio !== undefined ? renovacaoNovoContratoDataInicio : (contrato?.renovacaoNovoContratoDataInicio ?? null);
        const novoContratoPrazoMeses = renovacaoNovoContratoPrazoMeses !== undefined ? renovacaoNovoContratoPrazoMeses : (contrato?.renovacaoNovoContratoPrazoMeses ?? null);
        await db.updateLongTermContract(ctx.ownerId, id, {
          ...rest,
          ...(comissaoPct !== undefined ? { comissaoPct: String(comissaoPct) } : {}),
          ...(prazoIndeterminadoValor !== undefined ? { prazoIndeterminadoValor: prazoIndeterminadoValor !== null ? String(prazoIndeterminadoValor) : null } : {}),
          ...(imobiliariaId !== undefined
            ? { imobiliariaId: (rest.tipoAdministracao ?? contrato?.tipoAdministracao) === "administradora" ? imobiliariaId : null }
            : {}),
          ...(dataInicio !== undefined ? { dataInicio } : {}),
          ...(dataFim !== undefined ? { dataFim } : {}),
          ...(dataReajuste !== undefined ? { dataReajuste } : {}),
          ...(carenciaInicio !== undefined ? { carenciaInicio } : {}),
          ...(carenciaFim !== undefined ? { carenciaFim } : {}),
          ...((renovacaoNovoContratoDataInicio !== undefined || renovacaoNovoContratoPrazoMeses !== undefined)
            ? {
                renovacaoNovoContratoDataInicio: novoContratoDataInicio,
                renovacaoNovoContratoPrazoMeses: novoContratoPrazoMeses,
                renovacaoNovoContratoDataFim: novoContratoDataInicio && novoContratoPrazoMeses ? addMonthsToDate(novoContratoDataInicio, novoContratoPrazoMeses) : null,
                renovacaoNovoContratoDataReajuste: novoContratoDataInicio ? addMonthsToDate(novoContratoDataInicio, 12) : null,
              }
            : {}),
        });
        // Vigência e responsabilidade podem ter mudado, e ambas alteram quem paga cada custo.
        if (contrato) await sincronizarCustosDoImovel(ctx.ownerId, contrato.propertyId);
      }),
    delete: escritaProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const contrato = await db.getLongTermContract(ctx.ownerId, input.id);
        const parcelas = await db.listContractRentCharges(ctx.ownerId, input.id);
        for (const p of parcelas) {
          if (p.descontoLedgerEntryId) await db.deleteLedgerEntry(ctx.ownerId, p.descontoLedgerEntryId);
          await db.deleteLedgerEntriesByContractRentCharge(ctx.ownerId, p.id);
        }
        await db.deleteLongTermContract(ctx.ownerId, input.id);
        // Sem contrato cobrindo os meses, os custos voltam a ser do proprietário.
        if (contrato) await sincronizarCustosDoImovel(ctx.ownerId, contrato.propertyId);
      }),

    // ---- recebíveis (parcelas) do contrato
    charges: empresaProcedure
      .input(z.object({ contractId: z.number().optional() }))
      .query(({ ctx, input }) => db.listContractRentCharges(ctx.ownerId, input.contractId)),
    addCharge: escritaProcedure
      .input(
        z.object({
          contractId: z.number(),
          propertyId: z.number(),
          valor: z.number().positive(),
          competencia: competenciaSchema,
          dataVencimento: z.string(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const chargeId = await db.createContractRentCharge({
          ownerId: ctx.ownerId,
          contractId: input.contractId,
          propertyId: input.propertyId,
          valor: String(input.valor),
          competencia: input.competencia,
          dataVencimento: input.dataVencimento,
          status: "pendente",
        });

        const contrato = await db.getLongTermContract(ctx.ownerId, input.contractId);

        // Lança a receita do aluguel automaticamente no plano de contas
        await db.createLedgerEntry({
          ownerId: ctx.ownerId,
          propertyId: input.propertyId,
          chartAccountId: null,
          grupo: "receita",
          categoria: "Aluguel — Longa Duração",
          valor: String(input.valor),
          dia: Number(input.dataVencimento.slice(8, 10)) || 1,
          competenciaInicio: input.competencia,
          qtdMeses: 1,
          descricao: `Receita automática — Aluguel ${input.competencia} (${contrato?.nomeInquilino || "contrato"})`,
          contractRentChargeId: chargeId,
        });

        // A parcela nasce zerada de condomínio/IPTU; a sincronização preenche o repasse do mês.
        await sincronizarCustosDoImovel(ctx.ownerId, input.propertyId);

        return { id: chargeId };
      }),
    markReceived: escritaProcedure
      .input(
        z.object({
          id: z.number(),
          dataRecebimento: z.string().optional(),
          multaJuros: z.number().min(0).default(0),
          desconto: z.number().min(0).default(0),
          descontoChartAccountId: z.number().optional(),
          descontoDescricao: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const charge = await db.getContractRentCharge(ctx.ownerId, input.id);
        if (!charge) throw new Error("Parcela não encontrada.");

        // Se já havia um desconto anterior vinculado (ex.: reenviando o formulário), remove o lançamento antigo primeiro.
        if (charge.descontoLedgerEntryId) {
          await db.deleteLedgerEntry(ctx.ownerId, charge.descontoLedgerEntryId);
        }

        let descontoLedgerEntryId: number | null = null;
        if (input.desconto > 0) {
          // Conta é opcional: se a pessoa descreveu o motivo, não precisa classificar por conta (e vice-versa).
          let contaResolvida: { conta: { id: number; grupo: "despesa_fixa" | "despesa_variavel" }; nome: string } | null = null;
          if (input.descontoChartAccountId) {
            contaResolvida = await resolveChartAccount(ctx.ownerId, input.descontoChartAccountId, ["despesa_fixa", "despesa_variavel"]);
          }
          descontoLedgerEntryId = await db.createLedgerEntry({
            ownerId: ctx.ownerId,
            propertyId: charge.propertyId,
            chartAccountId: contaResolvida?.conta.id ?? null,
            grupo: contaResolvida?.conta.grupo ?? "despesa_variavel",
            categoria: contaResolvida?.nome ?? null,
            valor: String(input.desconto),
            dia: 1,
            competenciaInicio: charge.competencia,
            qtdMeses: 1,
            descricao: input.descontoDescricao?.trim() || `Desconto concedido — aluguel ${charge.competencia}`,
          });
        }

        const valorRecebido = num(charge.valor) + input.multaJuros - input.desconto;

        await db.updateContractRentCharge(ctx.ownerId, input.id, {
          status: "recebido",
          dataRecebimento: input.dataRecebimento || new Date().toISOString().slice(0, 10),
          multaJuros: String(input.multaJuros),
          desconto: String(input.desconto),
          valorRecebido: String(valorRecebido),
          descontoLedgerEntryId,
        });

        return { success: true };
      }),
    markPending: escritaProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const charge = await db.getContractRentCharge(ctx.ownerId, input.id);
        if (charge?.descontoLedgerEntryId) {
          await db.deleteLedgerEntry(ctx.ownerId, charge.descontoLedgerEntryId);
        }
        return db.updateContractRentCharge(ctx.ownerId, input.id, {
          status: "pendente",
          dataRecebimento: null,
          multaJuros: "0.00",
          desconto: "0.00",
          valorRecebido: null,
          descontoLedgerEntryId: null,
        });
      }),
    updateCharge: escritaProcedure
      .input(z.object({ id: z.number(), valor: z.number().positive().optional(), dataVencimento: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const { id, valor, dataVencimento } = input;
        await db.updateContractRentCharge(ctx.ownerId, id, {
          ...(valor !== undefined ? { valor: String(valor) } : {}),
          ...(dataVencimento !== undefined ? { dataVencimento } : {}),
        });

        // Reconcilia a receita automática vinculada se o valor ou o vencimento mudou
        if (valor !== undefined || dataVencimento !== undefined) {
          const charge = await db.getContractRentCharge(ctx.ownerId, id);
          if (charge) {
            await db.deleteLedgerEntriesByContractRentCharge(ctx.ownerId, id);
            const contrato = await db.getLongTermContract(ctx.ownerId, charge.contractId);
            await db.createLedgerEntry({
              ownerId: ctx.ownerId,
              propertyId: charge.propertyId,
              chartAccountId: null,
              grupo: "receita",
              categoria: "Aluguel — Longa Duração",
              valor: String(num(charge.valor)),
              dia: Number(charge.dataVencimento.slice(8, 10)) || 1,
              competenciaInicio: charge.competencia,
              qtdMeses: 1,
              descricao: `Receita automática — Aluguel ${charge.competencia} (${contrato?.nomeInquilino || "contrato"})`,
              contractRentChargeId: id,
            });
          }
        }
      }),
    deleteCharge: escritaProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const charge = await db.getContractRentCharge(ctx.ownerId, input.id);
        if (charge?.descontoLedgerEntryId) {
          await db.deleteLedgerEntry(ctx.ownerId, charge.descontoLedgerEntryId);
        }
        await db.deleteLedgerEntriesByContractRentCharge(ctx.ownerId, input.id);
        return db.deleteContractRentCharge(ctx.ownerId, input.id);
      }),
  }),

  // --------------------------------------------------------- reservations
  reservations: router({
    list: empresaProcedure
      .input(z.object({ propertyId: z.number().optional(), competencia: z.string().optional() }))
      .query(({ ctx, input }) => db.listReservations(ctx.ownerId, input.propertyId, input.competencia)),
    create: escritaProcedure
      .input(
        z.object({
          propertyId: z.number(),
          codigo: z.string().min(1),
          valorBruto: z.number().positive(),
          taxaLimpeza: z.number().min(0),
          taxaAirbnb: z.number().min(0).default(0),
          outrasTaxas: z.number().min(0).default(0),
          valorLiquidoRecebido: z.number().min(0).default(0),
          checkin: z.string(),
          checkout: z.string(),
          noites: z.number().int().positive(),
          faxinasUtilizadas: z.number().int().min(0).default(1),
          nomeHospede: z.string().optional(),
          cpfHospede: z.string().optional(),
          passaporteHospede: z.string().optional(),
          estrangeiro: z.boolean().default(false),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const novaReservaId = await db.createReservation({
          ownerId: ctx.ownerId,
          propertyId: input.propertyId,
          codigo: input.codigo,
          valorBruto: String(input.valorBruto),
          taxaLimpeza: String(input.taxaLimpeza),
          taxaAirbnb: String(input.taxaAirbnb),
          outrasTaxas: String(input.outrasTaxas),
          valorLiquidoRecebido: String(input.valorLiquidoRecebido),
          checkin: input.checkin,
          checkout: input.checkout,
          noites: input.noites,
          faxinasUtilizadas: input.faxinasUtilizadas,
          competencia: input.checkin.slice(0, 7),
          nomeHospede: input.nomeHospede || null,
          cpfHospede: input.cpfHospede || null,
          passaporteHospede: input.passaporteHospede || null,
          estrangeiro: input.estrangeiro ? 1 : 0,
        });

        // Lança a receita da locação automaticamente no plano de contas
        await db.createLedgerEntry({
          ownerId: ctx.ownerId,
          propertyId: input.propertyId,
          chartAccountId: null,
          grupo: "receita",
          categoria: "Aluguel — Curta Temporada",
          valor: String(input.valorBruto + input.taxaLimpeza),
          dia: Number(input.checkin.slice(8, 10)) || 1,
          competenciaInicio: input.checkin.slice(0, 7),
          qtdMeses: 1,
          descricao: `Receita automática — Reserva ${input.codigo}`,
          reservationId: novaReservaId,
        });

        // Gerar despesa automática de faxina se houver custo configurado no imóvel
        if (input.faxinasUtilizadas > 0) {
          const prop = await db.getProperty(ctx.ownerId, input.propertyId);
          const custoUnit = Number(prop?.custoFaxina ?? 0);
          if (custoUnit > 0) {
            const totalFaxina = custoUnit * input.faxinasUtilizadas;
            await db.createLedgerEntry({
              ownerId: ctx.ownerId,
              propertyId: input.propertyId,
              chartAccountId: null,
              grupo: "despesa_variavel",
              categoria: "Faxineira",
              valor: String(totalFaxina),
              dia: Number(input.checkin.slice(8, 10)) || 1,
              competenciaInicio: input.checkin.slice(0, 7),
              qtdMeses: 1,
              descricao: `Faxina automática — Reserva ${input.codigo} (${input.faxinasUtilizadas}x R$ ${custoUnit.toFixed(2)})`,
              reservationId: novaReservaId,
            });
          }
        }
      }),
    update: escritaProcedure
      .input(
        z.object({
          id: z.number(),
          codigo: z.string().optional(),
          valorBruto: z.number().positive().optional(),
          taxaLimpeza: z.number().min(0).optional(),
          taxaAirbnb: z.number().min(0).optional(),
          outrasTaxas: z.number().min(0).optional(),
          valorLiquidoRecebido: z.number().min(0).optional(),
          checkin: z.string().optional(),
          checkout: z.string().optional(),
          noites: z.number().int().positive().optional(),
          faxinasUtilizadas: z.number().int().min(0).optional(),
          nomeHospede: z.string().optional(),
          cpfHospede: z.string().optional(),
          passaporteHospede: z.string().optional(),
          estrangeiro: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { id, valorBruto, taxaLimpeza, taxaAirbnb, outrasTaxas, valorLiquidoRecebido, checkin, checkout, faxinasUtilizadas, estrangeiro, ...rest } = input;

        // Verificar se há NFS-e emitida — bloquear edição de campos fiscais e de período
        const notasExistentes = await db.listInvoicesByReservation(ctx.ownerId, id);
        if (notasExistentes.length > 0) {
          const camposBloqueados = valorBruto !== undefined || taxaLimpeza !== undefined || taxaAirbnb !== undefined || checkin !== undefined || checkout !== undefined || rest.codigo !== undefined;
          if (camposBloqueados) {
            throw new Error("Não é possível alterar valores, período ou código de uma reserva com NFS-e já emitida. Cancele as notas primeiro.");
          }
        }

        await db.updateReservation(ctx.ownerId, id, {
          ...rest,
          ...(valorBruto !== undefined ? { valorBruto: String(valorBruto) } : {}),
          ...(taxaLimpeza !== undefined ? { taxaLimpeza: String(taxaLimpeza) } : {}),
          ...(taxaAirbnb !== undefined ? { taxaAirbnb: String(taxaAirbnb) } : {}),
          ...(outrasTaxas !== undefined ? { outrasTaxas: String(outrasTaxas) } : {}),
          ...(valorLiquidoRecebido !== undefined ? { valorLiquidoRecebido: String(valorLiquidoRecebido) } : {}),
          ...(checkin !== undefined ? { checkin, competencia: checkin.slice(0, 7) } : {}),
          ...(checkout !== undefined ? { checkout } : {}),
          ...(faxinasUtilizadas !== undefined ? { faxinasUtilizadas } : {}),
          ...(estrangeiro !== undefined ? { estrangeiro: estrangeiro ? 1 : 0 } : {}),
        });

        // Reconciliar lançamentos automáticos (receita + despesa de faxina) se algo que os afeta mudou
        const afetaLancamentosAutomaticos =
          faxinasUtilizadas !== undefined || valorBruto !== undefined || taxaLimpeza !== undefined || checkin !== undefined;
        if (afetaLancamentosAutomaticos) {
          const reserva = await db.getReservation(ctx.ownerId, id);
          if (reserva) {
            // Remove os lançamentos antigos vinculados (receita + faxina) para recriar do zero
            await db.deleteLedgerEntriesByReservation(ctx.ownerId, id);

            // Recria a receita automática da locação
            await db.createLedgerEntry({
              ownerId: ctx.ownerId,
              propertyId: reserva.propertyId,
              chartAccountId: null,
              grupo: "receita",
              categoria: "Aluguel — Curta Temporada",
              valor: String(num(reserva.valorBruto) + num(reserva.taxaLimpeza)),
              dia: Number(reserva.checkin.slice(8, 10)) || 1,
              competenciaInicio: reserva.competencia,
              qtdMeses: 1,
              descricao: `Receita automática — Reserva ${reserva.codigo}`,
              reservationId: id,
            });

            // Recria a despesa automática de faxina, se houver
            const faxinasAtual = faxinasUtilizadas !== undefined ? faxinasUtilizadas : reserva.faxinasUtilizadas;
            if (faxinasAtual > 0) {
              const prop = await db.getProperty(ctx.ownerId, reserva.propertyId);
              const custoUnit = Number(prop?.custoFaxina ?? 0);
              if (custoUnit > 0) {
                await db.createLedgerEntry({
                  ownerId: ctx.ownerId,
                  propertyId: reserva.propertyId,
                  chartAccountId: null,
                  grupo: "despesa_variavel",
                  categoria: "Faxineira",
                  valor: String(custoUnit * faxinasAtual),
                  dia: Number(reserva.checkin.slice(8, 10)) || 1,
                  competenciaInicio: reserva.competencia,
                  qtdMeses: 1,
                  descricao: `Faxina automática — Reserva ${reserva.codigo} (${faxinasAtual}x R$ ${custoUnit.toFixed(2)})`,
                  reservationId: id,
                });
              }
            }
          }
        }
      }),
    delete: escritaProcedure.input(z.object({ id: z.number() })).mutation(({ ctx, input }) => db.deleteReservation(ctx.ownerId, input.id)),

    // Confirma que o valor caiu na conta — o mesmo valor líquido informado no cadastro
    // (Confirmar valor Airbnb) ou um valor diferente (Alterar valor), com a data do recebimento.
    marcarRecebimento: escritaProcedure
      .input(z.object({ id: z.number(), dataRecebimento: z.string(), valorRecebido: z.number().min(0) }))
      .mutation(({ ctx, input }) =>
        db.updateReservation(ctx.ownerId, input.id, {
          dataRecebimento: input.dataRecebimento,
          valorRecebido: String(input.valorRecebido),
        }),
      ),

    // Importação de CSV do Airbnb
    importCsv: escritaProcedure
      .input(
        z.object({
          propertyId: z.number(),
          rows: z.array(
            z.object({
              codigo: z.string(),
              valorBruto: z.number(),
              taxaLimpeza: z.number(),
              taxaAirbnb: z.number().default(0),
              outrasTaxas: z.number().default(0),
              valorLiquidoRecebido: z.number().default(0),
              nomeHospede: z.string().optional(),
              cpfHospede: z.string().optional(),
              passaporteHospede: z.string().optional(),
              estrangeiro: z.boolean().default(false),
              checkin: z.string(),
              checkout: z.string(),
              noites: z.number().int().positive(),
              faxinasUtilizadas: z.number().int().min(0).default(1),
            }),
          ),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const prop = await db.getProperty(ctx.ownerId, input.propertyId);
        if (!prop) throw new Error("Imóvel não encontrado");
        const custoUnit = Number(prop.custoFaxina ?? 0);
        let importadas = 0;

        for (const row of input.rows) {
          const novaReservaId = await db.createReservation({
            ownerId: ctx.ownerId,
            propertyId: input.propertyId,
            codigo: row.codigo,
            valorBruto: String(row.valorBruto),
            taxaLimpeza: String(row.taxaLimpeza),
            taxaAirbnb: String(row.taxaAirbnb),
            outrasTaxas: String(row.outrasTaxas),
            valorLiquidoRecebido: String(row.valorLiquidoRecebido),
            nomeHospede: row.nomeHospede || null,
            cpfHospede: row.cpfHospede || null,
            passaporteHospede: row.passaporteHospede || null,
            estrangeiro: row.estrangeiro ? 1 : 0,
            checkin: row.checkin,
            checkout: row.checkout,
            noites: row.noites,
            faxinasUtilizadas: row.faxinasUtilizadas,
            competencia: row.checkin.slice(0, 7),
          });

          // Lança a receita da locação automaticamente no plano de contas
          await db.createLedgerEntry({
            ownerId: ctx.ownerId,
            propertyId: input.propertyId,
            chartAccountId: null,
            grupo: "receita",
            categoria: "Aluguel — Curta Temporada",
            valor: String(row.valorBruto + row.taxaLimpeza),
            dia: Number(row.checkin.slice(8, 10)) || 1,
            competenciaInicio: row.checkin.slice(0, 7),
            qtdMeses: 1,
            descricao: `Receita automática — Reserva ${row.codigo}`,
            reservationId: novaReservaId,
          });

          // Gerar despesa de faxina automática
          if (row.faxinasUtilizadas > 0 && custoUnit > 0) {
            const totalFaxina = custoUnit * row.faxinasUtilizadas;
            await db.createLedgerEntry({
              ownerId: ctx.ownerId,
              propertyId: input.propertyId,
              chartAccountId: null,
              grupo: "despesa_variavel",
              categoria: "Faxineira",
              valor: String(totalFaxina),
              dia: Number(row.checkin.slice(8, 10)) || 1,
              competenciaInicio: row.checkin.slice(0, 7),
              qtdMeses: 1,
              descricao: `Faxina automática — Reserva ${row.codigo} (${row.faxinasUtilizadas}x R$ ${custoUnit.toFixed(2)})`,
              reservationId: novaReservaId,
            });
          }
          importadas++;
        }

        return { importadas };
      }),

    // Nota fiscal por reserva
    invoices: empresaProcedure
      .input(z.object({ reservationId: z.number() }))
      .query(({ ctx, input }) => db.listInvoicesByReservation(ctx.ownerId, input.reservationId)),

    // Notas por imóvel (para o extrato de repasse), filtradas por competência
    invoicesByProperty: empresaProcedure
      .input(z.object({ propertyId: z.number(), competencia: z.string().regex(/^\d{4}-\d{2}$/) }))
      .query(async ({ ctx, input }) => {
        const reservas = await db.listReservations(ctx.ownerId, input.propertyId, input.competencia);
        const ids = new Set(reservas.map((r) => r.id));
        const notas = await db.listInvoicesByProperty(ctx.ownerId, input.propertyId);
        return notas.filter((n) => n.reservationId != null && ids.has(n.reservationId));
      }),

    emitir: escritaProcedure
      .input(z.object({ reservationId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const reserva = await db.getReservation(ctx.ownerId, input.reservationId);
        if (!reserva) throw new Error("Reserva não encontrada");
        const prop = await db.getProperty(ctx.ownerId, reserva.propertyId);
        if (!prop) throw new Error("Imóvel não encontrado");
        const cliente = prop.clientId ? await db.getClient(ctx.ownerId, prop.clientId) : null;
        if (!cliente && prop.clientId) throw new Error("Cliente não encontrado");

        // limpa notas anteriores desta reserva (idempotência simples)
        await db.deleteInvoicesByReservation(ctx.ownerId, input.reservationId);

        // Imóvel administrado diretamente pelo próprio proprietário (ex.: holding com
        // imóveis próprios) não tem administradora cobrando comissão de terceiro —
        // não faz sentido emitir nota de comissão para si mesmo.
        const isPropria = prop.tipoAdministracao === "propria";

        const resultado = processarOperacao({
          reservaCodigo: reserva.codigo,
          propriedadeApelido: prop.apelido,
          checkin: reserva.checkin,
          checkout: reserva.checkout,
          noites: reserva.noites,
          valorBruto: num(reserva.valorBruto),
          taxaLimpeza: num(reserva.taxaLimpeza),
          taxaAirbnb: num(reserva.taxaAirbnb),
          comissaoPct: isPropria ? 0 : num(prop.comissaoPct),
          admin: {
            cnpj: "00.000.000/0001-00",
            razaoSocial: ctx.user.name || "Administradora",
          },
          proprietario: cliente
            ? { nome: cliente.nome, cpfCnpj: cliente.cpfCnpj, tipo: cliente.tipo }
            : { nome: ctx.user.name || "Holding", cpfCnpj: "", tipo: "PJ" as const },
          fiscalCategory: (cliente?.fiscalCategory as "pj" | "pf_cbs_ibs" | "pf_isento") ?? "pj",
        });

        // Emite nota de comissão apenas quando há administradora/gestor de fato
        let respComissao = null;
        if (!isPropria) {
          respComissao = await emitirNfse(resultado.notaComissao);
          await db.createInvoice({
            ownerId: ctx.ownerId,
            reservationId: reserva.id,
            propertyId: prop.id,
            tipo: "comissao",
            codigoServico: COD_INTERMEDIACAO,
            valorServicos: String(resultado.comissaoAdmin),
            status: "autorizada",
            chaveAcesso: respComissao.chaveAcesso,
            numeroNfse: respComissao.numeroNfse,
            payloadJson: JSON.stringify(resultado.notaComissao),
            respostaJson: JSON.stringify(respComissao),
          });
        }

        // Nota de locação: apenas se não for PF isento
        let respLocacao = null;
        if (resultado.gerarNotaLocacao) {
          respLocacao = await emitirNfse(resultado.notaLocacao);
          await db.createInvoice({
            ownerId: ctx.ownerId,
            reservationId: reserva.id,
            propertyId: prop.id,
            tipo: "locacao",
            codigoServico: COD_LOCACAO,
            valorServicos: String(resultado.receitaLocacao),
            baseCalculo: String(resultado.baseTributavelLocacao),
            cbs: String(resultado.cbsLocacao),
            ibs: String(resultado.ibsLocacao),
            status: "autorizada",
            chaveAcesso: respLocacao.chaveAcesso,
            numeroNfse: respLocacao.numeroNfse,
            payloadJson: JSON.stringify(resultado.notaLocacao),
            respostaJson: JSON.stringify(respLocacao),
          });
        }

        return { resultado, respComissao, respLocacao };
      }),
  }),

  // --------------------------------------------------------------- DRE
  dre: router({
    porUnidade: financeiroProcedure
      .input(z.object({ propertyId: z.number(), competencia: z.string().regex(/^\d{4}-\d{2}$/) }))
      .query(async ({ ctx, input }) => {
        const prop = await db.getProperty(ctx.ownerId, input.propertyId);
        if (!prop) throw new Error("Imóvel não encontrado");
        const cliente = prop.clientId ? await db.getClient(ctx.ownerId, prop.clientId) : null;

        const reservas = await db.listReservations(ctx.ownerId, input.propertyId, input.competencia);
        const despesasFixasRaw = await db.listLedgerEntriesNaCompetencia(ctx.ownerId, input.propertyId, input.competencia, "despesa_fixa");
        const despesasVariaveisRaw = await db.listLedgerEntriesNaCompetencia(ctx.ownerId, input.propertyId, input.competencia, "despesa_variavel");
        // Exclui lançamentos automáticos de receita (já contabilizados abaixo a partir das próprias
        // reservas/parcelas) para não contar a mesma receita duas vezes.
        const receitasManuaisRaw = (await db.listLedgerEntriesNaCompetencia(ctx.ownerId, input.propertyId, input.competencia, "receita")).filter(
          (e) => !e.reservationId && !e.contractRentChargeId,
        );
        const aportesRaw = await db.listLedgerEntriesNaCompetencia(ctx.ownerId, input.propertyId, input.competencia, "aporte_capital");

        let receitaBruta = 0;
        let taxaAirbnb = 0;
        let comissao = 0;
        let cbs = 0;
        let ibs = 0;
        let liquidoProp = 0;
        const comissaoPct = prop.tipoAdministracao === "propria" ? 0 : num(prop.comissaoPct);
        let totalParcelasLonga = 0;

        for (const r of reservas) {
          const res = processarOperacao({
            reservaCodigo: r.codigo,
            propriedadeApelido: prop.apelido,
            checkin: r.checkin,
            checkout: r.checkout,
            noites: r.noites,
            valorBruto: num(r.valorBruto),
            taxaLimpeza: num(r.taxaLimpeza),
            taxaAirbnb: num(r.taxaAirbnb),
            comissaoPct,
            admin: { cnpj: "", razaoSocial: "" },
            proprietario: { nome: cliente?.nome || "", cpfCnpj: cliente?.cpfCnpj || "", tipo: cliente?.tipo || "PF" },
            fiscalCategory: (cliente?.fiscalCategory as "pj" | "pf_cbs_ibs" | "pf_isento") ?? "pj",
          });
          receitaBruta += res.receitaLocacao;
          taxaAirbnb += res.taxaAirbnb;
          comissao += res.comissaoAdmin;
          cbs += res.cbsLocacao;
          ibs += res.ibsLocacao;
          liquidoProp += res.liquidoProprietario;
        }

        // Receita de aluguel de longa duração: parcelas do contrato com competência neste mês.
        if (prop.tipoLocacao === "longa") {
          const parcelas = await db.listContractRentChargesByProperty(ctx.ownerId, input.propertyId, input.competencia);
          const contratos = await db.listLongTermContracts(ctx.ownerId, input.propertyId);
          const contrato = contratos[0];
          const comissaoPctLonga = contrato && contrato.tipoAdministracao !== "propria" ? num(contrato.comissaoPct) : 0;
          for (const p of parcelas) {
            const valorParcela = num(p.valor);
            const comissaoParcela = valorParcela * (comissaoPctLonga / 100);
            receitaBruta += valorParcela;
            comissao += comissaoParcela;
            liquidoProp += valorParcela - comissaoParcela;
            totalParcelasLonga++;
          }
        }

        const despesasFixas = despesasFixasRaw.map((e) => ({ ...e, valor: num(e.valor) }));
        const despesasVariaveis = despesasVariaveisRaw.map((e) => ({ ...e, valor: num(e.valor) }));
        const receitasManuais = receitasManuaisRaw.map((e) => ({ ...e, valor: num(e.valor) }));
        const aportes = aportesRaw.map((e) => ({ ...e, valor: num(e.valor) }));

        const totalDespesasFixas = despesasFixas.reduce((s, e) => s + e.valor, 0);
        const totalDespesasVariaveis = despesasVariaveis.reduce((s, e) => s + e.valor, 0);
        const totalDespesas = totalDespesasFixas + totalDespesasVariaveis;
        const totalReceitasManuais = receitasManuais.reduce((s, e) => s + e.valor, 0);
        const totalAportes = aportes.reduce((s, e) => s + e.valor, 0);

        // Receitas lançadas manualmente somam ao resultado sem incidência de comissão
        // (comissão é específica da locação, já calculada acima a partir de reservas/contratos).
        const resultadoProprietario = liquidoProp + totalReceitasManuais - totalDespesas;

        const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

        return {
          propriedade: prop,
          cliente,
          competencia: input.competencia,
          totalReservas: reservas.length + totalParcelasLonga,
          receitaBruta: round2(receitaBruta),
          taxaAirbnb: round2(taxaAirbnb),
          comissao: round2(comissao),
          cbs: round2(cbs),
          ibs: round2(ibs),
          repasseBruto: round2(liquidoProp),
          despesasFixas,
          totalDespesasFixas: round2(totalDespesasFixas),
          despesasVariaveis,
          totalDespesasVariaveis: round2(totalDespesasVariaveis),
          totalDespesas: round2(totalDespesas),
          receitasManuais,
          totalReceitasManuais: round2(totalReceitasManuais),
          aportes,
          totalAportes: round2(totalAportes),
          resultadoProprietario: round2(resultadoProprietario),
        };
      }),

    // DRE consolidado da empresa: soma os lançamentos (Receitas/Despesas/Aportes) de todos os
    // imóveis para a competência, organizados pelas contas do plano de contas.
    empresa: financeiroProcedure
      .input(z.object({ competencia: z.string().regex(/^\d{4}-\d{2}$/) }))
      .query(async ({ ctx, input }) => {
        const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
        const grupos = ["receita", "despesa_fixa", "despesa_variavel", "aporte_capital"] as const;

        const secoes = await Promise.all(
          grupos.map(async (grupo) => {
            const todos = await db.listLedgerEntries(ctx.ownerId, undefined, grupo);
            const doMes = todos.filter((e) => db.competenciaNaSerie(e.competenciaInicio, e.qtdMeses, input.competencia));

            const porConta = new Map<string, number>();
            for (const e of doMes) {
              const chave = e.categoria || "Sem conta";
              porConta.set(chave, (porConta.get(chave) ?? 0) + num(e.valor));
            }
            const contas = Array.from(porConta.entries())
              .map(([nome, total]) => ({ nome, total: round2(total) }))
              .sort((a, b) => b.total - a.total);

            return { grupo, contas, total: round2(contas.reduce((s, c) => s + c.total, 0)) };
          }),
        );

        const porGrupo = Object.fromEntries(secoes.map((s) => [s.grupo, s])) as Record<(typeof grupos)[number], (typeof secoes)[number]>;

        const totalReceitas = porGrupo.receita.total;
        const totalDespesasFixas = porGrupo.despesa_fixa.total;
        const totalDespesasVariaveis = porGrupo.despesa_variavel.total;
        const totalAportes = porGrupo.aporte_capital.total;

        return {
          competencia: input.competencia,
          receitas: porGrupo.receita,
          despesasFixas: porGrupo.despesa_fixa,
          despesasVariaveis: porGrupo.despesa_variavel,
          aportes: porGrupo.aporte_capital,
          totalReceitas,
          totalDespesasFixas,
          totalDespesasVariaveis,
          totalDespesas: round2(totalDespesasFixas + totalDespesasVariaveis),
          totalAportes,
          resultado: round2(totalReceitas - totalDespesasFixas - totalDespesasVariaveis),
        };
      }),
  }),

  // --------------------------------------------------------- relatórios
  relatorios: router({
    // Relatório mensal para a EFD Contribuições: quem alugou cada unidade (curta e longa
    // duração), com nome, CPF/passaporte e valor, mais o total recebido no mês.
    // Regime de caixa NA PARTE DE CURTA TEMPORADA: conta pela data em que o dinheiro
    // efetivamente caiu (recebimento confirmado), não pela data do check-in — reserva sem
    // recebimento confirmado ainda não entra em nenhum mês.
    // A parte de longa duração continua por competência (vencimento): mudar pra regime de caixa
    // aqui esvaziaria o relatório de qualquer empresa com parcela vencida ainda não baixada em
    // "Aluguéis a Receber" — é uma troca maior, que precisa de decisão do cliente antes.
    efdContribuicoes: financeiroProcedure
      .input(z.object({ competencia: z.string().regex(/^\d{4}-\d{2}$/) }))
      .query(async ({ ctx, input }) => {
        const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
        const props = await db.listProperties(ctx.ownerId);
        const propMap = new Map(props.map((p) => [p.id, p]));

        const reservas = await db.listReservationsRecebidasNaCompetencia(ctx.ownerId, input.competencia);
        const parcelas = await db.listContractRentChargesByCompetencia(ctx.ownerId, input.competencia);

        type Item = {
          nome: string;
          documento: string;
          tipoDocumento: string;
          tipoLocacao: "curta" | "longa";
          imovel: string;
          valor: number;
        };
        const itens: Item[] = [];

        for (const r of reservas) {
          const prop = propMap.get(r.propertyId);
          itens.push({
            nome: r.nomeHospede || "(não informado)",
            documento: (r.estrangeiro ? r.passaporteHospede : r.cpfHospede) || "-",
            tipoDocumento: r.estrangeiro ? "Passaporte" : "CPF",
            tipoLocacao: "curta",
            imovel: prop?.apelido || "-",
            valor: round2(num(r.valorBruto) + num(r.taxaLimpeza)),
          });
        }

        const contractIds = Array.from(new Set(parcelas.map((p) => p.contractId)));
        const contratosArr = await Promise.all(contractIds.map((id) => db.getLongTermContract(ctx.ownerId, id)));
        const contratoMap = new Map(contratosArr.filter((c): c is NonNullable<typeof c> => !!c).map((c) => [c.id, c]));

        for (const p of parcelas) {
          const contrato = contratoMap.get(p.contractId);
          const prop = propMap.get(p.propertyId);
          itens.push({
            nome: contrato?.nomeInquilino || "(não informado)",
            documento: contrato?.cpfCnpjInquilino || "-",
            tipoDocumento: "CPF/CNPJ",
            tipoLocacao: "longa",
            imovel: prop?.apelido || "-",
            valor: round2(num(p.valor)),
          });
        }

        itens.sort((a, b) => a.nome.localeCompare(b.nome));

        return {
          competencia: input.competencia,
          itens,
          total: round2(itens.reduce((s, i) => s + i.valor, 0)),
        };
      }),

    // DIMOB: relatório anual de quem alugou cada unidade (curta e longa duração) durante
    // o ano inteiro, com nome, CPF/passaporte e valor total recebido no ano por locação.
    // Regime de caixa NA PARTE DE CURTA TEMPORADA, igual à EFD Contribuições acima. A parte de
    // longa duração continua por competência — ver o comentário na EFD Contribuições.
    dimob: financeiroProcedure
      .input(z.object({ ano: z.string().regex(/^\d{4}$/) }))
      .query(async ({ ctx, input }) => {
        const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
        const props = await db.listProperties(ctx.ownerId);
        const propMap = new Map(props.map((p) => [p.id, p]));

        const reservas = await db.listReservationsRecebidasNoAno(ctx.ownerId, input.ano);
        const parcelas = await db.listContractRentChargesByYear(ctx.ownerId, input.ano);

        type Item = {
          nome: string;
          documento: string;
          tipoDocumento: string;
          tipoLocacao: "curta" | "longa";
          imovel: string;
          valor: number;
        };
        const porChave = new Map<string, Item>();

        for (const r of reservas) {
          const prop = propMap.get(r.propertyId);
          const documento = (r.estrangeiro ? r.passaporteHospede : r.cpfHospede) || "-";
          const chave = `curta|${documento}|${r.nomeHospede}|${r.propertyId}`;
          const valor = round2(num(r.valorBruto) + num(r.taxaLimpeza));
          const existente = porChave.get(chave);
          if (existente) existente.valor = round2(existente.valor + valor);
          else
            porChave.set(chave, {
              nome: r.nomeHospede || "(não informado)",
              documento,
              tipoDocumento: r.estrangeiro ? "Passaporte" : "CPF",
              tipoLocacao: "curta",
              imovel: prop?.apelido || "-",
              valor,
            });
        }

        const contractIds = Array.from(new Set(parcelas.map((p) => p.contractId)));
        const contratosArr = await Promise.all(contractIds.map((id) => db.getLongTermContract(ctx.ownerId, id)));
        const contratoMap = new Map(contratosArr.filter((c): c is NonNullable<typeof c> => !!c).map((c) => [c.id, c]));

        for (const p of parcelas) {
          const contrato = contratoMap.get(p.contractId);
          const prop = propMap.get(p.propertyId);
          const documento = contrato?.cpfCnpjInquilino || "-";
          const chave = `longa|${documento}|${contrato?.nomeInquilino}|${p.propertyId}`;
          const valor = round2(num(p.valor));
          const existente = porChave.get(chave);
          if (existente) existente.valor = round2(existente.valor + valor);
          else
            porChave.set(chave, {
              nome: contrato?.nomeInquilino || "(não informado)",
              documento,
              tipoDocumento: "CPF/CNPJ",
              tipoLocacao: "longa",
              imovel: prop?.apelido || "-",
              valor,
            });
        }

        const itens = Array.from(porChave.values()).sort((a, b) => a.nome.localeCompare(b.nome));

        return {
          ano: input.ano,
          itens,
          total: round2(itens.reduce((s, i) => s + i.valor, 0)),
        };
      }),

    /**
     * Informe anual de aluguel, por contrato — serve tanto ao inquilino (informe de pagamento)
     * quanto ao proprietário (informe de rendimentos); o que muda entre os dois é só o texto.
     *
     * Duas regras definem o número impresso: segue REGIME DE CAIXA (conta pela data de
     * recebimento, então o aluguel de dezembro pago em janeiro cai no ano seguinte) e considera
     * apenas o aluguel — multa e juros somam, desconto subtrai, mas condomínio e IPTU repassados
     * ficam de fora, porque não são rendimento de locação.
     */
    informeIr: financeiroProcedure
      .input(z.object({ contractId: z.number(), ano: z.string().regex(/^\d{4}$/) }))
      .query(async ({ ctx, input }) => {
        const contrato = await db.getLongTermContract(ctx.ownerId, input.contractId);
        if (!contrato) throw new Error("Contrato não encontrado");
        const imovel = await db.getProperty(ctx.ownerId, contrato.propertyId);
        const proprietario = imovel?.clientId ? await db.getClient(ctx.ownerId, imovel.clientId) : null;
        const empresa = await db.getUserById(ctx.ownerId);

        const parcelas = await db.listContractRentChargesRecebidasNoAno(ctx.ownerId, input.ano, input.contractId);

        const meses = parcelas.map((p) => {
          const aluguel = num(p.valor);
          const multaJuros = num(p.multaJuros);
          const desconto = num(p.desconto);
          return {
            competencia: p.competencia,
            dataRecebimento: p.dataRecebimento,
            aluguel: round2(aluguel),
            multaJuros: round2(multaJuros),
            desconto: round2(desconto),
            // Base do informe: o que entrou a título de locação.
            valorRecebido: round2(aluguel + multaJuros - desconto),
            // Fora do total, apenas para o inquilino conferir o que pagou no ano.
            condominio: round2(num(p.condominio)),
            iptu: round2(num(p.iptu)),
          };
        });

        const somar = (campo: keyof (typeof meses)[number]) => round2(meses.reduce((s, m) => s + (m[campo] as number), 0));

        return {
          ano: input.ano,
          contrato: {
            id: contrato.id,
            nomeInquilino: contrato.nomeInquilino,
            cpfCnpjInquilino: contrato.cpfCnpjInquilino,
            dataInicio: contrato.dataInicio,
            dataFim: contrato.dataFim,
          },
          imovel: imovel ? { apelido: imovel.apelido, endereco: imovel.endereco } : null,
          proprietario: proprietario ? { nome: proprietario.nome, cpfCnpj: proprietario.cpfCnpj } : null,
          // A administradora do contrato é a EMPRESA que administra o imóvel, não quem emitiu o
          // documento. Um contador gerando o informe de um cliente estaria assinando como
          // administradora daquela locação, o que não é verdade — e isso vai impresso num papel
          // entregue ao inquilino e ao proprietário para declarar imposto.
          administradora: {
            razaoSocial: empresa?.razaoSocial || empresa?.name || null,
            cnpj: empresa?.cnpj ?? null,
          },
          meses,
          totalAluguel: somar("aluguel"),
          totalMultaJuros: somar("multaJuros"),
          totalDesconto: somar("desconto"),
          /** O que vai no informe de IR. */
          total: somar("valorRecebido"),
          /** Repasses do ano — informativo, fora do total do IR. */
          totalCondominio: somar("condominio"),
          totalIptu: somar("iptu"),
        };
      }),
  }),

  // --------------------------------------------------------- dashboard
  dashboard: router({
    // O painel é a porta de entrada de qualquer nível, então não pode ser fechado como as telas de
    // resultado — em vez disso, os números financeiros saem do retorno para quem não tem acesso a
    // eles. Contagens e alertas de vencimento continuam visíveis para todos.
    overview: empresaProcedure
      .input(z.object({ competencia: z.string().regex(/^\d{4}-\d{2}$/) }))
      .query(async ({ ctx, input }) => {
        const clientes = await db.listClients(ctx.ownerId);
        const props = await db.listProperties(ctx.ownerId);
        const reservas = await db.listReservations(ctx.ownerId, undefined, input.competencia);

        const propMap = new Map(props.map((p) => [p.id, p]));
        let comissaoMes = 0;
        let receitaMes = 0;
        for (const r of reservas) {
          const p = propMap.get(r.propertyId);
          const comissaoPct = p && p.tipoAdministracao !== "propria" ? num(p.comissaoPct) : 0;
          const receita = num(r.valorBruto) + num(r.taxaLimpeza);
          receitaMes += receita;
          comissaoMes += receita * (comissaoPct / 100);
        }

        // alertas de vencimento de certificado A1 (próximos 60 dias ou vencidos)
        const hoje = new Date();
        const limite = new Date();
        limite.setDate(limite.getDate() + 60);
        const alertasCertificado = clientes
          .filter((c) => c.certificadoA1Validade)
          .map((c) => {
            const validade = new Date(c.certificadoA1Validade as unknown as string);
            const diasRestantes = Math.ceil((validade.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
            return { clienteId: c.id, nome: c.nome, validade: validade.toISOString().slice(0, 10), diasRestantes };
          })
          .filter((a) => a.diasRestantes <= 60)
          .sort((a, b) => a.diasRestantes - b.diasRestantes);

        const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

        // Vigência dos contratos de longa duração: próximo reajuste (a cada 12 meses) e fim do contrato,
        // mostrando eventos futuros ou vencidos há até 30 dias (para não deixar passar em branco).
        const contratosLonga = await db.listLongTermContracts(ctx.ownerId);
        const propNome = (id: number) => props.find((p) => p.id === id)?.apelido ?? "—";
        const hojeStr = hoje.toISOString().slice(0, 10);
        const limiteAtrasoStr = (() => {
          const d = new Date();
          d.setDate(d.getDate() - 30);
          return d.toISOString().slice(0, 10);
        })();

        const eventosContrato: { propertyId: number; imovel: string; tipo: "reajuste" | "fim"; data: string }[] = [];
        for (const c of contratosLonga) {
          const numReajustes = Math.floor(c.prazoMeses / 12);
          for (let i = 1; i <= numReajustes; i++) {
            const dataReajusteN = addMonthsToDate(c.dataInicio, 12 * i);
            if (dataReajusteN >= limiteAtrasoStr) {
              eventosContrato.push({ propertyId: c.propertyId, imovel: propNome(c.propertyId), tipo: "reajuste", data: dataReajusteN });
            }
          }
          if (c.dataFim >= limiteAtrasoStr) {
            eventosContrato.push({ propertyId: c.propertyId, imovel: propNome(c.propertyId), tipo: "fim", data: c.dataFim });
          }
        }
        eventosContrato.sort((a, b) => a.data.localeCompare(b.data));
        const vigenciaContratos = eventosContrato.slice(0, 6).map((e) => ({
          ...e,
          diasRestantes: Math.ceil((new Date(e.data).getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24)),
        }));

        const veFinanceiro = ctx.nivel === "total";

        return {
          totalClientes: clientes.length,
          totalImoveis: props.length,
          totalReservasMes: reservas.length,
          receitaMes: veFinanceiro ? round2(receitaMes) : null,
          comissaoMes: veFinanceiro ? round2(comissaoMes) : null,
          alertasCertificado,
          vigenciaContratos,
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;
