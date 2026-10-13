/**
 * Auth helpers for BFF routes (Task 42-45).
 *
 * Two helpers:
 *   - `getAuthUserId()` — returns the authenticated User.id from the
 *     NextAuth session, or `null` if the request is unauthenticated.
 *     Wraps `getServerSession(authOptions)` and reads the augmented
 *     `session.user.id` (see src/types/next-auth.d.ts).
 *   - `requireAuth()` — the same lookup but returns a discriminated
 *     union so the calling route can `if (!auth.ok) return auth.response`
 *     and then use `auth.userId` as a typed string on the happy path.
 *
 * Use this from every BFF route that touches trust data:
 *
 * ```ts
 * export async function GET() {
 *   const auth = await requireAuth();
 *   if (!auth.ok) return auth.response;
 *   const service = createTrustService();
 *   const r = await service.getCurrentTrust(auth.userId);
 *   ...
 * }
 * ```
 *
 * Multi-tenant isolation depends on this — `auth.userId` is the only
 * tenant key the service layer is allowed to use. Never trust a
 * `userId` or `trustId` from the request body without first resolving
 * it through `auth.userId`.
 */

import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";

/**
 * Get the authenticated user's id from the NextAuth session.
 *
 * @returns The User.id (cuid string) if the request is authenticated,
 *          otherwise `null`. Does not throw on unauthenticated — the
 *          caller decides whether 401 or empty response is appropriate.
 */
export async function getAuthUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.id ?? null;
}

/**
 * Discriminated-union return type for `requireAuth`. The happy path is
 * `{ ok: true; userId: string }`; the unauthenticated path is
 * `{ ok: false; response: NextResponse }` so the caller can
 * `return auth.response` directly without constructing the 401.
 */
export type RequireAuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

/**
 * Wrapper for BFF routes that require auth.
 *
 * Usage:
 *   const auth = await requireAuth();
 *   if (!auth.ok) return auth.response;
 *   // auth.userId is `string` from here.
 *
 * @returns `{ ok: true, userId }` on auth success, or
 *          `{ ok: false, response: 401 NextResponse }` on failure.
 */
export async function requireAuth(): Promise<RequireAuthResult> {
  const userId = await getAuthUserId();
  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "unauthorized" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }
  return { ok: true, userId };
}
