import { NextResponse } from "next/server";

import { createRegimeDetector } from "@/server/services/regime-detector";
import { createAdvisor } from "@/server/services/advisor";
import { createDemoBook } from "@/server/lib/demo-book";
import {
  buildAdvisoryInputFromTrust,
  type AdvisoryInput,
} from "@/server/lib/trust-book";
import { AdvisoryOpinionSchema } from "@/server/domain/advisory";
import {
  createTrustService,
} from "@/server/services/trust-service";
import { requireAuth } from "@/lib/auth-helpers";

/**
 * /api/advisory — BFF endpoint that returns the House AdvisoryOpinion
 * (Task 7; updated in Task 12 to use current trust if present; Task 36
 * uses live CoinGecko prices and surfaces `priceSource` on the response).
 *
 * Flow:
 *   1. Find the demo trustee's current trust (v1: one trust per user).
 *   2. If a trust exists, build (bookState, mandate, principles, marks)
 *      from it via `buildAdvisoryInputFromTrust`. Otherwise fall back to
 *      the in-memory demo book (`createDemoBook`).
 *   3. Run the regime detector over the marks.
 *   4. Run the advisor with (bookState, mandate, regime, principles).
 *   5. Return the AdvisoryOpinion as JSON (Zod-parse for safety) with
 *      `priceSource: "live" | "fallback"` as a sibling field so the UI
 *      (Task 38) can show a Live-pulse vs Fallback-badge.
 *
 * The opinion is rådgivning, IKKE en executable intent. It becomes
 * intents only after the policy gate AND either the owner's approval
 * (Confirm mode) OR the rules engine consuming it (Rules mode).
 *
 * Auth (Task 42-45): `requireAuth()` sjekker session. Hvis ikke
 * innlogget → 401. Trust-isolation: `getCurrentTrust(auth.userId)`
 * filtrerer på trusteeId. Demo-boken (`createDemoBook`) brukes fortsatt
 * som fallback hvis brukeren ikke har en trust enda — men bare for
 * innloggede brukere; uautentiserte forespørsler får 401.
 *
 * `force-dynamic` so the response never caches; `Cache-Control:
 * no-store` for the same reason — the opinion is computed fresh on
 * every call.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  try {
    // Try the current trust first (Task 11 / 12). Falls back to demo
    // book if the user has no trust yet.
    const trustService = createTrustService();
    const current = await trustService.getCurrentTrust(auth.userId);

    // AdvisoryInput-typen (fra trust-book.ts) har nå et `priceSource`-
    // felt (Task 36). Demo-boken har det ikke — vi behandler demo-boken
    // som "fallback" siden den alltid bruker reference-priser.
    let advisoryInput: AdvisoryInput;
    let priceSource: "live" | "fallback";
    if (current.ok && current.value) {
      const fromTrust = await buildAdvisoryInputFromTrust(current.value);
      if (!fromTrust) {
        // Trust has no book — fall back to demo. Should not happen
        // because createTrustWithPositions always creates a book, but
        // guard anyway.
        const demo = createDemoBook();
        advisoryInput = {
          ...demo,
          priceSource: "fallback",
        };
        priceSource = "fallback";
      } else {
        advisoryInput = fromTrust;
        priceSource = fromTrust.priceSource;
      }
    } else {
      const demo = createDemoBook();
      advisoryInput = {
        ...demo,
        priceSource: "fallback",
      };
      priceSource = "fallback";
    }

    const detector = createRegimeDetector();
    const advisor = createAdvisor();

    const regime = detector.detect(advisoryInput.marks);
    const opinion = advisor.advise({
      bookState: advisoryInput.bookState,
      mandate: advisoryInput.mandate,
      regime,
      principles: advisoryInput.principles,
    });

    // Re-parse through the schema before returning so a malformed
    // advisor output never reaches the UI. Dates serialise as ISO
    // strings in JSON; the schema uses z.date() because we are
    // validating a Date-typed object BEFORE NextResponse.json turns
    // it into a string for transport.
    const parsed = AdvisoryOpinionSchema.parse(opinion);

    // Validate the priceSource from the live fetch so the UI badge is
    // accurate — if cache-timing between advisory input build and now
    // switched sources, prefer the input's source (it drove the marks).
    return NextResponse.json(
      { ...parsed, priceSource },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      },
    );
  } catch (err) {
    // Surface advisor / detector / parse failures as a 500 with the
    // error message so the dev sandbox shows what broke.
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "advisory-engine-failure", message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
