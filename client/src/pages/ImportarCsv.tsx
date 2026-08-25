import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useState, useRef, useMemo } from "react";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { PageHeader } from "./Clientes";
import { brl } from "@/lib/format";

interface CsvRow {
  codigo: string;
  valorBruto: number;
  taxaLimpeza: number;
  taxaAirbnb: number;
  outrasTaxas: number;
  valorLiquidoRecebido: number;
  nomeHospede?: string;
  cpfHospede?: string;
  passaporteHospede?: string;
  estrangeiro: boolean;
  checkin: string;
  checkout: string;
  noites: number;
  faxinasUtilizadas: number;
  // Nome do anúncio (imóvel) no Airbnb — usado só no cliente para mapear cada
  // linha ao imóvel correto quando o CSV mistura várias unidades. A mutation
  // ignora esse campo (zod remove chaves desconhecidas por padrão).
  anuncio?: string;
}

// Campos lógicos reconhecidos no CSV — mais amplos que CsvRow porque alguns
// (pago, ganhosBrutos, tipoDoc, documento) são usados só para calcular outros campos.
type LogicalField =
  | "codigo" | "valorBruto" | "taxaLimpeza" | "taxaAirbnb" | "outrasTaxas"
  | "valorLiquidoRecebido" | "nomeHospede" | "checkin" | "checkout" | "noites"
  | "tipoDoc" | "documento" | "pago" | "ganhosBrutos" | "anuncio";

// Mapeamento flexível de colunas do CSV do Airbnb
const COLUMN_MAP: Record<string, LogicalField> = {
  // Código da reserva
  "confirmation code": "codigo",
  "código de confirmação": "codigo",
  "codigo de confirmacao": "codigo",
  "código": "codigo",
  "codigo": "codigo",
  "reservation code": "codigo",
  // Valor bruto
  "amount": "valorBruto",
  "gross earnings": "valorBruto",
  "earnings": "valorBruto",
  "valor bruto": "valorBruto",
  "valor": "valorBruto",
  "total": "valorBruto",
  "payout": "valorBruto",
  "guest paid": "valorBruto",
  // Taxa de limpeza
  "cleaning fee": "taxaLimpeza",
  "taxa de limpeza": "taxaLimpeza",
  "limpeza": "taxaLimpeza",
  // Taxa Airbnb (taxa de serviço cobrada do anfitrião)
  "host fee": "taxaAirbnb",
  "host service fee": "taxaAirbnb",
  "service fee": "taxaAirbnb",
  "airbnb fee": "taxaAirbnb",
  "taxa airbnb": "taxaAirbnb",
  "taxa de serviço": "taxaAirbnb",
  "taxa de servico": "taxaAirbnb",
  // Outras taxas (impostos de ocupação, turismo, etc.) — mapeamento direto,
  // usado só quando o CSV não tem "Pago"+"Ganhos brutos" (ver cálculo abaixo)
  "occupancy taxes": "outrasTaxas",
  "occupancy tax": "outrasTaxas",
  "taxes": "outrasTaxas",
  "tourist tax": "outrasTaxas",
  "outras taxas": "outrasTaxas",
  "impostos": "outrasTaxas",
  // Valor líquido recebido — mapeamento direto (mesmo caso acima)
  "paid you": "valorLiquidoRecebido",
  "amount paid to host": "valorLiquidoRecebido",
  "net amount": "valorLiquidoRecebido",
  "you earned": "valorLiquidoRecebido",
  "net": "valorLiquidoRecebido",
  "valor líquido": "valorLiquidoRecebido",
  "valor liquido": "valorLiquidoRecebido",
  "valor líquido recebido": "valorLiquidoRecebido",
  "valor recebido": "valorLiquidoRecebido",
  // Nome do hóspede
  "guest name": "nomeHospede",
  "guest": "nomeHospede",
  "hóspede": "nomeHospede",
  "hospede": "nomeHospede",
  // Tipo de documento do hóspede (CPF ou Passaporte)
  "tipo doc": "tipoDoc",
  "tipo documento": "tipoDoc",
  "document type": "tipoDoc",
  // Número do documento
  "documento": "documento",
  "document": "documento",
  // Valor pago (aparece na linha-resumo em branco acima da reserva, neste modelo)
  "pago": "pago",
  // Ganhos brutos totais da reserva
  "ganhos brutos": "ganhosBrutos",
  // Check-in
  "start date": "checkin",
  "check-in": "checkin",
  "checkin": "checkin",
  "data de entrada": "checkin",
  "data de início": "checkin",
  "início": "checkin",
  "inicio": "checkin",
  // Check-out
  "end date": "checkout",
  "check-out": "checkout",
  "checkout": "checkout",
  "data de saída": "checkout",
  "data de saida": "checkout",
  "data de término": "checkout",
  "fim": "checkout",
  // Noites
  "nights": "noites",
  "noites": "noites",
  "diárias": "noites",
  "diarias": "noites",
  "darias": "noites",
  "# of nights": "noites",
  // Anúncio (imóvel) — usado para mapear cada linha ao imóvel correto quando
  // o CSV mistura reservas de várias unidades.
  "anúncio": "anuncio",
  "anuncio": "anuncio",
  "listing": "anuncio",
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Interpreta datas "D/M/AAAA" ou "M/D/AAAA" de forma ambígua: quando um dos dois
 * números é > 12 ele só pode ser o dia; quando os dois são ≤ 12 (ambíguo de
 * verdade), assume-se mês/dia (formato dos exports do Airbnb — as colunas "Data
 * de início"/"Data de término" vêm em inglês/EUA mesmo em relatórios com o resto
 * das colunas em português). O check-out real é recalculado a partir do check-in
 * + noites (ver mapRow), então essa função só precisa acertar o check-in.
 */
function parseAmbiguousDate(val: string): { y: number; m: number; d: number } | null {
  const m = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  let day: number, month: number;
  if (a > 12) { day = a; month = b; }
  else if (b > 12) { day = b; month = a; }
  else { day = b; month = a; } // ambíguo: assume mês/dia (M/D)
  return { y: year, m: month, d: day };
}

function parseDate(val: string): string | null {
  if (!val) return null;
  const isoMatch = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const ambiguous = parseAmbiguousDate(val);
  if (ambiguous) return `${ambiguous.y}-${String(ambiguous.m).padStart(2, "0")}-${String(ambiguous.d).padStart(2, "0")}`;
  const d = new Date(val);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function parseCurrency(val: string): number {
  if (!val) return 0;
  let cleaned = val.replace(/[R$\s]/g, "");
  // Detecta o separador decimal pela última ocorrência de "," ou "."
  // (formato BR "1.234,56" vs. formato US "1,234.56" ou "900.00")
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  if (lastComma > lastDot) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    cleaned = cleaned.replace(/,/g, "");
  }
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : Math.abs(n);
}

/** Divide uma linha de CSV respeitando campos entre aspas (que podem conter o separador). */
function splitCsvLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === sep) {
      result.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
}

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  const sep = lines[0].includes(";") ? ";" : ",";
  const headers = splitCsvLine(lines[0], sep).map((h) => h.toLowerCase());
  const rows = lines.slice(1).map((line) => splitCsvLine(line, sep));
  return { headers, rows };
}

