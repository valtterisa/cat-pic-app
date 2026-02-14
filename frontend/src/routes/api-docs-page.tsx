import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { API_BASE } from "@/lib/api";
import { ExternalLink } from "lucide-react";

export const ApiDocsPage = () => {
  const apiKey = "your-api-key-here";
  const swaggerUrl = `${API_BASE}/docs`;

  return (
    <div className="space-y-6 max-w-3xl">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>API Documentation</CardTitle>
          <Button variant="outline" size="sm" asChild>
            <a href={swaggerUrl} target="_blank" rel="noopener noreferrer">
              Open Swagger UI <ExternalLink className="ml-1 size-3.5" />
            </a>
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          <section>
            <h2 className="font-semibold text-lg mb-2">Authentication</h2>
            <p className="text-muted-foreground text-sm mb-2">
              Use your API key in the <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">x-api-key</code> header:
            </p>
            <pre className="rounded-lg border bg-muted/50 p-4 text-sm overflow-x-auto">
              <code>{`curl -H "x-api-key: ${apiKey}" \\
  https://api.mydomain/api/v1/quotes/random`}</code>
            </pre>
            <p className="text-muted-foreground text-sm mt-2">
              Public quote endpoints use the API key; feed and dashboard use cookie auth on the same base path.
            </p>
          </section>
          <section>
            <h2 className="font-semibold text-lg mb-2">Public (API key)</h2>
            <h3 className="font-medium mt-3 mb-1">GET /api/v1/quotes/random</h3>
            <p className="text-muted-foreground text-sm mb-2">Get a random quote.</p>
            <pre className="rounded-lg border bg-muted/50 p-4 text-sm overflow-x-auto mb-4">
              <code>{`curl -H "x-api-key: ${apiKey}" \\
  https://api.mydomain/api/v1/quotes/random`}</code>
            </pre>
            <h3 className="font-medium mt-3 mb-1">GET /api/v1/quotes</h3>
            <p className="text-muted-foreground text-sm mb-2">List quotes with optional author filter and cursor-based pagination.</p>
            <pre className="rounded-lg border bg-muted/50 p-4 text-sm overflow-x-auto">
              <code>{`curl -H "x-api-key: ${apiKey}" \\
  "https://api.mydomain/api/v1/quotes?limit=20&cursor=..."`}</code>
            </pre>
          </section>
          <section>
            <h2 className="font-semibold text-lg mb-2">Error Responses</h2>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
              <li><code className="rounded bg-muted px-1 font-mono">401</code> — Missing or invalid API key</li>
              <li><code className="rounded bg-muted px-1 font-mono">429</code> — Rate limit exceeded</li>
              <li><code className="rounded bg-muted px-1 font-mono">404</code> — Resource not found</li>
            </ul>
          </section>
        </CardContent>
      </Card>
    </div>
  );
};
