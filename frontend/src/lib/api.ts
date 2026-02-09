const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:3001").replace(/\/$/, "");

export const apiCall = async <T = unknown>(
  path: string,
  options?: RequestInit & { token?: string },
): Promise<T> => {
  const { token, ...rest } = options || {};
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(rest.headers as Record<string, string>),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...rest,
    headers,
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "unknown_error" }));
    throw new Error(err.error || "request_failed");
  }
  return res.json() as Promise<T>;
};

export const queryKeys = {
  dashboard: {
    quotes: () => ["dashboard", "quotes"] as const,
    apiKeys: () => ["dashboard", "api-keys"] as const,
    liked: () => ["dashboard", "liked"] as const,
    saved: () => ["dashboard", "saved"] as const,
  },
  feed: (sort?: string) => ["feed", sort ?? "newest"] as const,
} as const;
