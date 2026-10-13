/**
 * House — NextAuth options (Task 42-45).
 *
 * House is multi-tenant: every User owns exactly one Trust (the fond
 * container) and that Trust owns the Book, Positions, Mandate, EthicsList,
 * DecisionLog, and Snapshots. Authentication is therefore the boundary
 * that isolates one family's reserve from another's.
 *
 * Strategy: JWT sessions (not database sessions). v1 has no refresh-token
 * or single-sign-out story; the JWT is signed with NEXTAUTH_SECRET and
 * carries `id` (the User.id) plus `email` plus `name`. The session callback
 * copies `id` onto `session.user.id` so server code can read it via
 * `getServerSession(authOptions)` and BFF routes can use it as the
 * tenant-key for every trust lookup.
 *
 * Providers (v1):
 *   - CredentialsProvider — email + bcrypt-hashed password lookup against
 *     the `User` table. The User row is created either by `prisma/seed.ts`
 *     (the demo trustee `trustee@house.local` with password `house-demo`)
 *     or by `POST /api/auth/register` (a self-signup endpoint that hashes
 *     the password with bcrypt 10 rounds before writing the row).
 *
 * OAuth providers (Google, GitHub) are deliberately out-of-scope for v1.
 *
 * Pages:
 *   - `signIn: "/"` — login is rendered as a modal on the only route
 *     (src/app/page.tsx). There is no separate `/login` page; the modal
 *     (AuthModal) mounts when `useSession()` reports `unauthenticated`.
 *
 * The config is consumed in two places:
 *   1. `src/app/api/auth/[...nextauth]/route.ts` — the NextAuth HTTP
 *      handler (GET + POST).
 *   2. `src/lib/auth-helpers.ts` — `requireAuth()` wraps
 *      `getServerSession(authOptions)` and returns the userId (or a 401
 *      NextResponse) so every BFF route can gate behind one line.
 *
 * @see https://next-auth.js.org/configuration/options
 */

import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

import { db } from "@/lib/db";

/**
 * NextAuth options object. Exported as a value (not a function) because
 * NextAuth's initialization is the same for the HTTP handler and the
 * `getServerSession` call site — both import the same `authOptions`.
 */
export const authOptions: NextAuthOptions = {
  // JWT strategy — no database session rows. Easier in v1; the User table
  // already exists, and a JWT keeps the auth state entirely stateless
  // (the Session model in prisma/schema.prisma is reserved for a later
  // database-strategy swap if we need server-side revocation).
  session: { strategy: "jwt" },

  // Login lives on `/` as a modal — there is no dedicated signin route.
  // Setting `signIn: "/"` makes NextAuth bounce unauthenticated users
  // back to the only visible route rather than a 404 GET /api/auth/signin.
  pages: { signIn: "/" },

  providers: [
    CredentialsProvider({
      name: "credentials",
      // The form fields surfaced by the default NextAuth signin page. We
      // do not render that page (AuthModal renders its own form) — but
      // NextAuth requires the `credentials` shape for the authorize()
      // callback's typed argument.
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      /**
       * Authorize callback — the only place where the password is
       * compared. Returns the user object that becomes the JWT payload
       * (after the jwt callback below copies `id`).
       *
       * Failure modes (all return `null` so NextAuth surfaces a generic
       * "CredentialsSignin" error — the AuthModal translates that to
       * "Invalid email or password" so we don't leak which field was
       * wrong):
       *   - Missing email or password.
       *   - No User row with this email.
       *   - User row has no passwordHash (would happen only for OAuth-only
       *     users; we don't have any in v1).
       *   - bcrypt.compare returns false (wrong password).
       *
       * Email is lowercased before lookup so "Trustee@House.Local" and
       * "trustee@house.local" both match the seeded row.
       */
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = credentials.email.toLowerCase();
        const user = await db.user.findUnique({
          where: { email },
        });
        if (!user || !user.passwordHash) return null;

        const valid = await bcrypt.compare(
          credentials.password,
          user.passwordHash,
        );
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
        };
      },
    }),
  ],

  callbacks: {
    /**
     * JWT callback — runs on sign-in and on every session read. The first
     * call has `user` (the value returned from `authorize`); subsequent
     * calls only have `token`. We copy `user.id` onto `token.id` once so
     * the session callback can stamp it onto `session.user.id`.
     */
    jwt: async ({ token, user }) => {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    /**
     * Session callback — runs on every `useSession()` / `getServerSession()`.
     * Copies `token.id` onto `session.user.id` so client + server can both
     * read the userId without an extra DB lookup.
     *
     * The cast through `string` is necessary because the default
     * NextAuth `User` type does not include `id` (only `email`, `name`,
     * `image`) and we extend the session shape by appending `id` here.
     * `src/types/next-auth.d.ts` augments the module so the cast is safe
     * and the field is typed correctly downstream.
     */
    session: async ({ session, token }) => {
      if (token.id && session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
};
