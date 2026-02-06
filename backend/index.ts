import express from "express";
import type { Request, Response } from "express";

const app = express();
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true });
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, "0.0.0.0", () => {
    console.log(`backend listening on http://localhost:${port}`);
});
