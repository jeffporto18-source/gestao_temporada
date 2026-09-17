import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, ExternalLink, Loader2, Trash2, ListChecks, CheckCircle2, TriangleAlert, HelpCircle } from "lucide-react";
import { brl, formatDate } from "@/lib/format";
import { PageHeader } from "./Clientes";

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function anosDisponiveis(): number[] {
  const atual = new Date().getFullYear();
  const anos: number[] = [];
  for (let a = atual - 2; a <= atual + 1; a++) anos.push(a);
  return anos;
}

/** Botão de anexar/substituir + link "Ver" de um mês, mesmo padrão usado nos anexos de contrato. */
function AnexoMes({
  mes,
  url,
  arquivoKey,
  uploading,
  onUpload,
  onRemove,
  onConciliar,
  removing,
}: {
  mes: string;
  url?: string | null;
  arquivoKey?: string | null;
  uploading: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
  onConciliar: () => void;
  removing: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const ehPlanilha = !!arquivoKey && /\.xlsx?$/i.test(arquivoKey);
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="text-sm font-medium w-28 shrink-0">{mes}</span>
      <div className="flex items-center gap-1.5 flex-wrap justify-end">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xls,.xlsx"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = "";
          }}
        />
        {ehPlanilha && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs bg-background text-muted-foreground hover:text-primary"
            onClick={onConciliar}
            title="Conferir se todas as parcelas de Contas a Receber deste mês estão no extrato"
          >
            <ListChecks className="mr-1 h-3.5 w-3.5" /> Conciliar
          </Button>
        )}
        {url && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-muted-foreground hover:text-primary"
            onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
          >
            <ExternalLink className="mr-1 h-3.5 w-3.5" /> Ver
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs bg-background text-muted-foreground hover:text-primary"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />}
          {url ? "Substituir" : "Anexar"}
        </Button>
        {url && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            disabled={removing}
            onClick={onRemove}
            title="Remover anexo"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

/** Uma linha de item conciliado (conta a receber/pagar), com ✓ ou ⚠ conforme achou no extrato. */
function LinhaItem({ ok, texto, valor }: { ok: boolean; texto: string; valor: number }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm min-w-0">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {ok ? <CheckCircle2 className="h-4 w-4 text-primary shrink-0" /> : <TriangleAlert className="h-4 w-4 text-amber-600 shrink-0" />}
        <span className="truncate">{texto}</span>
      </div>
      <span className="tabular-nums font-medium shrink-0 pl-2">{brl(valor)}</span>
    </div>
  );
}

/** Uma linha de movimento do extrato sem lançamento correspondente no sistema. */
function LinhaSemLancamento({ texto, valor }: { texto: string; valor: number }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm min-w-0">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <HelpCircle className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="truncate">{texto}</span>
      </div>
      <span className="tabular-nums font-medium shrink-0 pl-2">{brl(valor)}</span>
    </div>
  );
}

