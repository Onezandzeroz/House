/**
 * NextAuth HTTP handler (Task 42-45).
 *
 * This is the only NextAuth route. It mounts the `authOptions` from
 * `src/lib/auth.ts` and serves both GET and POST on the catch-all
 * `/api/auth/*` paths NextAuth uses internally:
 *
 *   GET  /api/auth/csrf        — CSRF token for the signin form.
 *   GET  /api/auth/providers   — JSON list of configured providers.
 *   POST /api/auth/callback/credentials — the actual login attempt.
 *   POST /api/auth/signout     — clears the JWT cookie.
 *   GET  /api/auth/session     — `{ user, expires }` from the JWT.
 *
 * NextAuth v4 expects a single handler exported as `GET` and `POST`;
 * it routes internally based on the path after `/api/auth/`.
 *
 * `force-dynamic` is not set here because NextAuth's own caching
 * semantics already prevent static optimisation (the route reads
 * cookies). Setting it would be redundant.
 */

import NextAuth from "next-auth";

import { authOptions } from "@/lib/auth";

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
