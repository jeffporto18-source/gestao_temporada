import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, FileText, CalendarDays, CheckCircle2, Loader2, Pencil, Upload, ExternalLink, User, Wallet } from "lucide-react";
import { brl, competenciaAtual, formatCpfCnpj, formatDate } from "@/lib/format";
import { dataSugeridaRecebimentoAirbnb } from "@/lib/diaUtil";
import { PageHeader, EmptyState } from "./Clientes";
import { UnitPeriodFilter } from "@/components/UnitPeriodFilter";

interface ReservaForm {
  codigo: string;
  valorBruto: string;
  taxaLimpeza: string;
  taxaAirbnb: string;
  outrasTaxas: string;
  valorLiquidoRecebido: string;
  checkin: string;
  checkout: string;
  faxinas: string;
  nomeHospede: string;
  cpfHospede: string;
  passaporteHospede: string;
  estrangeiro: boolean;
}

const emptyForm: ReservaForm = { codigo: "", valorBruto: "", taxaLimpeza: "", taxaAirbnb: "0", outrasTaxas: "0", valorLiquidoRecebido: "0", checkin: "", checkout: "", faxinas: "1", nomeHospede: "", cpfHospede: "", passaporteHospede: "", estrangeiro: false };

export default function Reservas() {
  const utils = trpc.useUtils();
  const { data: todosImoveis } = trpc.properties.list.useQuery();
  const imoveis = useMemo(() => (todosImoveis ?? []).filter((p) => p.tipoLocacao === "curta"), [todosImoveis]);
  const [propertyId, setPropertyId] = useState<string>("");
  const [competencia, setCompetencia] = useState<string>(competenciaAtual());
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<ReservaForm>(emptyForm);
  const [notaOpen, setNotaOpen] = useState(false);
  const [notaData, setNotaData] = useState<{ locacao: unknown; comissao: unknown | null } | null>(null);

  const enabled = !!propertyId;
  const { data: reservas, isLoading } = trpc.reservations.list.useQuery(
    { propertyId: Number(propertyId), competencia },
    { enabled },
  );

  const reset = () => { setForm(emptyForm); setEditId(null); };

  const create = trpc.reservations.create.useMutation({
    onSuccess: () => { utils.reservations.list.invalidate(); setOpen(false); reset(); toast.success("Reserva registrada."); },
    onError: (e) => toast.error(e.message),
  });

  const update = trpc.reservations.update.useMutation({
    onSuccess: () => { utils.reservations.list.invalidate(); setOpen(false); reset(); toast.success("Reserva atualizada."); },
    onError: (e) => toast.error(e.message),
  });

  const del = trpc.reservations.delete.useMutation({
    onSuccess: () => { utils.reservations.list.invalidate(); toast.success("Reserva removida."); },
    onError: (e) => toast.error(e.message),
  });

  const emitir = trpc.reservations.emitir.useMutation({
    onSuccess: (res) => {
      utils.reservations.list.invalidate();
      utils.reservations.invoices.invalidate();
      setNotaData({ locacao: res.resultado.notaLocacao, comissao: res.respComissao ? res.resultado.notaComissao : null });
      setNotaOpen(true);
      toast.success(res.respComissao ? "NFS-e emitidas (locação + comissão)." : "NFS-e de locação emitida.");
    },
    onError: (e) => toast.error(e.message),
  });

  const noites = (a: string, b: string) => {
    if (!a || !b) return 1;
    const d = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
    return Math.max(1, d);
  };

  const openEdit = (r: NonNullable<typeof reservas>[number]) => {
    setEditId(r.id);
    setForm({
      codigo: r.codigo,
      valorBruto: String(Number(r.valorBruto)),
      taxaLimpeza: String(Number(r.taxaLimpeza)),
      taxaAirbnb: String(Number(r.taxaAirbnb)),
      outrasTaxas: String(Number(r.outrasTaxas)),
      valorLiquidoRecebido: String(Number(r.valorLiquidoRecebido)),
      checkin: r.checkin,
      checkout: r.checkout,
      faxinas: String(r.faxinasUtilizadas ?? 1),
      nomeHospede: r.nomeHospede || "",
      cpfHospede: r.cpfHospede || "",
      passaporteHospede: r.passaporteHospede || "",
      estrangeiro: r.estrangeiro === 1,
    });
    setOpen(true);
  };

  const submit = () => {
    if (!form.codigo || !form.valorBruto || !form.checkin || !form.checkout) {
      toast.error("Preencha código, valor e período.");
      return;
    }
    if (!form.estrangeiro && !form.cpfHospede.trim()) {
      toast.error("Informe o CPF do hóspede (obrigatório quando não é estrangeiro).");
      return;
    }
    if (editId) {
      update.mutate({
        id: editId,
        codigo: form.codigo,
        valorBruto: Number(form.valorBruto),
        taxaLimpeza: Number(form.taxaLimpeza) || 0,
        taxaAirbnb: Number(form.taxaAirbnb) || 0,
        outrasTaxas: Number(form.outrasTaxas) || 0,
        valorLiquidoRecebido: Number(form.valorLiquidoRecebido) || 0,
        checkin: form.checkin,
        checkout: form.checkout,
        noites: noites(form.checkin, form.checkout),
        faxinasUtilizadas: Number(form.faxinas) || 1,
        nomeHospede: form.nomeHospede || undefined,
        cpfHospede: form.cpfHospede || undefined,
        passaporteHospede: form.passaporteHospede || undefined,
        estrangeiro: form.estrangeiro,
      });
    } else {
      create.mutate({
        propertyId: Number(propertyId),
        codigo: form.codigo,
        valorBruto: Number(form.valorBruto),
        taxaLimpeza: Number(form.taxaLimpeza) || 0,
        taxaAirbnb: Number(form.taxaAirbnb) || 0,
        outrasTaxas: Number(form.outrasTaxas) || 0,
        valorLiquidoRecebido: Number(form.valorLiquidoRecebido) || 0,
        checkin: form.checkin,
        checkout: form.checkout,
        noites: noites(form.checkin, form.checkout),
        faxinasUtilizadas: Number(form.faxinas) || 1,
        nomeHospede: form.nomeHospede || undefined,
        cpfHospede: form.cpfHospede || undefined,
        passaporteHospede: form.passaporteHospede || undefined,
        estrangeiro: form.estrangeiro,
      });
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Reservas de Curta Temporada"
        subtitle="Registre as reservas e emita as notas fiscais (locação + comissão) por operação."
        action={
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
            <DialogTrigger asChild>
              <Button disabled={!enabled} className="active:scale-[0.97] transition-transform">
                <Plus className="mr-1 h-4 w-4" /> Nova reserva
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-serif">{editId ? "Editar reserva" : "Nova reserva"}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="grid gap-1.5">
                  <Label>Código da reserva (Airbnb)</Label>
                  <Input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} placeholder="ex.: HMABCDE123" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="grid gap-1.5">
                    <Label>Valor diárias</Label>
                    <Input value={form.valorBruto} onChange={(e) => setForm({ ...form, valorBruto: e.target.value })} type="number" step="0.01" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Taxa limpeza</Label>
                    <Input value={form.taxaLimpeza} onChange={(e) => setForm({ ...form, taxaLimpeza: e.target.value })} type="number" step="0.01" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Taxa Airbnb (R$)</Label>
                    <Input value={form.taxaAirbnb} onChange={(e) => setForm({ ...form, taxaAirbnb: e.target.value })} type="number" step="0.01" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label>Check-in</Label>
                    <DateInput value={form.checkin} onChange={(v) => setForm({ ...form, checkin: v })} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Check-out</Label>
                    <DateInput value={form.checkout} onChange={(v) => setForm({ ...form, checkout: v })} />
                  </div>
                </div>
                <div className="grid grid-cols-[88px_1fr_1fr] gap-3">
                  <div className="grid gap-1.5">
                    <Label>Faxinas</Label>
                    <Input value={form.faxinas} onChange={(e) => setForm({ ...form, faxinas: e.target.value })} type="number" min="0" step="1" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Outras taxas (R$)</Label>
                    <Input value={form.outrasTaxas} onChange={(e) => setForm({ ...form, outrasTaxas: e.target.value })} type="number" step="0.01" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Valor líquido recebido (R$)</Label>
                    <Input value={form.valorLiquidoRecebido} onChange={(e) => setForm({ ...form, valorLiquidoRecebido: e.target.value })} type="number" step="0.01" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground -mt-2">Faxinas utilizadas gera despesa automática conforme custo configurado no imóvel.</p>
                <div className="grid grid-cols-[2fr_1fr] gap-3 items-end">
                  <div className="grid gap-1.5">
                    <Label>Nome do hóspede</Label>
                    <Input value={form.nomeHospede} onChange={(e) => setForm({ ...form, nomeHospede: e.target.value })} placeholder="Nome completo" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Hóspede estrangeiro?</Label>
                    <RadioGroup
                      className="flex items-center gap-4 h-9"
                      value={form.estrangeiro ? "sim" : "nao"}
                      onValueChange={(v) => setForm({ ...form, estrangeiro: v === "sim", cpfHospede: v === "sim" ? "" : form.cpfHospede, passaporteHospede: v === "nao" ? "" : form.passaporteHospede })}
                    >
                      <div className="flex items-center gap-1.5">
                        <RadioGroupItem value="nao" id="estrangeiro-nao" />
                        <Label htmlFor="estrangeiro-nao" className="font-normal cursor-pointer">Não</Label>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <RadioGroupItem value="sim" id="estrangeiro-sim" />
                        <Label htmlFor="estrangeiro-sim" className="font-normal cursor-pointer">Sim</Label>
                      </div>
                    </RadioGroup>
                  </div>
                </div>
                {!form.estrangeiro ? (
                  <div className="grid gap-1.5">
                    <Label>CPF do hóspede <span className="text-destructive">*</span></Label>
                    <Input value={form.cpfHospede} onChange={(e) => setForm({ ...form, cpfHospede: e.target.value })} placeholder="000.000.000-00" />
                  </div>
                ) : (
                  <div className="grid gap-1.5">
                    <Label>Passaporte</Label>
                    <Input value={form.passaporteHospede} onChange={(e) => setForm({ ...form, passaporteHospede: e.target.value })} placeholder="Número do passaporte" />
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" className="bg-background" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button onClick={submit} disabled={create.isPending || update.isPending}>{editId ? "Salvar alterações" : "Registrar"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <UnitPeriodFilter
        properties={imoveis}
        propertyId={propertyId}
        setPropertyId={setPropertyId}
        competencia={competencia}
        setCompetencia={setCompetencia}
      />

      {!todosImoveis?.length ? null : !imoveis.length ? (
        <EmptyState title="Nenhum imóvel de curta duração" subtitle="Reservas são apenas para imóveis de curta duração (temporada). Ajuste o tipo de locação em Imóveis." />
      ) : !enabled ? (
        <EmptyState title="Selecione um imóvel" subtitle="Escolha a unidade e a competência para ver as reservas." />
      ) : isLoading ? (
        <div className="h-40 rounded-xl border border-border bg-card animate-pulse" />
      ) : !reservas?.length ? (
        <EmptyState title="Nenhuma reserva no período" />
      ) : (
        <div className="space-y-3">
          {reservas.map((r) => (
            <ReservaCard
              key={r.id}
              reserva={r}
              onDelete={() => del.mutate({ id: r.id })}
              onEmitir={() => emitir.mutate({ reservationId: r.id })}
              onEdit={() => openEdit(r)}
              emitindo={emitir.isPending && emitir.variables?.reservationId === r.id}
            />
          ))}
        </div>
      )}

      {/* Modal com os payloads das notas */}
      <Dialog open={notaOpen} onOpenChange={setNotaOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" /> {notaData?.comissao ? "NFS-e emitidas" : "NFS-e emitida"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {notaData?.comissao
              ? "Duas notas geradas para esta reserva."
              : "Uma nota gerada para esta reserva (imóvel administrado diretamente pelo proprietário, sem comissão)."}{" "}
            Os payloads abaixo são exatamente o que seria enviado ao provedor fiscal (Nuvem Fiscal / Focus NFe) no padrão nacional.
          </p>
          <div className="grid gap-4 max-h-[55vh] overflow-auto">
            <PayloadBox title="Nota de Locação (proprietário — 99.03.01)" data={notaData?.locacao} />
            {notaData?.comissao != null && <PayloadBox title="Nota de Comissão (administradora)" data={notaData.comissao} />}
          </div>
          <DialogFooter>
            <Button onClick={() => setNotaOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReservaCard({
  reserva,
  onDelete,
  onEmitir,
  onEdit,
  emitindo,
}: {
  reserva: {
    id: number;
    codigo: string;
    valorBruto: string;
    taxaLimpeza: string;
    taxaAirbnb: string;
    valorLiquidoRecebido: string;
    checkin: string;
    checkout: string;
    noites: number;
    faxinasUtilizadas: number | null;
    nomeHospede: string | null;
    cpfHospede: string | null;
    passaporteHospede: string | null;
    estrangeiro: number;
    documentoUrl: string | null;
    dataRecebimento: string | null;
    valorRecebido: string | null;
  };
  onDelete: () => void;
  onEmitir: () => void;
  onEdit: () => void;
  emitindo: boolean;
}) {
  const utils = trpc.useUtils();
  const { data: notas } = trpc.reservations.invoices.useQuery({ reservationId: reserva.id });
  const emitida = (notas?.length ?? 0) > 0;
  const fmt = formatDate;

  const [uploadingDoc, setUploadingDoc] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [recebimentoOpen, setRecebimentoOpen] = useState(false);

  const handleDocUpload = async (file: File) => {
    setUploadingDoc(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("reservationId", String(reserva.id));
      const resp = await fetch("/api/upload/documento-reserva", { method: "POST", body: formData });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Erro ao enviar." }));
        throw new Error(err.error);
      }
      toast.success("Documento enviado.");
      utils.reservations.list.invalidate();
    } catch (e: any) {
      toast.error(e.message || "Erro ao enviar documento.");
    } finally {
      setUploadingDoc(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <CalendarDays className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-medium">{reserva.codigo}</p>
            <p className="text-xs text-muted-foreground">
              {fmt(reserva.checkin)} → {fmt(reserva.checkout)} · {reserva.noites} noites
            </p>
            {reserva.nomeHospede && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <User className="h-3 w-3" /> {reserva.nomeHospede}
                {reserva.cpfHospede && ` · ${formatCpfCnpj(reserva.cpfHospede)}`}
                {reserva.passaporteHospede && ` · Passaporte ${reserva.passaporteHospede}`}
                {reserva.estrangeiro === 1 && <Badge variant="outline" className="ml-1 text-[10px] px-1.5 py-0 h-4">Estrangeiro</Badge>}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {emitida ? (
            <Badge className="bg-primary/10 text-primary"><CheckCircle2 className="mr-1 h-3 w-3" /> Nota fiscal emitida</Badge>
          ) : (
            <Badge variant="secondary">Pendente de nota fiscal</Badge>
          )}
          {reserva.dataRecebimento ? (
            <Badge className="bg-primary/10 text-primary">
              <Wallet className="mr-1 h-3 w-3" /> Recebido em {fmt(reserva.dataRecebimento)}
            </Badge>
          ) : (
            <Badge variant="secondary">Recebimento pendente</Badge>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
        <Info label="Diárias" value={brl(reserva.valorBruto)} />
        <Info label="Taxa limpeza" value={brl(reserva.taxaLimpeza)} />
        <Info label="Receita bruta" value={brl(Number(reserva.valorBruto) + Number(reserva.taxaLimpeza))} strong />
      </div>

      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={onEmitir} disabled={emitindo} className="active:scale-[0.97] transition-transform">
          {emitindo ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileText className="mr-1 h-4 w-4" />}
          {emitida ? "Reemitir NFS-e" : "Emitir NFS-e"}
        </Button>
        <Button size="sm" variant="outline" className="text-muted-foreground hover:text-primary" onClick={onEdit}>
          <Pencil className="mr-1 h-4 w-4" /> Editar
        </Button>
        <Button size="sm" variant="outline" className="text-muted-foreground hover:text-primary" onClick={() => setRecebimentoOpen(true)}>
          <Wallet className="mr-1 h-4 w-4" /> Recebimento
        </Button>
        <RecebimentoDialog
          open={recebimentoOpen}
          onOpenChange={setRecebimentoOpen}
          reserva={reserva}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleDocUpload(file);
            e.target.value = "";
          }}
        />
        <Button
          size="sm"
          variant="outline"
          className="text-muted-foreground hover:text-primary"
          disabled={uploadingDoc}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploadingDoc ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
          {reserva.documentoUrl ? "Substituir documento" : "Anexar documento"}
        </Button>
        {reserva.documentoUrl && (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-primary"
            onClick={() => window.open(reserva.documentoUrl!, "_blank", "noopener,noreferrer")}
          >
            <ExternalLink className="mr-1 h-4 w-4" /> Ver documento
          </Button>
        )}
        <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}

function RecebimentoDialog({
  open,
  onOpenChange,
  reserva,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reserva: {
    id: number;
    checkin: string;
    valorLiquidoRecebido: string;
    dataRecebimento: string | null;
    valorRecebido: string | null;
  };
}) {
  const utils = trpc.useUtils();
  const valorAirbnb = Number(reserva.valorLiquidoRecebido);
  const [modo, setModo] = useState<"confirmar" | "alterar">("confirmar");
  const [valor, setValor] = useState(String(valorAirbnb));
  const [data, setData] = useState("");

  useEffect(() => {
    if (open) {
      const jaConfirmado = reserva.valorRecebido != null && Number(reserva.valorRecebido) !== valorAirbnb;
      setModo(jaConfirmado ? "alterar" : "confirmar");
      setValor(reserva.valorRecebido != null ? String(Number(reserva.valorRecebido)) : String(valorAirbnb));
      // Sugestão: check-in + 1 dia útil (fim de semana/feriado nacional) — o Airbnb libera o
      // repasse no dia seguinte ao check-in, e adia se cair fora do dia útil bancário. É só uma
      // sugestão; confira e ajuste se o repasse realmente caiu em outra data.
      setData(reserva.dataRecebimento || dataSugeridaRecebimentoAirbnb(reserva.checkin));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reserva.id]);

  const marcar = trpc.reservations.marcarRecebimento.useMutation({
    onSuccess: () => { utils.reservations.list.invalidate(); onOpenChange(false); toast.success("Recebimento confirmado."); },
    onError: (e) => toast.error(e.message),
  });

  const confirmar = () => {
    if (!data) { toast.error("Informe a data do recebimento."); return; }
    marcar.mutate({
      id: reserva.id,
      dataRecebimento: data,
      valorRecebido: modo === "confirmar" ? valorAirbnb : Number(valor) || 0,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-serif">Recebimento</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="rounded-lg border border-border bg-secondary/50 px-3 py-2 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Valor líquido do Airbnb</span>
            <span className="tabular-nums font-medium">{brl(valorAirbnb)}</span>
          </div>
          <div className="grid gap-1.5">
            <Label>O valor recebido confere?</Label>
            <RadioGroup
              className="flex items-center gap-4 h-9"
              value={modo}
              onValueChange={(v) => { setModo(v as "confirmar" | "alterar"); if (v === "confirmar") setValor(String(valorAirbnb)); }}
            >
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="confirmar" id="recebimento-confirmar" />
                <Label htmlFor="recebimento-confirmar" className="font-normal cursor-pointer">Confirmar valor Airbnb</Label>
              </div>
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="alterar" id="recebimento-alterar" />
                <Label htmlFor="recebimento-alterar" className="font-normal cursor-pointer">Alterar valor</Label>
              </div>
            </RadioGroup>
          </div>
          {modo === "alterar" && (
            <div className="grid gap-1.5">
              <Label>Valor efetivamente recebido (R$)</Label>
              <Input autoFocus value={valor} onChange={(e) => setValor(e.target.value)} type="number" step="0.01" min="0" />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label>Data do recebimento</Label>
            <DateInput value={data} onChange={setData} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="bg-background" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={confirmar} disabled={marcar.isPending}>Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`tabular-nums ${strong ? "font-semibold text-primary" : "font-medium"}`}>{value}</p>
    </div>
  );
}

function PayloadBox({ title, data }: { title: string; data: unknown }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="bg-secondary px-4 py-2 text-sm font-medium">{title}</div>
      <pre className="p-4 text-xs overflow-auto bg-card font-mono leading-relaxed">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
