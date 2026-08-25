/**
 * Próximo dia útil bancário, contando fim de semana e feriados nacionais (o calendário que os
 * bancos seguem para liberar um PIX/repasse — feriado municipal não entra, o pagamento não trava
 * por causa dele). Usado só para SUGERIR a data de recebimento; o valor real sempre pode ser
 * ajustado à mão, porque a plataforma às vezes atrasa por outros motivos que nenhuma fórmula prevê.
 */

/** Domingo de Páscoa do ano informado (algoritmo de Gauss/Meeus). */
function pascoa(ano: number): { mes: number; dia: number } {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return { mes, dia };
}

function addDaysIso(iso: string, dias: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}

/** Feriados nacionais fixos + móveis (a partir da Páscoa) do ano informado, formato "AAAA-MM-DD". */
function feriadosDoAno(ano: number): Set<string> {
  const p = pascoa(ano);
  const pascoaIso = `${ano}-${String(p.mes).padStart(2, "0")}-${String(p.dia).padStart(2, "0")}`;
  return new Set([
    `${ano}-01-01`, // Confraternização Universal
    addDaysIso(pascoaIso, -48), // Segunda de Carnaval
    addDaysIso(pascoaIso, -47), // Terça de Carnaval
    addDaysIso(pascoaIso, -2), // Sexta-feira Santa
    `${ano}-04-21`, // Tiradentes
    `${ano}-05-01`, // Dia do Trabalho
    addDaysIso(pascoaIso, 60), // Corpus Christi
    `${ano}-09-07`, // Independência
    `${ano}-10-12`, // Nossa Senhora Aparecida
    `${ano}-11-02`, // Finados
    `${ano}-11-15`, // Proclamação da República
    `${ano}-11-20`, // Consciência Negra (feriado nacional desde 2024)
    `${ano}-12-25`, // Natal
  ]);
}

function ehFimDeSemana(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  const diaSemana = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return diaSemana === 0 || diaSemana === 6;
}

function ehFeriadoNacional(iso: string): boolean {
  const ano = Number(iso.slice(0, 4));
  return feriadosDoAno(ano).has(iso);
}

/** Se a data cair em fim de semana ou feriado nacional, avança até o próximo dia útil. */
export function proximoDiaUtil(iso: string): string {
  let atual = iso;
  while (ehFimDeSemana(atual) || ehFeriadoNacional(atual)) {
    atual = addDaysIso(atual, 1);
  }
  return atual;
}

/**
 * Data sugerida de repasse do Airbnb: check-in + 1 dia, avançada para o próximo dia útil se cair
 * em fim de semana ou feriado nacional. É só uma estimativa para pré-preencher o campo — o valor
 * real deve ser conferido e ajustado ao confirmar o recebimento.
 */
export function dataSugeridaRecebimentoAirbnb(checkin: string): string {
  return proximoDiaUtil(addDaysIso(checkin, 1));
}
