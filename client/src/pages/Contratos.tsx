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
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, FileText, CheckCircle2, Circle, User, Upload, ExternalLink, Loader2, Pencil } from "lucide-react";
import { brl, formatDate } from "@/lib/format";
import { PageHeader, EmptyState, SkeletonList } from "./Clientes";

interface ContractForm {
  propertyId: string;
  dataInicio: string;
  prazoMeses: string;
  diaVencimentoAluguel: string;
  indiceCorrecao: string;
  carenciaInicio: string;
  carenciaFim: string;
  valorAluguel: string;
  nomeInquilino: string;
  cpfCnpjInquilino: string;
  contatoInquilino: string;
  telefoneInquilino: string;
  celularInquilino: string;
  whatsappInquilino: string;
  emailInquilino: string;
  tipoGarantia: string;
  comissaoPct: string;
  tipoAdministracao: "propria" | "administradora" | "gestor_curta_temporada";
  imobiliariaId: string;
  renovacaoAutomatica: "" | "novo_contrato" | "prazo_indeterminado";
  prazoIndeterminadoDataInicio: string;
  prazoIndeterminadoValor: string;
  prazoIndeterminadoPrazoReajusteMeses: string;
  renovacaoNovoContratoDataInicio: string;
  renovacaoNovoContratoPrazoMeses: string;
  renovacaoNovoContratoValor: string;
  condominioPor: CostResponsibility;
  iptuPor: CostResponsibility;
}

type CostResponsibility = "proprietario" | "inquilino_direto" | "inquilino_via_repasse";

const RESPONSAVEL_CUSTO_LABELS: Record<CostResponsibility, string> = {
  proprietario: "Proprietário",
  inquilino_direto: "Inquilino — paga direto",
  inquilino_via_repasse: "Inquilino — cobrado junto com o aluguel",
};

const emptyForm: ContractForm = {
  propertyId: "", dataInicio: "", prazoMeses: "12", diaVencimentoAluguel: "10",
  indiceCorrecao: "IGPM", carenciaInicio: "", carenciaFim: "", valorAluguel: "",
  nomeInquilino: "", cpfCnpjInquilino: "", contatoInquilino: "", telefoneInquilino: "", celularInquilino: "",
  whatsappInquilino: "", emailInquilino: "", tipoGarantia: "", comissaoPct: "0", tipoAdministracao: "propria", imobiliariaId: "",
  renovacaoAutomatica: "", prazoIndeterminadoDataInicio: "", prazoIndeterminadoValor: "", prazoIndeterminadoPrazoReajusteMeses: "",
  renovacaoNovoContratoDataInicio: "", renovacaoNovoContratoPrazoMeses: "12", renovacaoNovoContratoValor: "",
  condominioPor: "proprietario", iptuPor: "proprietario",
};

const RENOVACAO_LABELS: Record<Exclude<ContractForm["renovacaoAutomatica"], "">, string> = {
  novo_contrato: "Novo contrato",
  prazo_indeterminado: "Prazo indeterminado",
};

const TIPO_ADMIN_LABELS_CONTRATO: Record<ContractForm["tipoAdministracao"], string> = {
  propria: "Direta (proprietário)",
  administradora: "Administradora",
  gestor_curta_temporada: "Gestor de temporada terceirizado",
};

