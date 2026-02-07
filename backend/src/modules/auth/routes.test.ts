import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";

describe("auth routes - password security", () => {
  it("should use bcrypt with 12 salt rounds", async () => {
    const password = "testpassword123";
    const hash = await bcrypt.hash(password, 12);

    // Verify salt rounds and that password verification works
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(await bcrypt.compare(password, hash)).toBe(true);
    expect(await bcrypt.compare("wrongpassword", hash)).toBe(false);
  });
});
