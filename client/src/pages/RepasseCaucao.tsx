import LancamentoManager from "@/components/LancamentoManager";

export default function RepasseCaucao() {
  return (
    <LancamentoManager
      titulo="Repasse de Caução"
      subtitulo="Caução de terceiros que fica com o proprietário. Não integra a DRE (nem por unidade, nem da empresa). A baixa (repassado, data e comprovante) é feita na aba Relatório."
      grupos={["repasse_caucao"]}
      contraparteLabel="Proprietário/Inquilino"
      contraparteholder="Ex.: Nome do proprietário"
      submitLabel="+ Cadastrar repasse"
      emptyLabel="Nenhum repasse de caução cadastrado ainda."
    />
  );
}