/** Soma meses a uma data "AAAA-MM-DD", preservando o dia (ajustado para o fim do mês se necessário) */
function addMonthsToDate(data: string, months: number): string {
  const [y, m, d] = data.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const ultimoDiaDoMes = new Date(ny, nm, 0).getDate();
  const diaAjustado = Math.min(d, ultimoDiaDoMes);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(diaAjustado).padStart(2, "0")}`;
}

/** Linha de anexo de documento (label + botão anexar/substituir + link ver), reutilizada nos 3 slots do contrato. */
function DocumentoUploadRow({
  label,
  url,
  uploading,
  accept,
  onUpload,
  allowReplace = true,
  disabled = false,
}: {
  label: string;
  url?: string | null;
  uploading: boolean;
  accept: string;
  onUpload: (file: File) => void;
  /** Quando false, some com o botão de anexar/substituir assim que houver um arquivo (só o "Ver" fica visível). */
  allowReplace?: boolean;
  /** Quando true, mostra a linha mas trava o botão de anexar — usado antes de o contrato ter sido salvo (sem id ainda). */
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
          e.target.value = "";
        }}
      />
      <span className="text-xs text-muted-foreground w-36 shrink-0">{label}</span>
      {(allowReplace || !url) && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs text-muted-foreground hover:text-primary"
          disabled={uploading || disabled}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />}
          {url ? "Substituir" : "Anexar"}
        </Button>
      )}
      {url && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-muted-foreground hover:text-primary"
          onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
        >
          <ExternalLink className="mr-1 h-3.5 w-3.5" /> Ver
        </Button>
      )}
    </div>
  );
}

export default function Contratos() {
  const utils = trpc.useUtils();
  const { data: imoveis } = trpc.properties.list.useQuery();
  const [propertyId, setPropertyId] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ContractForm>(emptyForm);
  const [selectedContractId, setSelectedContractId] = useState<number | null>(null);
  // Contrato sendo editado no diálogo — formulário e anexos ficam juntos na mesma tela. Ao criar
  // um contrato novo, o id retornado é atribuído aqui também, então o diálogo não troca de tela:
  // continua no mesmo formulário, os anexos liberam na hora e "Salvar" passa a atualizar.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [savedDocs, setSavedDocs] = useState<{ contratoLocacaoUrl?: string; garantiaDocumentoUrl?: string; apoliceSeguroUrl?: string; renovacaoContratoUrl?: string }>({});
  // Toggle de "sem carência": quando marcado, esvazia e esconde os campos de data de carência.
  const [semCarencia, setSemCarencia] = useState(false);
  const [uploadingLocacao, setUploadingLocacao] = useState(false);
  const [uploadingGarantia, setUploadingGarantia] = useState(false);
  const [uploadingApolice, setUploadingApolice] = useState(false);
  const [uploadingRenovacao, setUploadingRenovacao] = useState(false);

  const longTermProps = useMemo(() => (imoveis ?? []).filter((p) => p.tipoLocacao === "longa"), [imoveis]);

  const { data: contratos, isLoading } = trpc.longTermContracts.list.useQuery(
    { propertyId: propertyId ? Number(propertyId) : undefined },
    { enabled: true },
  );

  // Todos os contratos (sem filtro de imóvel), usado para saber quais imóveis já têm contrato.
  const { data: todosContratos } = trpc.longTermContracts.list.useQuery({});
  const imoveisComContrato = useMemo(() => new Set((todosContratos ?? []).map((c) => c.propertyId)), [todosContratos]);
  const imoveisSemContrato = useMemo(() => longTermProps.filter((p) => !imoveisComContrato.has(p.id)), [longTermProps, imoveisComContrato]);

  // Quando a tela já está filtrada por um imóvel específico (sem contrato ainda), "Novo contrato"
  // não precisa perguntar de novo qual imóvel é — a pessoa já escolheu isso uma vez, no filtro do
  // topo da página. Escolher duas vezes a mesma coisa foi o que um usuário real relatou.
  const imovelTravado = useMemo(
    () => (propertyId ? imoveisSemContrato.find((p) => String(p.id) === propertyId) : undefined),
    [propertyId, imoveisSemContrato],
  );

  const { data: charges } = trpc.longTermContracts.charges.useQuery(
    { contractId: selectedContractId ?? undefined },
    { enabled: !!selectedContractId },
  );

  const { data: garantias } = trpc.guaranteeTypes.list.useQuery();
  const { data: imobiliarias } = trpc.imobiliarias.list.useQuery();

  const reset = () => { setForm(emptyForm); setSavedDocs({}); setEditingId(null); setSemCarencia(false); };

  const create = trpc.longTermContracts.create.useMutation({
    onSuccess: (res) => {
      utils.longTermContracts.list.invalidate();
      utils.properties.list.invalidate(); // o anexo antigo do imóvel pode ter sido migrado para cá
      setSelectedContractId(res.id);
      // Continua na mesma tela em vez de trocar para uma etapa separada: passa a tratar como edição
      // deste contrato recém-criado, então os anexos liberam na hora e o botão Salvar passa a atualizar.
      setEditingId(res.id);
      // Se o imóvel já tinha um contrato de locação anexado antes de existir esta aba, ele acabou
      // de ser herdado pelo contrato — mostra como já anexado em vez de pedir para anexar de novo.
      if (res.contratoLocacaoUrl) {
        setSavedDocs((prev) => ({ ...prev, contratoLocacaoUrl: res.contratoLocacaoUrl ?? undefined }));
        toast.success("Contrato cadastrado. O documento já anexado no imóvel foi vinculado a ele.");
      } else {
        toast.success("Contrato cadastrado. Você já pode anexar os documentos abaixo.");
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const update = trpc.longTermContracts.update.useMutation({
    onSuccess: () => {
      utils.longTermContracts.list.invalidate();
      toast.success("Contrato atualizado.");
      setOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const del = trpc.longTermContracts.delete.useMutation({
    onSuccess: () => { utils.longTermContracts.list.invalidate(); setSelectedContractId(null); toast.success("Contrato removido."); },
    onError: (e) => toast.error(e.message),
  });

  const deleteCharge = trpc.longTermContracts.deleteCharge.useMutation({
    onSuccess: () => { utils.longTermContracts.charges.invalidate(); toast.success("Parcela removida."); },
    onError: (e) => toast.error(e.message),
  });

  const prazoMesesNum = Number(form.prazoMeses) || 12;
  const dataFimCalculada = form.dataInicio ? addMonthsToDate(form.dataInicio, prazoMesesNum) : "";
  // Reajuste ocorre a cada 12 meses, mas não conta o reajuste que cai em cima do fim do contrato
  // (ex.: 12 meses → nenhum; 24 meses → 1, aos 12; 30 meses → 2, aos 12 e aos 24).
  const numReajustes = Math.max(0, Math.ceil(prazoMesesNum / 12) - 1);
  const datasReajusteCalculadas = form.dataInicio
    ? Array.from({ length: numReajustes }, (_, i) => addMonthsToDate(form.dataInicio, 12 * (i + 1)))
    : [];

  const renovacaoNovoContratoPrazoNum = Number(form.renovacaoNovoContratoPrazoMeses) || 12;
  const renovacaoNovoContratoDataFimCalculada = form.renovacaoNovoContratoDataInicio
    ? addMonthsToDate(form.renovacaoNovoContratoDataInicio, renovacaoNovoContratoPrazoNum)
    : "";
  const renovacaoNovoContratoDataReajusteCalculada = form.renovacaoNovoContratoDataInicio
    ? addMonthsToDate(form.renovacaoNovoContratoDataInicio, 12)
    : "";

  const submit = () => {
    if (!form.dataInicio) { toast.error("Informe a data de início do contrato."); return; }

    if (editingId !== null) {
      update.mutate({
        id: editingId,
        dataInicio: form.dataInicio,
        indiceCorrecao: form.indiceCorrecao || "IGPM",
        prazoMeses: prazoMesesNum,
        diaVencimentoAluguel: Number(form.diaVencimentoAluguel) || 10,
        carenciaInicio: form.carenciaInicio || undefined,
        carenciaFim: form.carenciaFim || undefined,
        nomeInquilino: form.nomeInquilino || undefined,
        cpfCnpjInquilino: form.cpfCnpjInquilino || undefined,
        contatoInquilino: form.contatoInquilino || undefined,
        telefoneInquilino: form.telefoneInquilino || undefined,
        celularInquilino: form.celularInquilino || undefined,
        whatsappInquilino: form.whatsappInquilino || undefined,
        emailInquilino: form.emailInquilino || undefined,
        tipoGarantia: form.tipoGarantia || undefined,
        comissaoPct: form.tipoAdministracao === "propria" ? 0 : Number(form.comissaoPct) || 0,
        tipoAdministracao: form.tipoAdministracao,
        imobiliariaId: form.tipoAdministracao === "administradora" && form.imobiliariaId ? Number(form.imobiliariaId) : null,
        renovacaoAutomatica: form.renovacaoAutomatica || null,
        prazoIndeterminadoDataInicio: form.renovacaoAutomatica === "prazo_indeterminado" ? (form.prazoIndeterminadoDataInicio || null) : null,
        prazoIndeterminadoValor: form.renovacaoAutomatica === "prazo_indeterminado" && form.prazoIndeterminadoValor ? Number(form.prazoIndeterminadoValor) : null,
        prazoIndeterminadoPrazoReajusteMeses: form.renovacaoAutomatica === "prazo_indeterminado" && form.prazoIndeterminadoPrazoReajusteMeses ? Number(form.prazoIndeterminadoPrazoReajusteMeses) : null,
        renovacaoNovoContratoDataInicio: form.renovacaoAutomatica === "novo_contrato" ? (form.renovacaoNovoContratoDataInicio || null) : null,
        renovacaoNovoContratoPrazoMeses: form.renovacaoAutomatica === "novo_contrato" && form.renovacaoNovoContratoPrazoMeses ? Number(form.renovacaoNovoContratoPrazoMeses) : null,
        renovacaoNovoContratoValor: form.renovacaoAutomatica === "novo_contrato" && form.renovacaoNovoContratoValor ? Number(form.renovacaoNovoContratoValor) : null,
        condominioPor: form.condominioPor,
        iptuPor: form.iptuPor,
      });
      return;
    }

    if (!form.propertyId) { toast.error("Selecione o imóvel."); return; }
    const valor = Number(form.valorAluguel);
    if (!valor || valor <= 0) { toast.error("Informe o valor do aluguel."); return; }
    create.mutate({
      propertyId: Number(form.propertyId),
      dataInicio: form.dataInicio,
      indiceCorrecao: form.indiceCorrecao || "IGPM",
      prazoMeses: prazoMesesNum,
      diaVencimentoAluguel: Number(form.diaVencimentoAluguel) || 10,
      valorAluguel: valor,
      carenciaInicio: form.carenciaInicio || undefined,
      carenciaFim: form.carenciaFim || undefined,
      nomeInquilino: form.nomeInquilino || undefined,
      cpfCnpjInquilino: form.cpfCnpjInquilino || undefined,
      contatoInquilino: form.contatoInquilino || undefined,
      telefoneInquilino: form.telefoneInquilino || undefined,
      celularInquilino: form.celularInquilino || undefined,
      whatsappInquilino: form.whatsappInquilino || undefined,
      emailInquilino: form.emailInquilino || undefined,
      tipoGarantia: form.tipoGarantia || undefined,
      comissaoPct: form.tipoAdministracao === "propria" ? 0 : Number(form.comissaoPct) || 0,
      tipoAdministracao: form.tipoAdministracao,
      imobiliariaId: form.tipoAdministracao === "administradora" && form.imobiliariaId ? Number(form.imobiliariaId) : undefined,
      renovacaoAutomatica: form.renovacaoAutomatica || undefined,
      prazoIndeterminadoDataInicio: form.renovacaoAutomatica === "prazo_indeterminado" ? (form.prazoIndeterminadoDataInicio || undefined) : undefined,
      prazoIndeterminadoValor: form.renovacaoAutomatica === "prazo_indeterminado" && form.prazoIndeterminadoValor ? Number(form.prazoIndeterminadoValor) : undefined,
      prazoIndeterminadoPrazoReajusteMeses: form.renovacaoAutomatica === "prazo_indeterminado" && form.prazoIndeterminadoPrazoReajusteMeses ? Number(form.prazoIndeterminadoPrazoReajusteMeses) : undefined,
      renovacaoNovoContratoDataInicio: form.renovacaoAutomatica === "novo_contrato" ? (form.renovacaoNovoContratoDataInicio || undefined) : undefined,
      renovacaoNovoContratoPrazoMeses: form.renovacaoAutomatica === "novo_contrato" && form.renovacaoNovoContratoPrazoMeses ? Number(form.renovacaoNovoContratoPrazoMeses) : undefined,
      renovacaoNovoContratoValor: form.renovacaoAutomatica === "novo_contrato" && form.renovacaoNovoContratoValor ? Number(form.renovacaoNovoContratoValor) : undefined,
      condominioPor: form.condominioPor,
      iptuPor: form.iptuPor,
    });
  };

  const nomeImovel = (id: number) => imoveis?.find((p) => p.id === id)?.apelido ?? "—";
  const selectedContract = contratos?.find((c) => c.id === selectedContractId);

  const openEdit = (c: NonNullable<typeof contratos>[number]) => {
    setEditingId(c.id);
    setSemCarencia(!c.carenciaInicio && !c.carenciaFim);
    setForm({
      propertyId: String(c.propertyId),
      dataInicio: c.dataInicio,
      prazoMeses: String(c.prazoMeses),
      diaVencimentoAluguel: String(c.diaVencimentoAluguel),
      indiceCorrecao: c.indiceCorrecao,
      carenciaInicio: c.carenciaInicio || "",
      carenciaFim: c.carenciaFim || "",
      valorAluguel: "",
      nomeInquilino: c.nomeInquilino || "",
      cpfCnpjInquilino: c.cpfCnpjInquilino || "",
      contatoInquilino: c.contatoInquilino || "",
      telefoneInquilino: c.telefoneInquilino || "",
      celularInquilino: c.celularInquilino || "",
      whatsappInquilino: c.whatsappInquilino || "",
      emailInquilino: c.emailInquilino || "",
      tipoGarantia: c.tipoGarantia || "",
      comissaoPct: String(c.comissaoPct ?? "0"),
      tipoAdministracao: c.tipoAdministracao as ContractForm["tipoAdministracao"],
      imobiliariaId: c.imobiliariaId ? String(c.imobiliariaId) : "",
      renovacaoAutomatica: (c.renovacaoAutomatica as ContractForm["renovacaoAutomatica"]) || "",
      prazoIndeterminadoDataInicio: c.prazoIndeterminadoDataInicio || "",
      prazoIndeterminadoValor: c.prazoIndeterminadoValor ? String(c.prazoIndeterminadoValor) : "",
      prazoIndeterminadoPrazoReajusteMeses: c.prazoIndeterminadoPrazoReajusteMeses ? String(c.prazoIndeterminadoPrazoReajusteMeses) : "",
      renovacaoNovoContratoDataInicio: c.renovacaoNovoContratoDataInicio || "",
      renovacaoNovoContratoPrazoMeses: c.renovacaoNovoContratoPrazoMeses ? String(c.renovacaoNovoContratoPrazoMeses) : "12",
      renovacaoNovoContratoValor: c.renovacaoNovoContratoValor ? String(c.renovacaoNovoContratoValor) : "",
      condominioPor: (c.condominioPor as CostResponsibility) || "proprietario",
      iptuPor: (c.iptuPor as CostResponsibility) || "proprietario",
    });
    setSavedDocs({
      contratoLocacaoUrl: c.contratoLocacaoUrl || undefined,
      garantiaDocumentoUrl: c.garantiaDocumentoUrl || undefined,
      apoliceSeguroUrl: c.apoliceSeguroUrl || undefined,
      renovacaoContratoUrl: c.renovacaoContratoUrl || undefined,
    });
    setOpen(true);
  };

  /** Upload genérico de documento do contrato, usado pelos 3 slots (locação, garantia, apólice). */
  const uploadContractDoc = async (
    endpoint: string,
    contractId: number,
    file: File,
    setUploading: (v: boolean) => void,
    successMsg: string,
    onDone?: (data: any) => void,
  ) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("contractId", String(contractId));
      const resp = await fetch(endpoint, { method: "POST", body: formData });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || "Erro ao enviar.");
      toast.success(successMsg);
      utils.longTermContracts.list.invalidate();
      onDone?.(data);
    } catch (e: any) {
      toast.error(e.message || "Erro ao enviar documento.");
    } finally {
      setUploading(false);
    }
  };

  const handleContratoLocacaoUpload = (contractId: number, file: File) =>
    uploadContractDoc("/api/upload/contrato-locacao", contractId, file, setUploadingLocacao, "Contrato de locação enviado.", (data) =>
      setSavedDocs((prev) => ({ ...prev, contratoLocacaoUrl: data.contratoLocacaoUrl })),
    );

  const handleGarantiaDocUpload = (contractId: number, file: File) =>
    uploadContractDoc("/api/upload/garantia-contrato", contractId, file, setUploadingGarantia, "Documento da garantia enviado.", (data) =>
      setSavedDocs((prev) => ({ ...prev, garantiaDocumentoUrl: data.garantiaDocumentoUrl })),
    );

  const handleApoliceSeguroUpload = (contractId: number, file: File) =>
    uploadContractDoc("/api/upload/apolice-seguro", contractId, file, setUploadingApolice, "Apólice de seguro enviada.", (data) =>
      setSavedDocs((prev) => ({ ...prev, apoliceSeguroUrl: data.apoliceSeguroUrl })),
    );

  const handleRenovacaoContratoUpload = (contractId: number, file: File) =>
    uploadContractDoc("/api/upload/renovacao-contrato", contractId, file, setUploadingRenovacao, "Contrato renovado enviado.", (data) =>
      setSavedDocs((prev) => ({ ...prev, renovacaoContratoUrl: data.renovacaoContratoUrl })),
    );

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Contratos de Longa Duração"
        subtitle="Inquilinos, vigência e recebíveis de aluguel para imóveis de longa duração."
        action={
          <div className="flex gap-2">
            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
              <Button
                size="sm"
                className="active:scale-[0.97] transition-transform"
                disabled={!imoveisSemContrato.length}
                onClick={() => {
                  // Herda o imóvel do filtro do topo, já com administração/imobiliária/comissão
                  // dele — a mesma lógica que o Select do imóvel já aplica ao trocar de opção.
                  if (imovelTravado) {
                    setForm({
                      ...emptyForm,
                      propertyId: String(imovelTravado.id),
                      tipoAdministracao: imovelTravado.tipoAdministracao as ContractForm["tipoAdministracao"],
                      comissaoPct: String(Number(imovelTravado.comissaoPct)),
                      imobiliariaId: imovelTravado.imobiliariaId ? String(imovelTravado.imobiliariaId) : "",
                    });
                  }
                  setOpen(true);
                }}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Novo contrato
              </Button>
              <DialogContent className="sm:max-w-5xl max-h-[92vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="font-serif">
                    {editingId !== null ? "Editar contrato" : "Novo contrato"}
                  </DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-2">
                  <div className="grid gap-1.5">
                    <Label>Imóvel</Label>
                    {editingId !== null || imovelTravado ? (
                      <p className="text-sm px-3 py-2 rounded-md border border-input bg-secondary/30 text-muted-foreground">
                        {nomeImovel(Number(form.propertyId))}{" "}
                        <span className="text-xs">
                          {editingId !== null ? "(não pode ser alterado)" : "(já escolhido no filtro acima)"}
                        </span>
                      </p>
                    ) : (
                      <>
                        <Select
                          value={form.propertyId}
                          onValueChange={(v) => {
                            // A administração e a comissão já foram definidas no cadastro do
                            // imóvel — herda esses valores para não pedir a mesma informação de
                            // novo aqui. Continuam editáveis, porque um contrato específico pode
                            // negociar diferente do padrão do imóvel.
                            const imovel = imoveis?.find((p) => String(p.id) === v);
                            setForm({
                              ...form,
                              propertyId: v,
                              ...(imovel
                                ? {
                                    tipoAdministracao: imovel.tipoAdministracao as ContractForm["tipoAdministracao"],
                                    comissaoPct: String(Number(imovel.comissaoPct)),
                                    imobiliariaId: imovel.imobiliariaId ? String(imovel.imobiliariaId) : "",
                                  }
                                : {}),
                            });
                          }}
                        >
                          <SelectTrigger><SelectValue placeholder="Selecione o imóvel de longa duração" /></SelectTrigger>
                          <SelectContent>
                            {imoveisSemContrato.map((p) => (
                              <SelectItem key={p.id} value={String(p.id)}>{p.apelido}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {!longTermProps.length ? (
                          <p className="text-xs text-amber-600">Nenhum imóvel marcado como "Longa duração". Ajuste o tipo de locação em Imóveis.</p>
                        ) : !imoveisSemContrato.length ? (
                          <p className="text-xs text-amber-600">Todos os imóveis de longa duração já têm contrato cadastrado.</p>
                        ) : null}
                      </>
                    )}
                  </div>

                  <div className={form.tipoAdministracao === "propria" ? "grid gap-1.5" : "grid grid-cols-2 gap-3"}>
                    <div className="grid gap-1.5">
                      <Label>Administração</Label>
                      <Select
                        value={form.tipoAdministracao}
                        onValueChange={(v) => setForm({ ...form, tipoAdministracao: v as ContractForm["tipoAdministracao"], ...(v === "propria" ? { comissaoPct: "0" } : {}) })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(Object.keys(TIPO_ADMIN_LABELS_CONTRATO) as ContractForm["tipoAdministracao"][]).map((k) => (
                            <SelectItem key={k} value={k}>{TIPO_ADMIN_LABELS_CONTRATO[k]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {form.tipoAdministracao !== "propria" && (
                      <div className="grid gap-1.5">
                        <Label>Comissão (%)</Label>
                        <Input value={form.comissaoPct} onChange={(e) => setForm({ ...form, comissaoPct: e.target.value })} type="number" step="0.01" min="0" max="100" />
                      </div>
                    )}
                  </div>
                  {form.tipoAdministracao === "administradora" && (
                    <div className="grid gap-1.5">
                      <Label>Imobiliária responsável</Label>
                      <Select value={form.imobiliariaId} onValueChange={(v) => setForm({ ...form, imobiliariaId: v })}>
                        <SelectTrigger><SelectValue placeholder="Selecione a imobiliária" /></SelectTrigger>
                        <SelectContent>
                          {imobiliarias?.map((i) => (
                            <SelectItem key={i.id} value={String(i.id)}>{i.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="rounded-lg border border-border bg-secondary/50 p-3 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <User className="h-4 w-4 text-primary" /> Inquilino
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="grid gap-1.5">
                        <Label className="text-xs">Nome</Label>
                        <Input value={form.nomeInquilino} onChange={(e) => setForm({ ...form, nomeInquilino: e.target.value })} />
                      </div>
                      <div className="grid gap-1.5">
                        <Label className="text-xs">CPF/CNPJ</Label>
                        <Input value={form.cpfCnpjInquilino} onChange={(e) => setForm({ ...form, cpfCnpjInquilino: e.target.value })} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="grid gap-1.5">
                        <Label className="text-xs">Telefone</Label>
                        <Input value={form.telefoneInquilino} onChange={(e) => setForm({ ...form, telefoneInquilino: e.target.value })} />
                      </div>
                      <div className="grid gap-1.5">
                        <Label className="text-xs">WhatsApp</Label>
                        <Input value={form.whatsappInquilino} onChange={(e) => setForm({ ...form, whatsappInquilino: e.target.value })} />
                      </div>
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs">E-mail</Label>
                      <Input value={form.emailInquilino} onChange={(e) => setForm({ ...form, emailInquilino: e.target.value })} type="email" />
                    </div>
                  </div>

                  <div className={editingId === null ? "grid grid-cols-5 gap-2" : "grid grid-cols-4 gap-2"}>
                    <div className="grid gap-1.5">
                      <Label className="text-xs">Início do contrato</Label>
                      <DateInput value={form.dataInicio} onChange={(v) => setForm({ ...form, dataInicio: v })} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs">Prazo (meses)</Label>
                      <Input value={form.prazoMeses} onChange={(e) => setForm({ ...form, prazoMeses: e.target.value })} type="number" min="1" />
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs">Fim do contrato</Label>
                      <Input value={form.dataInicio ? formatDate(dataFimCalculada) : ""} disabled placeholder="Calculado" />
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs">Dia de vencimento</Label>
                      <Input value={form.diaVencimentoAluguel} onChange={(e) => setForm({ ...form, diaVencimentoAluguel: e.target.value })} type="number" min="1" max="31" />
                    </div>
                    {editingId === null && (
                      <div className="grid gap-1.5">
                        <Label className="text-xs">Valor do aluguel (R$)</Label>
                        <Input value={form.valorAluguel} onChange={(e) => setForm({ ...form, valorAluguel: e.target.value })} type="number" step="0.01" />
                      </div>
                    )}
                  </div>
                  {editingId !== null && (
                    <p className="text-xs text-muted-foreground -mt-2">
                      Para alterar o valor do aluguel, gerencie as parcelas em "Aluguéis a Receber".
                    </p>
                  )}
                  {numReajustes > 0 && (
                    <div className="grid grid-cols-2 gap-3">
                      {datasReajusteCalculadas.map((data, i) => (
                        <div key={data} className="grid grid-cols-2 gap-2 items-end">
                          <div className="grid gap-1.5">
                            <Label className="text-xs">{numReajustes > 1 ? `${i + 1}º reajuste` : "Reajuste"}</Label>
                            <Input value={formatDate(data)} disabled />
                          </div>
                          <div className="grid gap-1.5">
                            <Label className="text-xs text-muted-foreground">Valor</Label>
                            <Input value={form.valorAluguel ? brl(Number(form.valorAluguel)) : ""} disabled placeholder="—" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="grid gap-1.5">
                    <div className="flex items-center justify-between">
                      <Label>Carência</Label>
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 rounded border-input"
                          checked={semCarencia}
                          onChange={(e) => {
                            setSemCarencia(e.target.checked);
                            if (e.target.checked) setForm((f) => ({ ...f, carenciaInicio: "", carenciaFim: "" }));
                          }}
                        />
                        Sem carência
                      </label>
                    </div>
                  </div>
                  <div className={!semCarencia ? "grid grid-cols-4 gap-3" : "grid grid-cols-2 gap-3"}>
                    {!semCarencia && (
                      <>
                        <div className="grid gap-1.5">
                          <Label className="text-xs">Início</Label>
                          <DateInput value={form.carenciaInicio} onChange={(v) => setForm({ ...form, carenciaInicio: v })} />
                        </div>
                        <div className="grid gap-1.5">
                          <Label className="text-xs">Fim</Label>
                          <DateInput value={form.carenciaFim} onChange={(v) => setForm({ ...form, carenciaFim: v })} />
                        </div>
                      </>
                    )}
                    <div className="grid gap-1.5">
                      <Label>Índice de correção</Label>
                      <Select value={form.indiceCorrecao} onValueChange={(v) => setForm({ ...form, indiceCorrecao: v })}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="IGPM">IGP-M</SelectItem>
                          <SelectItem value="IPCA">IPCA</SelectItem>
                          <SelectItem value="INPC">INPC</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <Label>Tipo de garantia</Label>
                      <Select value={form.tipoGarantia} onValueChange={(v) => setForm({ ...form, tipoGarantia: v })}>
                        <SelectTrigger className="w-full"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                        <SelectContent>
                          {(garantias ?? []).filter((g) => g.ativa === 1).map((g) => (
                            <SelectItem key={g.id} value={g.nome}>{g.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="rounded-md border p-3">
                    <p className="text-sm font-medium">Condomínio e IPTU</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Quando o inquilino responde pelo custo, ele não entra na DRE do proprietário. Os valores são
                      cadastrados no imóvel, na aba Custos.
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="grid gap-1.5">
                        <Label>Condomínio por</Label>
                        <Select value={form.condominioPor} onValueChange={(v) => setForm({ ...form, condominioPor: v as CostResponsibility })}>
                          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.entries(RESPONSAVEL_CUSTO_LABELS).map(([v, label]) => (
                              <SelectItem key={v} value={v}>{label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-1.5">
                        <Label>IPTU por</Label>
                        <Select value={form.iptuPor} onValueChange={(v) => setForm({ ...form, iptuPor: v as CostResponsibility })}>
                          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.entries(RESPONSAVEL_CUSTO_LABELS).map(([v, label]) => (
                              <SelectItem key={v} value={v}>{label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-1.5">
                    <Label>Cadastrar Renovação</Label>
                    <div className="grid grid-cols-2 gap-3">
                      {(Object.keys(RENOVACAO_LABELS) as Exclude<ContractForm["renovacaoAutomatica"], "">[]).map((k) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setForm({ ...form, renovacaoAutomatica: form.renovacaoAutomatica === k ? "" : k })}
                          className={`rounded-md border px-3 py-2 text-sm text-left transition-colors ${
                            form.renovacaoAutomatica === k
                              ? "border-primary bg-primary/10 text-primary font-medium"
                              : "border-input bg-background hover:bg-secondary/50 text-muted-foreground"
                          }`}
                        >
                          {RENOVACAO_LABELS[k]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {form.renovacaoAutomatica === "novo_contrato" && (
                    <div className="rounded-lg border border-border bg-secondary/50 p-3 space-y-3">
                      <p className="text-xs font-medium text-muted-foreground">Novo contrato</p>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="grid gap-1.5">
                          <Label className="text-xs">Início</Label>
                          <DateInput
                            value={form.renovacaoNovoContratoDataInicio}
                            onChange={(v) => setForm({ ...form, renovacaoNovoContratoDataInicio: v })}
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <Label className="text-xs">Prazo (meses)</Label>
                          <Input
                            value={form.renovacaoNovoContratoPrazoMeses}
                            onChange={(e) => setForm({ ...form, renovacaoNovoContratoPrazoMeses: e.target.value })}
                            type="number"
                            min="1"
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <Label className="text-xs">Valor do aluguel (R$)</Label>
                          <Input
                            value={form.renovacaoNovoContratoValor}
                            onChange={(e) => setForm({ ...form, renovacaoNovoContratoValor: e.target.value })}
                            type="number"
                            step="0.01"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-1.5">
                          <Label className="text-xs">Fim</Label>
                          <Input value={renovacaoNovoContratoDataFimCalculada ? formatDate(renovacaoNovoContratoDataFimCalculada) : ""} disabled placeholder="Calculado" />
                        </div>
                        <div className="grid gap-1.5">
                          <Label className="text-xs">Reajuste</Label>
                          <Input value={renovacaoNovoContratoDataReajusteCalculada ? formatDate(renovacaoNovoContratoDataReajusteCalculada) : ""} disabled placeholder="Calculado" />
                        </div>
                      </div>
                      {editingId === null && (
                        <p className="text-xs text-muted-foreground">Salve o contrato para habilitar o anexo.</p>
                      )}
                      <DocumentoUploadRow
                        label="Contrato renovado"
                        url={savedDocs.renovacaoContratoUrl}
                        uploading={uploadingRenovacao}
                        accept="application/pdf,image/jpeg,image/png,image/webp"
                        disabled={editingId === null}
                        onUpload={(file) => editingId !== null && handleRenovacaoContratoUpload(editingId, file)}
                      />
                    </div>
                  )}

                  {form.renovacaoAutomatica === "prazo_indeterminado" && (
                    <div className="rounded-lg border border-border bg-secondary/50 p-3 space-y-3">
                      <p className="text-xs font-medium text-muted-foreground">Prazo indeterminado</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-1.5">
                          <Label className="text-xs">Data de início</Label>
                          <DateInput
                            value={form.prazoIndeterminadoDataInicio}
                            onChange={(v) => setForm({ ...form, prazoIndeterminadoDataInicio: v })}
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <Label className="text-xs">Valor do aluguel (R$)</Label>
                          <Input
                            value={form.prazoIndeterminadoValor}
                            onChange={(e) => setForm({ ...form, prazoIndeterminadoValor: e.target.value })}
                            type="number"
                            step="0.01"
                          />
                        </div>
                      </div>
                      <div className="grid gap-1.5">
                        <Label className="text-xs">Prazo de reajuste (meses)</Label>
                        <Input
                          value={form.prazoIndeterminadoPrazoReajusteMeses}
                          onChange={(e) => setForm({ ...form, prazoIndeterminadoPrazoReajusteMeses: e.target.value })}
                          type="number"
                          min="1"
                        />
                      </div>
                    </div>
                  )}

                  <div className="rounded-lg border border-border bg-secondary/50 p-3 space-y-3">
                    <p className="text-xs font-medium text-muted-foreground">Documentos do contrato</p>
                    {editingId === null && (
                      <p className="text-xs text-muted-foreground">Salve o contrato para habilitar os anexos.</p>
                    )}
                    <DocumentoUploadRow
                      label="Contrato - 1ª Locação"
                      url={savedDocs.contratoLocacaoUrl}
                      uploading={uploadingLocacao}
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      allowReplace={false}
                      disabled={editingId === null}
                      onUpload={(file) => editingId !== null && handleContratoLocacaoUpload(editingId, file)}
                    />
                    <DocumentoUploadRow
                      label="Documentos da fiança"
                      url={savedDocs.garantiaDocumentoUrl}
                      uploading={uploadingGarantia}
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      disabled={editingId === null}
                      onUpload={(file) => editingId !== null && handleGarantiaDocUpload(editingId, file)}
                    />
                    <DocumentoUploadRow
                      label="Apólice de seguro"
                      url={savedDocs.apoliceSeguroUrl}
                      uploading={uploadingApolice}
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      disabled={editingId === null}
                      onUpload={(file) => editingId !== null && handleApoliceSeguroUpload(editingId, file)}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" className="bg-background" onClick={() => setOpen(false)}>
                    {editingId !== null ? "Concluir" : "Cancelar"}
                  </Button>
                  <Button onClick={submit} disabled={create.isPending || update.isPending}>
                    {editingId !== null ? "Salvar alterações" : "Salvar"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <div className="mb-6 flex items-center gap-3">
        <Select value={propertyId || "all"} onValueChange={(v) => setPropertyId(v === "all" ? "" : v)}>
          <SelectTrigger className="w-[240px] bg-card">
            <SelectValue placeholder="Todos os imóveis" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os imóveis</SelectItem>
            {longTermProps.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>{p.apelido}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <SkeletonList />
      ) : !contratos?.length ? (
        <EmptyState title="Nenhum contrato cadastrado" subtitle="Cadastre o primeiro contrato de longa duração." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 items-start">
          <Card className="overflow-hidden py-0">
            <div className="divide-y divide-border">
              {contratos.map((c) => (
                <div
                  key={c.id}
                  className={`group flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${selectedContractId === c.id ? "bg-primary/5" : "hover:bg-secondary/40"}`}
                  onClick={() => setSelectedContractId(c.id)}
                >
                  <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <FileText className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{nomeImovel(c.propertyId)}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {c.nomeInquilino || "Inquilino não informado"} · {formatDate(c.dataInicio)}–{formatDate(c.dataFim)} · {c.indiceCorrecao}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity shrink-0"
                    onClick={(e) => { e.stopPropagation(); del.mutate({ id: c.id }); }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </Card>

          <div>
            {!selectedContract ? (
              <EmptyState title="Selecione um contrato" subtitle="Veja o cronograma de recebíveis do contrato selecionado." />
            ) : (
              <Card className="overflow-hidden py-0">
                <div className="px-4 py-3 border-b border-border">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{selectedContract.nomeInquilino || "Inquilino"}</p>
                      <p className="text-xs text-muted-foreground">
                        Vencimento todo dia {selectedContract.diaVencimentoAluguel} · {nomeImovel(selectedContract.propertyId)}
                        {selectedContract.tipoGarantia ? ` · Garantia: ${selectedContract.tipoGarantia}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {TIPO_ADMIN_LABELS_CONTRATO[selectedContract.tipoAdministracao as ContractForm["tipoAdministracao"]]}
                        {Number(selectedContract.comissaoPct) > 0 ? ` · Comissão ${Number(selectedContract.comissaoPct)}%` : ""}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-primary shrink-0"
                      onClick={() => openEdit(selectedContract)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="mt-3 space-y-2">
                    <DocumentoUploadRow
                      label="Contrato - 1ª Locação"
                      url={selectedContract.contratoLocacaoUrl}
                      uploading={uploadingLocacao}
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      allowReplace={false}
                      onUpload={(file) => handleContratoLocacaoUpload(selectedContract.id, file)}
                    />
                    <DocumentoUploadRow
                      label="Documentos da fiança"
                      url={selectedContract.garantiaDocumentoUrl}
                      uploading={uploadingGarantia}
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      onUpload={(file) => handleGarantiaDocUpload(selectedContract.id, file)}
                    />
                    <DocumentoUploadRow
                      label="Apólice de seguro"
                      url={selectedContract.apoliceSeguroUrl}
                      uploading={uploadingApolice}
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      onUpload={(file) => handleApoliceSeguroUpload(selectedContract.id, file)}
                    />
                    {selectedContract.renovacaoAutomatica === "novo_contrato" && (
                      <DocumentoUploadRow
                        label="Contrato renovado"
                        url={selectedContract.renovacaoContratoUrl}
                        uploading={uploadingRenovacao}
                        accept="application/pdf,image/jpeg,image/png,image/webp"
                        onUpload={(file) => handleRenovacaoContratoUpload(selectedContract.id, file)}
                      />
                    )}
                  </div>
                  {selectedContract.renovacaoAutomatica === "prazo_indeterminado" && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Renovação: prazo indeterminado
                      {selectedContract.prazoIndeterminadoDataInicio ? ` desde ${formatDate(selectedContract.prazoIndeterminadoDataInicio)}` : ""}
                      {selectedContract.prazoIndeterminadoValor ? ` · ${brl(selectedContract.prazoIndeterminadoValor)}` : ""}
                      {selectedContract.prazoIndeterminadoPrazoReajusteMeses ? ` · reajuste a cada ${selectedContract.prazoIndeterminadoPrazoReajusteMeses} meses` : ""}
                    </p>
                  )}
                  {selectedContract.renovacaoAutomatica === "novo_contrato" && selectedContract.renovacaoNovoContratoDataInicio && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Renovação: novo contrato {formatDate(selectedContract.renovacaoNovoContratoDataInicio)}–
                      {selectedContract.renovacaoNovoContratoDataFim ? formatDate(selectedContract.renovacaoNovoContratoDataFim) : "—"}
                      {selectedContract.renovacaoNovoContratoValor ? ` · ${brl(selectedContract.renovacaoNovoContratoValor)}` : ""}
                      {selectedContract.renovacaoNovoContratoDataReajuste ? ` · reajuste em ${formatDate(selectedContract.renovacaoNovoContratoDataReajuste)}` : ""}
                    </p>
                  )}
                </div>
                <div className="divide-y divide-border max-h-[480px] overflow-y-auto">
                  {!charges?.length ? (
                    <div className="p-4 text-sm text-muted-foreground">Nenhuma parcela gerada.</div>
                  ) : (
                    charges.map((ch) => {
                      const multa = Number(ch.multaJuros ?? 0);
                      const desconto = Number(ch.desconto ?? 0);
                      return (
                        <div key={ch.id} className="group flex items-center justify-between px-4 py-2 hover:bg-secondary/40 transition-colors">
                          <div className="flex items-center gap-2.5">
                            {ch.status === "recebido" ? (
                              <CheckCircle2 className="h-4 w-4 text-primary" />
                            ) : (
                              <Circle className="h-4 w-4 text-muted-foreground" />
                            )}
                            <div>
                              <p className="text-sm font-medium">{ch.competencia}</p>
                              <p className="text-xs text-muted-foreground">
                                Vence {formatDate(ch.dataVencimento)}
                                {ch.dataRecebimento ? ` · Recebido ${formatDate(ch.dataRecebimento)}` : ""}
                              </p>
                              {ch.status === "recebido" && (multa > 0 || desconto > 0) && (
                                <p className="text-[11px]">
                                  {multa > 0 && <span className="text-primary">+{brl(multa)} multa/juros</span>}
                                  {multa > 0 && desconto > 0 && " · "}
                                  {desconto > 0 && <span className="text-destructive">-{brl(desconto)} desconto</span>}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="tabular-nums text-sm font-medium">{brl(ch.status === "recebido" ? (ch.valorRecebido ?? ch.valor) : ch.valor)}</span>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity" onClick={() => deleteCharge.mutate({ id: ch.id })}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
