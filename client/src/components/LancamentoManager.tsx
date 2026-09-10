import { trpc, type RouterOutputs } from "@/lib/trpc";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Pencil, Trash2, Settings, TriangleAlert } from "lucide-react";
import { brl, formatCompetencia, addMesesCompetencia } from "@/lib/format";
import { PageHeader, EmptyState } from "@/pages/Clientes";
import { Link } from "wouter";

type Grupo = "despesa_fixa" | "despesa_variavel" | "receita" | "aporte_capital" | "repasse_caucao";
type ChartAccount = RouterOutputs["chartAccounts"]["list"][number];

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function anosDisponiveis(): number[] {
  const atual = new Date().getFullYear();
  const anos: number[] = [];
  for (let a = atual - 2; a <= atual + 3; a++) anos.push(a);
  return anos;
}

interface FormState {
  propertyId: string;
  chartAccountId: string;
  descricao: string;
  contraparte: string;
  valor: string;
  dia: string;
  mesInicio: string;
  anoInicio: string;
  repetir: "unico" | "repetir";
  qtdMeses: string;
  observacao: string;
}

function emptyForm(): FormState {
  const hoje = new Date();
  return {
    propertyId: "",
    chartAccountId: "",
    descricao: "",
    contraparte: "",
    valor: "",
    dia: "",
    mesInicio: String(hoje.getMonth() + 1),
    anoInicio: String(hoje.getFullYear()),
    repetir: "unico",
    qtdMeses: "2",
    observacao: "",
  };
}

interface LancamentoManagerProps {
  titulo: string;
  subtitulo: string;
  grupos: Grupo[];
  contraparteLabel: string;
  contraparteholder: string;
  contraparteFornecedor?: boolean;
  submitLabel: string;
  emptyLabel: string;
}

