import { trpc, type RouterOutputs } from "@/lib/trpc";
import { useEmpresaUserType } from "@/hooks/useEmpresa";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Building2, Pencil, FileText, Upload, User, CheckCircle2, Circle, MoreHorizontal, ExternalLink, Receipt } from "lucide-react";
import { PageHeader, EmptyState, SkeletonList } from "./Clientes";
import { brl, formatDate } from "@/lib/format";
import PropertyCostsDialog from "@/components/PropertyCostsDialog";

interface PropertyForm {
  clientId: string;
  apelido: string;
  endereco: string;
  comissao: string;
  custoFaxina: string;
  tipoLocacao: "curta" | "longa";
  tipoAdministracao: "propria" | "administradora" | "gestor_curta_temporada";
  imobiliariaId: string;
  gestorId: string;
  financiado: "sim" | "nao";
  tipoFinanciamento: "financiamento" | "consorcio";
  valorParcela: string;
  socioId: string;
  socio2Id: string;
  socio3Id: string;
}

const emptyForm: PropertyForm = {
  clientId: "", apelido: "", endereco: "", comissao: "20", custoFaxina: "150", tipoLocacao: "curta",
  tipoAdministracao: "propria", imobiliariaId: "", gestorId: "", financiado: "nao", tipoFinanciamento: "financiamento", valorParcela: "",
  socioId: "", socio2Id: "", socio3Id: "",
};

const TIPO_ADMIN_LABELS: Record<PropertyForm["tipoAdministracao"], string> = {
  propria: "Direta (proprietário)",
  administradora: "Administradora",
  gestor_curta_temporada: "Gestor de temporada terceirizado",
};

