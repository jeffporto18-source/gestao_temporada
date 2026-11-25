import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Circle, Trash2 } from "lucide-react";
import { brl, formatDate, formatCompetencia } from "@/lib/format";
import { PageHeader, EmptyState, SkeletonList } from "./Clientes";
import MarcarRecebidoDialog from "@/components/MarcarRecebidoDialog";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";

export default function AlugueisReceber() {
  const utils = trpc.useUtils();
  const { data: chargesRaw, isLoading } = trpc.longTermContracts.charges.useQuery({});
  const { data: contratos } = trpc.longTermContracts.list.useQuery({});
  const { data: imoveis } = trpc.properties.list.useQuery();
  const [recebendo, setRecebendo] = useState<{ id: number; valor: number } | null>(null);
  const [vencimentoDe, setVencimentoDe] = useState("");
  const [vencimentoAte, setVencimentoAte] = useState("");

  const nomeImovel = (id: number) => imoveis?.find((p) => p.id === id)?.apelido ?? "—";

  const charges = useMemo(
    () =>
      (chargesRaw ?? []).filter(
        (c) => (!vencimentoDe || c.dataVencimento >= vencimentoDe) && (!vencimentoAte || c.dataVencimento <= vencimentoAte),
      ),
    [chargesRaw, vencimentoDe, vencimentoAte],
  );
  const filtroAtivo = !!vencimentoDe || !!vencimentoAte;

  const markPending = trpc.longTermContracts.markPending.useMutation({
    onSuccess: () => { utils.longTermContracts.charges.invalidate(); toast.success("Movido de volta para pendente."); },
    onError: (e) => toast.error(e.message),
  });

  const deleteCharge = trpc.longTermContracts.deleteCharge.useMutation({
    onSuccess: () => { utils.longTermContracts.charges.invalidate(); toast.success("Parcela removida."); },
    onError: (e) => toast.error(e.message),
  });

  // Regime de caixa: pendente agrupa pela competência (o mês do aluguel, que é quando vence),
  // mas já recebida agrupa pelo mês em que o dinheiro realmente entrou (dataRecebimento) — um
  // aluguel pago em atraso precisa contar no mês do recebimento, não no mês em que venceria.
  const grupos = useMemo(() => {
    const pendentesPorMes = new Map<string, NonNullable<typeof charges>>();
    const recebidosPorMes = new Map<string, NonNullable<typeof charges>>();
    for (const ch of charges ?? []) {
      if (ch.status === "recebido") {
        const mes = (ch.dataRecebimento ?? ch.competencia).slice(0, 7);
        if (!recebidosPorMes.has(mes)) recebidosPorMes.set(mes, []);
        recebidosPorMes.get(mes)!.push(ch);
      } else {
        if (!pendentesPorMes.has(ch.competencia)) pendentesPorMes.set(ch.competencia, []);
        pendentesPorMes.get(ch.competencia)!.push(ch);
      }
    }
    const meses = new Set([...Array.from(pendentesPorMes.keys()), ...Array.from(recebidosPorMes.keys())]);
    return Array.from(meses)
      .sort()
      .map((mes) => {
        const pendentes = (pendentesPorMes.get(mes) ?? []).sort((a, b) => a.dataVencimento.localeCompare(b.dataVencimento));
        const recebidos = (recebidosPorMes.get(mes) ?? []).sort((a, b) => (b.dataRecebimento ?? "").localeCompare(a.dataRecebimento ?? ""));
        return {
          competencia: mes,
          pendentes,
          recebidos,
          total: pendentes.reduce((s, c) => s + Number(c.valor), 0) + recebidos.reduce((s, c) => s + Number(c.valorRecebido ?? c.valor), 0),
        };
      });
  }, [charges]);

  const totalGeral = useMemo(
    () => (charges ?? []).reduce((s, c) => s + (c.status === "recebido" ? Number(c.valorRecebido ?? c.valor) : Number(c.valor)), 0),
    [charges],
  );
  const totalGeralPendente = useMemo(() => (charges ?? []).filter((c) => c.status !== "recebido").reduce((s, c) => s + Number(c.valor), 0), [charges]);

  // Condomínio e IPTU só aparecem quando algum contrato manda cobrá-los junto com o aluguel —
  // quem não usa o recurso continua vendo a tela enxuta de antes.
  const temRepasse = useMemo(
    () => (charges ?? []).some((c) => Number(c.condominio ?? 0) > 0 || Number(c.iptu ?? 0) > 0),
    [charges],
  );
  const totalRepasse = useMemo(
    () => (charges ?? []).reduce((s, c) => s + Number(c.condominio ?? 0) + Number(c.iptu ?? 0), 0),
    [charges],
  );

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Aluguéis a Receber"
        subtitle="Todas as parcelas dos contratos de longa duração, do primeiro ao último mês."
      />

      <Card className="mb-4 p-3">
        <p className="text-[11px] font-medium text-muted-foreground mb-2">Filtrar por data de vencimento</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <label className="text-[11px] text-muted-foreground">De</label>
            <DateInput value={vencimentoDe} onChange={setVencimentoDe} className="h-8 w-[150px]" />
          </div>
          <div className="grid gap-1">
            <label className="text-[11px] text-muted-foreground">Até</label>
            <DateInput value={vencimentoAte} onChange={setVencimentoAte} className="h-8 w-[150px]" />
          </div>
          {filtroAtivo && (
            <Button variant="ghost" size="sm" className="h-8" onClick={() => { setVencimentoDe(""); setVencimentoAte(""); }}>
              Limpar filtro
            </Button>
          )}
        </div>
      </Card>

      {isLoading ? (
        <SkeletonList />
      ) : !grupos.length ? (
        filtroAtivo ? (
          <EmptyState title="Nenhuma parcela nesse período" subtitle="Ajuste o filtro de data de vencimento para ver outras parcelas." />
        ) : (
          <EmptyState title="Nenhuma parcela cadastrada" subtitle="Cadastre um contrato de longa duração para ver os aluguéis a receber aqui." />
        )
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3">
            <Card className="px-4 py-2.5">
              <p className="text-[11px] text-muted-foreground">Total geral</p>
              <p className="text-lg font-serif font-semibold text-primary leading-tight">{brl(totalGeral)}</p>
            </Card>
            <Card className="px-4 py-2.5">
              <p className="text-[11px] text-muted-foreground">Total pendente</p>
              <p className="text-lg font-serif font-semibold leading-tight">{brl(totalGeralPendente)}</p>
            </Card>
          </div>

          {temRepasse && (
            <Card className="mb-4 px-4 py-2.5">
              <p className="text-[11px] text-muted-foreground">Condomínio e IPTU repassados no período</p>
              <p className="text-lg font-serif font-semibold leading-tight">{brl(totalRepasse)}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Valores de terceiros: entram na cobrança do inquilino, mas não são receita do proprietário — ficam fora
                dos totais acima, da comissão e do informe de IR.
              </p>
            </Card>
          )}

          <div className="space-y-3">
            {grupos.map((g) => (
              <Card key={g.competencia} className="overflow-hidden py-0">
                <div className="flex items-center justify-between px-3 py-1.5 bg-secondary/50 border-b border-border">
                  <span className="text-sm font-serif font-semibold capitalize">{formatCompetencia(g.competencia)}</span>
                  <span className="tabular-nums text-sm font-semibold text-primary">{brl(g.total)}</span>
                </div>

                {g.pendentes.length > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow className="text-[11px]">
                        <TableHead className="h-7">Imóvel</TableHead>
                        <TableHead className="h-7">Vencimento</TableHead>
                        <TableHead className="h-7 text-right">Aluguel</TableHead>
                        {temRepasse && <TableHead className="h-7 text-right">Condomínio</TableHead>}
                        {temRepasse && <TableHead className="h-7 text-right">IPTU</TableHead>}
                        {temRepasse && <TableHead className="h-7 text-right">Total cobrado</TableHead>}
                        <TableHead className="h-7 w-0"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {g.pendentes.map((ch) => (
                        <TableRow key={ch.id} className="text-xs">
                          <TableCell className="py-1.5">
                            <button className="flex items-center gap-1.5" onClick={() => setRecebendo({ id: ch.id, valor: Number(ch.valor) })} title="Marcar como recebido">
                              <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="font-medium">{nomeImovel(ch.propertyId)}</span>
                            </button>
                          </TableCell>
                          <TableCell className="py-1.5 text-muted-foreground">{formatDate(ch.dataVencimento)}</TableCell>
                          <TableCell className="py-1.5 text-right tabular-nums font-medium">{brl(ch.valor)}</TableCell>
                          {temRepasse && <TableCell className="py-1.5 text-right tabular-nums text-muted-foreground">{brl(ch.condominio ?? 0)}</TableCell>}
                          {temRepasse && <TableCell className="py-1.5 text-right tabular-nums text-muted-foreground">{brl(ch.iptu ?? 0)}</TableCell>}
                          {temRepasse && (
                            <TableCell className="py-1.5 text-right tabular-nums font-medium">
                              {brl(Number(ch.valor) + Number(ch.condominio ?? 0) + Number(ch.iptu ?? 0))}
                            </TableCell>
                          )}
                          <TableCell className="py-1.5">
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => deleteCharge.mutate({ id: ch.id })}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}

                {g.recebidos.length > 0 && (
                  <div className={g.pendentes.length > 0 ? "border-t border-border" : ""}>
                    <p className="px-3 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-primary">Aluguel recebido</p>
                    <Table>
                      <TableBody>
                        {g.recebidos.map((ch) => {
                          const multa = Number(ch.multaJuros ?? 0);
                          const desconto = Number(ch.desconto ?? 0);
                          return (
                            <TableRow key={ch.id} className="text-xs bg-primary/5 align-top">
                              <TableCell className="py-1.5">
                                <button className="flex items-center gap-1.5" onClick={() => markPending.mutate({ id: ch.id })} title="Voltar para pendente">
                                  <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                                  <span className="font-medium">{nomeImovel(ch.propertyId)}</span>
                                </button>
                              </TableCell>
                              <TableCell className="py-1.5 text-muted-foreground">
                                <p>Recebido {ch.dataRecebimento ? formatDate(ch.dataRecebimento) : "—"}</p>
                                {(multa > 0 || desconto > 0) && (
                                  <p className="text-[11px]">
                                    {multa > 0 && <span className="text-primary">+{brl(multa)} multa/juros</span>}
                                    {multa > 0 && desconto > 0 && " · "}
                                    {desconto > 0 && <span className="text-destructive">-{brl(desconto)} desconto</span>}
                                  </p>
                                )}
                              </TableCell>
                              <TableCell className="py-1.5 text-right tabular-nums font-medium">{brl(ch.valorRecebido ?? ch.valor)}</TableCell>
                              {temRepasse && <TableCell className="py-1.5 text-right tabular-nums text-muted-foreground">{brl(ch.condominio ?? 0)}</TableCell>}
                              {temRepasse && <TableCell className="py-1.5 text-right tabular-nums text-muted-foreground">{brl(ch.iptu ?? 0)}</TableCell>}
                              {temRepasse && (
                                <TableCell className="py-1.5 text-right tabular-nums font-medium">
                                  {brl(Number(ch.valorRecebido ?? ch.valor) + Number(ch.condominio ?? 0) + Number(ch.iptu ?? 0))}
                                </TableCell>
                              )}
                              <TableCell className="py-1.5">
                                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => deleteCharge.mutate({ id: ch.id })}>
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </>
      )}

      <MarcarRecebidoDialog
        chargeId={recebendo?.id ?? null}
        valorOriginal={recebendo?.valor ?? 0}
        onOpenChange={(o) => !o && setRecebendo(null)}
        onSuccess={() => { utils.longTermContracts.charges.invalidate(); setRecebendo(null); }}
      />
    </div>
  );
}
