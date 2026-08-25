import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import { brl, competenciaAtual, competencias } from "@/lib/format";
import { PageHeader, EmptyState } from "./Clientes";
import { FileSpreadsheet, FileText } from "lucide-react";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";

export default function EfdContribuicoes() {
  const [competencia, setCompetencia] = useState<string>(competenciaAtual());
  const { data, isLoading } = trpc.relatorios.efdContribuicoes.useQuery({ competencia });
  const meses = competencias();

  function baixarExcel() {
    if (!data) return;
    const linhas = data.itens.map((i) => ({
      Nome: i.nome,
      Documento: `${i.tipoDocumento}: ${i.documento}`,
      "Tipo de locação": i.tipoLocacao === "curta" ? "Curta temporada" : "Longa duração",
      Imóvel: i.imovel,
      Valor: i.valor,
    }));
    linhas.push({ Nome: "", Documento: "", "Tipo de locação": "", Imóvel: "Total recebido no mês", Valor: data.total });
    const ws = XLSX.utils.json_to_sheet(linhas);
    ws["!cols"] = [{ wch: 28 }, { wch: 28 }, { wch: 20 }, { wch: 24 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Relatório");
    XLSX.writeFile(wb, `efd-contribuicoes-${competencia}.xlsx`);
  }

  function baixarPdf() {
    if (!data) return;
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text("EFD Contribuições", 14, 15);
    doc.setFontSize(10);
    doc.text(`Competência: ${meses.find((m) => m.value === competencia)?.label ?? competencia}`, 14, 22);
    autoTable(doc, {
      startY: 28,
      head: [["Nome", "Documento", "Tipo de locação", "Imóvel", "Valor"]],
      body: data.itens.map((i) => [
        i.nome,
        `${i.tipoDocumento}: ${i.documento}`,
        i.tipoLocacao === "curta" ? "Curta temporada" : "Longa duração",
        i.imovel,
        brl(i.valor),
      ]),
      foot: [["", "", "", "Total recebido no mês", brl(data.total)]],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [30, 41, 59] },
      footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: "bold" },
    });
    doc.save(`efd-contribuicoes-${competencia}.pdf`);
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="EFD Contribuições"
        subtitle="Relatório mensal com nome, CPF/passaporte e valor de quem alugou cada unidade, em curta temporada e longa duração. Reservas de curta temporada seguem regime de caixa: só entram no mês em que o recebimento foi confirmado (aba Recebimento) — sem confirmação, ainda não aparecem. O aluguel de longa duração continua pela competência do vencimento."
      />

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Select value={competencia} onValueChange={setCompetencia}>
          <SelectTrigger className="w-[160px] bg-card">
            <SelectValue placeholder="Competência" />
          </SelectTrigger>
          <SelectContent>
            {meses.map((m) => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="outline" onClick={baixarExcel} disabled={!data || data.itens.length === 0}>
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          Baixar Excel
        </Button>

        <Button variant="outline" onClick={baixarPdf} disabled={!data || data.itens.length === 0}>
          <FileText className="h-4 w-4 mr-2" />
          Baixar PDF
        </Button>
      </div>

      {isLoading ? (
        <div className="h-96 rounded-xl border border-border bg-card animate-pulse" />
      ) : !data || data.itens.length === 0 ? (
        <EmptyState title="Nenhum aluguel recebido nesta competência" />
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Nome</th>
                  <th className="px-4 py-3 font-medium">Documento</th>
                  <th className="px-4 py-3 font-medium">Tipo</th>
                  <th className="px-4 py-3 font-medium">Imóvel</th>
                  <th className="px-4 py-3 font-medium text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {data.itens.map((i, idx) => (
                  <tr key={idx} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">{i.nome}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {i.tipoDocumento}: {i.documento}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {i.tipoLocacao === "curta" ? "Curta temporada" : "Longa duração"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{i.imovel}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{brl(i.valor)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-primary/10">
                  <td className="px-4 py-3 font-semibold" colSpan={4}>
                    Total recebido no mês
                  </td>
                  <td className="px-4 py-3 text-right font-serif text-lg font-semibold text-primary tabular-nums">
                    {brl(data.total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
