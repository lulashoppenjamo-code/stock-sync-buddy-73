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

type Row = { id: string; name: string; is_admin: boolean; active: boolean };

function AdminPage() {
  const me = useCollaborator();
  const navigate = useNavigate();
  const [adminPin, setAdminPin] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!me?.is_admin) navigate({ to: "/app" });
  }, [me, navigate]);

  async function refresh() {
    const { data } = await supabase
      .from("collaborator_directory")
      .select("id, name, is_admin, active")
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
      toast.success("Colaborador creado");
      setName("");
      setPin("");
      setIsAdmin(false);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function update(target: Row, patch: { is_admin?: boolean; active?: boolean; pin?: string; name?: string }) {
    if (!me) return;
    if (adminPin.length < 4) return toast.error("Ingresá tu PIN de admin arriba");
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
              <Switch checked={isAdmin} onCheckedChange={setIsAdmin} id="adm" />
              <Label htmlFor="adm">Admin</Label>
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
                <TableHead>Admin</TableHead>
                <TableHead>Activo</TableHead>
                <TableHead>Reset PIN</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <RowEditor key={r.id} row={r} disabled={busy} onUpdate={(p) => update(r, p)} />
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
}: {
  row: Row;
  disabled: boolean;
  onUpdate: (patch: { is_admin?: boolean; active?: boolean; pin?: string }) => void;
}) {
  const [newPin, setNewPin] = useState("");
  return (
    <TableRow>
      <TableCell className="font-medium">{row.name}</TableCell>
      <TableCell>
        <Switch checked={row.is_admin} disabled={disabled} onCheckedChange={(v) => onUpdate({ is_admin: v })} />
      </TableCell>
      <TableCell>
        <Switch checked={row.active} disabled={disabled} onCheckedChange={(v) => onUpdate({ active: v })} />
      </TableCell>
      <TableCell>
        <div className="flex gap-2">
          <Input
            type="password"
            inputMode="numeric"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
            placeholder="Nuevo PIN"
            className="w-32"
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
            Cambiar
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
