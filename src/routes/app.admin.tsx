import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useCollaborator } from "@/lib/session";

export const Route = createFileRoute("/app/admin")({
  component: AdminPage,
});

type Row = { id: string; name: string; is_admin: boolean; active: boolean; branch: string | null };

function AdminPage() {
  const me = useCollaborator();
  const navigate = useNavigate();
  const [adminPin, setAdminPin] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [newBranch, setNewBranch] = useState<"A" | "B" | null>("A");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!me?.is_admin) navigate({ to: "/app" });
  }, [me, navigate]);

  async function refresh() {
    const { data } = await supabase
      .from("collaborators")
      .select("id, name, is_admin, active, branch")
      .order("name");
    setRows((data ?? []) as Row[]);
  }
  useEffect(() => { refresh(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!me) return;
    if (!name.trim() || pin.length < 4 || adminPin.length < 4) {
      toast.error("Completá nombre, PIN nuevo (4+) y tu PIN de admin");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.rpc("admin_create_collaborator", {
        p_admin_id: me.id,
        p_admin_pin: adminPin,
        p_name: name.trim(),
        p_pin: pin,
        p_is_admin: isAdmin,
      });
      if (error) throw error;
      // Asignar sucursal al nuevo colaborador (o dejarlo sin sucursal si es admin)
      await supabase.from("collaborators").update({ branch: newBranch }).eq("name", name.trim());
      toast.success("Colaborador creado");
      setName(""); setPin(""); setIsAdmin(false); setNewBranch("A");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function updateBranch(target: Row, newBranch: string | null) {
    setBusy(true);
    try {
      const { error } = await supabase
        .from("collaborators")
        .update({ branch: newBranch })
        .eq("id", target.id);
      if (error) throw error;
      toast.success(`Sucursal de ${target.name} → ${newBranch === "A" ? "Mina" : newBranch === "B" ? "Morelos" : "Sin sucursal"} ✓`);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function update(target: Row, patch: { name?: string; is_admin?: boolean; active?: boolean; pin?: string; branch?: string | null }) {
    if (!me) return;
    if (adminPin.length < 4) return toast.error("Ingresá tu PIN de admin arriba");

    if (patch.branch !== undefined && Object.keys(patch).length === 1) {
      await updateBranch(target, patch.branch);
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.rpc("admin_update_collaborator", {
        p_admin_id: me.id,
        p_admin_pin: adminPin,
        p_target_id: target.id,
        p_name: patch.name ?? target.name,
        p_pin: patch.pin ?? "",
        p_is_admin: patch.is_admin ?? target.is_admin,
        p_active: patch.active ?? target.active,
      });
      if (error) throw error;
      toast.success("Actualizado");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Administración de colaboradores</h1>

      <Card>
        <CardContent className="p-4 space-y-3">
          <Label>Tu PIN de administrador</Label>
          <Input
            type="password"
            inputMode="numeric"
            value={adminPin}
            onChange={(e) => setAdminPin(e.target.value.replace(/\D/g, ""))}
            placeholder="Necesario para crear/editar"
            className="max-w-xs"
          />
          <p className="text-xs text-muted-foreground">Se valida en cada cambio. No se guarda en el navegador.</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-4 sm:items-end">
            <div className="sm:col-span-2">
              <Label>Nombre</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. María" />
            </div>
            <div>
              <Label>PIN nuevo</Label>
              <Input
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                placeholder="4+ dígitos"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={isAdmin} onCheckedChange={(v) => { setIsAdmin(v); if (!v && newBranch === null) setNewBranch("A"); }} id="adm" />
              <Label htmlFor="adm">Admin</Label>
            </div>
            {/* Sucursal al crear */}
            <div className="sm:col-span-4">
              <Label>Sucursal asignada</Label>
              <div className="mt-1 inline-flex overflow-hidden rounded-md border">
                {(["A", "B"] as const).map((b) => (
                  <button key={b} type="button" onClick={() => setNewBranch(b)}
                    className={`px-4 py-1.5 text-sm font-medium transition-colors ${newBranch === b ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
                    {b === "A" ? "Mina" : "Morelos"}
                  </button>
                ))}
                {/* Un administrador puede quedar sin sucursal fija y elegir cuál usar cada vez */}
                {isAdmin && (
                  <button type="button" onClick={() => setNewBranch(null)}
                    className={`px-4 py-1.5 text-sm font-medium transition-colors ${newBranch === null ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
                    Sin sucursal
                  </button>
                )}
              </div>
              {isAdmin && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Los administradores pueden quedar "Sin sucursal" y elegir Mina o Morelos cada vez que auditen.
                </p>
              )}
            </div>
            <Button type="submit" disabled={busy} className="sm:col-span-4">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Crear colaborador
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Sucursal</TableHead>
                <TableHead>Admin</TableHead>
                <TableHead>Activo</TableHead>
                <TableHead>Reset PIN</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <RowEditor key={r.id} row={r} disabled={busy}
                  onUpdate={(p) => update(r, p)}
                  onSaveBranch={async (branch) => {
                    setBusy(true);
                    try {
                      const { error } = await supabase
                        .from("collaborators")
                        .update({ branch })
                        .eq("id", r.id);
                      if (error) throw error;
                      toast.success(`Sucursal de ${r.name} → ${branch === "A" ? "Mina" : branch === "B" ? "Morelos" : "Sin sucursal"}`);
                      refresh();
                    } catch (e) { toast.error((e as Error).message); }
                    finally { setBusy(false); }
                  }}
                />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function RowEditor({
  row,
  disabled,
  onUpdate,
  onSaveBranch,
}: {
  row: Row;
  disabled: boolean;
  onUpdate: (patch: { is_admin?: boolean; active?: boolean; pin?: string }) => void;
  onSaveBranch: (branch: "A" | "B" | null) => void;
}) {
  const [newPin, setNewPin] = useState("");
  const normalize = (b: string | null): "A" | "B" | null => (b === "A" || b === "B" ? b : row.is_admin ? null : "A");
  const [localBranch, setLocalBranch] = useState<"A" | "B" | null>(normalize(row.branch));
  const [branchChanged, setBranchChanged] = useState(false);

  useEffect(() => {
    setLocalBranch(normalize(row.branch));
    setBranchChanged(false);
  }, [row.branch, row.is_admin]);

  function handleBranchChange(b: "A" | "B" | null) {
    setLocalBranch(b);
    setBranchChanged(b !== normalize(row.branch));
  }

  return (
    <TableRow>
      <TableCell className="font-medium text-sm">{row.name}</TableCell>

      {/* Sucursal con botón Guardar */}
      <TableCell>
        <div className="flex flex-col gap-1">
          <div className="inline-flex overflow-hidden rounded-md border text-xs">
            {(["A", "B"] as const).map((b) => (
              <button key={b} type="button" disabled={disabled}
                onClick={() => handleBranchChange(b)}
                className={`px-3 py-1.5 font-medium transition-colors disabled:opacity-50 ${
                  localBranch === b ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                }`}>
                {b === "A" ? "Mina" : "Morelos"}
              </button>
            ))}
            {/* "Sin sucursal" solo tiene sentido para administradores */}
            {row.is_admin && (
              <button type="button" disabled={disabled}
                onClick={() => handleBranchChange(null)}
                className={`px-3 py-1.5 font-medium transition-colors disabled:opacity-50 ${
                  localBranch === null ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                }`}>
                Sin sucursal
              </button>
            )}
          </div>
          {branchChanged && (
            <Button size="sm" className="h-7 text-xs px-2 bg-emerald-600 hover:bg-emerald-700"
              disabled={disabled}
              onClick={() => { onSaveBranch(localBranch); setBranchChanged(false); }}>
              Guardar sucursal
            </Button>
          )}
        </div>
      </TableCell>

      <TableCell>
        <Switch checked={row.is_admin} disabled={disabled} onCheckedChange={(v) => onUpdate({ is_admin: v })} />
      </TableCell>
      <TableCell>
        <Switch checked={row.active} disabled={disabled} onCheckedChange={(v) => onUpdate({ active: v })} />
      </TableCell>
      <TableCell>
        <div className="flex gap-1">
          <Input type="password" inputMode="numeric" value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
            placeholder="Nuevo PIN" className="w-24" />
          <Button size="sm" variant="outline" disabled={disabled || newPin.length < 4}
            onClick={() => { onUpdate({ pin: newPin }); setNewPin(""); }}>
            OK
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
