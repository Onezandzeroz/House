/**
 * NextAuth module augmentation (Task 42-45).
 *
 * NextAuth's default `User` interface ships with `email`, `name`, and
 * `image` — but House routes user identity by `User.id` (the cuid from
 * prisma/schema.prisma). The `jwt` + `session` callbacks in
 * `src/lib/auth.ts` copy `token.id` onto `session.user.id`; this file
 * augments the upstream types so `session.user.id` is `string` instead
 * of `never`, and the JWT token carries `id` too.
 *
 * Without this, TypeScript flags `session.user.id = token.id as string`
 * in the session callback as an error ("Property 'id' does not exist on
 * type 'User'"). With it, the field is part of the type contract.
 *
 * NB: `noEmit` is on and this is a `.d.ts`, so the file ships type info
 * only — no runtime impact.
 */

import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  /**
   * Augmented User — adds `id` (User.id from the prisma schema) to the
   * default shape so `session.user.id` is type-safe in client + server.
   */
  interface User {
    id: string;
  }

  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  /**
   * Augmented JWT — the `jwt` callback writes `token.id` from
   * `authorize()`'s returned user. Without this augmentation `token.id`
   * is `unknown` and the session callback can't read it safely.
   */
  interface JWT {
    id?: string;
  }
}
