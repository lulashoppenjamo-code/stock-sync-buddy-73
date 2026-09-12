import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MessageSquare, Send, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";

type Props = {
  barcode: string;
  productName: string;
  category: string;
  branch: string;
  collaboratorName: string;
  collaboratorId: string;
};

export function ProductComment({ barcode, productName, category, branch, collaboratorName, collaboratorId }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const qc = useQueryClient();

  const { data: comments = [] } = useQuery({
    queryKey: ["product-comment", barcode, branch],
    enabled: open,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_comments")
        .select("id, comment, collaborator_name, created_at")
        .eq("barcode", barcode)
        .eq("branch", branch)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });

  async function send() {
    const t = text.trim();
    if (!t) return;
    setSending(true);
    try {
      const { error } = await supabase.from("audit_comments").insert({
        barcode,
        product_name: productName,
        category,
        branch,
        collaborator_id: collaboratorId || null,
        collaborator_name: collaboratorName || "Anónimo",
        comment: t,
      });
      if (error) throw error;
      setText("");
      toast.success("Comentario guardado");
      qc.invalidateQueries({ queryKey: ["product-comment", barcode, branch] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-1 px-7">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors">
        <MessageSquare className="h-3 w-3" />
        {comments.length > 0 ? `${comments.length} comentario${comments.length === 1 ? "" : "s"}` : "Agregar comentario"}
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {open && (
        <div className="mt-1.5 space-y-1.5 rounded-md border bg-muted/20 p-2">
          {comments.map((c) => (
            <div key={c.id} className="text-[10px]">
              <span className="font-medium text-foreground">{c.collaborator_name ?? "—"}</span>
              <span className="text-muted-foreground ml-1">
                · {new Date(c.created_at).toLocaleDateString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
              <p className="text-foreground mt-0.5">{c.comment}</p>
            </div>
          ))}
          <div className="flex gap-1.5 pt-1">
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }}
              placeholder="Escribe un comentario…"
              className="flex-1 rounded border bg-background px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="button"
              onClick={send}
              disabled={sending || !text.trim()}
              className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-[11px] text-primary-foreground disabled:opacity-40">
              {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
