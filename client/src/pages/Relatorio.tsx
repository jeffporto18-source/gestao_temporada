import { trpc, type RouterOutputs } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
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
  DialogFooter,
} from "@/components/ui/dialog";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Circle, CheckCircle2, Ban, RotateCcw, Paperclip, ExternalLink, Loader2, Printer } from "lucide-react";
import { brl, formatDate, formatCompetencia } from "@/lib/format";
import { PageHeader, EmptyState, SkeletonList } from "./Clientes";

type Charge = RouterOutputs["ledgerCharges"]["list"][number];
type Tipo = "" | "despesa" | "receita" | "aporte" | "repasse";
type Situacao = "" | "aberto" | "pago" | "cancelado";

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function anosDisponiveis(): number[] {
  const atual = new Date().getFullYear();
  const anos: number[] = [];
  for (let a = atual - 2; a <= atual + 3; a++) anos.push(a);
  return anos;
}

const GRUPOS_DO_TIPO: Record<Tipo, Charge["grupo"][]> = {
  "": ["despesa_fixa", "despesa_variavel", "receita", "aporte_capital", "repasse_caucao"],
  despesa: ["despesa_fixa", "despesa_variavel"],
  receita: ["receita"],
  aporte: ["aporte_capital"],
  repasse: ["repasse_caucao"],
};

/** Rótulo da ação de baixa: aluga/vende (receita), aporta capital, repassa caução, ou paga uma despesa. */
function rotuloBaixa(grupo: Charge["grupo"]) {
  if (grupo === "receita") return "Marcar como recebido";
  if (grupo === "aporte_capital") return "Confirmar aporte";
  if (grupo === "repasse_caucao") return "Confirmar repasse";
  return "Dar baixa";
}

