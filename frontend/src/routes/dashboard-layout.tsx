import { useState } from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/state/use-auth";
import { apiCall } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";

export const DashboardLayout = () => {
  const { user, clearAuth } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await apiCall("/auth/logout", { method: "POST" });
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      clearAuth();
      navigate("/");
    }
  };

  const nav = (
    <>
      <Button variant="ghost" asChild className="justify-start min-h-[44px]">
        <Link to="/dashboard" onClick={() => setSidebarOpen(false)}>Overview</Link>
      </Button>
      <Button variant="ghost" asChild className="justify-start min-h-[44px]">
        <Link to="/" onClick={() => setSidebarOpen(false)}>Feed</Link>
      </Button>
      <Button variant="ghost" asChild className="justify-start min-h-[44px]">
        <Link to="/dashboard/quotes" onClick={() => setSidebarOpen(false)}>Quotes</Link>
      </Button>
      <Button variant="ghost" asChild className="justify-start min-h-[44px]">
        <Link to="/dashboard/liked" onClick={() => setSidebarOpen(false)}>Liked</Link>
      </Button>
      <Button variant="ghost" asChild className="justify-start min-h-[44px]">
        <Link to="/dashboard/saved" onClick={() => setSidebarOpen(false)}>Saved</Link>
      </Button>
      <Button variant="ghost" asChild className="justify-start min-h-[44px]">
        <Link to="/dashboard/api-keys" onClick={() => setSidebarOpen(false)}>API keys</Link>
      </Button>
      <Button variant="ghost" asChild className="justify-start min-h-[44px]">
        <Link to="/dashboard/docs" onClick={() => setSidebarOpen(false)}>API docs</Link>
      </Button>
    </>
  );

  return (
    <div className="min-h-svh flex">
      <aside className="hidden md:flex w-56 border-r bg-muted/30 flex-col p-4 gap-4 shrink-0">
        <h2 className="font-semibold text-lg">Dashboard</h2>
        {user && (
          <p className="text-sm text-muted-foreground truncate">{user.email}</p>
        )}
        <nav className="flex flex-col gap-1 flex-1">{nav}</nav>
        <Button variant="outline" onClick={handleLogout}>
          Logout
        </Button>
      </aside>
      {sidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-64 border-r bg-background flex flex-col p-4 gap-4 md:hidden">
            <h2 className="font-semibold text-lg">Dashboard</h2>
            {user && (
              <p className="text-sm text-muted-foreground truncate">{user.email}</p>
            )}
            <nav className="flex flex-col gap-1 flex-1">{nav}</nav>
            <Button variant="outline" onClick={handleLogout}>
              Logout
            </Button>
          </aside>
        </>
      )}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden flex items-center gap-2 p-2 border-b bg-background shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="min-h-[44px] min-w-[44px]"
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </Button>
        </header>
        <main className="flex-1 p-4 md:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
