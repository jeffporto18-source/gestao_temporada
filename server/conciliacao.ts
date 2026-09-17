// Conciliação bancária: lê os movimentos (entradas e saídas) de um extrato em planilha Excel
// anexado em Extratos e casa cada um, por valor, com as parcelas de Contas a Receber e Contas a
// Pagar do mês, para apontar o que está faltando lançar e o que movimentou no banco sem
// lançamento correspondente.
//
// Contas a Receber inclui lançamentos manuais de receita, parcelas de contrato de longa duração e
// reservas de curta temporada. Reservas (Airbnb) usam o VALOR LÍQUIDO recebido (após taxas do
// Airbnb), não o valor bruto lançado no plano de contas — é o líquido que efetivamente cai na
// conta, então é ele que precisa bater com o extrato.

import * as XLSX from "xlsx";
import * as db from "./db";
import { storageGetBuffer } from "./storage";

const num = (v: number | string | null) => Number(v ?? 0);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

interface MovimentoExtrato {
  data: string; // "AAAA-MM-DD"
  descricao: string;
  valor: number; // sempre positivo — a direção (entrada/saída) já separa as listas
}

/** Converte "DD/MM/AAAA" (formato usual de extrato bancário) ou uma data do Excel em "AAAA-MM-DD". */
function normalizarData(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "string") {
    const s = v.trim();
    const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  }
  return null;
}

/** Valor em BRL pode vir como número (Excel) ou texto "1.234,56" — normaliza os dois casos. */
function normalizarValor(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.trim().replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Lê os movimentos de uma planilha de extrato bancário, separados em entradas (créditos) e saídas
 * (débitos). O formato exato varia por banco, mas todos têm uma linha de cabeçalho com uma coluna
 * de data e uma de valor (entradas/saídas ou só valor) — localiza essa linha por nome da coluna em
 * vez de assumir uma posição fixa. Ignora rendimento de aplicação e estornos: não são aluguel nem
 * despesa, e como acontecem quase todo dia só atrapalhariam a conciliação.
 */
function lerMovimentosDoExtrato(buffer: Buffer): { entradas: MovimentoExtrato[]; saidas: MovimentoExtrato[] } {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("A planilha não tem nenhuma aba com dados.");
  const linhas = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as unknown[][];

  let headerIdx = -1;
  let colData = -1;
  let colValor = -1;
  let colDescricao = -1;
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!Array.isArray(linha)) continue;
    const idxData = linha.findIndex((c) => typeof c === "string" && /data/i.test(c) && /(lan[cç]amento|movimento|opera[cç][aã]o)/i.test(c));
    const idxValor = linha.findIndex((c) => typeof c === "string" && (/entradas?\s*\/?\s*sa[ií]das?/i.test(c) || /^valor/i.test(c.trim())));
    if (idxData !== -1 && idxValor !== -1) {
      headerIdx = i;
      colData = idxData;
      colValor = idxValor;
      colDescricao = linha.findIndex((c) => typeof c === "string" && /descri[cç][aã]o/i.test(c));
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error("Não reconheci o formato da planilha — esperava uma coluna de data e uma de valor (entradas/saídas).");
  }

  const entradas: MovimentoExtrato[] = [];
  const saidas: MovimentoExtrato[] = [];
  for (let i = headerIdx + 1; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!Array.isArray(linha) || linha.length === 0) continue;
    const data = normalizarData(linha[colData]);
    const valor = normalizarValor(linha[colValor]);
    if (!data || valor === null || valor === 0) continue;
    const descricao = colDescricao !== -1 ? String(linha[colDescricao] ?? "") : "";
    if (/rendimento|estorno/i.test(descricao)) continue;
    const movimento = { data, descricao, valor: round2(Math.abs(valor)) };
    if (valor > 0) entradas.push(movimento);
    else saidas.push(movimento);
  }
  return { entradas, saidas };
}

/** Casa cada item com UMA entrada/saída de mesmo valor no extrato (multiset: um movimento só cobre
 * um item por vez, mesmo que dois tenham valores idênticos por coincidência). Marca in-place e
 * devolve os movimentos que sobraram sem casar com nada. */
function conciliarPorValor(itens: ItemConciliacao[], movimentos: MovimentoExtrato[]): MovimentoExtrato[] {
  const disponiveis = [...movimentos];
  for (const item of itens) {
    const idx = disponiveis.findIndex((m) => m.valor === item.valor);
    if (idx !== -1) {
      item.encontradoNoExtrato = true;
      disponiveis.splice(idx, 1);
    }
  }
  return disponiveis;
}

export interface ItemConciliacao {
  tipo: "ledger" | "contrato" | "reserva" | "despesa";
  id: number;
  descricao: string;
  valor: number;
  data: string;
  status: string;
  encontradoNoExtrato: boolean;
}

export interface ResultadoConciliacao {
  competencia: string;
  recebiveis: ItemConciliacao[];
  entradasSemLancamento: MovimentoExtrato[];
  totalRecebiveis: number;
  totalConciliados: number;
  pagaveis: ItemConciliacao[];
  saidasSemLancamento: MovimentoExtrato[];
  totalPagaveis: number;
  totalPagaveisConciliados: number;
}

