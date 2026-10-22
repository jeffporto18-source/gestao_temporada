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
import { Circle, CheckCircle2, Ban, RotateCcw, Paperclip, ExternalLink, Loader2, Printer, FileSpreadsheet } from "lucide-react";
import { brl, formatDate, formatCompetencia, formatCpfCnpj } from "@/lib/format";
import { PageHeader, EmptyState, SkeletonList } from "./Clientes";
import { useAuth } from "@/_core/hooks/useAuth";
import * as XLSX from "xlsx";

type Charge = RouterOutputs["ledgerCharges"]["list"][number];
type Parcela = RouterOutputs["longTermContracts"]["charges"][number];
type Reserva = RouterOutputs["reservations"]["list"][number];
type Tipo = "" | "despesa" | "receita" | "aporte" | "repasse";
type Situacao = "" | "aberto" | "pago" | "cancelado";

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

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

const STATUS_LABEL: Record<Charge["status"], string> = {
  aberto: "Em aberto",
  pago: "Baixado",
  cancelado: "Cancelado",
};

export default function Relatorio() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  // Código contábil é de uso interno da contabilidade — só quem tem role="admin" (o escritório) vê.
  const isContabilidade = user?.role === "admin";
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
  const [baixandoParcela, setBaixandoParcela] = useState<Parcela | null>(null);
  const [baixandoReserva, setBaixandoReserva] = useState<Reserva | null>(null);

  const { data: chargesRaw, isLoading } = trpc.ledgerCharges.list.useQuery({
    propertyId: propertyId ? Number(propertyId) : undefined,
  });
  // Aluguéis de longa e curta duração não nascem como ledgerCharges — a baixa deles mora em
  // contract_rent_charges e em reservations, respectivamente (ver Contratos/Reservas). Traz os
  // dois aqui pra aparecerem no mesmo relatório mês a mês, com baixa própria.
  const { data: parcelasRaw, isLoading: isLoadingParcelas } = trpc.longTermContracts.charges.useQuery({});
  const { data: contratos } = trpc.longTermContracts.list.useQuery({});
  const { data: reservasRaw, isLoading: isLoadingReservas } = trpc.reservations.list.useQuery({});

  const nomeImovel = (id: number | null) => (id === null ? "Empresa" : imoveis?.find((p) => p.id === id)?.apelido ?? "—");
  const nomeInquilino = (contractId: number) => contratos?.find((c) => c.id === contractId)?.nomeInquilino || "Inquilino";

  const reabrir = trpc.ledgerCharges.reabrir.useMutation({
    onSuccess: () => { utils.ledgerCharges.list.invalidate(); toast.success("Movido de volta para em aberto."); },
    onError: (e) => toast.error(e.message),
  });
  const cancelar = trpc.ledgerCharges.cancelar.useMutation({
    onSuccess: () => { utils.ledgerCharges.list.invalidate(); toast.success("Mês cancelado."); },
    onError: (e) => toast.error(e.message),
  });
  const reabrirParcela = trpc.longTermContracts.markPending.useMutation({
    onSuccess: () => { utils.longTermContracts.charges.invalidate(); toast.success("Movido de volta para em aberto."); },
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

  // Aluguéis de longa e curta duração só entram quando o filtro de Tipo permite receita — eles
  // não têm estado "cancelado" (só em aberto/baixado), então o filtro de Situação "cancelado"
  // os deixa de fora.
  const mostraAlugueis = tipo === "" || tipo === "receita";
  const parcelas = useMemo(
    () =>
      !mostraAlugueis
        ? []
        : (parcelasRaw ?? []).filter((p) => {
            if (propertyId && p.propertyId !== Number(propertyId)) return false;
            if (p.competencia < de || p.competencia > ate) return false;
            const statusMapeado = p.status === "recebido" ? "pago" : "aberto";
            if (situacao && situacao !== statusMapeado) return false;
            return true;
          }),
    [parcelasRaw, mostraAlugueis, propertyId, de, ate, situacao],
  );
  const reservas = useMemo(
    () =>
      !mostraAlugueis
        ? []
        : (reservasRaw ?? []).filter((r) => {
            if (propertyId && r.propertyId !== Number(propertyId)) return false;
            if (r.competencia < de || r.competencia > ate) return false;
            const statusMapeado = r.dataRecebimento ? "pago" : "aberto";
            if (situacao && situacao !== statusMapeado) return false;
            return true;
          }),
    [reservasRaw, mostraAlugueis, propertyId, de, ate, situacao],
  );

  const totais = useMemo(() => {
    const acc = charges.reduce(
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
    );
    for (const p of parcelas) {
      acc.receita += p.status === "recebido" ? Number(p.valorRecebido ?? p.valor) : Number(p.valor);
    }
    for (const r of reservas) {
      const previsto = Number(r.valorLiquidoRecebido) || Number(r.valorBruto) + Number(r.taxaLimpeza);
      acc.receita += r.dataRecebimento ? Number(r.valorRecebido ?? previsto) : previsto;
    }
    return acc;
  }, [charges, parcelas, reservas]);
  const resultado = totais.receita - totais.despesa;

  const grupos = useMemo(() => {
    const competencias = new Set<string>();
    for (const c of charges) competencias.add(c.competencia);
    for (const p of parcelas) competencias.add(p.competencia);
    for (const r of reservas) competencias.add(r.competencia);

    return Array.from(competencias)
      .sort()
      .map((competencia) => {
        const itensCharges = charges.filter((c) => c.competencia === competencia);
        const itensParcelas = parcelas.filter((p) => p.competencia === competencia);
        const itensReservas = reservas.filter((r) => r.competencia === competencia);
        return {
          competencia,
          abertos: itensCharges.filter((c) => c.status === "aberto").sort((a, b) => a.dataVencimento.localeCompare(b.dataVencimento)),
          pagos: itensCharges.filter((c) => c.status === "pago").sort((a, b) => (b.dataPagamento ?? "").localeCompare(a.dataPagamento ?? "")),
          cancelados: itensCharges.filter((c) => c.status === "cancelado"),
          parcelasAbertas: itensParcelas.filter((p) => p.status === "pendente").sort((a, b) => a.dataVencimento.localeCompare(b.dataVencimento)),
          parcelasPagas: itensParcelas.filter((p) => p.status === "recebido").sort((a, b) => (b.dataRecebimento ?? "").localeCompare(a.dataRecebimento ?? "")),
          reservasAbertas: itensReservas.filter((r) => !r.dataRecebimento).sort((a, b) => a.checkin.localeCompare(b.checkin)),
          reservasPagas: itensReservas.filter((r) => !!r.dataRecebimento).sort((a, b) => (b.dataRecebimento ?? "").localeCompare(a.dataRecebimento ?? "")),
        };
      });
  }, [charges, parcelas, reservas]);

  function baixarExcel() {
    const linhasManuais = charges.map((c) => {
      const linha: Record<string, string | number> = {
        Tipo: "Lançamento manual",
        Competência: formatCompetencia(c.competencia),
        Imóvel: nomeImovel(c.propertyId),
        Descrição: c.descricao || c.categoria || "—",
        Contraparte: c.contraparte || "—",
        Vencimento: formatDate(c.dataVencimento),
        Valor: Number(c.valor),
        Situação: STATUS_LABEL[c.status],
        "Data pagamento": c.dataPagamento ? formatDate(c.dataPagamento) : "—",
        "Valor pago": c.valorPago ? Number(c.valorPago) : "—",
      };
      if (isContabilidade) linha["Código Contábil"] = c.codigoContabil || "—";
      return linha;
    });
    const linhasParcelas = parcelas.map((p) => ({
      Tipo: "Aluguel — longa duração",
      Competência: formatCompetencia(p.competencia),
      Imóvel: nomeImovel(p.propertyId),
      Descrição: "Aluguel",
      Contraparte: nomeInquilino(p.contractId),
      Vencimento: formatDate(p.dataVencimento),
      Valor: Number(p.valor),
      Situação: p.status === "recebido" ? "Baixado" : "Em aberto",
      "Data pagamento": p.dataRecebimento ? formatDate(p.dataRecebimento) : "—",
      "Valor pago": p.valorRecebido ? Number(p.valorRecebido) : "—",
    }));
    const linhasReservas = reservas.map((r) => {
      const previsto = Number(r.valorLiquidoRecebido) || Number(r.valorBruto) + Number(r.taxaLimpeza);
      const documento = r.estrangeiro
        ? (r.passaporteHospede ? `Passaporte ${r.passaporteHospede}` : "—")
        : (r.cpfHospede ? formatCpfCnpj(r.cpfHospede) : "—");
      return {
        Tipo: "Aluguel — curta duração",
        Competência: formatCompetencia(r.competencia),
        Imóvel: nomeImovel(r.propertyId),
        Descrição: `Aluguel · ${r.codigo}`,
        Contraparte: r.nomeHospede || "—",
        "CPF/Passaporte": documento,
        Vencimento: formatDate(r.checkin),
        Valor: previsto,
        Situação: r.dataRecebimento ? "Baixado" : "Em aberto",
        "Data pagamento": r.dataRecebimento ? formatDate(r.dataRecebimento) : "—",
        "Valor pago": r.valorRecebido ? Number(r.valorRecebido) : "—",
      };
    });
    const linhas = [...linhasManuais, ...linhasParcelas, ...linhasReservas];
    const ws = XLSX.utils.json_to_sheet(linhas);
    ws["!cols"] = [
      { wch: 22 }, { wch: 14 }, { wch: 22 }, { wch: 30 }, { wch: 22 }, { wch: 12 },
      { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Relatório");
    XLSX.writeFile(wb, `relatorio-${de}-a-${ate}.xlsx`);
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-4 flex items-start justify-between gap-3 print:hidden">
        <PageHeader
          title="Relatório"
          subtitle="Cada mês do período, com data própria e baixa individual — dê baixa e anexe o comprovante."
        />
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" className="bg-background" onClick={baixarExcel}>
            <FileSpreadsheet className="mr-1.5 h-4 w-4" /> Baixar Excel
          </Button>
          <Button variant="outline" className="bg-background" onClick={() => window.print()}>
            <Printer className="mr-1.5 h-4 w-4" /> Imprimir PDF
          </Button>
        </div>
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

      {isLoading || isLoadingParcelas || isLoadingReservas ? (
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
                    <RowLabel charge={c} nomeImovel={nomeImovel(c.propertyId)} mostrarCodigo={isContabilidade} />
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
                        <RowLabel charge={c} nomeImovel={nomeImovel(c.propertyId)} pago mostrarCodigo={isContabilidade} />
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
                        <RowLabel charge={c} nomeImovel={nomeImovel(c.propertyId)} mostrarCodigo={isContabilidade} />
                      </span>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-primary" onClick={() => reabrir.mutate({ id: c.id })} title="Reabrir">
                        <RotateCcw className="h-3 w-3" />
                      </Button>
                    </ChargeRow>
                  ))}
                </div>
              )}

              {(g.parcelasAbertas.length > 0 || g.parcelasPagas.length > 0) && (
                <div className="border-t border-border">
                  <p className="px-3 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Aluguéis — Longa duração</p>
                  {g.parcelasAbertas.map((p) => (
                    <ChargeRow key={p.id}>
                      <button className="flex items-center gap-1.5 min-w-0 text-left" onClick={() => setBaixandoParcela(p)} title="Marcar como recebido">
                        <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <ParcelaLabel parcela={p} nomeImovel={nomeImovel(p.propertyId)} nomeInquilino={nomeInquilino(p.contractId)} />
                      </button>
                    </ChargeRow>
                  ))}
                  {g.parcelasPagas.map((p) => (
                    <ChargeRow key={p.id} tom="bg-primary/5">
                      <button className="flex items-center gap-1.5 min-w-0 text-left" onClick={() => reabrirParcela.mutate({ id: p.id })} title="Voltar para em aberto">
                        <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                        <ParcelaLabel parcela={p} nomeImovel={nomeImovel(p.propertyId)} nomeInquilino={nomeInquilino(p.contractId)} pago />
                      </button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-primary shrink-0" onClick={() => reabrirParcela.mutate({ id: p.id })} title="Reabrir">
                        <RotateCcw className="h-3 w-3" />
                      </Button>
                    </ChargeRow>
                  ))}
                </div>
              )}

              {(g.reservasAbertas.length > 0 || g.reservasPagas.length > 0) && (
                <div className="border-t border-border">
                  <p className="px-3 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Aluguéis — Curta duração (Airbnb)</p>
                  {g.reservasAbertas.map((r) => (
                    <ChargeRow key={r.id}>
                      <button className="flex items-center gap-1.5 min-w-0 text-left" onClick={() => setBaixandoReserva(r)} title="Marcar como recebido">
                        <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <ReservaLabel reserva={r} nomeImovel={nomeImovel(r.propertyId)} />
                      </button>
                    </ChargeRow>
                  ))}
                  {g.reservasPagas.map((r) => (
                    <ChargeRow key={r.id} tom="bg-primary/5">
                      <button className="flex items-center gap-1.5 min-w-0 text-left" onClick={() => setBaixandoReserva(r)} title="Ajustar recebimento">
                        <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                        <ReservaLabel reserva={r} nomeImovel={nomeImovel(r.propertyId)} pago />
                      </button>
                    </ChargeRow>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <BaixaDialog charge={baixando} onOpenChange={(o) => !o && setBaixando(null)} />
      <BaixaParcelaDialog parcela={baixandoParcela} onOpenChange={(o) => !o && setBaixandoParcela(null)} />
      <BaixaReservaDialog reserva={baixandoReserva} onOpenChange={(o) => !o && setBaixandoReserva(null)} />
    </div>
  );
}

function RowLabel({ charge, nomeImovel, pago, mostrarCodigo }: { charge: Charge; nomeImovel: string; pago?: boolean; mostrarCodigo?: boolean }) {
  const entrada = charge.grupo === "receita" || charge.grupo === "aporte_capital";
  return (
    <span className="min-w-0">
      <span className="font-medium truncate block">
        {nomeImovel} — {charge.descricao || charge.categoria || "—"}
        {mostrarCodigo && charge.codigoContabil && (
          <span className="ml-1.5 text-[11px] text-muted-foreground font-normal">({charge.codigoContabil})</span>
        )}
      </span>
      <span className="text-[11px] text-muted-foreground block">
        {pago
          ? `${entrada ? "Recebido" : "Pago"} ${charge.dataPagamento ? formatDate(charge.dataPagamento) : "—"} · ${brl(charge.valorPago ?? charge.valor)}`
          : `Vence ${formatDate(charge.dataVencimento)} · ${brl(charge.valor)}${charge.contraparte ? ` · ${charge.contraparte}` : ""}`}
      </span>
    </span>
  );
}

function ParcelaLabel({ parcela, nomeImovel, nomeInquilino, pago }: { parcela: Parcela; nomeImovel: string; nomeInquilino: string; pago?: boolean }) {
  return (
    <span className="min-w-0">
      <span className="font-medium truncate block">{nomeImovel} — Aluguel (longa duração)</span>
      <span className="text-[11px] text-muted-foreground block">
        {pago
          ? `Recebido ${parcela.dataRecebimento ? formatDate(parcela.dataRecebimento) : "—"} · ${brl(parcela.valorRecebido ?? parcela.valor)} · ${nomeInquilino}`
          : `Vence ${formatDate(parcela.dataVencimento)} · ${brl(parcela.valor)} · ${nomeInquilino}`}
      </span>
    </span>
  );
}

function ReservaLabel({ reserva, nomeImovel, pago }: { reserva: Reserva; nomeImovel: string; pago?: boolean }) {
  const previsto = Number(reserva.valorLiquidoRecebido) || Number(reserva.valorBruto) + Number(reserva.taxaLimpeza);
  const documento = reserva.estrangeiro
    ? (reserva.passaporteHospede ? `Passaporte ${reserva.passaporteHospede}` : null)
    : (reserva.cpfHospede ? `CPF ${formatCpfCnpj(reserva.cpfHospede)}` : null);
  const hospede = [reserva.nomeHospede, documento].filter(Boolean).join(" · ");
  return (
    <span className="min-w-0">
      <span className="font-medium truncate block">{nomeImovel} — Aluguel (curta duração) · {reserva.codigo}</span>
      <span className="text-[11px] text-muted-foreground block">
        {pago
          ? `Recebido ${reserva.dataRecebimento ? formatDate(reserva.dataRecebimento) : "—"} · ${brl(reserva.valorRecebido ?? previsto)}${hospede ? ` · ${hospede}` : ""}`
          : `Check-in ${formatDate(reserva.checkin)} · ${brl(previsto)}${hospede ? ` · ${hospede}` : ""}`}
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

function BaixaParcelaDialog({ parcela, onOpenChange }: { parcela: Parcela | null; onOpenChange: (open: boolean) => void }) {
  const utils = trpc.useUtils();
  const [valor, setValor] = useState("");
  const [data, setData] = useState("");
  const idRef = useRef<number | null>(null);

  if (parcela && idRef.current !== parcela.id) {
    idRef.current = parcela.id;
    setValor(String(Number(parcela.valorRecebido ?? parcela.valor)));
    setData(parcela.dataRecebimento || new Date().toISOString().slice(0, 10));
  }
  if (!parcela && idRef.current !== null) idRef.current = null;

  const markReceived = trpc.longTermContracts.markReceived.useMutation({
    onSuccess: () => { utils.longTermContracts.charges.invalidate(); onOpenChange(false); toast.success("Recebimento confirmado."); },
    onError: (e) => toast.error(e.message),
  });

  const confirmar = () => {
    if (!parcela) return;
    const v = Number(valor);
    if (!v || v <= 0) { toast.error("Informe o valor."); return; }
    if (!data) { toast.error("Informe a data."); return; }
    const base = Number(parcela.valor);
    markReceived.mutate({
      id: parcela.id,
      dataRecebimento: data,
      multaJuros: Math.max(0, round2(v - base)),
      desconto: Math.max(0, round2(base - v)),
    });
  };

  return (
    <Dialog open={parcela !== null} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-serif">Marcar como recebido</DialogTitle>
        </DialogHeader>
        {parcela && (
          <div className="grid gap-3 py-2">
            <div className="rounded-lg border border-border bg-secondary/50 px-3 py-2">
              <p className="text-sm font-medium">Aluguel (longa duração) — {formatCompetencia(parcela.competencia)}</p>
              <p className="text-xs text-muted-foreground">Vencimento {formatDate(parcela.dataVencimento)} · Previsto {brl(parcela.valor)}</p>
            </div>
            <div className="grid gap-1.5">
              <Label>Valor recebido (R$)</Label>
              <Input autoFocus value={valor} onChange={(e) => setValor(e.target.value)} type="number" step="0.01" min="0" />
              <p className="text-[11px] text-muted-foreground">Diferente do previsto vira multa/juros (a mais) ou desconto (a menos) automaticamente.</p>
            </div>
            <div className="grid gap-1.5">
              <Label>Data</Label>
              <DateInput value={data} onChange={setData} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" className="bg-background" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={confirmar} disabled={markReceived.isPending}>Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BaixaReservaDialog({ reserva, onOpenChange }: { reserva: Reserva | null; onOpenChange: (open: boolean) => void }) {
  const utils = trpc.useUtils();
  const [valor, setValor] = useState("");
  const [data, setData] = useState("");
  const idRef = useRef<number | null>(null);

  const previsto = reserva ? Number(reserva.valorLiquidoRecebido) || Number(reserva.valorBruto) + Number(reserva.taxaLimpeza) : 0;

  if (reserva && idRef.current !== reserva.id) {
    idRef.current = reserva.id;
    setValor(String(Number(reserva.valorRecebido ?? previsto)));
    setData(reserva.dataRecebimento || new Date().toISOString().slice(0, 10));
  }
  if (!reserva && idRef.current !== null) idRef.current = null;

  const marcarRecebimento = trpc.reservations.marcarRecebimento.useMutation({
    onSuccess: () => { utils.reservations.list.invalidate(); onOpenChange(false); toast.success("Recebimento confirmado."); },
    onError: (e) => toast.error(e.message),
  });

  const confirmar = () => {
    if (!reserva) return;
    const v = Number(valor);
    if (!v || v <= 0) { toast.error("Informe o valor."); return; }
    if (!data) { toast.error("Informe a data."); return; }
    marcarRecebimento.mutate({ id: reserva.id, dataRecebimento: data, valorRecebido: v });
  };

  return (
    <Dialog open={reserva !== null} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-serif">Marcar como recebido</DialogTitle>
        </DialogHeader>
        {reserva && (
          <div className="grid gap-3 py-2">
            <div className="rounded-lg border border-border bg-secondary/50 px-3 py-2">
              <p className="text-sm font-medium">Aluguel (curta duração) — {reserva.codigo}</p>
              <p className="text-xs text-muted-foreground">Check-in {formatDate(reserva.checkin)} · Previsto {brl(previsto)}</p>
            </div>
            <div className="grid gap-1.5">
              <Label>Valor recebido (R$)</Label>
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
          <Button onClick={confirmar} disabled={marcarRecebimento.isPending}>Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
