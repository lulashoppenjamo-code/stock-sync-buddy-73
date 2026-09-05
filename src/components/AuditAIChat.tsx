import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Sparkles, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { askAuditAI } from "@/lib/ai-audit.functions";
import { getCollaborator } from "@/lib/session";

type Msg = { role: "user" | "assistant"; content: string };

const THREAD_KEY = "inv.ai.thread.v1";

function getThreadId(): string {
  let id = localStorage.getItem(THREAD_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(THREAD_KEY, id);
  }
  return id;
}

const SUGGESTIONS = [
  "¿Cuánto faltante tengo este mes en pesos?",
  "¿Cuáles son los 10 productos con más faltante?",
  "¿Qué categoría tiene el peor faltante?",
  "Compará el faltante de este mes contra el mes anterior",
];

export function AuditAIChat() {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = getThreadId();
    setThreadId(id);
    supabase
      .from("ai_messages")
      .select("role, content")
      .eq("thread_id", id)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (data) setMsgs(data.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })));
      });
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy || !threadId) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", content: q }]);
    setBusy(true);
    try {
      const collab = getCollaborator();
      const res = await askAuditAI({
        data: { threadId, question: q, collaboratorName: collab?.name ?? undefined },
      });
      setMsgs((m) => [...m, { role: "assistant", content: res.answer }]);
    } catch (e) {
      toast.error((e as Error).message || "El asistente no pudo responder");
      setMsgs((m) => m.slice(0, -1));
      setInput(q);
    } finally {
      setBusy(false);
    }
  }

  function newThread() {
    const id = crypto.randomUUID();
    localStorage.setItem(THREAD_KEY, id);
    setThreadId(id);
    setMsgs([]);
  }

  return (
    <Card>
      <CardContent className="p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-600" />
          <span className="text-sm font-semibold">Asistente de inventario</span>
          <button type="button" onClick={newThread}
            className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground underline">
            <Trash2 className="h-3 w-3" /> Nueva conversación
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Preguntale lo que quieras sobre el inventario: faltantes por sucursal, por código, por producto o en pesos.
          Recuerda todo lo que le preguntes en esta conversación.
        </p>

        <div className="max-h-80 space-y-2 overflow-y-auto rounded-md border bg-muted/30 p-2">
          {msgs.length === 0 && !busy && (
            <div className="space-y-1.5 p-1">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)}
                  className="block w-full rounded-md border bg-background px-2.5 py-1.5 text-left text-xs hover:bg-muted">
                  {s}
                </button>
              ))}
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i}
              className={`max-w-[92%] whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-xs ${
                m.role === "user"
                  ? "ml-auto bg-primary text-primary-foreground"
                  : "bg-background border"
              }`}>
              {m.content}
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Analizando el inventario…
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex gap-2">
          <Input value={input} onChange={(e) => setInput(e.target.value)}
            placeholder="Escribí tu pregunta…" disabled={busy} />
          <Button type="submit" disabled={busy || !input.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
