import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createTrustService,
} from "@/server/services/trust-service";
import { requireAuth } from "@/lib/auth-helpers";

/**
 * /api/trust/positions — posisjon-CRUD på nåværende trust (Task 42-45
 * multi-tenant auth).
 *
 * `GET /api/trust/positions` — returner posisjonslisten med per-rad
 * positionId + venue + venueKind + avledet sleeve + estValue (Task 18).
 * Brukes av manage-positions-panelet; /api/portfolio returnerer aggregater
 * uten positionId.
 *
 * `POST /api/trust/positions` — legg til en posisjon på nåværende trust.
 * Body: `{ assetId, quantity, venue, venueKind }`. Returnerer oppdatert
 * PortfolioSnapshot (samma shape som /api/portfolio).
 *
 * `DELETE /api/trust/positions` — fjern en posisjon. Body:
 * `{ positionId }`. Returnerer oppdatert PortfolioSnapshot.
 *
 * Hvis brukeren ikke har en trust, returneres 404 med
 * `{ error: "no-trust" }` så page-byggeren vet å vise onboarding.
 *
 * Auth (Task 42-45): `requireAuth()` sjekker session. Hvis ikke
 * innlogget → 401. Trust-isolation: trusten slås opp via
 * `getCurrentTrust(auth.userId)` som filtrerer på trusteeId — en annen
 * brukers trust returneres aldri.
 *
 * `force-dynamic` — posisjoner muteres; responsen må ikke caches.
 */

export const dynamic = "force-dynamic";

const ADD_POSITION_SCHEMA = z.object({
  assetId: z.string().min(1),
  quantity: z.string().min(1),
  venue: z.string().min(1),
  venueKind: z.enum([
    "cex",
    "evm-wallet",
    "solana-wallet",
    "stake-defi",
    "xrp-wallet",
    "dex",
  ]),
  entryPrice: z.string().optional(),
});

const REMOVE_POSITION_SCHEMA = z.object({
  positionId: z.string().min(1),
});

/**
 * Hjelpefunksjon: sjekk auth + slå opp nåværende trust for DEN innloggede
 * brukeren. Returnerer enten trustId (som service-metodene tar) eller en
 * ferdig 401/404/500-NextResponse som ruten returnerer direkte.
 *
 * Bruker `requireAuth()` for auth-sjekk + `getCurrentTrust(userId)` for
 * trust-oppslag. Service-metoder tar trustId (ikke userId) fordi de
 * opererer på trust-nivå; userId-isolation skjer her.
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

export async function GET() {
  try {
    const lookup = await getTrustIdForUser();
    if (!lookup.ok) return lookup.response;

    const service = createTrustService();
    const r = await service.getPositions(lookup.trustId);
    if (!r.ok) {
      return NextResponse.json(
        { error: r.error.code, message: r.error.message },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(r.value, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "trust-engine-failure", message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(req: Request) {
  try {
    const lookup = await getTrustIdForUser();
    if (!lookup.ok) return lookup.response;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "invalid-body", message: "Expected JSON body." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    const parsed = ADD_POSITION_SCHEMA.safeParse(body);
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
    const add = await service.addPosition(lookup.trustId, parsed.data);
    if (!add.ok) {
      return NextResponse.json(
        { error: add.error.code, message: add.error.message },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }

    // Return updated PortfolioSnapshot — pie-chart-data after the add.
    const portfolio = await service.getPortfolio(lookup.trustId);
    if (!portfolio.ok) {
      return NextResponse.json(
        { error: portfolio.error.code, message: portfolio.error.message },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(portfolio.value, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "trust-engine-failure", message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const lookup = await getTrustIdForUser();
    if (!lookup.ok) return lookup.response;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "invalid-body", message: "Expected JSON body with positionId." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    const parsed = REMOVE_POSITION_SCHEMA.safeParse(body);
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
    const remove = await service.removePosition(lookup.trustId, parsed.data.positionId);
    if (!remove.ok) {
      // "position-not-found" → 404; everything else → 500.
      const status = remove.error.code === "position-not-found" ? 404 : 500;
      return NextResponse.json(
        { error: remove.error.code, message: remove.error.message },
        { status, headers: { "Cache-Control": "no-store" } },
      );
    }

    // Return updated PortfolioSnapshot — pie-chart-data after the remove.
    const portfolio = await service.getPortfolio(lookup.trustId);
    if (!portfolio.ok) {
      return NextResponse.json(
        { error: portfolio.error.code, message: portfolio.error.message },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(portfolio.value, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "trust-engine-failure", message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
