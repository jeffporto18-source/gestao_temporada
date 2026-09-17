import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, ExternalLink, Loader2, Trash2 } from "lucide-react";
import { PageHeader } from "./Clientes";

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function anosDisponiveis(): number[] {
  const atual = new Date().getFullYear();
  const anos: number[] = [];
  for (let a = atual - 2; a <= atual + 1; a++) anos.push(a);
  return anos;
}

/** Botão de anexar/substituir + link "Ver" de um mês, mesmo padrão usado nos anexos de contrato. */
function AnexoMes({
  mes,
  url,
  uploading,
  onUpload,
  onRemove,
  removing,
}: {
  mes: string;
  url?: string | null;
  uploading: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
  removing: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="text-sm font-medium w-28 shrink-0">{mes}</span>
      <div className="flex items-center gap-1.5 flex-wrap justify-end">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = "";
          }}
        />
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
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs bg-background text-muted-foreground hover:text-primary"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />}
          {url ? "Substituir" : "Anexar"}
        </Button>
        {url && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            disabled={removing}
            onClick={onRemove}
            title="Remover anexo"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

/** Extratos mensais gerais da empresa (ex.: extrato bancário) — sempre visível no menu, para consulta rápida. */
export default function Extratos() {
  const utils = trpc.useUtils();
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [uploadingMes, setUploadingMes] = useState<number | null>(null);

  const { data: extratos, isLoading } = trpc.statements.list.useQuery({ ano });
  const porMes = new Map((extratos ?? []).map((e) => [e.mes, e]));

  const remove = trpc.statements.delete.useMutation({
    onSuccess: () => { utils.statements.list.invalidate(); toast.success("Anexo removido."); },
    onError: (e) => toast.error(e.message),
  });

  const upload = async (mes: number, file: File) => {
    setUploadingMes(mes);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("ano", String(ano));
      formData.append("mes", String(mes));
      const resp = await fetch("/api/upload/extrato", { method: "POST", body: formData });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || "Erro ao enviar.");
      toast.success("Extrato anexado.");
      utils.statements.list.invalidate();
    } catch (e: any) {
      toast.error(e.message || "Erro ao enviar o extrato.");
    } finally {
      setUploadingMes(null);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader
        title="Extratos"
        subtitle="Um anexo por mês, geral da empresa — sempre disponível aqui para consulta e para tirar dúvidas."
        action={
          <div className="grid gap-1">
            <Label className="text-[11px] text-muted-foreground">Ano</Label>
            <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
              <SelectTrigger className="h-8 w-[110px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {anosDisponiveis().map((a) => (
                  <SelectItem key={a} value={String(a)}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {isLoading ? (
        <div className="h-96 rounded-xl border border-border bg-card animate-pulse" />
      ) : (
        <Card className="overflow-hidden py-0">
          <div className="divide-y divide-border">
            {MESES.map((nome, i) => {
              const mes = i + 1;
              const extrato = porMes.get(mes);
              return (
                <AnexoMes
                  key={mes}
                  mes={nome}
                  url={extrato?.arquivoUrl}
                  uploading={uploadingMes === mes}
                  onUpload={(file) => upload(mes, file)}
                  onRemove={() => remove.mutate({ ano, mes })}
                  removing={remove.isPending}
                />
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
