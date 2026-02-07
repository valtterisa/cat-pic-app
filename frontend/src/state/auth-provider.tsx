import { useState, type ReactNode } from "react";
import { AuthContext } from "./auth-context";

interface User {
  id: string;
  email: string;
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem("auth");
    return stored ? JSON.parse(stored).user : null;
  });
  const [token, setToken] = useState<string | null>(() => {
    const stored = localStorage.getItem("auth");
    return stored ? JSON.parse(stored).token : null;
  });

  const setAuth = (u: User, t: string) => {
    setUser(u);
    setToken(t);
    localStorage.setItem("auth", JSON.stringify({ user: u, token: t }));
  };

  const clearAuth = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem("auth");
  };

  return (
    <AuthContext.Provider value={{ user, token, setAuth, clearAuth }}>
      {children}
    </AuthContext.Provider>
  );
};
