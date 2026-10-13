/**
 * POST /api/auth/register — self-signup endpoint (Task 42-45).
 *
 * House is multi-tenant: every User is the trustee of exactly one Trust.
 * Before a new owner can create a trust they need a User row with a
 * bcrypt-hashed password so the CredentialsProvider in `src/lib/auth.ts`
 * can authenticate them.
 *
 * Flow:
 *   1. Validate the JSON body with zod (email format, password ≥ 8 chars,
 *      optional `name` ≥ 1 char). 400 on validation failure.
 *   2. Normalise email to lowercase (matches the lookup in `authorize`).
 *   3. Check whether the email is already registered. 409 if it is —
 *      the AuthModal surfaces "Email already registered — try signing
 *      in instead" on this status.
 *   4. Hash the password with bcrypt 10 rounds. 10 rounds is the bcrypt
 *      default and the cost factor used by the demo seed; 12 would be
 *      safer but slower. 10 keeps the dev sandbox usable on a cold
 *      start while still being a real hash (not plain text).
 *   5. Create the User row. The Prisma schema's `User.email` is
 *      `@unique` so a race between two concurrent registers for the
 *      same email bubbles up as Prisma P2002 → 409.
 *   6. Return `{ id, email, name }` (201). We do NOT auto-login — the
 *      AuthModal calls `signIn("credentials", ...)` immediately after
 *      a successful register so the JWT is set by NextAuth, not by us.
 *
 * `force-dynamic` so the route is never statically optimised — register
 * writes to the DB and must always run on the server.
 *
 * Auth: this route is intentionally public (anyone can register). The
 * trust isolation happens below this layer — every BFF route calls
 * `requireAuth()` to get the userId and only reads/writes that user's
 * trust.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";

import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Zod schema for the register body.
 *
 * `email` — zod's `email()` enforces RFC 5322-ish shape; we additionally
 * lowercase before lookup so "Trustee@House.Local" matches the seeded
 * row.
 *
 * `password` — minimum 8 characters. We do not impose uppercase/lowercase/
 * symbol rules because (a) bcrypt's hash is the real defence and (b) the
 * demo user is `house-demo` (9 chars, all lowercase, no symbols) and we
 * don't want to break that.
 *
 * `name` — optional, but if present must be at least 1 char (whitespace
 * trimmed). Used as the human label on the User row and as the default
 * trust name when the new owner finishes onboarding.
 */
const REGISTER_SCHEMA = z.object({
  email: z.string().min(1, "Email is required").email("Invalid email"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters"),
  name: z
    .string()
    .trim()
    .min(1, "Name must be at least 1 character")
    .optional(),
});

/** bcrypt cost factor — see file-level JSDoc. */
const BCRYPT_ROUNDS = 10;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "invalid-body", message: "Expected JSON body." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    const parsed = REGISTER_SCHEMA.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "invalid-input",
          message: parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const email = parsed.data.email.toLowerCase();
    const name = parsed.data.name ?? null;

    // Pre-check so the common case returns a friendly 409 (with the
    // "Email already registered" message) rather than relying on the
    // Prisma unique-constraint error path. The Prisma P2002 path is
    // still the source of truth under a race.
    const existing = await db.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        {
          error: "email-already-registered",
          message:
            "Email already registered — try signing in instead.",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS);

    const user = await db.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: "owner",
      },
      select: { id: true, email: true, name: true },
    });

    return NextResponse.json(
      { id: user.id, email: user.email, name: user.name },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (err) {
    // Prisma P2002 (unique constraint) — race between the pre-check and
    // the insert. Treat the same as the friendly 409 above.
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Unique constraint")) {
      return NextResponse.json(
        {
          error: "email-already-registered",
          message:
            "Email already registered — try signing in instead.",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { error: "register-failure", message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
