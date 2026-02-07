import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/state/use-auth";
import { apiCall, queryKeys } from "@/lib/api";
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

interface Quote {
  id: string;
  text: string;
  author?: string;
  createdAt: string;
}

export const QuotesPage = () => {
  const { token } = useAuth();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [...queryKeys.dashboard.quotes(), token ?? ""],
    queryFn: () =>
      apiCall<{ items: Quote[] }>("/dashboard/quotes", { token: token ?? undefined }),
    enabled: !!token,
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
    <Card>
      <CardHeader>
        <CardTitle>Your Quotes</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Text</TableHead>
              <TableHead>Author</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotes.map((q) => (
              <TableRow key={q.id}>
                <TableCell>{q.text}</TableCell>
                <TableCell>{q.author || "—"}</TableCell>
                <TableCell>{new Date(q.createdAt).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};