/** Concilia o extrato anexado no mês/ano com as Contas a Receber e Contas a Pagar da mesma competência. */
export async function conciliarExtratoContasAReceber(ownerId: number, ano: number, mes: number): Promise<ResultadoConciliacao> {
  const extrato = await db.getStatement(ownerId, ano, mes);
  if (!extrato?.arquivoKey) throw new Error("Nenhum extrato anexado para este mês.");
  if (!/\.xlsx?$/i.test(extrato.arquivoKey)) {
    throw new Error("Conciliação automática só funciona com extrato em planilha Excel (XLS/XLSX) — este mês está com outro tipo de arquivo.");
  }

  const buffer = await storageGetBuffer(extrato.arquivoKey);
  const { entradas, saidas } = lerMovimentosDoExtrato(buffer);

  const competencia = `${ano}-${String(mes).padStart(2, "0")}`;

  const [ledgerChargesReceita, ledgerChargesDespesa, contratosCharges, contratos, properties, reservasPorCheckin, reservasPorRecebimento] =
    await Promise.all([
      db.listLedgerCharges(ownerId, { grupo: "receita" }),
      db.listLedgerCharges(ownerId, { grupo: "despesa_fixa" }),
      db.listContractRentChargesByCompetencia(ownerId, competencia),
      db.listLongTermContracts(ownerId),
      db.listProperties(ownerId),
      db.listReservations(ownerId, undefined, competencia),
      db.listReservationsRecebidasNaCompetencia(ownerId, competencia),
    ]);
  // despesa_variavel entra separado porque o filtro do listLedgerCharges é por um grupo só.
  const ledgerChargesDespesaVariavel = await db.listLedgerCharges(ownerId, { grupo: "despesa_variavel" });

  const contratoPorId = new Map(contratos.map((c) => [c.id, c]));
  const propriedadePorId = new Map(properties.map((p) => [p.id, p]));
  // Uma reserva pode ter check-in num mês e o repasse do Airbnb cair no seguinte — junta as duas
  // buscas (por competência do check-in e por competência do recebimento já confirmado) sem duplicar.
  const reservasDoMes = Array.from(new Map([...reservasPorCheckin, ...reservasPorRecebimento].map((r) => [r.id, r])).values());

  const receitasDoMes = ledgerChargesReceita.filter((c) => c.competencia === competencia && c.status !== "cancelado");
  const despesasDoMes = [...ledgerChargesDespesa, ...ledgerChargesDespesaVariavel].filter(
    (c) => c.competencia === competencia && c.status !== "cancelado",
  );

  const recebiveis: ItemConciliacao[] = [
    ...receitasDoMes.map((c) => ({
      tipo: "ledger" as const,
      id: c.id,
      descricao: c.descricao || c.categoria || "Receita",
      valor: round2(c.status === "pago" ? num(c.valorPago ?? c.valor) : num(c.valor)),
      data: c.dataVencimento,
      status: c.status,
      encontradoNoExtrato: false,
    })),
    ...contratosCharges.map((c) => {
      const contrato = contratoPorId.get(c.contractId);
      const prop = contrato ? propriedadePorId.get(contrato.propertyId) : undefined;
      return {
        tipo: "contrato" as const,
        id: c.id,
        descricao: `Aluguel — ${prop?.apelido ?? "Imóvel"}${contrato?.nomeInquilino ? ` (${contrato.nomeInquilino})` : ""}`,
        valor: round2(c.status === "recebido" ? num(c.valorRecebido ?? c.valor) : num(c.valor)),
        data: c.dataVencimento,
        status: c.status,
        encontradoNoExtrato: false,
      };
    }),
    ...reservasDoMes.map((r) => {
      const prop = propriedadePorId.get(r.propertyId);
      return {
        tipo: "reserva" as const,
        id: r.id,
        descricao: `Airbnb — ${prop?.apelido ?? "Imóvel"} (${r.codigo}${r.nomeHospede ? ` · ${r.nomeHospede}` : ""})`,
        valor: round2(r.dataRecebimento ? num(r.valorRecebido ?? r.valorLiquidoRecebido) : num(r.valorLiquidoRecebido)),
        data: r.dataRecebimento || r.checkin,
        status: r.dataRecebimento ? "recebido" : "pendente",
        encontradoNoExtrato: false,
      };
    }),
  ];

  const pagaveis: ItemConciliacao[] = despesasDoMes.map((c) => ({
    tipo: "despesa" as const,
    id: c.id,
    descricao: c.descricao || (c.contraparte ? `${c.categoria || "Despesa"} — ${c.contraparte}` : c.categoria || "Despesa"),
    valor: round2(c.status === "pago" ? num(c.valorPago ?? c.valor) : num(c.valor)),
    data: c.dataVencimento,
    status: c.status,
    encontradoNoExtrato: false,
  }));

  const entradasSemLancamento = conciliarPorValor(recebiveis, entradas);
  const saidasSemLancamento = conciliarPorValor(pagaveis, saidas);

  return {
    competencia,
    recebiveis,
    entradasSemLancamento,
    totalRecebiveis: recebiveis.length,
    totalConciliados: recebiveis.filter((r) => r.encontradoNoExtrato).length,
    pagaveis,
    saidasSemLancamento,
    totalPagaveis: pagaveis.length,
    totalPagaveisConciliados: pagaveis.filter((p) => p.encontradoNoExtrato).length,
  };
}
