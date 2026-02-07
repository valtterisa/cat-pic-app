import type { Request, Response } from "express";
import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { db } from "../../db/drizzle";
import { users } from "../../db/schema";
import { signAccessToken } from "../../middleware/auth";
import { eq } from "drizzle-orm";

const router = Router();

const authSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

router.post("/signup", async (req: Request, res: Response) => {
  const result = authSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: "invalid_body" });
  }

  const { email, password } = result.data;

  const existing = await db.query.users.findFirst({
    where: (u, { eq: eqOp }) => eqOp(u.email, email),
  });
  if (existing) {
    return res.status(409).json({ error: "email_in_use" });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const [created] = await db
    .insert(users)
    .values({ email, passwordHash })
    .returning();

  const token = signAccessToken({ id: created.id, email: created.email, role: created.role });

  return res.status(201).json({
    user: { id: created.id, email: created.email, role: created.role },
    token,
  });
});

router.post("/login", async (req: Request, res: Response) => {
  const result = authSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: "invalid_body" });
  }

  const { email, password } = result.data;

  const user = await db.query.users.findFirst({
    where: (u, { eq: eqOp }) => eqOp(u.email, email),
  });

  if (!user) {
    return res.status(401).json({ error: "invalid_credentials" });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "invalid_credentials" });
  }

  const token = signAccessToken({ id: user.id, email: user.email, role: user.role });

  return res.json({
    user: { id: user.id, email: user.email, role: user.role },
    token,
  });
});

export const authRouter = router;