/** Resultado da conciliação de um mês: Contas a Receber/Pagar casadas por valor com o extrato. */
function ConciliacaoDialog({ ano, mes, onOpenChange }: { ano: number; mes: number | null; onOpenChange: (open: boolean) => void }) {
  const { data, isLoading, error } = trpc.statements.conciliar.useQuery(
    { ano, mes: mes ?? 1 },
    { enabled: mes !== null },
  );

  return (
    <Dialog open={mes !== null} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-2xl max-h-[85vh] overflow-y-auto min-w-0">
        <DialogHeader>
          <DialogTitle className="font-serif">
            Conciliação — {mes !== null ? MESES[mes - 1] : ""}/{ano}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="h-40 rounded-xl border border-border bg-card animate-pulse" />
        ) : error ? (
          <p className="text-sm text-destructive py-4">{error.message}</p>
        ) : !data ? null : (
          <div className="grid gap-4 min-w-0">
            <p className="text-sm text-muted-foreground">
              {data.totalConciliados} de {data.totalRecebiveis} contas a receber e {data.totalPagaveisConciliados} de {data.totalPagaveis} contas a pagar deste mês foram encontradas no extrato.
            </p>

            <div className="grid gap-1.5 min-w-0">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Contas a Receber do mês</p>
              {data.recebiveis.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma conta a receber cadastrada para este mês.</p>
              ) : (
                <div className="rounded-lg border border-border divide-y divide-border min-w-0">
                  {data.recebiveis.map((r) => (
                    <LinhaItem key={`${r.tipo}-${r.id}`} ok={r.encontradoNoExtrato} texto={r.descricao} valor={r.valor} />
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                <TriangleAlert className="inline h-3 w-3 mr-1 text-amber-600" />
                não achei uma entrada de mesmo valor no extrato — pode não ter sido pago ainda, ou ter caído com valor diferente.
              </p>
            </div>

            {data.entradasSemLancamento.length > 0 && (
              <div className="grid gap-1.5 min-w-0">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Entradas no extrato sem conta a receber correspondente</p>
                <div className="rounded-lg border border-border divide-y divide-border min-w-0">
                  {data.entradasSemLancamento.map((e, i) => (
                    <LinhaSemLancamento key={i} texto={`${e.descricao || "—"} · ${formatDate(e.data)}`} valor={e.valor} />
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Dinheiro que entrou na conta mas não bate com nenhuma parcela cadastrada — vale conferir se é aluguel sem lançamento, ou outra receita/aporte.</p>
              </div>
            )}

            <div className="grid gap-1.5 min-w-0">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Contas a Pagar do mês</p>
              {data.pagaveis.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma conta a pagar cadastrada para este mês.</p>
              ) : (
                <div className="rounded-lg border border-border divide-y divide-border min-w-0">
                  {data.pagaveis.map((p) => (
                    <LinhaItem key={`${p.tipo}-${p.id}`} ok={p.encontradoNoExtrato} texto={p.descricao} valor={p.valor} />
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                <TriangleAlert className="inline h-3 w-3 mr-1 text-amber-600" />
                não achei uma saída de mesmo valor no extrato — pode não ter sido paga ainda, ou ter caído com valor diferente.
              </p>
            </div>

            {data.saidasSemLancamento.length > 0 && (
              <div className="grid gap-1.5 min-w-0">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Saídas no extrato sem conta a pagar correspondente</p>
                <div className="rounded-lg border border-border divide-y divide-border min-w-0">
                  {data.saidasSemLancamento.map((s, i) => (
                    <LinhaSemLancamento key={i} texto={`${s.descricao || "—"} · ${formatDate(s.data)}`} valor={s.valor} />
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Dinheiro que saiu da conta mas não bate com nenhuma conta a pagar cadastrada — vale conferir se é despesa sem lançamento, ou outro pagamento.</p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Extratos mensais gerais da empresa (ex.: extrato bancário) — sempre visível no menu, para consulta rápida. */
export default function Extratos() {
  const utils = trpc.useUtils();
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [uploadingMes, setUploadingMes] = useState<number | null>(null);
  const [conciliandoMes, setConciliandoMes] = useState<number | null>(null);

  const { data: extratos, isLoading } = trpc.statements.list.useQuery({ ano });
  const porMes = new Map((extratos ?? []).map((e) => [e.mes, e]));

  const remove = trpc.statements.delete.useMutation({
    onSuccess: () => { utils.statements.list.invalidate(); toast.success("Anexo removido."); },
    onError: (e) => toast.error(e.message),
  });

  const upload = async (mes: number, file: File) => {
    setUploadingMes(mes);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("ano", String(ano));
      formData.append("mes", String(mes));
      const resp = await fetch("/api/upload/extrato", { method: "POST", body: formData });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || "Erro ao enviar.");
      toast.success("Extrato anexado.");
      utils.statements.list.invalidate();
    } catch (e: any) {
      toast.error(e.message || "Erro ao enviar o extrato.");
    } finally {
      setUploadingMes(null);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader
        title="Extratos"
        subtitle="Um anexo por mês, geral da empresa — sempre disponível aqui para consulta e para tirar dúvidas."
        action={
          <div className="grid gap-1">
            <Label className="text-[11px] text-muted-foreground">Ano</Label>
            <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
              <SelectTrigger className="h-8 w-[110px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {anosDisponiveis().map((a) => (
                  <SelectItem key={a} value={String(a)}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {isLoading ? (
        <div className="h-96 rounded-xl border border-border bg-card animate-pulse" />
      ) : (
        <Card className="overflow-hidden py-0">
          <div className="divide-y divide-border">
            {MESES.map((nome, i) => {
              const mes = i + 1;
              const extrato = porMes.get(mes);
              return (
                <AnexoMes
                  key={mes}
                  mes={nome}
                  url={extrato?.arquivoUrl}
                  arquivoKey={extrato?.arquivoKey}
                  uploading={uploadingMes === mes}
                  onUpload={(file) => upload(mes, file)}
                  onRemove={() => remove.mutate({ ano, mes })}
                  onConciliar={() => setConciliandoMes(mes)}
                  removing={remove.isPending}
                />
              );
            })}
          </div>
        </Card>
      )}

      <ConciliacaoDialog ano={ano} mes={conciliandoMes} onOpenChange={(open) => !open && setConciliandoMes(null)} />
    </div>
  );
}
