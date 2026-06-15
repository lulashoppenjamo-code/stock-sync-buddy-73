import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { setCollaborator, getCollaborator, type Collaborator } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Boxes, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Iniciar sesión · Inventario" },
      { name: "description", content: "Identificate con tu PIN para entrar al inventario." },
    ],
  }),
  component: LoginPage,
});

type DirEntry = { id: string; name: string; is_admin: boolean };

function LoginPage() {
  const navigate = useNavigate();
  const [collabs, setCollabs] = useState<DirEntry[]>([]);
  const [selected, setSelected] = useState<DirEntry | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (getCollaborator()) navigate({ to: "/app" });
  }, [navigate]);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("collaborator_directory")
        .select("id, name, is_admin")
        .order("name");
      if (error) {
        toast.error("No se pudo cargar la lista de colaboradores");
      } else {
        setCollabs((data ?? []) as DirEntry[]);
      }
      setLoading(false);
    })();
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || pin.length < 4) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("verify_pin", {
        p_collaborator_id: selected.id,
        p_pin: pin,
      });
      if (error) throw error;
      const row = (data ?? [])[0];
      if (!row) {
        toast.error("PIN incorrecto");
        setPin("");
        return;
      }
      const c: Collaborator = { id: row.id, name: row.name, is_admin: row.is_admin };
      setCollaborator(c);
      toast.success(`Hola, ${c.name}`);
      navigate({ to: "/app" });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 px-4 py-10">
      <div className="mx-auto max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Boxes className="h-5 w-5" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Inventario A/B</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Identificate con tu PIN</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : !selected ? (
              <div className="grid grid-cols-2 gap-2">
                {collabs.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelected(c)}
                    className="rounded-lg border bg-background px-3 py-3 text-left transition hover:border-primary hover:bg-accent"
                  >
                    <div className="font-medium">{c.name}</div>
                    {c.is_admin && <div className="text-xs text-primary">administrador</div>}
                  </button>
                ))}
                {collabs.length === 0 && (
                  <p className="col-span-2 text-sm text-muted-foreground">
                    No hay colaboradores. Usa el acceso inicial: <strong>Admin</strong> / PIN <code>1234</code>.
                  </p>
                )}
              </div>
            ) : (
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="text-sm">
                  <div className="text-muted-foreground">Colaborador</div>
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{selected.name}</div>
                    <button type="button" className="text-xs text-primary underline" onClick={() => setSelected(null)}>
                      cambiar
                    </button>
                  </div>
                </div>
                <div>
                  <Label htmlFor="pin">PIN</Label>
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="pin"
                      autoFocus
                      type="password"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]*"
                      maxLength={8}
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                      placeholder="••••"
                      className="pl-9 text-center text-lg tracking-widest"
                    />
                  </div>
                </div>
                <Button type="submit" disabled={busy || pin.length < 4} className="w-full">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Entrar"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Funciona en móvil y PC · Sincronización en tiempo real · Soporta uso offline
        </p>
      </div>
    </div>
  );
}
