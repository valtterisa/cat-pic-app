import { useState, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AuthContext, type User } from "./auth-context";
import { apiCall, queryKeys, setCsrfToken, ApiError } from "@/lib/api";

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);

  const meQuery = useQuery({
    queryKey: queryKeys.auth.me(),
    queryFn: () => apiCall<{ user: User }>("/auth/me"),
    retry: false,
  });

  const csrfQuery = useQuery({
    queryKey: queryKeys.auth.csrfToken(),
    queryFn: () => apiCall<{ token: string }>("/auth/csrf-token"),
    enabled: !!user,
    retry: false,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (meQuery.data) {
      setUser(meQuery.data.user);
      return;
    }

    if (meQuery.isError) {
      const err = meQuery.error as ApiError | Error | null | undefined;
      const status = (err as ApiError | undefined)?.status;
      const code = (err as ApiError | undefined)?.code;
      const message = err?.message;

      const isAuthError =
        status === 401 ||
        code === "missing_token" ||
        code === "invalid_token" ||
        code === "unauthorized" ||
        message === "missing_token" ||
        message === "invalid_token" ||
        message === "unauthorized";

      if (isAuthError) {
        setUser(null);
      }
    }
  }, [meQuery.data, meQuery.isError, meQuery.error]);

  useEffect(() => {
    if (csrfQuery.data?.token) {
      setCsrfToken(csrfQuery.data.token);
    }
  }, [csrfQuery.data]);

  const setAuth = (u: User) => {
    setUser(u);
  };

  const clearAuth = () => {
    setUser(null);
  };

  const isLoading =
    meQuery.isPending || (user != null && csrfQuery.isPending);

  return (
    <AuthContext.Provider value={{ user, setAuth, clearAuth, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};
