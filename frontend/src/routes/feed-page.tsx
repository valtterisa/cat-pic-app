import { useRef, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/state/use-auth";
import { apiCall, queryKeys } from "@/lib/api";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Heart, Bookmark } from "lucide-react";

export interface FeedQuote {
  id: string;
  text: string;
  author?: string | null;
  createdAt: string;
  likeCount: number;
  liked?: boolean;
  saved?: boolean;
}

type FeedSort = "newest" | "popular";

interface FeedResponse {
  items: FeedQuote[];
  nextCursor?: string | null;
  nextOffset?: number | null;
}

const PAGE_SIZE = 20;

export const FeedPage = () => {
  const { user, clearAuth } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sort, setSort] = useState<FeedSort>("newest");
  const sentinelRef = useRef<HTMLDivElement>(null);

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

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: queryKeys.feed(sort),
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("sort", sort);
      if (sort === "popular") {
        params.set("offset", String(pageParam ?? 0));
      } else if (pageParam) {
        params.set("cursor", pageParam);
      }
      return apiCall<FeedResponse>(`/api/v1/feed?${params.toString()}`);
    },
    initialPageParam: undefined as string | number | undefined,
    getNextPageParam: (lastPage) => {
      if (sort === "popular") return lastPage.nextOffset ?? undefined;
      return lastPage.nextCursor ?? undefined;
    },
  });

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage || isFetchingNextPage) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) fetchNextPage();
      },
      { rootMargin: "200px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const likeMutation = useMutation({
    mutationFn: ({ quoteId, action }: { quoteId: string; action: "like" | "unlike" }) =>
      action === "like"
        ? apiCall(`/api/v1/feed/likes/${quoteId}`, { method: "POST" })
        : apiCall(`/api/v1/feed/likes/${quoteId}`, { method: "DELETE" }),
    onMutate: async ({ quoteId, action }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.feed(sort) });
      const prev = queryClient.getQueryData<{ pages: FeedResponse[] }>(queryKeys.feed(sort));
      queryClient.setQueryData(queryKeys.feed(sort), (old: { pages: FeedResponse[] } | undefined) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.map((q) =>
              q.id === quoteId
                ? {
                    ...q,
                    liked: action === "like",
                    likeCount: q.likeCount + (action === "like" ? 1 : -1),
                  }
                : q
            ),
          })),
        };
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKeys.feed(sort), ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.feed(sort) });
    },
  });

  const saveMutation = useMutation({
    mutationFn: ({ quoteId, action }: { quoteId: string; action: "save" | "unsave" }) =>
      action === "save"
        ? apiCall(`/api/v1/feed/saved/${quoteId}`, { method: "POST" })
        : apiCall(`/api/v1/feed/saved/${quoteId}`, { method: "DELETE" }),
    onMutate: async ({ quoteId, action }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.feed(sort) });
      const prev = queryClient.getQueryData<{ pages: FeedResponse[] }>(queryKeys.feed(sort));
      queryClient.setQueryData(queryKeys.feed(sort), (old: { pages: FeedResponse[] } | undefined) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.map((q) =>
              q.id === quoteId ? { ...q, saved: action === "save" } : q
            ),
          })),
        };
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKeys.feed(sort), ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.feed(sort) });
    },
  });

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  if (isLoading) {
    return (
      <div className="min-h-svh flex flex-col">
        {header}
        <div className="max-w-xl mx-auto w-full px-4 py-4 pb-safe flex-1">
          <div className="flex gap-2 mb-4">
            <div className="h-10 w-20 bg-muted rounded-md animate-pulse" />
            <div className="h-10 w-20 bg-muted rounded-md animate-pulse" />
          </div>
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <Card key={i} className="p-6">
                <div className="h-5 bg-muted rounded animate-pulse mb-2 w-3/4" />
                <div className="h-4 bg-muted rounded animate-pulse w-1/2" />
                <div className="h-4 bg-muted rounded animate-pulse w-1/3 mt-4" />
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-svh flex flex-col">
        {header}
        <div className="max-w-xl mx-auto w-full px-4 py-4">
          <Alert variant="destructive">
            <AlertDescription>{error?.message ?? "Failed to load feed"}</AlertDescription>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => refetch()}
            >
              Retry
            </Button>
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-svh flex flex-col text-base">
      {header}
      <div className="max-w-xl mx-auto w-full px-4 py-4 pb-safe flex-1">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur py-2 -mx-4 px-4 flex gap-2 border-b">
        <Button
          variant={sort === "newest" ? "secondary" : "ghost"}
          size="sm"
          className="min-h-[44px] flex-1"
          onClick={() => setSort("newest")}
        >
          Newest
        </Button>
        <Button
          variant={sort === "popular" ? "secondary" : "ghost"}
          size="sm"
          className="min-h-[44px] flex-1"
          onClick={() => setSort("popular")}
        >
          Popular
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="text-center text-muted-foreground py-12">No quotes yet.</p>
      ) : (
        <ul className="space-y-4 mt-4 list-none p-0">
          {items.map((q) => (
            <li key={q.id}>
              <article>
              <Card className="overflow-hidden">
                <CardContent className="pt-6 pb-2">
                  <p className="text-lg leading-relaxed" style={{ minHeight: "44px" }}>
                    {q.text}
                  </p>
                  {q.author && (
                    <p className="text-sm text-muted-foreground mt-2">— {q.author}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(q.createdAt).toLocaleDateString()}
                  </p>
                </CardContent>
                <CardFooter className="flex gap-2 border-t pt-4 pb-6 px-6">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-[44px] min-w-[44px] gap-1.5"
                    onClick={() =>
                      likeMutation.mutate({
                        quoteId: q.id,
                        action: q.liked ? "unlike" : "like",
                      })
                    }
                    disabled={!user}
                    aria-label={q.liked ? "Unlike quote" : "Like quote"}
                  >
                    <Heart
                      className="size-5"
                      fill={q.liked ? "currentColor" : "none"}
                    />
                    <span>{q.likeCount}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-[44px] min-w-[44px]"
                    onClick={() =>
                      saveMutation.mutate({
                        quoteId: q.id,
                        action: q.saved ? "unsave" : "save",
                      })
                    }
                    disabled={!user}
                    aria-label={q.saved ? "Unsave quote" : "Save quote"}
                  >
                    <Bookmark
                      className="size-5"
                      fill={q.saved ? "currentColor" : "none"}
                    />
                  </Button>
                </CardFooter>
              </Card>
              </article>
            </li>
          ))}
        </ul>
      )}

      <div ref={sentinelRef} className="h-4" aria-hidden />
      {isFetchingNextPage && (
        <div className="flex justify-center py-4">
          <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      </div>
    </div>
  );
};
