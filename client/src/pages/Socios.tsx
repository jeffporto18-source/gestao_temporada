import { trpc, type RouterOutputs } from "@/lib/trpc";
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
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, UserRound, Users } from "lucide-react";
import { PageHeader, EmptyState, SkeletonList } from "./Clientes";
import { formatCpfCnpj } from "@/lib/format";

interface SocioForm {
  nome: string;
  cpf: string;
  grupoId: string;
}

const emptyForm: SocioForm = { nome: "", cpf: "", grupoId: "" };

type Socio = RouterOutputs["socios"]["list"][number];

export default function Socios() {
  const utils = trpc.useUtils();
  const { data: socios, isLoading } = trpc.socios.list.useQuery();
  const { data: grupos } = trpc.socioGrupos.list.useQuery();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<SocioForm>(emptyForm);

  const reset = () => { setForm(emptyForm); setEditId(null); };

  const create = trpc.socios.create.useMutation({
    onSuccess: () => { utils.socios.list.invalidate(); setOpen(false); reset(); toast.success("Sócio cadastrado."); },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.socios.update.useMutation({
    onSuccess: () => { utils.socios.list.invalidate(); setOpen(false); reset(); toast.success("Sócio atualizado."); },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.socios.delete.useMutation({
    onSuccess: () => { utils.socios.list.invalidate(); toast.success("Sócio removido."); },
    onError: (e) => toast.error(e.message),
  });

  const openEdit = (s: Socio) => {
    setEditId(s.id);
    setForm({ nome: s.nome, cpf: s.cpf, grupoId: s.grupoId ? String(s.grupoId) : "" });
    setOpen(true);
  };

  const submit = () => {
    if (!form.nome.trim()) { toast.error("Informe o nome do sócio."); return; }
    if (!form.cpf.trim()) { toast.error("Informe o CPF do sócio."); return; }
    const payload = { nome: form.nome.trim(), cpf: form.cpf.trim(), grupoId: form.grupoId ? Number(form.grupoId) : null };
    if (editId) {
      update.mutate({ id: editId, ...payload });
    } else {
      create.mutate(payload);
    }
  };

  const grupoNome = (id: number | null) => grupos?.find((g) => g.id === id)?.nome ?? null;

  // Sócios agrupados (na ordem dos grupos) primeiro, sem grupo por último.
  const secoes = useMemo(() => {
    const semGrupo = (socios ?? []).filter((s) => !s.grupoId);
    const porGrupo = (grupos ?? []).map((g) => ({
      titulo: g.nome,
      itens: (socios ?? []).filter((s) => s.grupoId === g.id),
    }));
    return [...porGrupo, ...(semGrupo.length ? [{ titulo: "Sem grupo", itens: semGrupo }] : [])].filter((s) => s.itens.length > 0);
  }, [socios, grupos]);

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Sócios"
        subtitle="Cadastro dos sócios da empresa. Agrupe quem recebe o rendimento de um imóvel junto (ex.: imóvel de família)."
        action={
          <div className="flex gap-2">
            <SocioGruposDialog />
            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
              <DialogTrigger asChild>
                <Button className="active:scale-[0.97] transition-transform">
                  <Plus className="mr-1 h-4 w-4" /> Novo sócio
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle className="font-serif">{editId ? "Editar sócio" : "Novo sócio"}</DialogTitle>
                </DialogHeader>
                <div className="grid gap-3 py-2">
                  <div className="grid gap-1.5">
                    <Label>Nome</Label>
                    <Input autoFocus value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Nome completo" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>CPF</Label>
                    <Input value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value })} placeholder="000.000.000-00" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Grupo</Label>
                    <Select value={form.grupoId || "nenhum"} onValueChange={(v) => setForm({ ...form, grupoId: v === "nenhum" ? "" : v })}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="nenhum">Nenhum</SelectItem>
                        {grupos?.map((g) => (
                          <SelectItem key={g.id} value={String(g.id)}>{g.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" className="bg-background" onClick={() => setOpen(false)}>Cancelar</Button>
                  <Button onClick={submit} disabled={create.isPending || update.isPending}>{editId ? "Salvar alterações" : "Salvar"}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {isLoading ? (
        <SkeletonList />
      ) : !socios?.length ? (
        <EmptyState title="Nenhum sócio cadastrado" subtitle="Cadastre o primeiro sócio da empresa." />
      ) : (
        <div className="space-y-6">
          {secoes.map((secao) => (
            <div key={secao.titulo}>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">{secao.titulo}</p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {secao.itens.map((s) => (
                  <Card key={s.id} className="p-5">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <UserRound className="h-5 w-5 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium truncate">{s.nome}</p>
                          <p className="text-xs text-muted-foreground">{formatCpfCnpj(s.cpf)}</p>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => openEdit(s)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => del.mutate({ id: s.id })}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Gerenciar grupos (criar, renomear, excluir) num diálogo à parte — não precisa disso toda hora. */
function SocioGruposDialog() {
  const utils = trpc.useUtils();
  const { data: grupos } = trpc.socioGrupos.list.useQuery();
  const [open, setOpen] = useState(false);
  const [nomeNovo, setNomeNovo] = useState("");
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [nomeEditando, setNomeEditando] = useState("");

  const create = trpc.socioGrupos.create.useMutation({
    onSuccess: () => { utils.socioGrupos.list.invalidate(); setNomeNovo(""); toast.success("Grupo criado."); },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.socioGrupos.update.useMutation({
    onSuccess: () => { utils.socioGrupos.list.invalidate(); setEditandoId(null); toast.success("Grupo renomeado."); },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.socioGrupos.delete.useMutation({
    onSuccess: () => { utils.socioGrupos.list.invalidate(); utils.socios.list.invalidate(); toast.success("Grupo removido — os sócios continuam cadastrados, sem grupo."); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="bg-background">
          <Users className="mr-1.5 h-4 w-4" /> Grupos
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-serif">Grupos de sócios</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-1">
          Quem está no mesmo grupo recebe o rendimento do imóvel junto — escolher o grupo no cadastro do imóvel preenche os sócios de uma vez.
        </p>
        <div className="grid gap-2 py-1">
          {grupos?.map((g) => (
            <div key={g.id} className="flex items-center gap-2">
              {editandoId === g.id ? (
                <>
                  <Input autoFocus value={nomeEditando} onChange={(e) => setNomeEditando(e.target.value)} className="h-8" />
                  <Button size="sm" className="h-8 shrink-0" disabled={update.isPending} onClick={() => nomeEditando.trim() && update.mutate({ id: g.id, nome: nomeEditando.trim() })}>Salvar</Button>
                  <Button size="sm" variant="ghost" className="h-8 shrink-0" onClick={() => setEditandoId(null)}>Cancelar</Button>
                </>
              ) : (
                <>
                  <Badge variant="outline" className="flex-1 justify-start py-1.5 font-normal">{g.nome}</Badge>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary shrink-0" onClick={() => { setEditandoId(g.id); setNomeEditando(g.nome); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0" onClick={() => del.mutate({ id: g.id })}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          ))}
          {!grupos?.length && <p className="text-xs text-muted-foreground">Nenhum grupo criado ainda.</p>}
        </div>
        <div className="flex items-center gap-2 pt-1 border-t border-border">
          <Input
            value={nomeNovo}
            onChange={(e) => setNomeNovo(e.target.value)}
            placeholder="Nome do novo grupo"
            className="h-8 mt-2"
            onKeyDown={(e) => { if (e.key === "Enter" && nomeNovo.trim()) create.mutate({ nome: nomeNovo.trim() }); }}
          />
          <Button size="sm" className="h-8 mt-2 shrink-0" disabled={create.isPending || !nomeNovo.trim()} onClick={() => create.mutate({ nome: nomeNovo.trim() })}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" className="bg-background" onClick={() => setOpen(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
