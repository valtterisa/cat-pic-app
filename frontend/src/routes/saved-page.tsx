import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/state/use-auth";
import { apiCall, queryKeys } from "@/lib/api";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Heart, Bookmark } from "lucide-react";
import type { FeedQuote } from "./feed-page";

export const SavedPage = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.dashboard.saved(),
    queryFn: () => apiCall<{ items: FeedQuote[] }>("/api/v1/dashboard/saved"),
    enabled: !!user,
  });

  const likeMutation = useMutation({
    mutationFn: ({
      quoteId,
      action,
    }: {
      quoteId: string;
      action: "like" | "unlike";
    }) =>
      action === "like"
        ? apiCall(`/api/v1/feed/likes/${quoteId}`, { method: "POST" })
        : apiCall(`/api/v1/feed/likes/${quoteId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.saved() });
    },
  });

  const saveMutation = useMutation({
    mutationFn: ({
      quoteId,
      action,
    }: {
      quoteId: string;
      action: "save" | "unsave";
    }) =>
      action === "save"
        ? apiCall(`/api/v1/feed/saved/${quoteId}`, { method: "POST" })
        : apiCall(`/api/v1/feed/saved/${quoteId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.saved() });
    },
  });

  const quotes = data?.items ?? [];

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-muted-foreground text-sm">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Error: {error?.message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <h1 className="text-2xl font-semibold">Saved Quotes</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Quotes you've saved for later
          </p>
        </CardContent>
      </Card>

      {quotes.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <p className="text-center text-muted-foreground">
              You haven't saved any quotes yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {quotes.map((q) => (
            <Card key={q.id} className="overflow-hidden">
              <CardContent className="pt-6 pb-2">
                <p
                  className="text-lg leading-relaxed"
                  style={{ minHeight: "44px" }}
                >
                  {q.text}
                </p>
                {q.author && (
                  <p className="text-sm text-muted-foreground mt-2">
                    — {q.author}
                  </p>
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
          ))}
        </div>
      )}
    </div>
  );
};
