import { Link, useRouter, useLocation } from "@tanstack/react-router";
import { Boxes, ClipboardCheck, ArrowLeftRight, History, Settings, LogOut, WifiOff, CloudUpload, PackageCheck } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useOnline, usePendingCount } from "@/hooks/use-online";
import { useCollaborator, setCollaborator } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

const navItems = [
  { to: "/app", label: "Productos", icon: Boxes, exact: true },
  { to: "/app/audit", label: "Auditoría", icon: ClipboardCheck },
  { to: "/app/transfer", label: "Traspaso", icon: ArrowLeftRight },
  { to: "/app/reception", label: "Recepción", icon: PackageCheck, badge: true as const },
  { to: "/app/history", label: "Historial", icon: History },
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
            <span>Inventario</span>
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
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-1 font-medium text-blue-900 dark:bg-blue-900/40 dark:text-blue-100">
                <CloudUpload className="h-3.5 w-3.5" /> {pending} pendiente{pending === 1 ? "" : "s"}
              </span>
            )}
            {/* Nombre visible en móvil y desktop */}
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary">
              {collab?.name}
              {collab?.is_admin ? " · admin" : ""}
            </span>
            <Button variant="ghost" size="sm" onClick={signOut} aria-label="Salir">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4 pb-24 md:pb-6">{children}</main>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 backdrop-blur md:hidden">
        <ul className="mx-auto flex max-w-6xl">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = item.exact ? loc.pathname === item.to : loc.pathname.startsWith(item.to);
            const showBadge = item.badge && pendingReceptions > 0;
            return (
              <li key={item.to} className="flex-1">
                <Link
                  to={item.to}
                  className={`relative flex flex-col items-center gap-0.5 px-2 py-2 text-[11px] ${
                    active ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  {item.label}
                  {showBadge && (
                    <span className="absolute right-2 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white">
                      {pendingReceptions}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
          {collab?.is_admin ? (
            <li className="flex-1">
              <Link
                to="/app/admin"
                className={`flex flex-col items-center gap-0.5 px-2 py-2 text-[11px] ${
                  loc.pathname.startsWith("/app/admin") ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <Settings className="h-5 w-5" />
                Admin
              </Link>
            </li>
          ) : null}
        </ul>
      </nav>
    </div>
  );
}
