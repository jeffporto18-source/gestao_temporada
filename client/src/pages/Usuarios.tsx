import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Users, Mail, Phone, User } from "lucide-react";
import { formatPhone } from "@shared/validators";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { NIVEIS_ACESSO, NIVEL_ACESSO_INFO, type NivelAcesso } from "@shared/niveis";
import { useAuth } from "@/_core/hooks/useAuth";

export default function Usuarios() {
  const { data: teamUsers, isLoading } = trpc.team.list.useQuery();
  const { user } = useAuth();
  const utils = trpc.useUtils();

  // "Contabilidade" = funcionário com acesso a todas as empresas (role=admin, o mesmo alcance do
  // escritório). Só quem já é do escritório pode marcar isso — o servidor confere de novo, isso aqui
  // só decide se o campo aparece.
  const podeMarcarContabilidade = user?.role === "admin";

  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [telefone, setTelefone] = useState("");
  const [nivel, setNivel] = useState<NivelAcesso>("operacional");
  const [contabilidade, setContabilidade] = useState(false);

  const createMutation = trpc.team.create.useMutation({
    onSuccess: () => {
      toast.success("Usuário adicionado com sucesso!");
      utils.team.list.invalidate();
      setDialogOpen(false);
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const alterarNivel = trpc.team.alterarNivel.useMutation({
    onSuccess: () => {
      toast.success("Nível de acesso atualizado.");
      utils.team.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.team.delete.useMutation({
    onSuccess: () => {
      toast.success("Usuário removido.");
      utils.team.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  function resetForm() {
    setName("");
    setEmail("");
    setPassword("");
    setTelefone("");
    setNivel("operacional");
    setContabilidade(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password) {
      toast.error("Nome, e-mail e senha são obrigatórios.");
      return;
    }
    if (password.length < 6) {
      toast.error("A senha deve ter no mínimo 6 caracteres.");
      return;
    }
    createMutation.mutate({
      name: name.trim(),
      email: email.trim(),
      password,
      telefone: telefone ? telefone.replace(/\D/g, "") : undefined,
      nivel,
      contabilidade: podeMarcarContabilidade && contabilidade ? true : undefined,
    });
  }

  return (
    <div className="container max-w-3xl py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-serif font-semibold flex items-center gap-2">
            <Users className="h-6 w-6" />
            Usuários do Sistema
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Adicione colaboradores que terão acesso ao sistema com login próprio.
          </p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="active:scale-[0.97] transition-transform">
              <Plus className="mr-2 h-4 w-4" />
              Adicionar usuário
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Novo usuário</DialogTitle>
              <DialogDescription>
                Crie um acesso para um colaborador. Ele poderá fazer login com o e-mail e senha definidos.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label htmlFor="newName">Nome completo</Label>
                <Input
                  id="newName"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nome do colaborador"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newEmail">E-mail</Label>
                <Input
                  id="newEmail"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="colaborador@email.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newPassword">Senha inicial</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mín. 6 caracteres"
                  required
                  minLength={6}
                />
              </div>
              {podeMarcarContabilidade && (
                <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2.5">
                  <Checkbox
                    id="contabilidade"
                    checked={contabilidade}
                    onCheckedChange={(v) => setContabilidade(v === true)}
                    className="mt-0.5"
                  />
                  <Label htmlFor="contabilidade" className="cursor-pointer font-normal">
                    Funcionário da contabilidade
                    <span className="block text-xs text-muted-foreground font-normal mt-0.5">
                      Acesso a todas as empresas cadastradas no sistema, não só a esta.
                    </span>
                  </Label>
                </div>
              )}
              {!contabilidade && (
                <div className="space-y-2">
                  <Label>Nível de acesso</Label>
                  <Select value={nivel} onValueChange={(v) => setNivel(v as NivelAcesso)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {NIVEIS_ACESSO.map((n) => (
                        <SelectItem key={n} value={n}>{NIVEL_ACESSO_INFO[n].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{NIVEL_ACESSO_INFO[nivel].descricao}</p>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="newTelefone">Telefone / WhatsApp (opcional)</Label>
                <Input
                  id="newTelefone"
                  value={telefone}
                  onChange={(e) => setTelefone(formatPhone(e.target.value))}
                  placeholder="(00) 00000-0000"
                  maxLength={15}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending && <Loader2 className="animate-spin mr-2 h-4 w-4" />}
                  Criar usuário
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="animate-spin h-6 w-6 text-muted-foreground" />
        </div>
      )}

      {!isLoading && (!teamUsers || teamUsers.length === 0) && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground">Nenhum usuário adicionado ainda.</p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              Clique em "Adicionar usuário" para criar acessos para seus colaboradores.
            </p>
          </CardContent>
        </Card>
      )}

      {teamUsers && teamUsers.length > 0 && (
        <div className="space-y-3">
          {teamUsers.map((user) => (
            <Card key={user.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="flex items-center justify-between py-4">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{user.name}</p>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      {user.email && (
                        <span className="flex items-center gap-1">
                          <Mail className="h-3.5 w-3.5" />
                          {user.email}
                        </span>
                      )}
                      {user.telefone && (
                        <span className="flex items-center gap-1">
                          <Phone className="h-3.5 w-3.5" />
                          {formatPhone(user.telefone)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {user.role === "admin" ? (
                    <span className="h-8 flex items-center rounded-md border border-border bg-secondary/50 px-2.5 text-xs font-medium text-muted-foreground">
                      Contabilidade · todas as empresas
                    </span>
                  ) : (
                  <Select
                    value={user.nivel ?? "total"}
                    onValueChange={(v) => alterarNivel.mutate({ userId: user.id, nivel: v as NivelAcesso })}
                  >
                    <SelectTrigger className="h-8 w-[150px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {NIVEIS_ACESSO.map((n) => (
                        <SelectItem key={n} value={n}>{NIVEL_ACESSO_INFO[n].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  )}

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remover usuário</AlertDialogTitle>
                      <AlertDialogDescription>
                        Tem certeza que deseja remover <strong>{user.name}</strong> do sistema? Esta ação não pode ser desfeita.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteMutation.mutate({ id: user.id })}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Remover
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
