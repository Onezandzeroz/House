"use client";

import * as React from "react";
import { SessionProvider } from "next-auth/react";

/**
 * NextAuth SessionProvider wrapper (Task 42-45).
 *
 * `SessionProvider` is a Client Component — it reads the JWT cookie via
 * `useEffect` + `fetch`, which is not allowed in a Server Component. The
 * root layout (`src/app/layout.tsx`) must stay a Server Component (it
 * owns fonts and metadata which are Server-only), so we wrap
 * `SessionProvider` in this small Client Component and import THAT from
 * the layout instead.
 *
 * Children pass through unchanged — the layout still owns the page tree,
 * this just adds the React Context that `useSession()` reads from.
 */

export interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return <SessionProvider>{children}</SessionProvider>;
}
