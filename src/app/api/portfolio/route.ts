import { NextResponse } from "next/server";

import {
  createTrustService,
} from "@/server/services/trust-service";
import { requireAuth } from "@/lib/auth-helpers";

/**
 * /api/portfolio — pie-chart-data for hovedoversikten (Task 11 + 13;
 * multi-tenant auth in Task 42-45).
 *
 * `GET /api/portfolio` — returnerer PortfolioSnapshot for DEN innloggede
 * brukerens trust:
 *   {
 *     trustId, trustName, mode, aiRole, killSwitchActive,
 *     nav, bookCurrency, dryPowderBps, dryPowderStatus,
 *     sleeves: [{ category, assets: [{ assetId, quantity, price,
 *     value, weightBps }], currentWeightBps, navContribution }],
 *     positionsCount, asOf
 *   }
 *
 * Hvis brukeren ikke har en trust, returneres 404 med
 * `{ error: "no-trust" }` så page-byggeren vet å vise onboarding.
 *
 * Auth (Task 42-45): `requireAuth()` sjekker session. Hvis ikke
 * innlogget → 401. Trust-isolation: `getCurrentTrust(auth.userId)`
 * filtrerer på trusteeId — en annen brukers trust returneres aldri.
 *
 * `force-dynamic` — NAV og sleeve-vekter endres med reference-priser /
 * posisjoner; responsen må ikke caches.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  try {
    const service = createTrustService();

    // Find the user's current trust (v1: one trust per user).
    const current = await service.getCurrentTrust(auth.userId);
    if (!current.ok) {
      return NextResponse.json(
        { error: current.error.code, message: current.error.message },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (!current.value) {
      return NextResponse.json(
        { error: "no-trust" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    const portfolio = await service.getPortfolio(current.value.id);
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
      { error: "portfolio-engine-failure", message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
