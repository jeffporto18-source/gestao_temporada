// Conciliação bancária: lê os créditos (entradas) de um extrato em planilha Excel anexado em
// Extratos e casa cada um, por valor, com as parcelas de Contas a Receber do mês (lançamentos
// manuais de receita + parcelas de contrato de longa duração), para apontar o que está faltando
// lançar e o que entrou no banco sem lançamento correspondente.

import * as XLSX from "xlsx";
import * as db from "./db";
import { storageGetBuffer } from "./storage";

const num = (v: number | string | null) => Number(v ?? 0);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

interface MovimentoExtrato {
  data: string; // "AAAA-MM-DD"
  descricao: string;
  valor: number;
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
 * Lê os créditos (entradas) de uma planilha de extrato bancário. O formato exato varia por banco,
 * mas todos têm uma linha de cabeçalho com uma coluna de data e uma de valor (entradas/saídas ou só
 * valor) — localiza essa linha por nome da coluna em vez de assumir uma posição fixa. Ignora
 * rendimento de aplicação e estornos: não são aluguel, e como acontecem quase todo dia só
 * atrapalhariam a conciliação.
 */
function lerEntradasDoExtrato(buffer: Buffer): MovimentoExtrato[] {
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

  const movimentos: MovimentoExtrato[] = [];
  for (let i = headerIdx + 1; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!Array.isArray(linha) || linha.length === 0) continue;
    const data = normalizarData(linha[colData]);
    const valor = normalizarValor(linha[colValor]);
    if (!data || valor === null || valor <= 0) continue; // só créditos (entradas)
    const descricao = colDescricao !== -1 ? String(linha[colDescricao] ?? "") : "";
    if (/rendimento|estorno/i.test(descricao)) continue;
    movimentos.push({ data, descricao, valor: round2(valor) });
  }
  return movimentos;
}

export interface ItemConciliacao {
  tipo: "ledger" | "contrato";
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
}

/** Concilia o extrato anexado no mês/ano com as Contas a Receber da mesma competência. */
export async function conciliarExtratoContasAReceber(ownerId: number, ano: number, mes: number): Promise<ResultadoConciliacao> {
  const extrato = await db.getStatement(ownerId, ano, mes);
  if (!extrato?.arquivoKey) throw new Error("Nenhum extrato anexado para este mês.");
  if (!/\.xlsx?$/i.test(extrato.arquivoKey)) {
    throw new Error("Conciliação automática só funciona com extrato em planilha Excel (XLS/XLSX) — este mês está com outro tipo de arquivo.");
  }

  const buffer = await storageGetBuffer(extrato.arquivoKey);
  const entradas = lerEntradasDoExtrato(buffer);

  const competencia = `${ano}-${String(mes).padStart(2, "0")}`;

  const [ledgerCharges, contratosCharges, contratos, properties] = await Promise.all([
    db.listLedgerCharges(ownerId, { grupo: "receita" }),
    db.listContractRentChargesByCompetencia(ownerId, competencia),
    db.listLongTermContracts(ownerId),
    db.listProperties(ownerId),
  ]);

  const contratoPorId = new Map(contratos.map((c) => [c.id, c]));
  const propriedadePorId = new Map(properties.map((p) => [p.id, p]));

  const receitasDoMes = ledgerCharges.filter((c) => c.competencia === competencia && c.status !== "cancelado");

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
    ...contratosCharges
      .map((c) => {
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
  ];

  // Casa cada recebível com UMA entrada de mesmo valor no extrato (multiset: uma entrada só cobre
  // um recebível por vez, mesmo que dois tenham valores idênticos por coincidência).
  const entradasDisponiveis = [...entradas];
  for (const item of recebiveis) {
    const idx = entradasDisponiveis.findIndex((e) => e.valor === item.valor);
    if (idx !== -1) {
      item.encontradoNoExtrato = true;
      entradasDisponiveis.splice(idx, 1);
    }
  }

  return {
    competencia,
    recebiveis,
    entradasSemLancamento: entradasDisponiveis,
    totalRecebiveis: recebiveis.length,
    totalConciliados: recebiveis.filter((r) => r.encontradoNoExtrato).length,
  };
}