/** Extrai os campos lógicos reconhecidos de uma linha, sem interpretar/validar ainda. */
function extractFields(headers: string[], row: string[]): Partial<Record<LogicalField, string>> {
  const out: Partial<Record<LogicalField, string>> = {};
  for (let i = 0; i < headers.length; i++) {
    const field = COLUMN_MAP[headers[i]];
    if (field && row[i]) out[field] = row[i];
  }
  return out;
}

/**
 * Interpreta uma linha já extraída em uma reserva, sem aplicar ainda o valor de
 * "Pago" do repasse (isso é feito depois, no agrupamento por repasse — ver
 * handleFile). Retorna null se a linha não tem dados suficientes (ex.: linha de
 * repasse, sem código/data/valor de reserva).
 */
function buildBaseRow(
  fields: Partial<Record<LogicalField, string>>,
  defaultFaxinas: number,
): { row: CsvRow; ganhosBrutos: number | null } | null {
  const codigo = fields.codigo;
  const valorBruto = fields.valorBruto ? parseCurrency(fields.valorBruto) : 0;
  if (!codigo || !valorBruto) return null;

  const noites = fields.noites ? parseInt(fields.noites, 10) || 0 : 0;
  const checkin = fields.checkin ? parseDate(fields.checkin) : null;
  if (!checkin) return null;
  const noitesFinal = noites > 0 ? noites : Math.max(
    1,
    fields.checkout
      ? Math.round((new Date(parseDate(fields.checkout) || checkin).getTime() - new Date(checkin).getTime()) / 86400000)
      : 1,
  );
  // Check-out sempre recalculado a partir do check-in + noites: as datas de
  // "término" em relatórios exportados costumam vir em formato inconsistente
  // (ora dia/mês, ora mês/dia) e "noites" é o dado confiável.
  const checkout = addDaysIso(checkin, noitesFinal);

  const taxaAirbnb = fields.taxaAirbnb ? parseCurrency(fields.taxaAirbnb) : 0;
  const taxaLimpeza = fields.taxaLimpeza ? parseCurrency(fields.taxaLimpeza) : 0;
  const outrasTaxas = fields.outrasTaxas ? parseCurrency(fields.outrasTaxas) : 0;
  const valorLiquidoRecebido = fields.valorLiquidoRecebido ? parseCurrency(fields.valorLiquidoRecebido) : 0;
  const ganhosBrutos = fields.ganhosBrutos ? parseCurrency(fields.ganhosBrutos) : null;

  const tipoDoc = (fields.tipoDoc || "").trim().toLowerCase();
  const documento = (fields.documento || "").trim() || undefined;
  const estrangeiro = tipoDoc.includes("passaporte") || tipoDoc.includes("passport");
  const cpfHospede = !estrangeiro ? documento : undefined;
  const passaporteHospede = estrangeiro ? documento : undefined;

  return {
    row: {
      codigo,
      valorBruto,
      taxaLimpeza,
      taxaAirbnb,
      outrasTaxas,
      valorLiquidoRecebido,
      nomeHospede: fields.nomeHospede || undefined,
      cpfHospede,
      passaporteHospede,
      estrangeiro,
      checkin,
      checkout,
      noites: noitesFinal,
      faxinasUtilizadas: defaultFaxinas,
      anuncio: fields.anuncio || undefined,
    },
    ganhosBrutos,
  };
}

