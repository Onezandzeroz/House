import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createTrustService,
} from "@/server/services/trust-service";
import { requireAuth } from "@/lib/auth-helpers";

/**
 * /api/trust/snapshots — NAV-historikk BFF (Task 37).
 *
 * `GET /api/trust/snapshots?limit=30` — returnerer BookSnapshot-rader
 * (NAV-historikk for chartet). Respons:
 *   { snapshots: BookSnapshot[] }
 *
 * Sortert nyest først (snapshotAt desc). `limit` er optional (default
 * 30, cap 365).
 *
 * `POST /api/trust/snapshots` — ta et nytt snapshot av nåværende book-
 * tilstand. Ingen body. Beregner NAV + weights + drawdown fra posisjoner
 * og live priser (Task 36 CoinGecko fallback), lagrer som ny BookSnapshot-
 * rad. Returnerer 201 med `{ snapshot: BookSnapshot }`.
 *
 * Hvis trusten ikke har noen trust enda: 404 `{ error: "no-trust" }` så
 * UI-et vet å vise onboarding.
 *
 * `force-dynamic` — snapshots legges til (append-only) så responsen
 * må ikke caches (slik at en GET etter POST alltid viser den nye).
 *
 * Auth (Task 42-45): `requireAuth()` sjekker session. Hvis ikke
 * innlogget → 401. Trust-isolation: `getCurrentTrust(auth.userId)`
 * filtrerer på trusteeId.
 */

export const dynamic = "force-dynamic";

/** Query-param schema. `limit` parses som string fra URL → konverteres. */
const LIMIT_SCHEMA = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v == null ? undefined : Number(v)))
    .pipe(z.number().int().positive().optional()),
});

/**
 * Hjelpefunksjon: sjekk auth + slå opp nåværende trust for DEN innloggede
 * brukeren. Samme som mandate-ruten sin hjelpefunksjon.
 */
async function getTrustIdForUser(): Promise<
  { ok: true; trustId: string } | { ok: false; response: Response }
> {
  const auth = await requireAuth();
  if (!auth.ok) return { ok: false, response: auth.response };

  const service = createTrustService();
  const r = await service.getCurrentTrust(auth.userId);
  if (!r.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: r.error.code, message: r.error.message },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }
  if (!r.value) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "no-trust" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }
  return { ok: true, trustId: r.value.id };
}

/**
 * GET — returner BookSnapshot-rader.
 */
export async function GET(req: Request) {
  try {
    const lookup = await getTrustIdForUser();
    if (!lookup.ok) return lookup.response;

    // Parse ?limit= fra URL. Default 30 hvis ikke oppgitt.
    const url = new URL(req.url);
    const queryParams = { limit: url.searchParams.get("limit") ?? undefined };
    const parsed = LIMIT_SCHEMA.safeParse(queryParams);
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

    const service = createTrustService();
    const r = await service.getSnapshots(lookup.trustId, parsed.data.limit);
    if (!r.ok) {
      return NextResponse.json(
        { error: r.error.code, message: r.error.message },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { snapshots: r.value },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "trust-engine-failure", message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

/**
 * POST — ta et nytt snapshot av nåværende book-tilstand.
 * Ingen body. Beregner NAV + weights + drawdown (se takeSnapshot for
 * detaljer). Returnerer 201 med `{ snapshot: BookSnapshot }`.
 *
 * UI-et kaller denne etter en rebalance eller manuelt når brukeren vil
 * fryse en ny NAV-baselinje for chartet.
 */
export async function POST() {
  try {
    const lookup = await getTrustIdForUser();
    if (!lookup.ok) return lookup.response;

    const service = createTrustService();
    const r = await service.takeSnapshot(lookup.trustId);
    if (!r.ok) {
      return NextResponse.json(
        { error: r.error.code, message: r.error.message },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { snapshot: r.value },
      {
        status: 201,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "trust-engine-failure", message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
