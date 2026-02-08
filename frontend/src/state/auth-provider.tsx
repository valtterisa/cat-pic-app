import { useState, useEffect, type ReactNode } from "react";
import { AuthContext, type User } from "./auth-context";
import { apiCall } from "@/lib/api";

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const data = await apiCall<{ user: User }>("/auth/me");
        setUser(data.user);
      } catch {
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchUser();
  }, []);

  const setAuth = (u: User) => {
    setUser(u);
  };

  const clearAuth = () => {
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, setAuth, clearAuth, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};
