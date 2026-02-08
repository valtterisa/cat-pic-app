import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/state/use-auth";
import { apiCall, queryKeys } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface ApiKey {
  id: string;
  label: string;
  createdAt: string;
  revokedAt?: string;
}

export const ApiKeysPage = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [newLabel, setNewLabel] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.dashboard.apiKeys(),
    queryFn: () =>
      apiCall<{ keys: ApiKey[] }>("/dashboard/api-keys"),
    enabled: !!user,
  });

  const createKey = useMutation({
    mutationFn: (label: string) =>
      apiCall<{ key: { id: string; label: string; createdAt: string }; token: string }>("/dashboard/api-keys", {
        method: "POST",
        body: JSON.stringify({ label }),
      }),
    onSuccess: (data) => {
      setCreatedKey(data.token);
      setNewLabel("");
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.apiKeys() });
    },
  });

  const revokeKey = useMutation({
    mutationFn: (id: string) =>
      apiCall(`/dashboard/api-keys/${id}/revoke`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.apiKeys() });
    },
  });

  const keys = data?.keys ?? [];

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newLabel) return;
    createKey.mutate(newLabel);
  };

  const handleRevoke = (id: string) => {
    if (!user) return;
    revokeKey.mutate(id);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-muted-foreground text-sm">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>API Keys</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {createdKey && (
            <Alert>
              <AlertDescription className="flex flex-wrap items-center gap-2">
                <span>Your new API key:</span>
                <code className="rounded bg-muted px-2 py-1 text-xs font-mono break-all">
                  {createdKey}
                </code>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => navigator.clipboard.writeText(createdKey)}
                  >
                    Copy
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setCreatedKey(null)}>
                    Close
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}
          <form onSubmit={handleCreate} className="flex gap-2 items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="api-key-label">Label</Label>
              <Input
                id="api-key-label"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. Production"
              />
            </div>
            <Button type="submit">Create API Key</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Your keys</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell>{k.label}</TableCell>
                  <TableCell>{new Date(k.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>{k.revokedAt ? "Revoked" : "Active"}</TableCell>
                  <TableCell>
                    {!k.revokedAt && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleRevoke(k.id)}
                      >
                        Revoke
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};
