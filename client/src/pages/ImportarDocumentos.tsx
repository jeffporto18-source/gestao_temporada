import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { PageHeader } from "./Clientes";
import * as XLSX from "xlsx";

interface DocRow {
  codigo: string;
  cpfHospede?: string;
  passaporteHospede?: string;
  estrangeiro: boolean;
}

function normalizeHeader(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
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

function csvToGrid(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = lines[0].includes(";") ? ";" : ",";
  return lines.map((line) => splitCsvLine(line, sep));
}

function sheetToGrid(data: ArrayBuffer): string[][] {
  const wb = XLSX.read(data, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  return aoa.map((r) => r.map((v) => String(v ?? "").trim()));
}

/**
 * Acha a linha de cabeçalho (pode não ser a primeira — algumas planilhas têm título acima) com
 * uma coluna de código de reserva e pelo menos uma de CPF ou Passaporte, em colunas separadas.
 */
function parseDocumentos(grid: string[][]): { rows: DocRow[]; errors: string[] } {
  let headerRowIdx = -1;
  let colCodigo = -1, colCpf = -1, colPassaporte = -1;
  for (let i = 0; i < Math.min(grid.length, 6); i++) {
    const norm = grid[i].map(normalizeHeader);
    const iCodigo = norm.findIndex((h) => h.includes("codigo") || h.includes("confirmation"));
    const iCpf = norm.findIndex((h) => h.includes("cpf"));
    const iPassaporte = norm.findIndex((h) => h.includes("passa"));
    if (iCodigo >= 0 && (iCpf >= 0 || iPassaporte >= 0)) {
      headerRowIdx = i;
      colCodigo = iCodigo;
      colCpf = iCpf;
      colPassaporte = iPassaporte;
      break;
    }
  }
  if (headerRowIdx < 0) {
    return { rows: [], errors: ["Não encontrei as colunas esperadas (Código da reserva e CPF ou Passaporte) nas primeiras linhas do arquivo."] };
  }

  const rows: DocRow[] = [];
  const errors: string[] = [];
  for (let i = headerRowIdx + 1; i < grid.length; i++) {
    const line = grid[i];
    const codigo = (line[colCodigo] || "").trim();
    const passaporte = colPassaporte >= 0 ? (line[colPassaporte] || "").trim() : "";
    const cpf = colCpf >= 0 ? (line[colCpf] || "").trim() : "";
    if (!codigo) continue; // linha vazia
    if (!passaporte && !cpf) {
      errors.push(`Linha ${i + 1}: código ${codigo} sem CPF nem passaporte preenchido — ignorada.`);
      continue;
    }
    rows.push(
      passaporte
        ? { codigo, passaporteHospede: passaporte, estrangeiro: true }
        : { codigo, cpfHospede: cpf.replace(/\D/g, ""), estrangeiro: false },
    );
  }
  return { rows, errors };
}

export default function ImportarDocumentos() {
  const utils = trpc.useUtils();
  const [parsedRows, setParsedRows] = useState<DocRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const importMut = trpc.reservations.importDocumentos.useMutation();

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const isExcel = /\.xlsx?$/i.test(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const grid = isExcel ? sheetToGrid(ev.target?.result as ArrayBuffer) : csvToGrid(ev.target?.result as string);
      const { rows, errors: errs } = parseDocumentos(grid);
      setParsedRows(rows);
      setErrors(errs);
    };
    if (isExcel) reader.readAsArrayBuffer(file);
    else reader.readAsText(file, "utf-8");
  };

  const submit = async () => {
    if (!parsedRows.length) {
      toast.error("Nenhuma linha válida para importar.");
      return;
    }
    setImporting(true);
    try {
      const res = await importMut.mutateAsync({ rows: parsedRows });
      utils.reservations.list.invalidate();
      if (res.naoEncontradas.length > 0) {
        toast.warning(
          `${res.atualizadas} atualizada(s). ${res.naoEncontradas.length} código(s) não encontrados: ${res.naoEncontradas.slice(0, 5).join(", ")}${res.naoEncontradas.length > 5 ? "..." : ""}`,
        );
      } else {
        toast.success(`${res.atualizadas} reserva(s) atualizada(s) com sucesso!`);
      }
      setParsedRows([]);
      setFileName("");
      setErrors([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao importar.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Importar CPF/Passaporte"
        subtitle="Preenche o documento do hóspede de reservas já importadas, casando pelo código — o relatório do Airbnb não traz esse dado."
      />

      <Card className="p-6 space-y-5">
        <div className="grid gap-1.5">
          <Label className="text-sm font-medium">Arquivo (CSV ou Excel)</Label>
          <div className="flex items-center gap-3">
            <Button variant="outline" className="bg-background" onClick={() => fileRef.current?.click()}>
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
            accept=".csv,.txt,.xlsx,.xls"
            className="hidden"
            onChange={handleFile}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Precisa de uma coluna com o <strong>código da reserva</strong> (o mesmo da importação do Airbnb) e uma
            coluna de <strong>CPF</strong> e/ou <strong>Passaporte</strong> — os nomes exatos não importam, desde
            que contenham essas palavras. Uma linha por hóspede; se tiver passaporte preenchido, o hóspede é
            marcado como estrangeiro automaticamente.
          </p>
        </div>

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

        {parsedRows.length > 0 && (
          <div className="space-y-3">
            <Badge className="bg-primary/10 text-primary">
              <CheckCircle2 className="mr-1 h-3 w-3" /> {parsedRows.length} linha(s) prontas
            </Badge>
            <div className="overflow-auto max-h-80 rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Código da reserva</th>
                    <th className="px-3 py-2 text-left font-medium">Documento</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-2 font-mono text-xs">{r.codigo}</td>
                      <td className="px-3 py-2">
                        {r.estrangeiro ? `Passaporte ${r.passaporteHospede}` : `CPF ${r.cpfHospede}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button onClick={submit} disabled={!parsedRows.length || importing} className="active:scale-[0.97] transition-transform">
            {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Atualizar {parsedRows.length} reserva(s)
          </Button>
        </div>
      </Card>
    </div>
  );
}
