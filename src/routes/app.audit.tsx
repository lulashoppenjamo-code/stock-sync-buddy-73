import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, ScanLine, Save, Camera, Search } from "lucide-react";
import { toast } from "sonner";
import { getCollaborator } from "@/lib/session";
import { BarcodeScanner } from "@/components/BarcodeScanner";

export const Route = createFileRoute("/app/audit")({
  component: AuditPage,
});

type Product = {
  barcode: string;
  product_name: string;
  category: string | null;
  stock_a: number;
  stock_b: number;
};

function startOfTodayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function AuditPage() {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [physical, setPhysical] = useState("");
  const [branch, setBranch] = useState<"A" | "B">("A");
  const [current, setCurrent] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const physicalRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scanRef.current?.focus();
  }, []);

  const { data: history } = useQuery({
    queryKey: ["audits"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audits")
        .select("id, barcode, product_name, system_stock, physical_count, difference, collaborator_name, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  // For the current product: all of today's audits to show breakdown + sum.
  const { data: todayForProduct } = useQuery({
    queryKey: ["audits-today-product", current?.barcode],
    enabled: !!current,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audits")
        .select("id, physical_count, collaborator_name, branch, created_at")
        .eq("barcode", current!.barcode)
        .gte("created_at", startOfTodayIso())
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Array<{ id: string; physical_count: number; collaborator_name: string | null; branch: "A" | "B" | null; created_at: string }>;
    },
  });

  async function lookup(barcode: string) {
    const { data, error } = await supabase
      .from("products")
      .select("barcode, product_name, category, stock_a, stock_b")
      .eq("barcode", barcode)
      .maybeSingle();
    if (error) {
      toast.error(error.message);
      return null;
    }
    if (!data) {
      toast.error(`Producto no encontrado: ${barcode}`);
      return null;
    }
    return data as Product;
  }

  async function handleScan(e: React.FormEvent) {
    e.preventDefault();
    const c = code.trim();
    if (!c) return;
    setBusy(true);
    const p = await lookup(c);
    setBusy(false);
    if (p) {
      setCurrent(p);
      setPhysical("");
      setTimeout(() => physicalRef.current?.focus(), 10);
    } else {
      setCode("");
      scanRef.current?.focus();
    }
  }

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (!current) return;
    const phys = Number(physical);
    if (!Number.isFinite(phys)) {
      toast.error("Conteo físico inválido");
      return;
    }
    const totalStock = Number(current.stock_a) + Number(current.stock_b);
    const sumToday = (todayForProduct ?? []).reduce((s, r) => s + Number(r.physical_count), 0);
    const diff = sumToday + phys - totalStock;
    const collab = getCollaborator();
    if (!collab) {
      toast.error("Sesión expirada — iniciá sesión otra vez");
      return;
    }
    const payload = {
      branch: branch as "A" | "B",
      barcode: current.barcode,

      product_name: current.product_name,
      system_stock: totalStock,
      physical_count: phys,
      difference: diff,
      collaborator_id: collab.id,
      collaborator_name: collab.name,
      client_uid: `audit-${crypto.randomUUID()}`,
    };
    setBusy(true);
    try {
      const { error } = await supabase.from("audits").insert(payload);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["audits"] });
      qc.invalidateQueries({ queryKey: ["audits-today-product", current.barcode] });
      const finalSum = sumToday + phys;
      const sign = diff > 0 ? "+" : "";
      toast.success(
        `Guardado. Suma de hoy: ${finalSum} vs sistema: ${totalStock} (${sign}${diff})`,
      );
      setCurrent(null);
      setCode("");
      setPhysical("");
      scanRef.current?.focus();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const totalStock = current ? Number(current.stock_a) + Number(current.stock_b) : 0;
  const sumToday = (todayForProduct ?? []).reduce((s, r) => s + Number(r.physical_count), 0);
  const sumMina = (todayForProduct ?? []).filter((r) => r.branch === "A").reduce((s, r) => s + Number(r.physical_count), 0);
  const sumMorelos = (todayForProduct ?? []).filter((r) => r.branch === "B").reduce((s, r) => s + Number(r.physical_count), 0);
  const previewSum = current && physical !== "" ? sumToday + Number(physical) : sumToday;
  const previewMina = branch === "A" && physical !== "" ? sumMina + Number(physical) : sumMina;
  const previewMorelos = branch === "B" && physical !== "" ? sumMorelos + Number(physical) : sumMorelos;
  const previewDiff = current ? previewSum - totalStock : 0;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Auditoría</h1>
      <p className="text-xs text-muted-foreground">
        Conteo único: cada colaboradora pistolea lo que ve. La suma de todos los conteos del día se compara con el stock total en Productos.
      </p>

      <Card>
        <CardContent className="space-y-4 p-4">
          <form onSubmit={handleScan}>
            <label className="text-xs font-medium text-muted-foreground">Escanear código (Enter)</label>
            <div className="relative mt-1 flex gap-2">
              <div className="relative flex-1">
                <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={scanRef}
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Pistola, cámara o tipear…"
                  className="pl-9 font-mono text-base"
                  inputMode="numeric"
                />
              </div>
              <Button
                type="button"
                variant="default"
                onClick={() => setScannerOpen(true)}
                aria-label="Escanear con cámara"
                className="shrink-0"
              >
                <Camera className="h-4 w-4" /> Cámara
              </Button>
            </div>
          </form>

          <ProductNameSearch
            onPick={async (barcode) => {
              setCode(barcode);
              setBusy(true);
              const p = await lookup(barcode);
              setBusy(false);
              if (p) {
                setCurrent(p);
                setPhysical("");
                setTimeout(() => physicalRef.current?.focus(), 10);
              }
            }}
          />

          <CategoryAudit
            onPick={async (barcode) => {
              setCode(barcode);
              setBusy(true);
              const p = await lookup(barcode);
              setBusy(false);
              if (p) {
                setCurrent(p);
                setPhysical("");
                setTimeout(() => physicalRef.current?.focus(), 10);
              }
            }}
          />

          {current && (
            <form onSubmit={save} className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <div>
                <div className="text-xs text-muted-foreground">Producto</div>
                <div className="font-medium">{current.product_name}</div>
                <div className="font-mono text-xs text-muted-foreground">{current.barcode}</div>
              </div>

              <div>
                <div className="mb-1 text-xs text-muted-foreground">Sucursal donde estás contando</div>
                <div className="inline-flex overflow-hidden rounded-md border">
                  <button
                    type="button"
                    onClick={() => setBranch("A")}
                    className={`px-3 py-1.5 text-sm font-medium ${branch === "A" ? "bg-primary text-primary-foreground" : "bg-background"}`}
                  >
                    Mina
                  </button>
                  <button
                    type="button"
                    onClick={() => setBranch("B")}
                    className={`px-3 py-1.5 text-sm font-medium ${branch === "B" ? "bg-primary text-primary-foreground" : "bg-background"}`}
                  >
                    Morelos
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-muted-foreground">Stock total sistema</div>
                  <div className="text-xl font-semibold tabular-nums">{totalStock}</div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Tu conteo</label>
                  <Input
                    ref={physicalRef}
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={physical}
                    onChange={(e) => setPhysical(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") save();
                    }}
                    placeholder="0"
                    className="text-lg"
                  />
                </div>
              </div>

              {/* Per-branch sums */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-md border bg-card p-2">
                  <div className="text-xs text-muted-foreground">Suma Mina</div>
                  <div className="text-lg font-semibold tabular-nums">{previewMina}</div>
                </div>
                <div className="rounded-md border bg-card p-2">
                  <div className="text-xs text-muted-foreground">Suma Morelos</div>
                  <div className="text-lg font-semibold tabular-nums">{previewMorelos}</div>
                </div>
              </div>

              {/* Today's breakdown by collaborator */}
              {(todayForProduct ?? []).length > 0 && (
                <div className="rounded-md border bg-card p-2">
                  <div className="mb-1 text-xs font-medium">Conteos de hoy</div>
                  <ul className="divide-y text-xs">
                    {(todayForProduct ?? []).map((r) => (
                      <li key={r.id} className="flex items-center justify-between py-1">
                        <span className="truncate">
                          {r.collaborator_name ?? "Anónimo"}{" "}
                          <span className="text-muted-foreground">
                            · {r.branch === "A" ? "Mina" : r.branch === "B" ? "Morelos" : "—"}
                          </span>
                        </span>
                        <span className="tabular-nums">{r.physical_count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="rounded-md border bg-card p-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Suma hoy {physical !== "" ? "(incluye tu conteo)" : ""}</span>
                  <span className="font-semibold tabular-nums">{previewSum}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Sistema</span>
                  <span className="font-semibold tabular-nums">{totalStock}</span>
                </div>
                <div className="mt-1 flex items-center justify-between border-t pt-1">
                  <span className="text-muted-foreground">Diferencia</span>
                  <span
                    className={
                      "font-semibold tabular-nums " +
                      (previewDiff === 0
                        ? ""
                        : previewDiff > 0
                          ? "text-emerald-600"
                          : "text-red-600")
                    }
                  >
                    {previewDiff > 0 ? "+" : ""}
                    {previewDiff}
                  </span>
                </div>
              </div>

              <div className="flex gap-2">
                <Button type="submit" disabled={busy || physical === ""}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar conteo
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setCurrent(null);
                    setCode("");
                    setPhysical("");
                    scanRef.current?.focus();
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <h2 className="text-sm font-semibold tracking-tight">Historial reciente</h2>
      <Card>
        <CardContent className="p-0">
          <div className="max-h-[50vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Colaboradora</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Sistema</TableHead>
                  <TableHead className="text-right">Conteo</TableHead>
                  <TableHead className="text-right">Dif. acumulada</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(history ?? []).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {new Date(a.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-xs">{a.collaborator_name ?? "—"}</TableCell>
                    <TableCell>
                      <div>{a.product_name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{a.barcode}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{a.system_stock}</TableCell>
                    <TableCell className="text-right tabular-nums">{a.physical_count}</TableCell>
                    <TableCell
                      className={`text-right tabular-nums font-medium ${
                        a.difference === 0 ? "" : a.difference > 0 ? "text-emerald-600" : "text-red-600"
                      }`}
                    >
                      {a.difference > 0 ? "+" : ""}
                      {a.difference}
                    </TableCell>
                  </TableRow>
                ))}
                {(history ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      Sin auditorías aún
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={async (c) => {
          setCode(c);
          setBusy(true);
          const p = await lookup(c);
          setBusy(false);
          if (p) {
            setCurrent(p);
            setPhysical("");
            setTimeout(() => physicalRef.current?.focus(), 10);
          }
        }}
      />
    </div>
  );
}

function ProductNameSearch({ onPick }: { onPick: (barcode: string) => void }) {
  const [q, setQ] = useState("");
  const { data, isFetching } = useQuery({
    queryKey: ["audit-product-search", q],
    queryFn: async () => {
      const term = q.trim();
      if (term.length < 2) return [];
      const { data, error } = await supabase
        .from("products")
        .select("barcode, product_name, uom, stock_a, stock_b")
        .ilike("product_name", `%${term}%`)
        .order("product_name")
        .limit(15);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">Buscar producto por nombre</label>
      <div className="relative mt-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Escribí al menos 2 letras…"
          className="pl-9"
        />
      </div>
      {q.trim().length >= 2 && (
        <div className="mt-2 max-h-60 overflow-auto rounded-md border">
          {isFetching && (
            <div className="p-3 text-center text-xs text-muted-foreground">Buscando…</div>
          )}
          {!isFetching && (data ?? []).length === 0 && (
            <div className="p-3 text-center text-xs text-muted-foreground">Sin resultados</div>
          )}
          {(data ?? []).map((p) => (
            <button
              key={p.barcode}
              type="button"
              onClick={() => { onPick(p.barcode); setQ(""); }}
              className="block w-full border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted"
            >
              <div className="font-medium">{p.product_name}</div>
              <div className="font-mono text-xs text-muted-foreground">
                {p.barcode} · {p.uom ?? "—"} · Total: {Number(p.stock_a) + Number(p.stock_b)}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryAudit({ onPick }: { onPick: (barcode: string) => void }) {
  const [category, setCategory] = useState<string>("");
  const [hideAudited, setHideAudited] = useState(false);

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("category")
        .not("category", "is", null)
        .order("category");
      if (error) throw error;
      const set = new Set<string>();
      for (const r of data ?? []) if (r.category) set.add(r.category);
      return Array.from(set).sort();
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["category-products", category],
    enabled: !!category,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("barcode, product_name, stock_a, stock_b")
        .eq("category", category)
        .order("product_name");
      if (error) throw error;
      return data as Array<{ barcode: string; product_name: string; stock_a: number; stock_b: number }>;
    },
  });

  const { data: auditedToday = new Set<string>() } = useQuery({
    queryKey: ["audited-today-global", category],
    enabled: !!category,
    queryFn: async () => {
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("audits")
        .select("barcode")
        .gte("created_at", since.toISOString());
      if (error) throw error;
      return new Set((data ?? []).map((a) => a.barcode));
    },
  });

  const visible = products.filter((p) => (hideAudited ? !auditedToday.has(p.barcode) : true));
  const done = products.filter((p) => auditedToday.has(p.barcode)).length;

  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Auditar por categoría</span>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">Elegir categoría…</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {category && (
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input type="checkbox" checked={hideAudited} onChange={(e) => setHideAudited(e.target.checked)} />
            Ocultar auditados hoy
          </label>
        )}
        {category && (
          <span className="ml-auto text-xs text-muted-foreground">
            {done}/{products.length} hechos
          </span>
        )}
      </div>
      {category && (
        <div className="max-h-72 overflow-auto rounded-md border">
          {visible.length === 0 ? (
            <div className="p-3 text-center text-xs text-muted-foreground">
              {products.length === 0 ? "Sin productos en esta categoría" : "Todos auditados hoy ✓"}
            </div>
          ) : (
            visible.map((p) => {
              const total = Number(p.stock_a) + Number(p.stock_b);
              const isDone = auditedToday.has(p.barcode);
              return (
                <button
                  key={p.barcode}
                  type="button"
                  onClick={() => onPick(p.barcode)}
                  className={
                    "flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0 " +
                    (isDone
                      ? "bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/40"
                      : "hover:bg-muted")
                  }
                >
                  <span className="min-w-0 truncate">
                    {isDone && <span className="mr-1 text-emerald-600">✓</span>}
                    <span className="font-medium">{p.product_name}</span>{" "}
                    <span className="font-mono text-xs text-muted-foreground">{p.barcode}</span>
                    {isDone && (
                      <span className="ml-1 text-xs text-emerald-700 dark:text-emerald-400">· tocá para corregir</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    Total: {total}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
