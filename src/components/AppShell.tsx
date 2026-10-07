import { Link, useRouter, useLocation } from "@tanstack/react-router";
import { Boxes, ClipboardCheck, ArrowLeftRight, History, Settings, LogOut, WifiOff, CloudUpload, PackageCheck, ScanBarcode } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useOnline, usePendingCount } from "@/hooks/use-online";
import { useCollaborator, setCollaborator } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

const navItems = [
  { to: "/app", label: "Productos", shortLabel: "Productos", icon: Boxes, exact: true },
  { to: "/app/audit", label: "Auditoría", shortLabel: "Auditoría", icon: ClipboardCheck },
  { to: "/app/transfer", label: "Traspaso", shortLabel: "Traspaso", icon: ArrowLeftRight },
  { to: "/app/reception", label: "Recepción", shortLabel: "Recepción", icon: PackageCheck, badge: true as const },
  { to: "/app/inventory-full", label: "Inventario físico", shortLabel: "Inv. físico", icon: ScanBarcode },
  { to: "/app/history", label: "Historial", shortLabel: "Historial", icon: History },
];

function usePendingTransfersCount() {
  const { data } = useQuery({
    queryKey: ["pending-transfers-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("transfers")
        .select("id", { count: "exact", head: true })
        .is("received_at", null);
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 30_000,
  });
  return data ?? 0;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const collab = useCollaborator();
  const online = useOnline();
  const pending = usePendingCount();
  const pendingReceptions = usePendingTransfersCount();
  const router = useRouter();
  const loc = useLocation();

  const signOut = () => {
    setCollaborator(null);
    router.navigate({ to: "/" });
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/70">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <div className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground">
              <Boxes className="h-4 w-4" />
            </div>
            <div className="flex flex-col leading-none">
              <span>Inventario</span>
              {collab && (
                <span className="text-[11px] font-normal text-muted-foreground">
                  {collab.name}{collab.is_admin ? " · admin" : ""}
                </span>
              )}
            </div>
          </div>
          <nav className="ml-4 hidden gap-1 md:flex">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = item.exact ? loc.pathname === item.to : loc.pathname.startsWith(item.to);
              const showBadge = item.badge && pendingReceptions > 0;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`relative inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
                    active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                  {showBadge && (
                    <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
                      {pendingReceptions}
                    </span>
                  )}
                </Link>
              );
            })}
            {collab?.is_admin ? (
              <Link
                to="/app/admin"
                className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
                  loc.pathname.startsWith("/app/admin") ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60"
                }`}
              >
                <Settings className="h-4 w-4" />
                Admin
              </Link>
            ) : null}
          </nav>
          <div className="ml-auto flex items-center gap-2 text-xs">
            {!online && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                <WifiOff className="h-3.5 w-3.5" /> Sin conexión
              </span>
            )}
            {pending > 0 && (
              <button type="button"
                onClick={async () => {
                  const { toast } = await import("sonner");
                  if (!online) {
                    toast.error("Sin internet — los datos se sincronizarán cuando vuelva la conexión.");
                    return;
                  }
                  const { drainQueue } = await import("@/lib/offline-queue");
                  toast.info("Sincronizando…");
                  const result = await drainQueue();
                  // Forzar refresco del contador (varias veces por si IndexedDB tarda)
                  window.dispatchEvent(new Event("inv:queue-changed"));
                  setTimeout(() => window.dispatchEvent(new Event("inv:queue-changed")), 300);
                  setTimeout(() => window.dispatchEvent(new Event("inv:queue-changed")), 1000);

                  if (result.unreachable) {
                    toast.error("Hay señal pero no se pudo conectar al servidor. Probá de nuevo en unos segundos.");
                    return;
                  }
                  if (result.errors.includes("Sincronización en curso")) {
                    toast.message("Ya hay una sincronización en curso. Esperá unos segundos y tocá de nuevo.");
                    return;
                  }
                  if (result.remaining === 0 && result.failed === 0) {
                    toast.success("Todo sincronizado ✓");
                    return;
                  }
                  if (result.ok > 0) {
                    toast.success(`${result.ok} sincronizado${result.ok === 1 ? "" : "s"} · quedan ${result.remaining}`);
                  }
                  if (result.failed > 0) {
                    const detail = result.errors[0] ? ` (${result.errors[0].slice(0, 80)})` : "";
                    toast.error(`${result.failed} fallaron${detail}. Tocá de nuevo para reintentar.`);
                  }
                  if (result.ok === 0 && result.failed === 0 && result.remaining > 0) {
                    toast.message(`Quedan ${result.remaining} pendientes. Tocá de nuevo para reintentar.`);
                  }
                }}
                className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-1 font-medium text-blue-900 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-100">
                <CloudUpload className="h-3.5 w-3.5" /> {pending} pendiente{pending === 1 ? "" : "s"}
              </button>
            )}

            <Button variant="ghost" size="sm" onClick={signOut} aria-label="Salir">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4 pb-24 md:pb-6">{children}</main>

      {/* Mobile bottom nav — scroll horizontal para que ningún ítem quede oculto */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 backdrop-blur md:hidden">
        <ul className="mx-auto flex max-w-6xl overflow-x-auto scrollbar-none">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = item.exact ? loc.pathname === item.to : loc.pathname.startsWith(item.to);
            const showBadge = item.badge && pendingReceptions > 0;
            return (
              <li key={item.to} className="min-w-[4.25rem] flex-1">
                <Link
                  to={item.to}
                  className={`relative flex flex-col items-center gap-0.5 px-1.5 py-2 text-[10px] leading-tight ${
                    active ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span className="max-w-[4.5rem] truncate text-center">{item.shortLabel}</span>
                  {showBadge && (
                    <span className="absolute right-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white">
                      {pendingReceptions}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
          {collab?.is_admin ? (
            <li className="min-w-[4.25rem] flex-1">
              <Link
                to="/app/admin"
                className={`flex flex-col items-center gap-0.5 px-1.5 py-2 text-[10px] leading-tight ${
                  loc.pathname.startsWith("/app/admin") ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <Settings className="h-5 w-5 shrink-0" />
                <span className="text-center">Admin</span>
              </Link>
            </li>
          ) : null}
        </ul>
      </nav>
    </div>
  );
}
