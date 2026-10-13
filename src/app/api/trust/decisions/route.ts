import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createTrustService,
} from "@/server/services/trust-service";
import { requireAuth } from "@/lib/auth-helpers";

/**
 * /api/trust/decisions — decision-log / audit-trail BFF (Task 37).
 *
 * `GET /api/trust/decisions?limit=50` — returnerer DecisionLogEntry-rader
 * (audit trail av accepterte/avviste intents) sammen med tilhørende
 * Intent-data (1:1 per schema). Respons:
 *   { decisions: Array<{ entry: DecisionLogEntry, intent: Intent }> }
 *
 * `limit` er optional (default 50, cap 200). Service-kallet klemmer
 * verdien til [1, 200] så en client som sender `limit=1000000` får 200.
 *
 * Sortering: nyeste først (createdAt desc) — UI-et rendrer en tabell
 * hvor den nyeste beslutningen er øverst.
 *
 * Hvis trusten ikke har noen trust enda: 404 `{ error: "no-trust" }` så
 * UI-et vet å vise onboarding.
 *
 * `force-dynamic` — beslutninger legges til (append-only) så responsen
 * må ikke caches (slik at en GET etter en ny beslutning viser den).
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
 * GET — returner beslutningsloggen med tilhørende intent-data.
 */
export async function GET(req: Request) {
  try {
    const lookup = await getTrustIdForUser();
    if (!lookup.ok) return lookup.response;

    // Parse ?limit= fra URL. Default 50 hvis ikke oppgitt.
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
    const r = await service.getDecisions(lookup.trustId, parsed.data.limit);
    if (!r.ok) {
      return NextResponse.json(
        { error: r.error.code, message: r.error.message },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { decisions: r.value },
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
