import { trpc, type RouterOutputs } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Check, X, ChevronRight, ChevronDown } from "lucide-react";
import { PageHeader } from "./Clientes";

type Grupo = "conta_principal" | "despesa_fixa" | "despesa_variavel" | "receita" | "aporte_capital" | "repasse_caucao";
type ChartAccount = RouterOutputs["chartAccounts"]["list"][number];

const GRUPO_LABELS: Record<Grupo, string> = {
  conta_principal: "Conta principal",
  despesa_fixa: "Despesa Fixa",
  despesa_variavel: "Despesa Variável",
  receita: "Receita",
  aporte_capital: "Aporte de Capital",
  repasse_caucao: "Repasse de Caução (não entra na DRE)",
};

const MAX_DEPTH = 3; // 4 níveis: 0=conta principal, 1=conta, 2=subconta (modalidade), 3=sub-subconta (despesa)
const DEPTH_LABEL = (depth: number) =>
  depth === 0 ? "Conta principal" : depth === 1 ? "Conta" : depth === 2 ? "Subconta · modalidade" : "Sub-subconta · despesa";

export default function PlanoContas() {
  const utils = trpc.useUtils();
  const { data: contas, isLoading } = trpc.chartAccounts.list.useQuery({});
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // Apenas um fluxo de edição/criação ativo por vez, sempre inline na própria árvore.
  const [addingUnderId, setAddingUnderId] = useState<number | null>(null);
  const [addingRoot, setAddingRoot] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [nome, setNome] = useState("");
  const [grupo, setGrupo] = useState<Grupo>("conta_principal");

  const closeAll = () => { setAddingUnderId(null); setAddingRoot(false); setEditingId(null); setNome(""); };

  const create = trpc.chartAccounts.create.useMutation({
    onSuccess: (_, vars) => {
      utils.chartAccounts.list.invalidate();
      if (vars.parentId) setExpanded((prev) => new Set(prev).add(vars.parentId!));
      closeAll();
      toast.success("Conta criada.");
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.chartAccounts.update.useMutation({
    onSuccess: () => { utils.chartAccounts.list.invalidate(); closeAll(); toast.success("Conta atualizada."); },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.chartAccounts.delete.useMutation({
    onSuccess: () => { utils.chartAccounts.list.invalidate(); toast.success("Conta removida."); },
    onError: (e) => toast.error(e.message),
  });

  const childrenOf = useMemo(() => {
    const map = new Map<number | null, ChartAccount[]>();
    for (const c of contas ?? []) {
      const key = c.parentId ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return map;
  }, [contas]);

  const allIds = useMemo(() => (contas ?? []).map((c) => c.id), [contas]);
  const principais = childrenOf.get(null) ?? [];

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startAddUnder = (parentId: number) => { setAddingRoot(false); setEditingId(null); setAddingUnderId(parentId); setNome(""); };
  const startAddRoot = () => { setAddingUnderId(null); setEditingId(null); setAddingRoot(true); setNome(""); setGrupo("conta_principal"); };
  const startEdit = (a: ChartAccount) => { setAddingUnderId(null); setAddingRoot(false); setEditingId(a.id); setNome(a.nome); };

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Plano de contas"
        subtitle="Conta principal › conta › subconta (modalidade) › sub-subconta (despesa)."
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="bg-background" onClick={() => setExpanded(new Set(allIds))}>Expandir tudo</Button>
            <Button variant="outline" size="sm" className="bg-background" onClick={() => setExpanded(new Set())}>Recolher tudo</Button>
          </div>
        }
      />

      {isLoading ? (
        <div className="h-64 rounded-xl border border-border bg-card animate-pulse" />
      ) : (
        <Card className="overflow-hidden py-0">
          <div className="divide-y divide-border">
            {principais.map((c) => (
              <AccountNode
                key={c.id}
                conta={c}
                depth={0}
                childrenOf={childrenOf}
                expanded={expanded}
                onToggle={toggle}
                addingUnderId={addingUnderId}
                editingId={editingId}
                nome={nome}
                setNome={setNome}
                onStartAdd={startAddUnder}
                onStartEdit={startEdit}
                onCancel={closeAll}
                onConfirmAdd={(parentId) => nome.trim() && create.mutate({ nome: nome.trim(), parentId })}
                onConfirmEdit={(id) => nome.trim() && update.mutate({ id, nome: nome.trim() })}
                onExcluir={(id) => del.mutate({ id })}
                pending={create.isPending || update.isPending}
              />
            ))}
          </div>
          <div className="px-4 py-3 border-t border-border">
            {addingRoot ? (
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  className="h-8 flex-1 focus-visible:ring-2"
                  placeholder="Nome da conta principal"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && nome.trim()) create.mutate({ nome: nome.trim(), grupo }); }}
                />
                <Select value={grupo} onValueChange={(v) => setGrupo(v as Grupo)}>
                  <SelectTrigger className="h-8 w-44 shrink-0"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(GRUPO_LABELS) as Grupo[]).map((g) => (
                      <SelectItem key={g} value={g}>{GRUPO_LABELS[g]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" disabled={!nome.trim() || create.isPending} onClick={() => create.mutate({ nome: nome.trim(), grupo })}>
                  Adicionar
                </Button>
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={closeAll}>Cancelar</Button>
              </div>
            ) : (
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={startAddRoot}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Nova conta principal
              </Button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function AccountNode({
  conta,
  depth,
  childrenOf,
  expanded,
  onToggle,
  addingUnderId,
  editingId,
  nome,
  setNome,
  onStartAdd,
  onStartEdit,
  onCancel,
  onConfirmAdd,
  onConfirmEdit,
  onExcluir,
  pending,
}: {
  conta: ChartAccount;
  depth: number;
  childrenOf: Map<number | null, ChartAccount[]>;
  expanded: Set<number>;
  onToggle: (id: number) => void;
  addingUnderId: number | null;
  editingId: number | null;
  nome: string;
  setNome: (v: string) => void;
  onStartAdd: (parentId: number) => void;
  onStartEdit: (a: ChartAccount) => void;
  onCancel: () => void;
  onConfirmAdd: (parentId: number) => void;
  onConfirmEdit: (id: number) => void;
  onExcluir: (id: number) => void;
  pending: boolean;
}) {
  const filhos = childrenOf.get(conta.id) ?? [];
  const isOpen = expanded.has(conta.id);
  const podeExpandir = depth < MAX_DEPTH;
  const isEditing = editingId === conta.id;
  const isAddingHere = addingUnderId === conta.id;

  return (
    <div>
      <div className="flex items-center gap-2 px-4 py-2.5 hover:bg-secondary/40 transition-colors" style={{ paddingLeft: `${16 + depth * 20}px` }}>
        {podeExpandir ? (
          <button onClick={() => onToggle(conta.id)} className="text-muted-foreground shrink-0">
            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}

        {isEditing ? (
          <>
            <Input
              autoFocus
              className="h-8 flex-1 focus-visible:ring-2"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && nome.trim()) onConfirmEdit(conta.id); if (e.key === "Escape") onCancel(); }}
            />
            <Button variant="ghost" size="icon" className="h-7 w-7 text-primary shrink-0" disabled={!nome.trim() || pending} onClick={() => onConfirmEdit(conta.id)}>
              <Check className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground shrink-0" onClick={onCancel}>
              <X className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <>
            <span className={`flex-1 truncate ${depth === 0 ? "text-sm font-semibold" : "text-sm"}`}>{conta.nome}</span>
            {depth > 0 && (
              <span className="text-[11px] text-muted-foreground shrink-0">{DEPTH_LABEL(depth)}</span>
            )}
            {podeExpandir && (
              <Button variant="outline" size="sm" className="h-7 bg-background text-xs shrink-0" onClick={() => onStartAdd(conta.id)}>
                <Plus className="mr-1 h-3 w-3" /> {DEPTH_LABEL(depth + 1)}
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground shrink-0" onClick={() => onStartEdit(conta)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0" onClick={() => onExcluir(conta.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>

      {isAddingHere && (
        <div className="flex items-center gap-2 px-4 py-2 bg-secondary/30" style={{ paddingLeft: `${16 + (depth + 1) * 20 + 18}px` }}>
          <Input
            autoFocus
            className="h-8 flex-1 focus-visible:ring-2"
            placeholder={`Nome da ${DEPTH_LABEL(depth + 1).toLowerCase()}`}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && nome.trim()) onConfirmAdd(conta.id); if (e.key === "Escape") onCancel(); }}
          />
          <Button size="sm" disabled={!nome.trim() || pending} onClick={() => onConfirmAdd(conta.id)}>
            Adicionar
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onCancel}>Cancelar</Button>
        </div>
      )}

      {podeExpandir && isOpen && filhos.length === 0 && !isAddingHere && (
        <p className="text-xs text-muted-foreground py-2" style={{ paddingLeft: `${16 + (depth + 1) * 20 + 18}px` }}>
          Nenhuma {DEPTH_LABEL(depth + 1).toLowerCase()} cadastrada ainda.
        </p>
      )}

      {isOpen && filhos.map((f) => (
        <AccountNode
          key={f.id}
          conta={f}
          depth={depth + 1}
          childrenOf={childrenOf}
          expanded={expanded}
          onToggle={onToggle}
          addingUnderId={addingUnderId}
          editingId={editingId}
          nome={nome}
          setNome={setNome}
          onStartAdd={onStartAdd}
          onStartEdit={onStartEdit}
          onCancel={onCancel}
          onConfirmAdd={onConfirmAdd}
          onConfirmEdit={onConfirmEdit}
          onExcluir={onExcluir}
          pending={pending}
        />
      ))}
    </div>
  );
}
