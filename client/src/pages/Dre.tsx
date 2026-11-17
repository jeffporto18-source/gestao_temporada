import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { useState } from "react";
import { brl, competenciaAtual } from "@/lib/format";
import { PageHeader, EmptyState } from "./Clientes";
import { UnitPeriodFilter } from "@/components/UnitPeriodFilter";
import { TrendingDown, TrendingUp } from "lucide-react";

/**
 * Rótulo de uma despesa lançada: o nome que identifica ELA (descrição digitada ou, na falta
 * dela, o fornecedor), não só a conta do plano — senão toda despesa da mesma conta (ex.: duas
 * contas de "Manutenção" de fornecedores diferentes) apareceria com o mesmo nome genérico.
 */
function despesaLabel(e: { categoria?: string | null; descricao?: string | null; contraparte?: string | null }) {
  const nome = e.descricao || e.contraparte || e.categoria || "Despesa";
  const detalhes = [e.categoria, e.descricao && e.contraparte ? e.contraparte : null].filter(
    (v, i, arr) => v && v !== nome && arr.indexOf(v) === i,
  );
  return { nome, detail: detalhes.join(" · ") || undefined };
}

export default function Dre() {
  const { data: imoveis } = trpc.properties.list.useQuery();
  const [propertyId, setPropertyId] = useState<string>("");
  const [competencia, setCompetencia] = useState<string>(competenciaAtual());

  const enabled = !!propertyId;
  const { data: dre, isLoading } = trpc.dre.porUnidade.useQuery(
    { propertyId: Number(propertyId), competencia },
    { enabled },
  );

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="DRE por Unidade"
        subtitle="Demonstrativo de resultado mensal consolidado de cada imóvel."
      />

      <UnitPeriodFilter
        properties={imoveis}
        propertyId={propertyId}
        setPropertyId={setPropertyId}
        competencia={competencia}
        setCompetencia={setCompetencia}
      />

      {!enabled ? (
        <EmptyState title="Selecione um imóvel" subtitle="Escolha a unidade e a competência para ver a DRE." />
      ) : isLoading ? (
        <div className="h-96 rounded-xl border border-border bg-card animate-pulse" />
      ) : !dre ? (
        <EmptyState title="Sem dados no período" />
      ) : (
        <div className="space-y-5">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="font-serif text-xl font-semibold">{dre.propriedade.apelido}</h2>
                <p className="text-sm text-muted-foreground">
                  {dre.cliente?.nome} · {dre.totalReservas} {dre.propriedade.tipoLocacao === "longa" ? "parcela(s) de aluguel" : "reservas"} · comp. {competencia}
                </p>
              </div>
            </div>

            <div className="space-y-1">
              <Line label="Receita bruta de locação" value={brl(dre.receitaBruta)} bold positive />
              <Line label={`(−) Taxa Airbnb`} value={`− ${brl(dre.taxaAirbnb)}`} sub />
              <Line label={`(−) Comissão da administradora`} value={`− ${brl(dre.comissao)}`} sub />
              <Divider />
              <Line label="(=) Repasse bruto ao proprietário" value={brl(dre.repasseBruto)} bold />

              {dre.receitasManuais.length > 0 && (
                <>
                  <SectionLabel>Outras receitas</SectionLabel>
                  {dre.receitasManuais.map((r) => (
                    <Line key={r.id} label={r.categoria || "Receita"} value={`+ ${brl(r.valor)}`} sub small positive />
                  ))}
                  <Line label="(+) Total de outras receitas" value={`+ ${brl(dre.totalReceitasManuais)}`} sub positive />
                </>
              )}

              {dre.despesasFixas.length > 0 && (
                <>
                  <SectionLabel>Despesas fixas</SectionLabel>
                  {dre.despesasFixas.map((e) => {
                    const { nome, detail } = despesaLabel(e);
                    return <Line key={e.id} label={nome} detail={detail} value={`− ${brl(e.valor)}`} sub small />;
                  })}
                </>
              )}
              <Line label="(−) Total de despesas fixas" value={`− ${brl(dre.totalDespesasFixas)}`} sub />

              {dre.despesasVariaveis.length > 0 && (
                <>
                  <SectionLabel>Despesas variáveis</SectionLabel>
                  {dre.despesasVariaveis.map((e) => {
                    const { nome, detail } = despesaLabel(e);
                    return <Line key={e.id} label={nome} detail={detail} value={`− ${brl(e.valor)}`} sub small />;
                  })}
                </>
              )}
              <Line label="(−) Total de despesas variáveis" value={`− ${brl(dre.totalDespesasVariaveis)}`} sub />

              <Divider />
              <div className={`flex items-center justify-between rounded-lg px-4 py-4 ${dre.resultadoProprietario >= 0 ? "bg-primary/10" : "bg-destructive/10"}`}>
                <span className="flex items-center gap-2 font-medium">
                  {dre.resultadoProprietario >= 0 ? <TrendingUp className="h-4 w-4 text-primary" /> : <TrendingDown className="h-4 w-4 text-destructive" />}
                  Resultado líquido do proprietário
                </span>
                <span className={`tabular-nums font-serif text-xl font-semibold ${dre.resultadoProprietario >= 0 ? "text-primary" : "text-destructive"}`}>
                  {brl(dre.resultadoProprietario)}
                </span>
              </div>
              {dre.totalAportes > 0 && (
                <p className="text-xs text-muted-foreground pt-2">
                  Aportes de capital no período: <span className="font-medium">{brl(dre.totalAportes)}</span> (informativo, não incluído no resultado operacional acima).
                </p>
              )}
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="font-serif font-semibold mb-3">Tributos sobre a locação (fase de teste 2026)</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Base reduzida em 40% (redutor da locação por temporada). Alíquotas simbólicas de teste.
            </p>
            <div className="grid grid-cols-3 gap-4">
              <Metric label="CBS (locação)" value={brl(dre.cbs)} />
              <Metric label="IBS (locação)" value={brl(dre.ibs)} />
              <Metric label="Total CBS + IBS" value={brl(dre.cbs + dre.ibs)} />
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function Line({ label, value, bold, sub, small, positive, detail }: { label: string; value: string; bold?: boolean; sub?: boolean; small?: boolean; positive?: boolean; detail?: string }) {
  return (
    <div className={`flex items-center justify-between gap-3 py-1.5 ${small ? "pl-4" : ""}`}>
      <span className={`min-w-0 ${sub ? "text-muted-foreground" : ""} ${small ? "text-sm" : ""}`}>
        <span className="block truncate">{label}</span>
        {detail && <span className="block truncate text-[11px] text-muted-foreground">{detail}</span>}
      </span>
      <span className={`tabular-nums shrink-0 ${bold ? "font-semibold" : ""} ${positive ? "text-primary" : ""} ${small ? "text-sm" : ""}`}>{value}</span>
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-border my-2" />;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground pt-3 pb-1">{children}</p>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="tabular-nums font-semibold mt-1">{value}</p>
    </div>
  );
}