export default function Relatorio() {
  const utils = trpc.useUtils();
  const { data: imoveis } = trpc.properties.list.useQuery();
  const hoje = new Date();
  const [mesInicio, setMesInicio] = useState(String(1));
  const [anoInicio, setAnoInicio] = useState(String(hoje.getFullYear()));
  const [mesFim, setMesFim] = useState(String(12));
  const [anoFim, setAnoFim] = useState(String(hoje.getFullYear()));
  const [tipo, setTipo] = useState<Tipo>("");
  const [situacao, setSituacao] = useState<Situacao>("");
  const [propertyId, setPropertyId] = useState<string>("");
  const [baixando, setBaixando] = useState<Charge | null>(null);

  const { data: chargesRaw, isLoading } = trpc.ledgerCharges.list.useQuery({
    propertyId: propertyId ? Number(propertyId) : undefined,
  });

  const nomeImovel = (id: number | null) => (id === null ? "Empresa" : imoveis?.find((p) => p.id === id)?.apelido ?? "—");

  const reabrir = trpc.ledgerCharges.reabrir.useMutation({
    onSuccess: () => { utils.ledgerCharges.list.invalidate(); toast.success("Movido de volta para em aberto."); },
    onError: (e) => toast.error(e.message),
  });
  const cancelar = trpc.ledgerCharges.cancelar.useMutation({
    onSuccess: () => { utils.ledgerCharges.list.invalidate(); toast.success("Mês cancelado."); },
    onError: (e) => toast.error(e.message),
  });

  const de = `${anoInicio}-${mesInicio.padStart(2, "0")}`;
  const ate = `${anoFim}-${mesFim.padStart(2, "0")}`;
  const periodo = de === ate ? formatCompetencia(de) : `${formatCompetencia(de)} a ${formatCompetencia(ate)}`;

  const charges = useMemo(
    () =>
      (chargesRaw ?? []).filter((c) => {
        if (!GRUPOS_DO_TIPO[tipo].includes(c.grupo)) return false;
        if (situacao && c.status !== situacao) return false;
        if (c.competencia < de || c.competencia > ate) return false;
        return true;
      }),
    [chargesRaw, tipo, situacao, de, ate],
  );

  const totais = useMemo(
    () =>
      charges.reduce(
        (acc, c) => {
          if (c.status === "cancelado") return acc;
          const valor = c.status === "pago" ? Number(c.valorPago ?? c.valor) : Number(c.valor);
          if (c.grupo === "receita") acc.receita += valor;
          else if (c.grupo === "aporte_capital") acc.aporte += valor;
          else if (c.grupo === "repasse_caucao") acc.repasse += valor;
          else acc.despesa += valor;
          return acc;
        },
        { receita: 0, despesa: 0, aporte: 0, repasse: 0 },
      ),
    [charges],
  );
  const resultado = totais.receita - totais.despesa;

  const grupos = useMemo(() => {
    const mapa = new Map<string, Charge[]>();
    for (const c of charges) {
      if (!mapa.has(c.competencia)) mapa.set(c.competencia, []);
      mapa.get(c.competencia)!.push(c);
    }
    return Array.from(mapa.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([competencia, itens]) => ({
        competencia,
        abertos: itens.filter((c) => c.status === "aberto").sort((a, b) => a.dataVencimento.localeCompare(b.dataVencimento)),
        pagos: itens.filter((c) => c.status === "pago").sort((a, b) => (b.dataPagamento ?? "").localeCompare(a.dataPagamento ?? "")),
        cancelados: itens.filter((c) => c.status === "cancelado"),
      }));
  }, [charges]);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-4 flex items-start justify-between gap-3 print:hidden">
        <PageHeader
          title="Relatório"
          subtitle="Cada mês do período, com data própria e baixa individual — dê baixa e anexe o comprovante."
        />
        <Button variant="outline" className="bg-background shrink-0" onClick={() => window.print()}>
          <Printer className="mr-1.5 h-4 w-4" /> Imprimir PDF
        </Button>
      </div>

      {/* Só aparece na impressão — identifica o período no papel/PDF gerado. */}
      <div className="mb-4 hidden print:block">
        <h2 className="text-base font-serif font-bold">Relatório · {periodo}</h2>
      </div>

      <div className="mb-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card className="px-4 py-2.5">
          <p className="text-[11px] text-muted-foreground">Receitas · {periodo}</p>
          <p className="text-lg font-serif font-semibold text-primary leading-tight">{brl(totais.receita)}</p>
        </Card>
        <Card className="px-4 py-2.5">
          <p className="text-[11px] text-muted-foreground">Despesas</p>
          <p className="text-lg font-serif font-semibold text-destructive leading-tight">{brl(totais.despesa)}</p>
        </Card>
        <Card className="px-4 py-2.5">
          <p className="text-[11px] text-muted-foreground">Resultado (receitas − despesas)</p>
          <p className={`text-lg font-serif font-semibold leading-tight ${resultado < 0 ? "text-destructive" : ""}`}>{brl(resultado)}</p>
        </Card>
        <Card className="px-4 py-2.5">
          <p className="text-[11px] text-muted-foreground">Aportes de sócios</p>
          <p className="text-lg font-serif font-semibold leading-tight">{brl(totais.aporte)}</p>
        </Card>
        <Card className="px-4 py-2.5">
          <p className="text-[11px] text-muted-foreground">Repasse de caução</p>
          <p className="text-lg font-serif font-semibold leading-tight">{brl(totais.repasse)}</p>
        </Card>
      </div>

      <Card className="mb-4 p-3 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <Label className="text-[11px] text-muted-foreground">De</Label>
            <div className="flex gap-1.5">
              <Select value={mesInicio} onValueChange={setMesInicio}>
                <SelectTrigger className="h-8 w-[120px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MESES.map((m, i) => (
                    <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={anoInicio} onValueChange={setAnoInicio}>
                <SelectTrigger className="h-8 w-[90px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {anosDisponiveis().map((a) => (
                    <SelectItem key={a} value={String(a)}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1">
            <Label className="text-[11px] text-muted-foreground">Até</Label>
            <div className="flex gap-1.5">
              <Select value={mesFim} onValueChange={setMesFim}>
                <SelectTrigger className="h-8 w-[120px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MESES.map((m, i) => (
                    <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={anoFim} onValueChange={setAnoFim}>
                <SelectTrigger className="h-8 w-[90px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {anosDisponiveis().map((a) => (
                    <SelectItem key={a} value={String(a)}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1">
            <Label className="text-[11px] text-muted-foreground">Tipo</Label>
            <Select value={tipo || "todos"} onValueChange={(v) => setTipo(v === "todos" ? "" : (v as Tipo))}>
              <SelectTrigger className="h-8 w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Tudo</SelectItem>
                <SelectItem value="receita">Só receitas</SelectItem>
                <SelectItem value="despesa">Só despesas</SelectItem>
                <SelectItem value="aporte">Só aportes</SelectItem>
                <SelectItem value="repasse">Só repasses de caução</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-[11px] text-muted-foreground">Situação</Label>
            <Select value={situacao || "todas"} onValueChange={(v) => setSituacao(v === "todas" ? "" : (v as Situacao))}>
              <SelectTrigger className="h-8 w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                <SelectItem value="aberto">Em aberto</SelectItem>
                <SelectItem value="pago">Baixadas</SelectItem>
                <SelectItem value="cancelado">Canceladas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-[11px] text-muted-foreground">Imóvel</Label>
            <Select value={propertyId || "todos"} onValueChange={(v) => setPropertyId(v === "todos" ? "" : v)}>
              <SelectTrigger className="h-8 w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {imoveis?.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.apelido}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {isLoading ? (
        <SkeletonList />
      ) : !grupos.length ? (
        <EmptyState title="Nada por aqui" subtitle="Cadastre contas em Contas a Pagar, Contas a Receber, Aportes ou Repasse de Caução para elas aparecerem aqui mês a mês." />
      ) : (
        <div className="space-y-3">
          {grupos.map((g) => (
            <Card key={g.competencia} className="overflow-hidden py-0">
              <div className="px-3 py-1.5 bg-secondary/50 border-b border-border">
                <span className="text-sm font-serif font-semibold capitalize">{formatCompetencia(g.competencia)}</span>
              </div>

              {g.abertos.map((c) => (
                <ChargeRow key={c.id}>
                  <button className="flex items-center gap-1.5 min-w-0 text-left" onClick={() => setBaixando(c)} title={rotuloBaixa(c.grupo)}>
                    <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <RowLabel charge={c} nomeImovel={nomeImovel(c.propertyId)} />
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <ComprovanteControle charge={c} />
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => cancelar.mutate({ id: c.id })} title="Cancelar mês">
                      <Ban className="h-3 w-3" />
                    </Button>
                  </div>
                </ChargeRow>
              ))}

              {g.pagos.length > 0 && (
                <div className={g.abertos.length > 0 ? "border-t border-border" : ""}>
                  <p className="px-3 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-primary">Baixados</p>
                  {g.pagos.map((c) => (
                    <ChargeRow key={c.id} tom="bg-primary/5">
                      <button className="flex items-center gap-1.5 min-w-0 text-left" onClick={() => reabrir.mutate({ id: c.id })} title="Voltar para em aberto">
                        <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                        <RowLabel charge={c} nomeImovel={nomeImovel(c.propertyId)} pago />
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        <ComprovanteControle charge={c} />
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-primary" onClick={() => reabrir.mutate({ id: c.id })} title="Reabrir">
                          <RotateCcw className="h-3 w-3" />
                        </Button>
                      </div>
                    </ChargeRow>
                  ))}
                </div>
              )}

              {g.cancelados.length > 0 && (
                <div className="border-t border-border">
                  <p className="px-3 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Cancelados</p>
                  {g.cancelados.map((c) => (
                    <ChargeRow key={c.id} tom="opacity-60">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <Ban className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <RowLabel charge={c} nomeImovel={nomeImovel(c.propertyId)} />
                      </span>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-primary" onClick={() => reabrir.mutate({ id: c.id })} title="Reabrir">
                        <RotateCcw className="h-3 w-3" />
                      </Button>
                    </ChargeRow>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <BaixaDialog charge={baixando} onOpenChange={(o) => !o && setBaixando(null)} />
    </div>
  );
}

function RowLabel({ charge, nomeImovel, pago }: { charge: Charge; nomeImovel: string; pago?: boolean }) {
  const entrada = charge.grupo === "receita" || charge.grupo === "aporte_capital";
  return (
    <span className="min-w-0">
      <span className="font-medium truncate block">
        {nomeImovel} — {charge.descricao || charge.categoria || "—"}
      </span>
      <span className="text-[11px] text-muted-foreground block">
        {pago
          ? `${entrada ? "Recebido" : "Pago"} ${charge.dataPagamento ? formatDate(charge.dataPagamento) : "—"} · ${brl(charge.valorPago ?? charge.valor)}`
          : `Vence ${formatDate(charge.dataVencimento)} · ${brl(charge.valor)}${charge.contraparte ? ` · ${charge.contraparte}` : ""}`}
      </span>
    </span>
  );
}

function ChargeRow({ tom, children }: { tom?: string; children: React.ReactNode }) {
  return (
    <div className={`flex items-center justify-between gap-3 px-3 py-1.5 text-xs border-b border-border/60 last:border-0 ${tom ?? ""}`}>
      {children}
    </div>
  );
}

function ComprovanteControle({ charge }: { charge: Charge }) {
  const utils = trpc.useUtils();
  const [enviando, setEnviando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    setEnviando(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("chargeId", String(charge.id));
      const resp = await fetch("/api/upload/comprovante-lancamento", { method: "POST", body: formData });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Erro ao enviar." }));
        throw new Error(err.error);
      }
      toast.success("Comprovante anexado.");
      utils.ledgerCharges.list.invalidate();
    } catch (e: any) {
      toast.error(e.message || "Erro ao enviar comprovante.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
          e.target.value = "";
        }}
      />
      {charge.comprovanteUrl && (
        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-primary" title="Ver comprovante" onClick={() => window.open(charge.comprovanteUrl!, "_blank", "noopener,noreferrer")}>
          <ExternalLink className="h-3 w-3" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-muted-foreground hover:text-primary"
        disabled={enviando}
        title={charge.comprovanteUrl ? "Substituir comprovante" : "Anexar comprovante"}
        onClick={() => inputRef.current?.click()}
      >
        {enviando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
      </Button>
    </>
  );
}

function BaixaDialog({ charge, onOpenChange }: { charge: Charge | null; onOpenChange: (open: boolean) => void }) {
  const utils = trpc.useUtils();
  const [valor, setValor] = useState("");
  const [data, setData] = useState("");
  const chargeIdRef = useRef<number | null>(null);

  if (charge && chargeIdRef.current !== charge.id) {
    chargeIdRef.current = charge.id;
    setValor(String(Number(charge.valor)));
    setData(new Date().toISOString().slice(0, 10));
  }
  if (!charge && chargeIdRef.current !== null) chargeIdRef.current = null;

  const pagar = trpc.ledgerCharges.pagar.useMutation({
    onSuccess: () => { utils.ledgerCharges.list.invalidate(); onOpenChange(false); toast.success("Baixa confirmada."); },
    onError: (e) => toast.error(e.message),
  });

  const confirmar = () => {
    if (!charge) return;
    const v = Number(valor);
    if (!v || v <= 0) { toast.error("Informe o valor."); return; }
    if (!data) { toast.error("Informe a data."); return; }
    pagar.mutate({ id: charge.id, valorPago: v, dataPagamento: data });
  };

  const entrada = charge?.grupo === "receita" || charge?.grupo === "aporte_capital";

  return (
    <Dialog open={charge !== null} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-serif">{charge ? rotuloBaixa(charge.grupo) : ""}</DialogTitle>
        </DialogHeader>
        {charge && (
          <div className="grid gap-3 py-2">
            <div className="rounded-lg border border-border bg-secondary/50 px-3 py-2">
              <p className="text-sm font-medium">{charge.descricao || charge.categoria}</p>
              <p className="text-xs text-muted-foreground">Vencimento {formatDate(charge.dataVencimento)} · Previsto {brl(charge.valor)}</p>
            </div>
            <div className="grid gap-1.5">
              <Label>{entrada ? "Valor recebido (R$)" : "Valor pago (R$)"}</Label>
              <Input autoFocus value={valor} onChange={(e) => setValor(e.target.value)} type="number" step="0.01" min="0" />
            </div>
            <div className="grid gap-1.5">
              <Label>Data</Label>
              <DateInput value={data} onChange={setData} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" className="bg-background" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={confirmar} disabled={pagar.isPending}>Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
