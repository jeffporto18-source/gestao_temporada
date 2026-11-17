import LancamentoManager from "@/components/LancamentoManager";

export default function DistribuicaoLucros() {
  return (
    <LancamentoManager
      titulo="Distribuição de Lucros"
      subtitulo="Lucro distribuído aos sócios por imóvel, classificado no plano de contas. Não é despesa — não integra a DRE. A baixa (pago, data e comprovante) é feita na aba Relatório, para conciliar com o extrato."
      grupos={["distribuicao_lucros"]}
      contraparteLabel="Sócio"
      contraparteholder="Ex.: Nome do sócio"
      contraparteSocios
      submitLabel="+ Cadastrar distribuição"
      emptyLabel="Nenhuma distribuição de lucros cadastrada ainda."
    />
  );
}
