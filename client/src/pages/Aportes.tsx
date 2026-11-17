import LancamentoManager from "@/components/LancamentoManager";

export default function Aportes() {
  return (
    <LancamentoManager
      titulo="Aportes de Capital"
      subtitulo="Aportes de capital por imóvel, classificados no plano de contas. Informativo na DRE (não entra no resultado operacional)."
      grupos={["aporte_capital"]}
      contraparteLabel="Origem do aporte"
      contraparteholder="Ex.: Proprietário"
      contraparteSocios
      submitLabel="+ Cadastrar aporte"
      emptyLabel="Nenhum aporte cadastrado ainda."
    />
  );
}
