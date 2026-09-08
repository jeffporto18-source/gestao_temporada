import { int, mysqlEnum, mysqlTable, text, timestamp, unique, varchar, decimal, date } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow (administradora / usuário do SaaS).
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  /** Tipo de usuário: administradora de aluguel, administrador airbnb, proprietário, holding ou gestor de temporada PJ */
  userType: mysqlEnum("userType", ["administradora", "admin_airbnb", "proprietario", "holding", "gestor_temporada_pj", "escritorio_contabil"]),
  /** Categoria fiscal: PJ, PF com CBS/IBS (obrigado a emitir nota) ou PF isento */
  fiscalCategory: mysqlEnum("fiscalCategory", ["pj", "pf_cbs_ibs", "pf_isento"]),
  /** Tipo de cadastro: pessoa jurídica ou pessoa física */
  tipoCadastro: mysqlEnum("tipoCadastro", ["pj", "pf"]),
  /** CNPJ da empresa (quando tipoCadastro = pj) */
  cnpj: varchar("cnpj", { length: 20 }),
  /** Razão social da empresa (quando tipoCadastro = pj) */
  razaoSocial: varchar("razaoSocial", { length: 255 }),
  /** CPF do responsável master (quando tipoCadastro = pf, ou responsável da PJ) */
  cpfResponsavel: varchar("cpfResponsavel", { length: 14 }),
  /** Nome do responsável (quando tipoCadastro = pf) */
  nomeResponsavel: varchar("nomeResponsavel", { length: 255 }),
  /** Telefone/WhatsApp */
  telefone: varchar("telefone", { length: 40 }),
  /** ID do usuário dono que convidou este usuário (null = dono do sistema) */
  invitedBy: int("invitedBy"),
  /** Hash bcrypt da senha (login próprio) */
  passwordHash: varchar("passwordHash", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Quem pode operar qual empresa, e com que alcance.
 *
 * O sistema é multiempresa: cada cliente é uma conta dona (`users.invitedBy = null`) e os dados
 * pertencem a ela pelo `ownerId`. Antes desta tabela, "usuário logado" e "empresa dos dados" eram
 * a mesma coisa — o que impedia o escritório contábil de atender vários clientes e fazia o
 * funcionário convidado entrar num sistema vazio, porque as consultas procuravam dados sob o id
 * dele em vez do id da empresa.
 *
 * Agora a empresa em operação vem daqui e é revalidada a cada requisição: sem uma linha ligando o
 * usuário à empresa, não há acesso — é isto que separa os dados de um cliente dos do outro.
 */
export const tenantAccess = mysqlTable(
  "tenant_access",
  {
    id: int("id").autoincrement().primaryKey(),
    /** Quem acessa (users.id). */
    userId: int("userId").notNull(),
    /** Empresa acessada — o `ownerId` sob o qual os dados estão gravados (users.id do dono). */
    tenantOwnerId: int("tenantOwnerId").notNull(),
    /**
     * total: enxerga e altera tudo, inclusive DRE, repasse e comissão.
     * operacional: cadastra e edita o dia a dia, mas não vê o resultado financeiro.
     * consulta: só visualiza, não altera nada.
     */
    nivel: mysqlEnum("nivel", ["total", "operacional", "consulta"]).notNull().default("total"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({
    // Um usuário tem no máximo um nível por empresa.
    userTenantUnico: unique("tenant_access_user_tenant").on(t.userId, t.tenantOwnerId),
  }),
);

export type TenantAccess = typeof tenantAccess.$inferSelect;
export type InsertTenantAccess = typeof tenantAccess.$inferInsert;

// Os níveis vivem em shared/niveis.ts, porque as telas também precisam deles.
export { NIVEIS_ACESSO, NIVEL_ACESSO_INFO } from "../shared/niveis";
export type { NivelAcesso } from "../shared/niveis";

/**
 * Clientes proprietários dos imóveis (PF com CPF ou PJ com CNPJ).
 * Cada cliente pertence a uma administradora (ownerId = users.id).
 */
export const clients = mysqlTable("clients", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull(), // administradora dona do cadastro
  tipo: mysqlEnum("tipo", ["PF", "PJ"]).notNull(),
  nome: varchar("nome", { length: 255 }).notNull(), // nome ou razão social
  cpfCnpj: varchar("cpfCnpj", { length: 20 }).notNull(),
  email: varchar("email", { length: 320 }),
  telefone: varchar("telefone", { length: 40 }),
  /** Categoria fiscal do proprietário: determina se emite nota e como tributa */
  fiscalCategory: mysqlEnum("clientFiscalCategory", ["pj", "pf_cbs_ibs", "pf_isento"]).default("pj").notNull(),
  // Certificado digital A1
  certificadoA1Nome: varchar("certificadoA1Nome", { length: 255 }), // apelido/identificação
  certificadoA1Validade: date("certificadoA1Validade"), // data de vencimento
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Client = typeof clients.$inferSelect;
export type InsertClient = typeof clients.$inferInsert;

/**
 * Imóveis (unidades) vinculados a um cliente.
 */
export const properties = mysqlTable("properties", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull(),
  clientId: int("clientId"), // proprietário (clients.id) - null para holdings (imóvel próprio)
  apelido: varchar("apelido", { length: 255 }).notNull(),
  endereco: varchar("endereco", { length: 500 }),
  // percentual de comissão da administradora (ex.: 20.00 = 20%)
  comissaoPct: decimal("comissaoPct", { precision: 5, scale: 2 }).notNull().default("20.00"),
  // Custo unitário por faxina (R$) — usado para gerar despesa automática por reserva
  custoFaxina: decimal("custoFaxina", { precision: 10, scale: 2 }).default("0.00"),
  // Tipo de locação: curta (temporada) ou longa duração
  tipoLocacao: varchar("tipoLocacao", { length: 20 }).notNull().default("curta"),
  // URL do contrato de administração (PDF armazenado no S3)
  contratoUrl: varchar("contratoUrl", { length: 500 }),
  contratoKey: varchar("contratoKey", { length: 255 }),
  // Imobiliária responsável pela captação/gestão do inquilino (opcional)
  imobiliariaId: int("imobiliariaId"),
  // Como o imóvel é administrado: diretamente pelo proprietário, por uma administradora (cliente) ou por um gestor de temporada terceirizado
  tipoAdministracao: mysqlEnum("tipoAdministracao", ["propria", "administradora", "gestor_curta_temporada"]).notNull().default("propria"),
  // Gestor de temporada terceirizado responsável (quando tipoAdministracao = gestor_curta_temporada)
  gestorId: int("gestorId"),
  // Se o imóvel está financiado/consorciado
  financiado: mysqlEnum("financiado", ["sim", "nao"]).notNull().default("nao"),
  tipoFinanciamento: mysqlEnum("tipoFinanciamento", ["financiamento", "consorcio"]),
  valorParcela: decimal("valorParcela", { precision: 10, scale: 2 }),
  // Sócios responsáveis pelo imóvel (imóveis de longa duração) — até 3, quando o imóvel é de
  // mais de um sócio (comum em imóvel de família). socioId é o primeiro; os outros dois são
  // opcionais.
  socioId: int("socioId"),
  socio2Id: int("socio2Id"),
  socio3Id: int("socio3Id"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Property = typeof properties.$inferSelect;
export type InsertProperty = typeof properties.$inferInsert;

/**
 * Plano de contas: árvore de profundidade FIXA em 4 níveis (parentId aponta para o nível
 * imediatamente acima). Nível 0 = conta principal (define a natureza/grupo), nível 1 = conta,
 * nível 2 = subconta, nível 3 = sub-subconta. Sub-contas herdam a natureza da conta principal
 * ancestral, mas o nome é livre.
 */
export const chartAccounts = mysqlTable("chart_accounts", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull(),
  grupo: mysqlEnum("grupo", ["conta_principal", "despesa_fixa", "despesa_variavel", "receita", "aporte_capital"]).notNull(),
  nome: varchar("nome", { length: 100 }).notNull(),
  parentId: int("parentId"), // null = conta principal (nível 0); caso contrário, aponta para o pai imediato (máx. nível 3)
  ativa: int("ativa").notNull().default(1),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ChartAccount = typeof chartAccounts.$inferSelect;
export type InsertChartAccount = typeof chartAccounts.$inferInsert;

/** Conta principal padrão (única, por natureza) semeada na primeira vez que o usuário acessa o plano de contas. */
export const DEFAULT_CHART_ACCOUNTS: Record<"despesa_fixa" | "despesa_variavel" | "receita" | "aporte_capital", string> = {
  despesa_fixa: "Despesas fixas",
  despesa_variavel: "Despesas variáveis / extras",
  receita: "Receitas",
  aporte_capital: "Aportes de capital",
};

/**
 * Lançamentos financeiros por unidade (despesas, receitas e aportes de capital), sempre
 * vinculados a um imóvel e classificados no plano de contas. Suporta recorrência: um único
 * registro representa uma série mensal (competenciaInicio + qtdMeses), não uma ocorrência por mês.
 */
export const ledgerEntries = mysqlTable("ledger_entries", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull(),
  propertyId: int("propertyId").notNull(),
  chartAccountId: int("chartAccountId"), // referencia chart_accounts.id (nulo = desconto sem classificação, só com descrição)
  grupo: mysqlEnum("grupo", ["despesa_fixa", "despesa_variavel", "receita", "aporte_capital"]).notNull(), // denormalizado da conta, para consulta rápida
  categoria: varchar("categoria", { length: 300 }), // caminho da conta (denormalizado para consulta rápida)
  descricao: varchar("descricao", { length: 300 }),
  contraparte: varchar("contraparte", { length: 150 }), // cliente/origem (receita) ou fornecedor (despesa/aporte)
  valor: decimal("valor", { precision: 12, scale: 2 }).notNull(),
  dia: int("dia").notNull(), // dia do mês de recebimento/vencimento (1-31)
  competenciaInicio: varchar("competenciaInicio", { length: 7 }).notNull(), // "AAAA-MM" do primeiro mês da série
  qtdMeses: int("qtdMeses").notNull().default(1), // quantidade de meses da série (1 = lançamento único)
  observacao: varchar("observacao", { length: 1000 }),
  // Vincula lançamento automático à reserva que o gerou (null = lançamento manual)
  reservationId: int("reservationId"),
  // Vincula lançamento automático à parcela de aluguel (longa duração) que o gerou (null = lançamento manual)
  contractRentChargeId: int("contractRentChargeId"),
  // Vincula lançamento automático ao custo do imóvel (condomínio/IPTU/rateio) que o gerou. Só
  // existe quando o custo é do proprietário; quando é do inquilino não há lançamento nenhum.
  propertyCostId: int("propertyCostId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type InsertLedgerEntry = typeof ledgerEntries.$inferInsert;

/**
 * Ocorrência mensal de um lançamento manual (receita/despesa) — o "contas a pagar/receber" de
 * verdade: uma linha por mês, com baixa (data + valor pago) e comprovante próprios. Gerada a
 * partir de `ledgerEntries` (o cadastro recorrente) quando ele é criado ou editado; meses já
 * pagos nunca são regenerados, para não perder a baixa nem o comprovante anexado.
 */
export const ledgerCharges = mysqlTable("ledger_charges", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull(),
  ledgerEntryId: int("ledgerEntryId").notNull(),
  propertyId: int("propertyId").notNull(),
  grupo: mysqlEnum("grupo", ["despesa_fixa", "despesa_variavel", "receita", "aporte_capital"]).notNull(),
  categoria: varchar("categoria", { length: 300 }),
  descricao: varchar("descricao", { length: 300 }),
  contraparte: varchar("contraparte", { length: 150 }),
  competencia: varchar("competencia", { length: 7 }).notNull(), // "AAAA-MM"
  dataVencimento: date("dataVencimento", { mode: "string" }).notNull(),
  valor: decimal("valor", { precision: 12, scale: 2 }).notNull(),
  status: mysqlEnum("status", ["aberto", "pago", "cancelado"]).notNull().default("aberto"),
  dataPagamento: date("dataPagamento", { mode: "string" }),
  valorPago: decimal("valorPago", { precision: 12, scale: 2 }),
  comprovanteUrl: varchar("comprovanteUrl", { length: 500 }),
  comprovanteKey: varchar("comprovanteKey", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type LedgerCharge = typeof ledgerCharges.$inferSelect;
export type InsertLedgerCharge = typeof ledgerCharges.$inferInsert;

/**
 * Reservas por unidade.
 */
export const reservations = mysqlTable("reservations", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull(),
  propertyId: int("propertyId").notNull(),
  codigo: varchar("codigo", { length: 60 }).notNull(), // código Airbnb
  valorBruto: decimal("valorBruto", { precision: 12, scale: 2 }).notNull(),
  taxaLimpeza: decimal("taxaLimpeza", { precision: 12, scale: 2 }).notNull().default("0.00"),
  // taxa Airbnb em valor (R$), digitado livremente por reserva
  taxaAirbnb: decimal("taxaAirbnb", { precision: 12, scale: 2 }).notNull().default("0.00"),
  // outras taxas e valor líquido recebido, ambos digitados livremente em R$
  outrasTaxas: decimal("outrasTaxas", { precision: 12, scale: 2 }).notNull().default("0.00"),
  valorLiquidoRecebido: decimal("valorLiquidoRecebido", { precision: 12, scale: 2 }).notNull().default("0.00"),
  checkin: date("checkin", { mode: "string" }).notNull(),
  checkout: date("checkout", { mode: "string" }).notNull(),
  noites: int("noites").notNull().default(1),
  // Faxinas utilizadas nesta reserva (gera despesa automática)
  faxinasUtilizadas: int("faxinasUtilizadas").notNull().default(1),
  competencia: varchar("competencia", { length: 7 }).notNull(), // "AAAA-MM"
  nomeHospede: varchar("nomeHospede", { length: 150 }),
  cpfHospede: varchar("cpfHospede", { length: 20 }),
  passaporteHospede: varchar("passaporteHospede", { length: 40 }),
  estrangeiro: int("estrangeiro").notNull().default(0), // 0 = não, 1 = sim
  documentoUrl: varchar("documentoUrl", { length: 500 }),
  documentoKey: varchar("documentoKey", { length: 255 }),
  // Confirmação de recebimento: quando o valor do Airbnb efetivamente caiu na conta e quanto
  // (pode confirmar o valor líquido já informado ou ajustar, se o repasse do Airbnb veio diferente).
  dataRecebimento: date("dataRecebimento", { mode: "string" }),
  valorRecebido: decimal("valorRecebido", { precision: 12, scale: 2 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Reservation = typeof reservations.$inferSelect;
export type InsertReservation = typeof reservations.$inferInsert;

/**
 * Notas fiscais (NFS-e) emitidas por reserva.
 * Cada reserva gera 2 notas: locação (proprietário) e comissão (administradora).
 */
export const invoices = mysqlTable("invoices", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull(),
  reservationId: int("reservationId").notNull(),
  propertyId: int("propertyId").notNull(),
  tipo: mysqlEnum("tipo", ["locacao", "comissao"]).notNull(),
  codigoServico: varchar("codigoServico", { length: 20 }).notNull(),
  valorServicos: decimal("valorServicos", { precision: 12, scale: 2 }).notNull(),
  baseCalculo: decimal("baseCalculo", { precision: 12, scale: 2 }),
  cbs: decimal("cbs", { precision: 12, scale: 2 }),
  ibs: decimal("ibs", { precision: 12, scale: 2 }),
  status: mysqlEnum("status", ["simulada", "autorizada", "cancelada"]).notNull().default("simulada"),
  chaveAcesso: varchar("chaveAcesso", { length: 60 }),
  numeroNfse: varchar("numeroNfse", { length: 30 }),
  payloadJson: text("payloadJson").notNull(), // payload enviado ao provedor
  respostaJson: text("respostaJson"), // resposta simulada/real
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = typeof invoices.$inferInsert;

/**
 * Imobiliárias parceiras que captam/gerenciam inquilinos de longa duração.
 */
export const imobiliarias = mysqlTable("imobiliarias", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull(),
  nome: varchar("nome", { length: 255 }).notNull(),
  telefone: varchar("telefone", { length: 40 }),
  email: varchar("email", { length: 320 }),
  contato: varchar("contato", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  endereco: varchar("endereco", { length: 500 }),
  celular: varchar("celular", { length: 40 }),
  whatsapp: varchar("whatsapp", { length: 40 }),
});

export type Imobiliaria = typeof imobiliarias.$inferSelect;
export type InsertImobiliaria = typeof imobiliarias.$inferInsert;

/**
 * Gestores de temporada terceirizados (administram imóveis de curta duração por conta do proprietário).
 */
export const curtaManagers = mysqlTable("curta_managers", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull(),
  nome: varchar("nome", { length: 255 }).notNull(),
  telefone: varchar("telefone", { length: 40 }),
  email: varchar("email", { length: 320 }),
  contato: varchar("contato", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CurtaManager = typeof curtaManagers.$inferSelect;
export type InsertCurtaManager = typeof curtaManagers.$inferInsert;

/**
 * Tipos de garantia configuráveis para contratos de longa duração (caução, fiador, seguro-fiança, etc.).
 */
export const guaranteeTypes = mysqlTable("guarantee_types", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull(),
  nome: varchar("nome", { length: 100 }).notNull(),
  ativa: int("ativa").notNull().default(1),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type GuaranteeType = typeof guaranteeTypes.$inferSelect;
export type InsertGuaranteeType = typeof guaranteeTypes.$inferInsert;

/** Tipos de garantia padrão para seeding automático */
export const DEFAULT_GUARANTEE_TYPES = ["Sem garantia", "Caução", "Fiador", "Seguro Fiança", "Capitalização"] as const;

/**
 * Fornecedores cadastrados pelo usuário, para vincular às despesas lançadas.
 */
export const fornecedores = mysqlTable("fornecedores", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull(),
  nome: varchar("nome", { length: 150 }).notNull(),
  cpfCnpj: varchar("cpfCnpj", { length: 20 }),
  telefone: varchar("telefone", { length: 20 }),
  email: varchar("email", { length: 150 }),
  // Conta de despesa (chart_accounts) usada para já classificar a despesa ao lançar para este fornecedor
  chartAccountId: int("chartAccountId"),
  ativo: int("ativo").notNull().default(1),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Fornecedor = typeof fornecedores.$inferSelect;
export type InsertFornecedor = typeof fornecedores.$inferInsert;

/**
 * Grupo de sócios: mesmo grupo familiar/societário recebe o rendimento de um imóvel junto — ex.
 * "Luiz Eduardo" (sozinho) e "Felipe/Guilherme/Fernanda" (juntos). Escolher o grupo no imóvel
 * preenche os até 3 sócios de uma vez, em vez de escolher pessoa por pessoa toda vez.
 */
export const socioGrupos = mysqlTable("socio_grupos", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull(),
  nome: varchar("nome", { length: 150 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SocioGrupo = typeof socioGrupos.$inferSelect;
export type InsertSocioGrupo = typeof socioGrupos.$inferInsert;

/**
 * Sócios da empresa (administradora), apenas nome e CPF. Um sócio pode pertencer a um grupo
 * (opcional) — quem não tem grupo continua selecionável individualmente no imóvel.
 */
export const socios = mysqlTable("socios", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull(),
  nome: varchar("nome", { length: 150 }).notNull(),
  cpf: varchar("cpf", { length: 20 }).notNull(),
  grupoId: int("grupoId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Socio = typeof socios.$inferSelect;
export type InsertSocio = typeof socios.$inferInsert;

/**
 * Itens de inventário (enxoval) por imóvel.
 */
export const inventoryItems = mysqlTable("inventory_items", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull(),
  propertyId: int("propertyId").notNull(),
  nome: varchar("nome", { length: 255 }).notNull(),
  quantidade: int("quantidade").notNull().default(1),
  descricao: varchar("descricao", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type InventoryItem = typeof inventoryItems.$inferSelect;
export type InsertInventoryItem = typeof inventoryItems.$inferInsert;

/**
 * Custos recorrentes do imóvel (condomínio e IPTU) e rateios extraordinários.
 *
 * O valor pertence ao imóvel; QUEM PAGA pertence ao contrato de locação vigente na competência
 * (`long_term_contracts.condominioPor` / `.iptuPor`) — exceto nos extras, cuja responsabilidade é
 * negociada caso a caso e por isso mora no próprio registro (`responsavel`).
 *
 * O histórico é preservado por vigência: para mudar o valor do condomínio, encerra-se o registro
 * atual e cria-se outro a partir da competência nova, de modo que a DRE de um mês passado continue
 * enxergando o valor que valia naquele mês.
 */
export const propertyCosts = mysqlTable("property_costs", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull(),
  propertyId: int("propertyId").notNull(),
  tipo: mysqlEnum("tipo", ["condominio", "iptu", "condominio_extra"]).notNull(),
  // Valor de CADA parcela (não o total do ano): o IPTU anual dividido pela quantidade escolhida.
  valor: decimal("valor", { precision: 12, scale: 2 }).notNull(),
  competenciaInicio: varchar("competenciaInicio", { length: 7 }).notNull(), // "AAAA-MM" da 1ª parcela
  // Condomínio: quantidade em aberto, encerrada ao surgir um valor novo. IPTU: 1 ou 10. Extra: 1.
  qtdMeses: int("qtdMeses").notNull().default(1),
  dia: int("dia").notNull().default(10), // dia de vencimento no mês
  descricao: varchar("descricao", { length: 300 }),
  // Só nos extras (rateio de obra, fundo de reserva): a lei costuma atribuir a despesa
  // extraordinária ao proprietário, mas isso é negociável, então cada rateio decide o seu.
  responsavel: mysqlEnum("costResponsavel", ["proprietario", "inquilino"]),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PropertyCost = typeof propertyCosts.$inferSelect;
export type InsertPropertyCost = typeof propertyCosts.$inferInsert;

/** Quem responde por condomínio/IPTU num contrato, e se o dinheiro passa pela administradora. */
export const COST_RESPONSIBILITY = ["proprietario", "inquilino_direto", "inquilino_via_repasse"] as const;
export type CostResponsibility = (typeof COST_RESPONSIBILITY)[number];

/**
 * Contratos de locação de longa duração vinculados a um imóvel.
 */
export const longTermContracts = mysqlTable("long_term_contracts", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull(),
  propertyId: int("propertyId").notNull(),
  dataInicio: date("dataInicio", { mode: "string" }).notNull(),
  dataFim: date("dataFim", { mode: "string" }).notNull(),
  dataReajuste: date("dataReajuste", { mode: "string" }),
  indiceCorrecao: varchar("indiceCorrecao", { length: 50 }).notNull().default("IGPM"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  nomeInquilino: varchar("nomeInquilino", { length: 255 }),
  cpfCnpjInquilino: varchar("cpfCnpjInquilino", { length: 20 }),
  contatoInquilino: varchar("contatoInquilino", { length: 255 }),
  telefoneInquilino: varchar("telefoneInquilino", { length: 40 }),
  celularInquilino: varchar("celularInquilino", { length: 40 }),
  whatsappInquilino: varchar("whatsappInquilino", { length: 40 }),
  emailInquilino: varchar("emailInquilino", { length: 320 }),
  carenciaInicio: date("carenciaInicio", { mode: "string" }),
  carenciaFim: date("carenciaFim", { mode: "string" }),
  prazoMeses: int("prazoMeses").notNull().default(12),
  diaVencimentoAluguel: int("diaVencimentoAluguel").notNull().default(10),
  // Tipo de garantia (nome, referenciando guarantee_types no momento do cadastro)
  tipoGarantia: varchar("tipoGarantia", { length: 100 }),
  garantiaDocumentoUrl: varchar("garantiaDocumentoUrl", { length: 500 }),
  garantiaDocumentoKey: varchar("garantiaDocumentoKey", { length: 255 }),
  // Contrato de locação assinado (PDF) e apólice de seguro (PDF ou imagem), por contrato
  contratoLocacaoUrl: varchar("contratoLocacaoUrl", { length: 500 }),
  contratoLocacaoKey: varchar("contratoLocacaoKey", { length: 255 }),
  apoliceSeguroUrl: varchar("apoliceSeguroUrl", { length: 500 }),
  apoliceSeguroKey: varchar("apoliceSeguroKey", { length: 255 }),
  // Comissão da administradora sobre este contrato (%) e como o imóvel é administrado
  comissaoPct: decimal("comissaoPct", { precision: 5, scale: 2 }).notNull().default("0.00"),
  tipoAdministracao: mysqlEnum("contractTipoAdministracao", ["propria", "administradora", "gestor_curta_temporada"]).notNull().default("propria"),
  // Imobiliária responsável (quando tipoAdministracao = administradora). Para longa duração, quem
  // administra e a comissão vivem só aqui — o imóvel não pergunta mais isso, porque podem mudar a
  // cada inquilino/contrato.
  imobiliariaId: int("contractImobiliariaId"),
  // Renovação automática ao final do prazo: novo contrato assinado (anexa PDF) ou continuidade por prazo indeterminado
  renovacaoAutomatica: mysqlEnum("renovacaoAutomatica", ["novo_contrato", "prazo_indeterminado"]),
  renovacaoContratoUrl: varchar("renovacaoContratoUrl", { length: 500 }),
  renovacaoContratoKey: varchar("renovacaoContratoKey", { length: 255 }),
  // Documentos da fiança e apólice referentes ao novo contrato da renovação (separados dos do contrato original).
  renovacaoGarantiaDocumentoUrl: varchar("renovacaoGarantiaDocumentoUrl", { length: 500 }),
  renovacaoGarantiaDocumentoKey: varchar("renovacaoGarantiaDocumentoKey", { length: 255 }),
  renovacaoApoliceSeguroUrl: varchar("renovacaoApoliceSeguroUrl", { length: 500 }),
  renovacaoApoliceSeguroKey: varchar("renovacaoApoliceSeguroKey", { length: 255 }),
  prazoIndeterminadoDataInicio: date("prazoIndeterminadoDataInicio", { mode: "string" }),
  prazoIndeterminadoValor: decimal("prazoIndeterminadoValor", { precision: 12, scale: 2 }),
  prazoIndeterminadoPrazoReajusteMeses: int("prazoIndeterminadoPrazoReajusteMeses"),
  // Vigência do novo contrato firmado na renovação (quando renovacaoAutomatica = novo_contrato).
  // dataFim e dataReajuste são calculadas a partir de início + prazo, igual ao contrato principal.
  renovacaoNovoContratoDataInicio: date("renovacaoNovoContratoDataInicio", { mode: "string" }),
  renovacaoNovoContratoPrazoMeses: int("renovacaoNovoContratoPrazoMeses"),
  renovacaoNovoContratoDataFim: date("renovacaoNovoContratoDataFim", { mode: "string" }),
  renovacaoNovoContratoDataReajuste: date("renovacaoNovoContratoDataReajuste", { mode: "string" }),
  renovacaoNovoContratoValor: decimal("renovacaoNovoContratoValor", { precision: 12, scale: 2 }),
  // Quem paga condomínio e IPTU enquanto este contrato vigora. `inquilino_direto` = ele paga o
  // boleto no nome dele e o dinheiro nunca passa pela administradora; `inquilino_via_repasse` =
  // vem junto com o aluguel e a administradora repassa. Nos dois casos o custo NÃO é despesa do
  // proprietário e por isso não entra na DRE dele.
  condominioPor: mysqlEnum("condominioPor", ["proprietario", "inquilino_direto", "inquilino_via_repasse"]).notNull().default("proprietario"),
  iptuPor: mysqlEnum("iptuPor", ["proprietario", "inquilino_direto", "inquilino_via_repasse"]).notNull().default("proprietario"),
});

export type LongTermContract = typeof longTermContracts.$inferSelect;
export type InsertLongTermContract = typeof longTermContracts.$inferInsert;

/**
 * Parcelas/recebíveis de aluguel gerados a partir de um contrato de longa duração.
 */
export const contractRentCharges = mysqlTable("contract_rent_charges", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull(),
  contractId: int("contractId").notNull(),
  propertyId: int("propertyId").notNull(),
  valor: decimal("valor", { precision: 12, scale: 2 }).notNull(),
  competencia: varchar("competencia", { length: 7 }).notNull(), // "AAAA-MM"
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  dataVencimento: date("dataVencimento", { mode: "string" }).notNull(),
  status: mysqlEnum("status", ["pendente", "recebido"]).notNull().default("pendente"),
  dataRecebimento: date("dataRecebimento", { mode: "string" }),
  // Multa/juros por atraso (soma ao valor recebido) e desconto concedido (subtrai do valor recebido)
  multaJuros: decimal("multaJuros", { precision: 12, scale: 2 }).notNull().default("0.00"),
  desconto: decimal("desconto", { precision: 12, scale: 2 }).notNull().default("0.00"),
  // Valor efetivamente recebido: valor + multaJuros - desconto (registrado no momento do recebimento)
  valorRecebido: decimal("valorRecebido", { precision: 12, scale: 2 }),
  // Lançamento gerado automaticamente para registrar o desconto concedido (conta escolhida no plano de contas)
  descontoLedgerEntryId: int("descontoLedgerEntryId"),
  // Condomínio e IPTU repassados nesta parcela (quando o contrato manda cobrar junto com o
  // aluguel). Ficam FORA de `valor` de propósito: a comissão incide apenas sobre o aluguel, e o
  // informe de IR também. Total cobrado = valor + condominio + iptu + multaJuros - desconto.
  condominio: decimal("condominio", { precision: 12, scale: 2 }).notNull().default("0.00"),
  iptu: decimal("iptu", { precision: 12, scale: 2 }).notNull().default("0.00"),
});

export type ContractRentCharge = typeof contractRentCharges.$inferSelect;
export type InsertContractRentCharge = typeof contractRentCharges.$inferInsert;
