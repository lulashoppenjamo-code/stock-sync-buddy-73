import { Link, useRouter, useLocation } from "@tanstack/react-router";
import { Boxes, ClipboardCheck, ArrowLeftRight, History, Settings, LogOut, WifiOff, CloudUpload } from "lucide-react";
import { useOnline, usePendingCount } from "@/hooks/use-online";
import { useCollaborator, setCollaborator } from "@/lib/session";
import { Button } from "@/components/ui/button";

const navItems = [
  { to: "/app", label: "Productos", icon: Boxes, exact: true },
  { to: "/app/audit", label: "Auditoría", icon: ClipboardCheck },
  { to: "/app/transfer", label: "Traspaso", icon: ArrowLeftRight },
  { to: "/app/history", label: "Historial", icon: History },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const collab = useCollaborator();
  const online = useOnline();
  const pending = usePendingCount();
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
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
                    active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
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
            <span className="hidden sm:inline text-muted-foreground">
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
            return (
              <li key={item.to} className="flex-1">
                <Link
                  to={item.to}
                  className={`flex flex-col items-center gap-0.5 px-2 py-2 text-[11px] ${
                    active ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  {item.label}
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