export default function Imoveis() {
  const utils = trpc.useUtils();
  const { data: imoveis, isLoading } = trpc.properties.list.useQuery();
  // O perfil é da EMPRESA aberta, não de quem está logado — um contador operando um cliente
  // holding não é holding ele mesmo, e usar o perfil dele aqui reativava um bug já corrigido em
  // outras telas (painel, menu, cabeçalho).
  const isHolding = useEmpresaUserType() === "holding";
  const { data: clientes } = trpc.clients.list.useQuery(undefined, { enabled: !isHolding });
  const { data: imobiliarias } = trpc.imobiliarias.list.useQuery();
  const { data: gestores } = trpc.curtaManagers.list.useQuery();
  const { data: socios } = trpc.socios.list.useQuery();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<PropertyForm>(emptyForm);
  const [uploading, setUploading] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => { setForm(emptyForm); setEditId(null); };

  const create = trpc.properties.create.useMutation({
    onSuccess: () => { utils.properties.list.invalidate(); setOpen(false); reset(); toast.success("Imóvel cadastrado."); },
    onError: (e) => toast.error(e.message),
  });

  const update = trpc.properties.update.useMutation({
    onSuccess: () => { utils.properties.list.invalidate(); setOpen(false); reset(); toast.success("Imóvel atualizado."); },
    onError: (e) => toast.error(e.message),
  });

  const del = trpc.properties.delete.useMutation({
    onSuccess: () => { utils.properties.list.invalidate(); toast.success("Imóvel removido."); },
    onError: (e) => toast.error(e.message),
  });

  const openEdit = (p: NonNullable<typeof imoveis>[number]) => {
    setEditId(p.id);
    setForm({
      clientId: String(p.clientId ?? ""),
      apelido: p.apelido,
      endereco: p.endereco || "",
      comissao: String(Number(p.comissaoPct)),
      custoFaxina: String(Number(p.custoFaxina)),
      tipoLocacao: (p.tipoLocacao as "curta" | "longa") || "curta",
      tipoAdministracao: (p.tipoAdministracao as PropertyForm["tipoAdministracao"]) || "propria",
      imobiliariaId: String(p.imobiliariaId ?? ""),
      gestorId: String(p.gestorId ?? ""),
      financiado: (p.financiado as "sim" | "nao") || "nao",
      tipoFinanciamento: (p.tipoFinanciamento as PropertyForm["tipoFinanciamento"]) || "financiamento",
      valorParcela: p.valorParcela ? String(Number(p.valorParcela)) : "",
      socioId: p.socioId ? String(p.socioId) : "",
      socio2Id: p.socio2Id ? String(p.socio2Id) : "",
      socio3Id: p.socio3Id ? String(p.socio3Id) : "",
    });
    setOpen(true);
  };

  const submit = () => {
    if (!isHolding && !form.clientId) { toast.error("Selecione o proprietário."); return; }
    if (!form.apelido) { toast.error("Informe o apelido do imóvel."); return; }
    const payload = {
      apelido: form.apelido,
      endereco: form.endereco || undefined,
      // Comissão e custo de faxina não fazem sentido para longa duração: quem administra e a
      // comissão são definidas por contrato (podem mudar a cada inquilino), e faxina é conceito de
      // temporada. Ficam zerados e nem aparecem no formulário nesse caso.
      comissaoPct: form.tipoLocacao === "longa" ? 0 : Number(form.comissao) || 0,
      custoFaxina: form.tipoLocacao === "longa" ? 0 : Number(form.custoFaxina) || 0,
      tipoLocacao: form.tipoLocacao,
      // Para longa, administração/imobiliária/gestor não aparecem mais no formulário — força
      // valores neutros (em vez de "undefined", que o update deixaria como estava) para não deixar
      // um valor antigo de quando o imóvel foi curta ou administradora esquecido no banco.
      tipoAdministracao: form.tipoLocacao === "longa" ? "propria" : form.tipoAdministracao,
      imobiliariaId: form.tipoLocacao === "curta" && form.tipoAdministracao === "administradora" && form.imobiliariaId ? Number(form.imobiliariaId) : null,
      gestorId: form.tipoLocacao === "curta" && form.tipoAdministracao === "gestor_curta_temporada" && form.gestorId ? Number(form.gestorId) : null,
      financiado: form.financiado,
      tipoFinanciamento: form.financiado === "sim" ? form.tipoFinanciamento : undefined,
      valorParcela: form.financiado === "sim" && form.valorParcela ? Number(form.valorParcela) : undefined,
      socioId: form.tipoLocacao === "longa" && form.socioId ? Number(form.socioId) : undefined,
      socio2Id: form.tipoLocacao === "longa" && form.socio2Id ? Number(form.socio2Id) : undefined,
      socio3Id: form.tipoLocacao === "longa" && form.socio3Id ? Number(form.socio3Id) : undefined,
    };
    if (editId) {
      update.mutate({
        id: editId,
        ...(isHolding ? {} : { clientId: Number(form.clientId) }),
        ...payload,
      });
    } else {
      create.mutate({
        ...(isHolding ? {} : { clientId: Number(form.clientId) }),
        ...payload,
      });
    }
  };

  const handleContractUpload = async (propertyId: number, file: File) => {
    if (file.type !== "application/pdf") {
      toast.error("Apenas arquivos PDF são aceitos.");
      return;
    }
    setUploading(propertyId);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("propertyId", String(propertyId));
      const resp = await fetch("/api/upload/contrato", { method: "POST", body: formData });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Erro ao enviar." }));
        throw new Error(err.error);
      }
      toast.success("Contrato enviado com sucesso.");
      utils.properties.list.invalidate();
    } catch (e: any) {
      toast.error(e.message || "Erro ao enviar contrato.");
    } finally {
      setUploading(null);
    }
  };

  const nomeCliente = (id: number | null) => id ? clientes?.find((c) => c.id === id)?.nome ?? "—" : "Imóvel próprio";

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Imóveis"
        subtitle={isHolding ? "Imóveis próprios da holding." : "Unidades gerenciadas, vinculadas a um proprietário."}
        action={
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
            <DialogTrigger asChild>
              <Button size="sm" className="active:scale-[0.97] transition-transform" disabled={!isHolding && !clientes?.length}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Novo imóvel
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle className="font-serif">{editId ? "Editar imóvel" : "Novo imóvel"}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                {!isHolding && (
                  <div className="grid gap-1.5">
                    <Label>Proprietário</Label>
                    <Select value={form.clientId} onValueChange={(v) => setForm({ ...form, clientId: v })}>
                      <SelectTrigger><SelectValue placeholder="Selecione o cliente" /></SelectTrigger>
                      <SelectContent>
                        {clientes?.map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="grid gap-1.5">
                  <Label>Apelido da unidade</Label>
                  <Input value={form.apelido} onChange={(e) => setForm({ ...form, apelido: e.target.value })} placeholder="ex.: Studio Beira-Mar" />
                </div>
                <div className="grid gap-1.5">
                  <Label>Tipo de locação</Label>
                  <Select value={form.tipoLocacao} onValueChange={(v) => setForm({ ...form, tipoLocacao: v as "curta" | "longa" })}>
                    <SelectTrigger><SelectValue placeholder="Selecione o tipo" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="curta">Curta duração (temporada)</SelectItem>
                      <SelectItem value="longa">Longa duração</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Administração, imobiliária, comissão e custo de faxina só aparecem para curta
                    temporada: não há contrato para reservas, então esses valores são usados
                    direto daqui. Para longa duração, quem administra, a imobiliária e a comissão
                    são definidos no cadastro do CONTRATO — podem mudar a cada inquilino, então não
                    fazem sentido como um dado fixo do imóvel, e pedir aqui também seria a mesma
                    informação duas vezes. */}
                {form.tipoLocacao === "curta" && (
                  <>
                    <div className="grid gap-1.5">
                      <Label>Administração do imóvel</Label>
                      <Select value={form.tipoAdministracao} onValueChange={(v) => setForm({ ...form, tipoAdministracao: v as PropertyForm["tipoAdministracao"] })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(Object.keys(TIPO_ADMIN_LABELS) as PropertyForm["tipoAdministracao"][]).map((k) => (
                            <SelectItem key={k} value={k}>{TIPO_ADMIN_LABELS[k]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
                    {form.tipoAdministracao === "gestor_curta_temporada" && (
                      <div className="grid gap-1.5">
                        <Label>Gestor de temporada</Label>
                        <Select value={form.gestorId} onValueChange={(v) => setForm({ ...form, gestorId: v })}>
                          <SelectTrigger><SelectValue placeholder="Selecione o gestor" /></SelectTrigger>
                          <SelectContent>
                            {gestores?.map((g) => (
                              <SelectItem key={g.id} value={String(g.id)}>{g.nome}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="grid gap-1.5">
                        <Label>Comissão (%)</Label>
                        <Input value={form.comissao} onChange={(e) => setForm({ ...form, comissao: e.target.value })} type="number" step="0.01" />
                      </div>
                      <div className="grid gap-1.5">
                        <Label>Custo por faxina (R$)</Label>
                        <Input value={form.custoFaxina} onChange={(e) => setForm({ ...form, custoFaxina: e.target.value })} type="number" step="0.01" placeholder="ex.: 150.00" />
                      </div>
                    </div>
                  </>
                )}

                {form.tipoLocacao === "longa" && (
                  <div className="grid gap-1.5">
                    <Label>Sócios</Label>
                    <p className="text-xs text-muted-foreground -mt-1">Até 3, para imóvel de mais de um sócio (ex.: imóvel de família).</p>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {(["socioId", "socio2Id", "socio3Id"] as const).map((campo, idx) => {
                        const escolhidosNosOutros = (["socioId", "socio2Id", "socio3Id"] as const)
                          .filter((c) => c !== campo)
                          .map((c) => form[c])
                          .filter(Boolean);
                        return (
                          <Select
                            key={campo}
                            value={form[campo]}
                            onValueChange={(v) => setForm({ ...form, [campo]: v === "nenhum" ? "" : v })}
                          >
                            <SelectTrigger className="w-full"><SelectValue placeholder={`Sócio ${idx + 1}`} /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="nenhum">Nenhum</SelectItem>
                              {socios?.filter((s) => !escolhidosNosOutros.includes(String(s.id))).map((s) => (
                                <SelectItem key={s.id} value={String(s.id)}>{s.nome}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="grid gap-1.5">
                  <Label>Endereço</Label>
                  <Input value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })} />
                </div>

                <div className="grid gap-1.5">
                  <Label>Imóvel financiado ou consorciado?</Label>
                  <Select value={form.financiado} onValueChange={(v) => setForm({ ...form, financiado: v as "sim" | "nao" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nao">Não</SelectItem>
                      <SelectItem value="sim">Sim</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.financiado === "sim" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <Label>Tipo</Label>
                      <Select value={form.tipoFinanciamento} onValueChange={(v) => setForm({ ...form, tipoFinanciamento: v as PropertyForm["tipoFinanciamento"] })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="financiamento">Financiamento</SelectItem>
                          <SelectItem value="consorcio">Consórcio</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <Label>Valor da parcela (R$)</Label>
                      <Input value={form.valorParcela} onChange={(e) => setForm({ ...form, valorParcela: e.target.value })} type="number" step="0.01" />
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" className="bg-background" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button onClick={submit} disabled={create.isPending || update.isPending}>{editId ? "Salvar alterações" : "Salvar"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {/* Hidden file input for contract upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const propId = fileInputRef.current?.dataset.propertyId;
          if (file && propId) handleContractUpload(Number(propId), file);
          e.target.value = "";
        }}
      />

      {!isHolding && !clientes?.length && !isLoading && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Cadastre um cliente antes de adicionar imóveis.
        </div>
      )}

      {isLoading ? (
        <SkeletonList />
      ) : !imoveis?.length ? (
        <EmptyState title="Nenhum imóvel cadastrado" subtitle="Vincule a primeira unidade a um proprietário." />
      ) : (
        <Card className="overflow-hidden py-0">
          <div className="divide-y divide-border">
            {imoveis.map((p) => (
              <ImovelRow
                key={p.id}
                p={p}
                nomeCliente={nomeCliente}
                uploading={uploading === p.id}
                onEdit={() => openEdit(p)}
                onDelete={() => del.mutate({ id: p.id })}
                onUpload={() => {
                  if (fileInputRef.current) {
                    fileInputRef.current.dataset.propertyId = String(p.id);
                    fileInputRef.current.click();
                  }
                }}
              />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

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

/** Competências (AAAA-MM) em que o aluguel deve ser reajustado: a cada 12 meses a partir do início do contrato. */
function computeReajusteMonths(dataInicio: string, dataFim: string): Set<string> {
  const meses = new Set<string>();
  let i = 12;
  while (true) {
    const data = addMonthsToDate(dataInicio, i);
    if (data.slice(0, 7) >= dataFim.slice(0, 7)) break;
    meses.add(data.slice(0, 7));
    i += 12;
  }
  return meses;
}

interface ImovelRowProps {
  p: RouterOutputs["properties"]["list"][number];
  nomeCliente: (id: number | null) => string;
  uploading: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onUpload: () => void;
}

/** Linha compacta de um imóvel, com todas as ações agrupadas em um único menu. */
function ImovelRow({ p, nomeCliente, uploading, onEdit, onDelete, onUpload }: ImovelRowProps) {
  const [dadosOpen, setDadosOpen] = useState(false);
  const [fichaOpen, setFichaOpen] = useState(false);
  const [custosOpen, setCustosOpen] = useState(false);
  const isLonga = p.tipoLocacao === "longa";

  const { data: contratos } = trpc.longTermContracts.list.useQuery({ propertyId: p.id }, { enabled: isLonga });
  const contrato = contratos?.[0];

  const { data: charges } = trpc.longTermContracts.charges.useQuery(
    { contractId: contrato?.id },
    { enabled: !!contrato && fichaOpen },
  );

  const todasParcelas = charges ?? [];
  const mesesReajuste = contrato ? computeReajusteMonths(contrato.dataInicio, contrato.dataFim) : new Set<string>();

  return (
    <>
      <div className="group flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/40 transition-colors">
        <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          <Building2 className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{p.apelido}</p>
          <p className="text-xs text-muted-foreground truncate">
            {nomeCliente(p.clientId)}
            {p.endereco ? ` · ${p.endereco}` : ""}
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-1.5 shrink-0">
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-5 ${isLonga ? "border-blue-300 text-blue-700" : "border-amber-300 text-amber-700"}`}>
            {isLonga ? "Longa" : "Curta"}
          </Badge>
          <Badge className="text-[10px] px-1.5 py-0 h-5 bg-primary/10 text-primary">{Number(p.comissaoPct)}%</Badge>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100 transition-opacity shrink-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="mr-2 h-3.5 w-3.5" /> Editar
            </DropdownMenuItem>
            {/* Para longa duração o contrato de locação passa a ser anexado na aba Contratos, não
                mais aqui — evita a mesma informação em dois lugares para anexos NOVOS. Mas "Ver
                contrato" continua disponível se já houver algo anexado no imóvel: são documentos
                reais, e boa parte dos imóveis de longa ainda não tem contrato cadastrado (logo,
                nenhum lugar para onde levar o arquivo) — escondê-lo teria travado o acesso a
                contratos de locação já assinados e guardados aqui. */}
            {!isLonga && (
              <DropdownMenuItem disabled={uploading} onClick={onUpload}>
                <Upload className="mr-2 h-3.5 w-3.5" /> {uploading ? "Enviando..." : p.contratoUrl ? "Substituir contrato" : "Anexar contrato"}
              </DropdownMenuItem>
            )}
            {p.contratoUrl && (
              <DropdownMenuItem onClick={() => window.open(p.contratoUrl!, "_blank", "noopener,noreferrer")}>
                <ExternalLink className="mr-2 h-3.5 w-3.5" /> Ver contrato{isLonga ? " (anexo antigo)" : ""}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => setCustosOpen(true)}>
              <Receipt className="mr-2 h-3.5 w-3.5" /> Condomínio e IPTU
            </DropdownMenuItem>
            {isLonga && contrato && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px] font-normal text-muted-foreground">Contrato de locação</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setDadosOpen(true)}>
                  <FileText className="mr-2 h-3.5 w-3.5" /> Dados do contrato
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setFichaOpen(true)}>
                  <User className="mr-2 h-3.5 w-3.5" /> Ficha financeira
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <PropertyCostsDialog propertyId={p.id} apelido={p.apelido} open={custosOpen} onOpenChange={setCustosOpen} />

      <Dialog open={dadosOpen} onOpenChange={setDadosOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif">Dados do contrato</DialogTitle>
          </DialogHeader>
          {contrato && (
            <div className="grid gap-3 py-2 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Início</p>
                  <p className="font-medium">{formatDate(contrato.dataInicio)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Fim</p>
                  <p className="font-medium">{formatDate(contrato.dataFim)}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Prazo</p>
                  <p className="font-medium">{contrato.prazoMeses} meses</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Índice de correção</p>
                  <p className="font-medium">{contrato.indiceCorrecao}</p>
                </div>
              </div>
              {(contrato.dataReajuste || contrato.tipoGarantia) && (
                <div className="grid grid-cols-2 gap-3">
                  {contrato.dataReajuste && (
                    <div>
                      <p className="text-xs text-muted-foreground">Próximo reajuste</p>
                      <p className="font-medium">{formatDate(contrato.dataReajuste)}</p>
                    </div>
                  )}
                  {contrato.tipoGarantia && (
                    <div>
                      <p className="text-xs text-muted-foreground">Tipo de garantia</p>
                      <p className="font-medium">{contrato.tipoGarantia}</p>
                    </div>
                  )}
                </div>
              )}
              {(contrato.carenciaInicio || contrato.carenciaFim) && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Carência (início)</p>
                    <p className="font-medium">{contrato.carenciaInicio ? formatDate(contrato.carenciaInicio) : "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Carência (fim)</p>
                    <p className="font-medium">{contrato.carenciaFim ? formatDate(contrato.carenciaFim) : "—"}</p>
                  </div>
                </div>
              )}
              <div className="border-t border-border pt-3 mt-1">
                <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Inquilino</p>
                <p className="font-medium">{contrato.nomeInquilino || "—"}</p>
                {contrato.cpfCnpjInquilino && <p className="text-xs text-muted-foreground">{contrato.cpfCnpjInquilino}</p>}
                <div className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
                  {contrato.telefoneInquilino && <span>Tel: {contrato.telefoneInquilino}</span>}
                  {contrato.whatsappInquilino && <span>WhatsApp: {contrato.whatsappInquilino}</span>}
                  {contrato.emailInquilino && <span>{contrato.emailInquilino}</span>}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={fichaOpen} onOpenChange={setFichaOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif">Ficha financeira — todas as parcelas</DialogTitle>
          </DialogHeader>
          {mesesReajuste.size > 0 && (
            <p className="text-xs text-muted-foreground -mt-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-destructive align-middle mr-1.5" />
              Em vermelho: meses de reajuste do aluguel
            </p>
          )}
          <div className="divide-y divide-border max-h-[420px] overflow-y-auto">
            {!todasParcelas.length ? (
              <p className="text-sm text-muted-foreground py-4">Nenhuma parcela encontrada.</p>
            ) : (
              todasParcelas.map((ch) => {
                const isReajuste = mesesReajuste.has(ch.competencia);
                return (
                  <div key={ch.id} className={`flex items-center justify-between py-2.5 ${isReajuste ? "bg-destructive/10 -mx-6 px-6" : ""}`}>
                    <div className="flex items-center gap-2">
                      {ch.status === "recebido" ? (
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                      ) : (
                        <Circle className="h-4 w-4 text-muted-foreground" />
                      )}
                      <div>
                        <p className={`text-sm font-medium ${isReajuste ? "text-destructive" : ""}`}>{ch.competencia}</p>
                        <p className="text-xs text-muted-foreground">Vence {formatDate(ch.dataVencimento)}</p>
                      </div>
                    </div>
                    <span className={`tabular-nums text-sm font-medium ${isReajuste ? "text-destructive" : ""}`}>{brl(ch.valor)}</span>
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

    </>
  );
}
