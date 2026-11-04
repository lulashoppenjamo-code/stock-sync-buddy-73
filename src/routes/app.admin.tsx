import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, UserPlus, Trash2, Pencil, Check, X } from "lucide-react";
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
  useEffect(() => {
    refresh();
  }, []);

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
      await supabase.from("collaborators").update({ branch: newBranch }).eq("name", name.trim());
      toast.success("Colaborador creado");
      setName("");
      setPin("");
      setIsAdmin(false);
      setNewBranch("A");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function update(
    target: Row,
    patch: { name?: string; is_admin?: boolean; active?: boolean; pin?: string; branch?: string | null },
  ) {
    if (!me) return;
    if (adminPin.length < 4) return toast.error("Ingresá tu PIN de admin arriba");

    if (patch.branch !== undefined && Object.keys(patch).length === 1) {
      setBusy(true);
      try {
        const { error } = await supabase
          .from("collaborators")
          .update({ branch: patch.branch })
          .eq("id", target.id);
        if (error) throw error;
        toast.success(
          "Sucursal de " +
            target.name +
            " → " +
            (patch.branch === "A" ? "Mina" : patch.branch === "B" ? "Morelos" : "Sin sucursal") +
            " ✓",
        );
        refresh();
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusy(false);
      }
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

  async function removeCollaborator(target: Row) {
    if (!me) return;
    if (adminPin.length < 4) return toast.error("Ingresá tu PIN de admin arriba");
    if (target.id === me.id) return toast.error("No podés eliminarte a vos mismo");
    if (!window.confirm('¿Eliminar a "' + target.name + '"? Se desactiva (no borra historial).')) return;

    setBusy(true);
    try {
      const { error } = await supabase.rpc("admin_update_collaborator", {
        p_admin_id: me.id,
        p_admin_pin: adminPin,
        p_target_id: target.id,
        p_name: target.name,
        p_pin: "",
        p_is_admin: target.is_admin,
        p_active: false,
      });
      if (error) throw error;
      toast.success(target.name + " eliminado (desactivado)");
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
              <Switch
                checked={isAdmin}
                onCheckedChange={(v) => {
                  setIsAdmin(v);
                  if (!v && newBranch === null) setNewBranch("A");
                }}
                id="adm"
              />
              <Label htmlFor="adm">Admin</Label>
            </div>
            <div className="sm:col-span-4">
              <Label>Sucursal asignada</Label>
              <div className="mt-1 inline-flex overflow-hidden rounded-md border">
                {(["A", "B"] as const).map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setNewBranch(b)}
                    className={
                      "px-4 py-1.5 text-sm font-medium transition-colors " +
                      (newBranch === b ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted")
                    }
                  >
                    {b === "A" ? "Mina" : "Morelos"}
                  </button>
                ))}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setNewBranch(null)}
                    className={
                      "px-4 py-1.5 text-sm font-medium transition-colors " +
                      (newBranch === null ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted")
                    }
                  >
                    Sin sucursal
                  </button>
                )}
              </div>
            </div>
            <Button type="submit" disabled={busy} className="sm:col-span-4">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Crear
              colaborador
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Sucursal</TableHead>
                <TableHead>Admin</TableHead>
                <TableHead>Activo</TableHead>
                <TableHead>Reset PIN</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <RowEditor
                  key={r.id}
                  row={r}
                  disabled={busy}
                  onUpdate={(p) => update(r, p)}
                  onDelete={() => removeCollaborator(r)}
                  onSaveBranch={async (branch) => {
                    setBusy(true);
                    try {
                      const { error } = await supabase
                        .from("collaborators")
                        .update({ branch })
                        .eq("id", r.id);
                      if (error) throw error;
                      toast.success(
                        "Sucursal de " +
                          r.name +
                          " → " +
                          (branch === "A" ? "Mina" : branch === "B" ? "Morelos" : "Sin sucursal"),
                      );
                      refresh();
                    } catch (e) {
                      toast.error((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
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
  onDelete,
  onSaveBranch,
}: {
  row: Row;
  disabled: boolean;
  onUpdate: (patch: { name?: string; is_admin?: boolean; active?: boolean; pin?: string }) => void;
  onDelete: () => void;
  onSaveBranch: (branch: "A" | "B" | null) => void;
}) {
  const [newPin, setNewPin] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(row.name);
  const normalize = (b: string | null): "A" | "B" | null =>
    b === "A" || b === "B" ? b : row.is_admin ? null : "A";
  const [localBranch, setLocalBranch] = useState<"A" | "B" | null>(normalize(row.branch));
  const [branchChanged, setBranchChanged] = useState(false);

  useEffect(() => {
    setLocalBranch(normalize(row.branch));
    setBranchChanged(false);
    setNameDraft(row.name);
    setEditingName(false);
  }, [row.branch, row.is_admin, row.name]);

  function handleBranchChange(b: "A" | "B" | null) {
    setLocalBranch(b);
    setBranchChanged(b !== normalize(row.branch));
  }

  function saveName() {
    const n = nameDraft.trim();
    if (!n) {
      toast.error("El nombre no puede estar vacío");
      return;
    }
    if (n === row.name) {
      setEditingName(false);
      return;
    }
    onUpdate({ name: n });
    setEditingName(false);
  }

  return (
    <TableRow className={!row.active ? "opacity-50" : undefined}>
      <TableCell className="font-medium text-sm min-w-[140px]">
        {editingName ? (
          <div className="flex items-center gap-1">
            <Input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              className="h-8 w-32"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                if (e.key === "Escape") {
                  setNameDraft(row.name);
                  setEditingName(false);
                }
              }}
            />
            <Button size="icon" variant="ghost" className="h-8 w-8" disabled={disabled} onClick={saveName}>
              <Check className="h-4 w-4 text-emerald-600" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              disabled={disabled}
              onClick={() => {
                setNameDraft(row.name);
                setEditingName(false);
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <span>{row.name}</span>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              disabled={disabled}
              onClick={() => setEditingName(true)}
              title="Editar nombre"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </TableCell>

      <TableCell>
        <div className="flex flex-col gap-1">
          <div className="inline-flex overflow-hidden rounded-md border text-xs">
            {(["A", "B"] as const).map((b) => (
              <button
                key={b}
                type="button"
                disabled={disabled}
                onClick={() => handleBranchChange(b)}
                className={
                  "px-3 py-1.5 font-medium transition-colors disabled:opacity-50 " +
                  (localBranch === b ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted")
                }
              >
                {b === "A" ? "Mina" : "Morelos"}
              </button>
            ))}
            {row.is_admin && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => handleBranchChange(null)}
                className={
                  "px-3 py-1.5 font-medium transition-colors disabled:opacity-50 " +
                  (localBranch === null ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted")
                }
              >
                Sin sucursal
              </button>
            )}
          </div>
          {branchChanged && (
            <Button
              size="sm"
              className="h-7 text-xs px-2 bg-emerald-600 hover:bg-emerald-700"
              disabled={disabled}
              onClick={() => {
                onSaveBranch(localBranch);
                setBranchChanged(false);
              }}
            >
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
          <Input
            type="password"
            inputMode="numeric"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
            placeholder="Nuevo PIN"
            className="w-24"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || newPin.length < 4}
            onClick={() => {
              onUpdate({ pin: newPin });
              setNewPin("");
            }}
          >
            OK
          </Button>
        </div>
      </TableCell>
      <TableCell>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-destructive hover:text-destructive"
          disabled={disabled}
          onClick={onDelete}
          title="Eliminar (desactivar)"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}