/** Página compartilhada de lançamento recorrente (Receitas, Despesas, Aportes): imóvel primeiro, depois conta do plano. */
export default function LancamentoManager({ titulo, subtitulo, grupos, contraparteLabel, contraparteholder, contraparteFornecedor, submitLabel, emptyLabel }: LancamentoManagerProps) {
  const utils = trpc.useUtils();
  const { data: imoveis } = trpc.properties.list.useQuery();
  const { data: contasTodas } = trpc.chartAccounts.list.useQuery({});
  const { data: entriesTodos, isLoading } = trpc.ledgerEntries.list.useQuery({});
  const { data: fornecedoresTodos } = trpc.fornecedores.list.useQuery(undefined, { enabled: !!contraparteFornecedor });
  const fornecedoresAtivos = useMemo(() => (fornecedoresTodos ?? []).filter((f) => f.ativo === 1), [fornecedoresTodos]);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());

  const contas = useMemo(() => (contasTodas ?? []).filter((c) => grupos.includes(c.grupo as Grupo) && c.ativa === 1), [contasTodas, grupos]);

  // Contas do(s) grupo(s) permitido(s), achatadas em ordem hierárquica com indentação.
  const contasOrdenadas = useMemo(() => {
    const porPai = new Map<number | null, ChartAccount[]>();
    for (const c of contas) {
      const key = c.parentId ?? null;
      if (!porPai.has(key)) porPai.set(key, []);
      porPai.get(key)!.push(c);
    }
    const out: { id: number; label: string }[] = [];
    const visit = (parentId: number | null, depth: number) => {
      for (const c of porPai.get(parentId) ?? []) {
        out.push({ id: c.id, label: `${"— ".repeat(depth)}${c.nome}` });
        visit(c.id, depth + 1);
      }
    };
    visit(null, 0);
    return out;
  }, [contas]);

  const entries = useMemo(
    () =>
      (entriesTodos ?? [])
        // Exclui lançamentos automáticos (gerados por reserva, parcela de contrato ou custo do imóvel) — essa tela é só para lançamentos manuais.
        .filter((e) => grupos.includes(e.grupo as Grupo) && !e.reservationId && !e.contractRentChargeId && !e.propertyCostId)
        .map((e) => ({ ...e, valor: Number(e.valor) })),
    [entriesTodos, grupos],
  );

  const reset = () => { setForm(emptyForm()); setEditingId(null); };

  const create = trpc.ledgerEntries.create.useMutation({
    onSuccess: () => { utils.ledgerEntries.list.invalidate(); reset(); toast.success("Lançamento cadastrado."); },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.ledgerEntries.update.useMutation({
    onSuccess: () => { utils.ledgerEntries.list.invalidate(); reset(); toast.success("Lançamento atualizado."); },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.ledgerEntries.delete.useMutation({
    onSuccess: () => { utils.ledgerEntries.list.invalidate(); toast.success("Lançamento removido."); },
    onError: (e) => toast.error(e.message),
  });

  const openEdit = (e: (typeof entries)[number]) => {
    const [ano, mes] = e.competenciaInicio.split("-");
    setEditingId(e.id);
    setForm({
      propertyId: e.propertyId !== null ? String(e.propertyId) : "empresa",
      chartAccountId: e.chartAccountId ? String(e.chartAccountId) : "",
      descricao: e.descricao || "",
      contraparte: e.contraparte || "",
      valor: String(e.valor),
      dia: String(e.dia),
      mesInicio: String(Number(mes)),
      anoInicio: ano,
      repetir: e.qtdMeses > 1 ? "repetir" : "unico",
      qtdMeses: String(Math.max(e.qtdMeses, 2)),
      observacao: e.observacao || "",
    });
  };

  const competenciaInicio = `${form.anoInicio}-${form.mesInicio.padStart(2, "0")}`;
  const qtdMesesFinal = form.repetir === "repetir" ? Number(form.qtdMeses) || 2 : 1;
  const competenciaFim = addMesesCompetencia(competenciaInicio, qtdMesesFinal - 1);

  const submit = () => {
    const valor = Number(form.valor);
    const dia = Number(form.dia);
    if (!form.propertyId) { toast.error("Selecione o imóvel ou a opção Empresa."); return; }
    if (!form.chartAccountId) { toast.error("Selecione a conta do plano."); return; }
    if (!valor || valor <= 0) { toast.error("Informe um valor válido."); return; }
    if (!dia || dia < 1 || dia > 31) { toast.error("Informe um dia válido (1-31)."); return; }

    const payload = {
      propertyId: form.propertyId === "empresa" ? null : Number(form.propertyId),
      chartAccountId: Number(form.chartAccountId),
      descricao: form.descricao || undefined,
      contraparte: form.contraparte || undefined,
      valor,
      dia,
      competenciaInicio,
      qtdMeses: qtdMesesFinal,
      observacao: form.observacao || undefined,
    };

    if (editingId) {
      update.mutate({ id: editingId, ...payload });
    } else {
      create.mutate(payload);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title={titulo} subtitle={subtitulo} />

      <Card className="p-5 mb-6">
        <div className="grid gap-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label>Imóvel</Label>
              <Select
                value={form.propertyId === "empresa" ? "" : form.propertyId}
                onValueChange={(v) => setForm((f) => ({ ...f, propertyId: v }))}
                disabled={form.propertyId === "empresa"}
              >
                <SelectTrigger><SelectValue placeholder={form.propertyId === "empresa" ? "— (lançamento da empresa)" : "Selecione o imóvel..."} /></SelectTrigger>
                <SelectContent>
                  {imoveis?.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.apelido}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Empresa</Label>
              <label className="flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-background cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  checked={form.propertyId === "empresa"}
                  onChange={(e) => setForm((f) => ({ ...f, propertyId: e.target.checked ? "empresa" : "" }))}
                />
                <span className="text-sm">Sem imóvel (despesa/receita da empresa)</span>
              </label>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Conta do plano</Label>
            <div className="flex gap-2">
              <Select value={form.chartAccountId} onValueChange={(v) => setForm((f) => ({ ...f, chartAccountId: v }))}>
                <SelectTrigger className="flex-1"><SelectValue placeholder="Selecione a conta..." /></SelectTrigger>
                <SelectContent>
                  {contasOrdenadas.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" size="icon" className="bg-background shrink-0" asChild title="Gerenciar plano de contas">
                <Link href="/plano-contas"><Settings className="h-4 w-4" /></Link>
              </Button>
            </div>
            {contasOrdenadas.length === 0 && (
              <p className="text-xs text-amber-600 flex items-center gap-1.5 mt-1">
                <TriangleAlert className="h-3.5 w-3.5 shrink-0" /> Cadastre antes uma conta no plano de contas.
              </p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label>Descrição</Label>
            <Input value={form.descricao} onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))} placeholder="Ex.: Aluguel de temporada" />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label>{contraparteLabel}</Label>
              {contraparteFornecedor ? (
                <div className="flex gap-2">
                  <Select
                    value={form.contraparte}
                    onValueChange={(v) => {
                      const fornecedor = fornecedoresAtivos.find((fo) => fo.nome === v);
                      setForm((f) => ({
                        ...f,
                        contraparte: v,
                        chartAccountId: !f.chartAccountId && fornecedor?.chartAccountId ? String(fornecedor.chartAccountId) : f.chartAccountId,
                      }));
                    }}
                  >
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Selecione o fornecedor..." /></SelectTrigger>
                    <SelectContent>
                      {fornecedoresAtivos.map((fo) => (
                        <SelectItem key={fo.id} value={fo.nome}>{fo.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" size="icon" className="bg-background shrink-0" asChild title="Gerenciar fornecedores">
                    <Link href="/fornecedores"><Settings className="h-4 w-4" /></Link>
                  </Button>
                </div>
              ) : (
                <Input value={form.contraparte} onChange={(e) => setForm((f) => ({ ...f, contraparte: e.target.value }))} placeholder={contraparteholder} />
              )}
            </div>
            <div className="grid gap-1.5">
              <Label>Valor (R$)</Label>
              <Input value={form.valor} onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))} type="number" step="0.01" placeholder="0,00" />
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <div className="grid gap-1.5">
              <Label>Dia do vencimento/recebimento</Label>
              <Input value={form.dia} onChange={(e) => setForm((f) => ({ ...f, dia: e.target.value }))} type="number" min="1" max="31" placeholder="Ex.: 10" />
            </div>
            <div className="grid gap-1.5">
              <Label>Primeiro mês</Label>
              <Select value={form.mesInicio} onValueChange={(v) => setForm((f) => ({ ...f, mesInicio: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MESES.map((m, i) => (
                    <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Ano</Label>
              <Select value={form.anoInicio} onValueChange={(v) => setForm((f) => ({ ...f, anoInicio: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {anosDisponiveis().map((a) => (
                    <SelectItem key={a} value={String(a)}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Repetir nos meses seguintes?</Label>
            <RadioGroup value={form.repetir} onValueChange={(v) => setForm((f) => ({ ...f, repetir: v as "unico" | "repetir" }))}>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="unico" id="rep-unico" />
                <Label htmlFor="rep-unico" className="font-normal cursor-pointer">Não, só neste mês</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="repetir" id="rep-repetir" />
                <Label htmlFor="rep-repetir" className="font-normal cursor-pointer">Sim, repetir por</Label>
                <Input
                  value={form.qtdMeses}
                  onChange={(e) => setForm((f) => ({ ...f, qtdMeses: e.target.value }))}
                  onFocus={() => setForm((f) => ({ ...f, repetir: "repetir" }))}
                  type="number"
                  min="2"
                  className="w-20 h-8"
                  disabled={form.repetir !== "repetir"}
                />
                <span className="text-sm text-muted-foreground">meses</span>
              </div>
            </RadioGroup>
            <p className="text-xs text-muted-foreground">
              {form.repetir === "repetir"
                ? `De ${formatCompetencia(competenciaInicio)} até ${formatCompetencia(competenciaFim)} (${qtdMesesFinal} meses).`
                : `Somente em ${formatCompetencia(competenciaInicio)}.`}
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label>Observação</Label>
            <Input value={form.observacao} onChange={(e) => setForm((f) => ({ ...f, observacao: e.target.value }))} placeholder="Opcional" />
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={submit} disabled={create.isPending || update.isPending} className="active:scale-[0.97] transition-transform">
              {editingId ? "Salvar alterações" : submitLabel}
            </Button>
            {editingId && (
              <Button type="button" variant="outline" className="bg-background" onClick={reset}>Cancelar edição</Button>
            )}
          </div>
        </div>
      </Card>

      {isLoading ? (
        <div className="h-40 rounded-xl border border-border bg-card animate-pulse" />
      ) : !entries.length ? (
        <EmptyState title={emptyLabel} />
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-border">
            {entries.map((e) => (
              <div key={e.id} className="flex items-center justify-between px-5 py-3.5 gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate">{e.descricao || e.categoria || "—"}</p>
                  <p className="text-xs text-muted-foreground truncate">{e.categoria}</p>
                </div>
                <div className="hidden sm:block text-right shrink-0 w-28">
                  <p className="tabular-nums font-medium text-sm">{brl(e.valor)}</p>
                  <p className="text-xs text-muted-foreground">dia {e.dia}</p>
                </div>
                <div className="hidden md:block text-xs text-muted-foreground shrink-0 w-48 text-right">
                  {e.qtdMeses > 1
                    ? `${formatCompetencia(e.competenciaInicio)} → ${formatCompetencia(addMesesCompetencia(e.competenciaInicio, e.qtdMeses - 1))} (${e.qtdMeses}m)`
                    : formatCompetencia(e.competenciaInicio)}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => openEdit(e)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => del.mutate({ id: e.id })}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
