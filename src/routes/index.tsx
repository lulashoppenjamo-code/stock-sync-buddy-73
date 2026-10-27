import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { setCollaborator, getCollaborator, type Collaborator } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Boxes, KeyRound, Loader2, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { useOnline } from "@/hooks/use-online";

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

// ── Cache colaboradores en localStorage ──────────────────────────────
const COLLABS_CACHE_KEY = "inv.collabs.cache.v1";

function saveCollabsCache(collabs: DirEntry[]) {
  try { localStorage.setItem(COLLABS_CACHE_KEY, JSON.stringify(collabs)); } catch { /* ignore */ }
}

function loadCollabsCache(): DirEntry[] {
  try {
    const r = localStorage.getItem(COLLABS_CACHE_KEY);
    return r ? JSON.parse(r) : [];
  } catch { return []; }
}

// ── Cache de hashes de PIN para login offline ─────────────────────────
// Guardamos el hash que devuelve verify_pin para cada colaborador exitoso
const PIN_CACHE_KEY = "inv.pin.cache.v1";

type PinCache = Record<string, { hash: string; name: string; is_admin: boolean; branch?: "A" | "B" | null }>;

function savePinCache(collaboratorId: string, pin: string, name: string, is_admin: boolean, branch?: "A" | "B" | null) {
  try {
    const cache: PinCache = JSON.parse(localStorage.getItem(PIN_CACHE_KEY) || "{}");
    // Store a simple hash: collaboratorId + pin (not cryptographic, just for offline use)
    cache[collaboratorId] = { hash: btoa(`${collaboratorId}:${pin}`), name, is_admin, branch: branch ?? null };
    localStorage.setItem(PIN_CACHE_KEY, JSON.stringify(cache));
  } catch { /* ignore */ }
}

function verifyPinOffline(collaboratorId: string, pin: string): { name: string; is_admin: boolean; branch?: "A" | "B" | null } | null {
  try {
    const cache: PinCache = JSON.parse(localStorage.getItem(PIN_CACHE_KEY) || "{}");
    const entry = cache[collaboratorId];
    if (!entry) return null;
    if (entry.hash === btoa(`${collaboratorId}:${pin}`)) {
      return { name: entry.name, is_admin: entry.is_admin, branch: entry.branch ?? null };
    }
    return null;
  } catch { return null; }
}

function LoginPage() {
  const navigate = useNavigate();
  const online = useOnline();
  const [collabs, setCollabs] = useState<DirEntry[]>(() => loadCollabsCache());
  const [selected, setSelected] = useState<DirEntry | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (getCollaborator()) navigate({ to: "/app" });
  }, [navigate]);

  useEffect(() => {
    if (!online) {
      // Use cached collaborators when offline
      const cached = loadCollabsCache();
      if (cached.length > 0) {
        setCollabs(cached);
      }
      setLoading(false);
      return;
    }

    // Online: fetch from Supabase and update cache
    (async () => {
      const { data, error } = await supabase
        .from("collaborator_directory")
        .select("id, name, is_admin")
        .order("name");
      if (error) {
        // If online fetch fails, fall back to cache
        const cached = loadCollabsCache();
        setCollabs(cached);
        if (cached.length === 0) toast.error("No se pudo cargar la lista de colaboradores");
      } else {
        const list = (data ?? []) as DirEntry[];
        setCollabs(list);
        saveCollabsCache(list); // Update cache for offline use
      }
      setLoading(false);
    })();
  }, [online]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || pin.length < 4) return;
    setBusy(true);
    try {
      if (!online) {
        // Offline login using cached PIN
        const cached = verifyPinOffline(selected.id, pin);
        if (!cached) {
          toast.error("PIN incorrecto o no disponible offline. Necesitás internet para el primer inicio de sesión.");
          setPin("");
          return;
        }
        const c: Collaborator = { id: selected.id, name: cached.name, is_admin: cached.is_admin, branch: cached.branch ?? null };
        setCollaborator(c);
        toast.success(`Hola, ${c.name} · Modo sin conexión`);
        navigate({ to: "/app" });
        return;
      }

      // Online login
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
      // Obtener sucursal asignada para guardarla en sesión y en caché offline
      let branch: "A" | "B" | null = null;
      try {
        const { data: br } = await supabase
          .from("collaborators")
          .select("branch")
          .eq("id", row.id)
          .maybeSingle();
        if (br?.branch === "A" || br?.branch === "B") branch = br.branch;
      } catch { /* ignore */ }

      // Save PIN + branch to cache for future offline logins
      savePinCache(selected.id, pin, row.name, row.is_admin, branch);

      const c: Collaborator = { id: row.id, name: row.name, is_admin: row.is_admin, branch };
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

        {/* Offline banner */}
        {!online && (
          <div className="mb-4 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            <WifiOff className="h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Sin conexión a internet</p>
              <p className="mt-0.5">Podés entrar si ya iniciaste sesión antes en este dispositivo.</p>
            </div>
          </div>
        )}

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
                  <div className="col-span-2 space-y-2 text-sm text-muted-foreground">
                    {online ? (
                      <p>No hay colaboradores. Usa el acceso inicial: <strong>Admin</strong> / PIN <code>1234</code>.</p>
                    ) : (
                      <p>Sin conexión y sin datos en caché. Necesitás internet para el primer inicio de sesión.</p>
                    )}
                  </div>
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
                {!online && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Sin internet — se usará el PIN guardado en este dispositivo.
                  </p>
                )}
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
