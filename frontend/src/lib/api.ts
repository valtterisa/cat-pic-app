const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:3001").replace(/\/$/, "");

let csrfToken: string | null = null;

export const getCsrfToken = async (): Promise<string | null> => {
  if (csrfToken) return csrfToken;
  try {
    const data = await apiCall<{ token: string }>("/auth/csrf-token");
    csrfToken = data.token;
    return csrfToken;
  } catch {
    return null;
  }
};

export const apiCall = async <T = unknown>(
  path: string,
  options?: RequestInit & { token?: string; _isRetry?: boolean },
): Promise<T> => {
  const { token, _isRetry, ...rest } = options || {};
  const method = rest.method?.toUpperCase() || "GET";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(rest.headers as Record<string, string>),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  
  const isPublicEndpoint = path === "/auth/login" || path === "/auth/signup";
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && !isPublicEndpoint) {
    const csrf = await getCsrfToken();
    if (csrf) {
      headers["X-CSRF-Token"] = csrf;
    }
  }
  
  const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...rest,
    headers,
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "unknown_error" }));
    
    if (res.status === 403 && err.error === "invalid_csrf_token" && !_isRetry) {
      csrfToken = null;
      return apiCall<T>(path, { ...options, _isRetry: true });
    }
    
    throw new Error(err.error || "request_failed");
  }
  
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return null as T;
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
