import { Link, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/state/use-auth";
import { Button } from "@/components/ui/button";

export const DashboardLayout = () => {
  const { user, clearAuth } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    clearAuth();
    navigate("/");
  };

  return (
    <div className="min-h-svh flex">
      <aside className="w-56 border-r bg-muted/30 flex flex-col p-4 gap-4">
        <h2 className="font-semibold text-lg">Dashboard</h2>
        {user && (
          <p className="text-sm text-muted-foreground truncate">{user.email}</p>
        )}
        <nav className="flex flex-col gap-1 flex-1">
          <Button variant="ghost" asChild className="justify-start">
            <Link to="/dashboard">Overview</Link>
          </Button>
          <Button variant="ghost" asChild className="justify-start">
            <Link to="/dashboard/quotes">Quotes</Link>
          </Button>
          <Button variant="ghost" asChild className="justify-start">
            <Link to="/dashboard/api-keys">API keys</Link>
          </Button>
          <Button variant="ghost" asChild className="justify-start">
            <Link to="/dashboard/docs">API docs</Link>
          </Button>
        </nav>
        <Button variant="outline" onClick={handleLogout}>
          Logout
        </Button>
      </aside>
      <main className="flex-1 p-6 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
};