const SEM_ANUNCIO = "(sem anúncio informado)";

export default function ImportarCsv() {
  const utils = trpc.useUtils();
  const { data: todosImoveis } = trpc.properties.list.useQuery();
  const imoveis = useMemo(() => (todosImoveis ?? []).filter((p) => p.tipoLocacao === "curta"), [todosImoveis]);
  const [faxinasPadrao, setFaxinasPadrao] = useState("1");
  const [parsedRows, setParsedRows] = useState<CsvRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  // Mapeia cada "Anúncio" encontrado no CSV (ou a chave SEM_ANUNCIO, quando o
  // arquivo não tem essa coluna) para o id do imóvel correspondente no sistema.
  const [propertyMap, setPropertyMap] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const importMut = trpc.reservations.importCsv.useMutation();

  const anuncios = useMemo(() => {
    const porAnuncio = new Map<string, number>();
    for (const r of parsedRows) {
      const chave = r.anuncio || SEM_ANUNCIO;
      porAnuncio.set(chave, (porAnuncio.get(chave) ?? 0) + 1);
    }
    return Array.from(porAnuncio.entries()).map(([anuncio, qtd]) => ({ anuncio, qtd })).sort((a, b) => a.anuncio.localeCompare(b.anuncio));
  }, [parsedRows]);

  const todosMapeados = anuncios.length > 0 && anuncios.every((a) => propertyMap[a.anuncio]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setPropertyMap({});

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const { headers, rows } = parseCsv(text);

      if (!headers.length) {
        setErrors(["Arquivo vazio ou formato inválido."]);
        setParsedRows([]);
        return;
      }

      const errs: string[] = [];
      const defaultFax = Number(faxinasPadrao) || 1;

      // 1ª passada: agrupa as reservas pelo repasse ("Pago") que as cobre — um
      // repasse pode cobrir uma única reserva (modelo com linha-resumo em branco)
      // ou várias de uma vez (quando o Airbnb paga mais de uma reserva junta).
      type Grupo = { pago: number | null; itens: { row: CsvRow; ganhosBrutos: number | null }[] };
      const grupos: Grupo[] = [{ pago: null, itens: [] }];

      for (let i = 0; i < rows.length; i++) {
        const fields = extractFields(headers, rows[i]);
        const pagoDesta = fields.pago ? parseCurrency(fields.pago) : null;
        if (pagoDesta !== null) {
          grupos.push({ pago: pagoDesta, itens: [] });
          continue;
        }
        const base = buildBaseRow(fields, defaultFax);
        if (base) {
          grupos[grupos.length - 1].itens.push(base);
        } else if (fields.codigo) {
          // Só reporta erro se a linha tinha um código de reserva (ou seja,
          // não é uma linha-resumo/em branco do relatório).
          errs.push(`Linha ${i + 2}: dados insuficientes (código, datas ou valor ausentes)`);
        }
      }

      // 2ª passada: em alguns modelos de relatório do Airbnb a coluna "Valor" já vem
      // LÍQUIDA — soma exatamente ao "Pago" do repasse que cobre o grupo inteiro — em
      // vez de ser a diária bruta. Usá-la direto como valor bruto fazia ele importar
      // igual ao líquido. Detecta esse modelo comparando a soma do "Valor" das reservas
      // do grupo com o "Pago" do repasse: quando bate, esse "Valor" já é o total líquido
      // recebido (diárias + limpeza, depois da taxa de serviço) — a diária BRUTA sozinha
      // (sem a limpeza, que o formulário soma à parte) é "Valor" + "Taxa de serviço" −
      // "Taxa de limpeza". Sem subtrair a limpeza aqui, ela entrava em dobro na Receita
      // bruta (valorBruto + taxaLimpeza, calculada à parte na tela e no lançamento).
      // Quando não bate (outro modelo de relatório, onde "Valor" já é bruto de fato),
      // usa "Ganhos brutos" para refinar o líquido recebido e as outras taxas — mas só
      // quando o repasse cobre exatamente uma reserva; cobrindo várias, não dá pra saber
      // a fatia de cada uma com segurança, então usa uma estimativa sem "outras taxas".
      const mapped: CsvRow[] = [];
      for (const g of grupos) {
        const somaValorDoGrupo = g.itens.reduce((s, it) => s + it.row.valorBruto, 0);
        const valorDoGrupoJaELiquido = g.pago !== null && g.itens.length > 0 && Math.abs(somaValorDoGrupo - g.pago) < 0.01;

        for (const item of g.itens) {
          const row = { ...item.row };
          if (valorDoGrupoJaELiquido) {
            row.valorLiquidoRecebido = row.valorBruto;
            row.valorBruto = round2(row.valorBruto + row.taxaAirbnb - row.taxaLimpeza);
          } else if (item.ganhosBrutos !== null) {
            if (g.pago !== null && g.itens.length === 1) {
              row.valorLiquidoRecebido = g.pago;
              row.outrasTaxas = round2(item.ganhosBrutos - g.pago - row.taxaAirbnb);
            } else {
              row.valorLiquidoRecebido = round2(item.ganhosBrutos - row.taxaAirbnb);
              row.outrasTaxas = 0;
            }
          }
          mapped.push(row);
        }
      }

      setParsedRows(mapped);
      setErrors(errs);
    };
    reader.readAsText(file, "utf-8");
  };

  const submit = async () => {
    if (!parsedRows.length) {
      toast.error("Nenhuma reserva válida para importar.");
      return;
    }
    if (!todosMapeados) {
      toast.error("Selecione o imóvel correspondente a cada anúncio antes de importar.");
      return;
    }

    const grupos = new Map<string, CsvRow[]>();
    for (const r of parsedRows) {
      const propertyId = propertyMap[r.anuncio || SEM_ANUNCIO];
      if (!grupos.has(propertyId)) grupos.set(propertyId, []);
      grupos.get(propertyId)!.push(r);
    }

    setImporting(true);
    try {
      let total = 0;
      for (const [propertyId, rows] of Array.from(grupos.entries())) {
        const res = await importMut.mutateAsync({ propertyId: Number(propertyId), rows });
        total += res.importadas;
      }
      utils.reservations.list.invalidate();
      utils.ledgerEntries.list.invalidate();
      toast.success(`${total} reserva(s) importada(s) com sucesso!`);
      setParsedRows([]);
      setFileName("");
      setErrors([]);
      setPropertyMap({});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao importar.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Importar CSV"
        subtitle="Importe reservas do relatório de ganhos/pagamentos do Airbnb em lote."
      />

      <Card className="p-6 space-y-5">
        {/* Faxinas padrão */}
        <div className="grid gap-1.5 max-w-xs">
          <Label>Faxinas por reserva (padrão)</Label>
          <Input
            value={faxinasPadrao}
            onChange={(e) => setFaxinasPadrao(e.target.value)}
            type="number"
            min="0"
            step="1"
          />
          <p className="text-xs text-muted-foreground">
            Quantidade de faxinas a atribuir para cada reserva importada.
          </p>
        </div>

        {/* Upload */}
        <div className="grid gap-1.5">
          <Label>Arquivo CSV</Label>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              className="bg-background"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="mr-2 h-4 w-4" /> Selecionar arquivo
            </Button>
            {fileName && (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <FileSpreadsheet className="h-4 w-4" /> {fileName}
              </span>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={handleFile}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Aceita o relatório de pagamentos do Airbnb (colunas Tipo, Código de Confirmação, Data de início/término,
            Noites, Hóspede, Anúncio, Valor, Pago, Taxa de serviço, Taxa de limpeza, Ganhos brutos) — pode conter
            reservas de vários imóveis misturadas, identificadas pela coluna "Anúncio". As colunas Informações,
            Código de referência, Moeda, Imposto repassado pelo Airbnb e Ganhos do ano são ignoradas. CPF/passaporte
            e se o hóspede é estrangeiro não vêm no relatório — preencha manualmente depois, editando a reserva.
            Separador: vírgula ou ponto-e-vírgula.
          </p>
        </div>

        {/* Mapeamento de imóveis por anúncio */}
        {anuncios.length > 0 && (
          <div className="grid gap-2">
            <Label>Mapear cada anúncio para o imóvel correspondente</Label>
            <div className="rounded-lg border border-border divide-y divide-border">
              {anuncios.map(({ anuncio, qtd }) => (
                <div key={anuncio} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{anuncio}</p>
                    <p className="text-xs text-muted-foreground">{qtd} reserva(s)</p>
                  </div>
                  <Select
                    value={propertyMap[anuncio] ?? ""}
                    onValueChange={(v) => setPropertyMap((prev) => ({ ...prev, [anuncio]: v }))}
                  >
                    <SelectTrigger className="w-[220px] bg-background shrink-0">
                      <SelectValue placeholder="Selecione o imóvel" />
                    </SelectTrigger>
                    <SelectContent>
                      {imoveis?.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>{p.apelido}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            {!todosMapeados && (
              <p className="text-xs text-amber-700 flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5" /> Selecione o imóvel de cada anúncio antes de importar.
              </p>
            )}
          </div>
        )}

        {/* Erros */}
        {errors.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-1">
            <p className="text-sm font-medium text-amber-800 flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4" /> {errors.length} linha(s) ignorada(s)
            </p>
            <ul className="text-xs text-amber-700 list-disc list-inside max-h-32 overflow-auto">
              {errors.slice(0, 10).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
              {errors.length > 10 && <li>... e mais {errors.length - 10}</li>}
            </ul>
          </div>
        )}

        {/* Preview */}
        {parsedRows.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge className="bg-primary/10 text-primary">
                <CheckCircle2 className="mr-1 h-3 w-3" /> {parsedRows.length} reserva(s) prontas
              </Badge>
            </div>
            <div className="overflow-auto max-h-64 rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Código</th>
                    <th className="px-3 py-2 text-left font-medium">Anúncio</th>
                    <th className="px-3 py-2 text-left font-medium">Hóspede</th>
                    <th className="px-3 py-2 text-left font-medium">Documento</th>
                    <th className="px-3 py-2 text-left font-medium">Check-in</th>
                    <th className="px-3 py-2 text-left font-medium">Check-out</th>
                    <th className="px-3 py-2 text-right font-medium">Noites</th>
                    <th className="px-3 py-2 text-right font-medium">Valor</th>
                    <th className="px-3 py-2 text-right font-medium">Limpeza</th>
                    <th className="px-3 py-2 text-right font-medium">Taxa Airbnb</th>
                    <th className="px-3 py-2 text-right font-medium">Outras taxas</th>
                    <th className="px-3 py-2 text-right font-medium">Líquido</th>
                    <th className="px-3 py-2 text-right font-medium">Faxinas</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-2 font-mono text-xs">{r.codigo}</td>
                      <td className="px-3 py-2">{r.anuncio || "—"}</td>
                      <td className="px-3 py-2">{r.nomeHospede || "—"}</td>
                      <td className="px-3 py-2">
                        {r.estrangeiro
                          ? (r.passaporteHospede ? `Passaporte ${r.passaporteHospede}` : "—")
                          : (r.cpfHospede ? `CPF ${r.cpfHospede}` : "—")}
                      </td>
                      <td className="px-3 py-2">{r.checkin}</td>
                      <td className="px-3 py-2">{r.checkout}</td>
                      <td className="px-3 py-2 text-right">{r.noites}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{brl(r.valorBruto)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{brl(r.taxaLimpeza)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{brl(r.taxaAirbnb)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{brl(r.outrasTaxas)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{brl(r.valorLiquidoRecebido)}</td>
                      <td className="px-3 py-2 text-right">{r.faxinasUtilizadas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsedRows.length > 50 && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  Mostrando 50 de {parsedRows.length} linhas...
                </p>
              )}
            </div>
          </div>
        )}

        {/* Botão de importar */}
        <div className="flex justify-end pt-2">
          <Button
            onClick={submit}
            disabled={!parsedRows.length || !todosMapeados || importing}
            className="active:scale-[0.97] transition-transform"
          >
            {importing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            Importar {parsedRows.length} reserva(s)
          </Button>
        </div>
      </Card>
    </div>
  );
}
