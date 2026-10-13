import { NextResponse } from "next/server";

import { OnboardingInputSchema } from "@/server/domain/trust";
import { aiRoleForMode } from "@/server/domain/trust";
import type { OperatingMode } from "@/server/domain/modes";
import {
  createTrustService,
  type TrustWithRelations,
} from "@/server/services/trust-service";
import { requireAuth } from "@/lib/auth-helpers";

/**
 * /api/trust — BFF endpoint for trust/tenant-container (Task 11; multi-tenant
 * auth in Task 42-45).
 *
 * `GET /api/trust` — returnerer nåværende trust for DEN innloggede brukeren,
 * eller `{ trust: null }` hvis ingen finnes. Side-byggeren (Task 14) bruker
 * dette til å avgjøre om onboarding-veiviseren skal vises.
 *
 * `POST /api/trust` — opprett en trust + initielle posisjoner fra
 * onboarding-veiviseren. Body: `OnboardingInput`. Returnerer den nye
 * trusten (samme shape som GET's trust-felt).
 *
 * `DELETE /api/trust` — slett brukerens trust (inkludert kaskaderende books,
 * accounts, positions, mandates, ethics, lots, marks, intents, decisions,
 * snapshots, trustMembers). Brukes når eieren vil re-onboarde med sine
 * egne reelle beholdninger. Returnerer `{ ok: true }` (200) eller 404 med
 * `{ error: "no-trust" }` hvis ingen trust finnes. Ingen body kreves —
 * API-et bruker session.userId og finner brukerens trust via samme path
 * som GET.
 *
 * Auth (Task 42-45): alle tre metodene ringer `requireAuth()` først. Hvis
 * ikke innlogget → 401 `{ error: "unauthorized" }`. Multi-tenant isolation
 * skjer i `TrustService.getCurrentTrust(userId)` som filtrerer på
 * `trusteeId` — en annen brukers trust returneres aldri.
 *
 * Response shape:
 *   {
 *     trust: null | {
 *       id, name, mode, aiRole, killSwitchActive, houseExpiry,
 *       createdAt, updatedAt, bookId, trusteeId
 *     }
 *   }
 *
 * `force-dynamic` so the response never caches; the trust state can
 * change at any moment (kill switch, mode switch, position CRUD).
 */

export const dynamic = "force-dynamic";

/**
 * Map en Prisma Trust (med relasjoner) til TrustState-shape for BFF.
 * TrustState er zod-validerbar (se domain/trust.ts) men her bare
 * serialisert direkte — vi validerer igjen på dør-inn via route-body.
 */
function mapTrust(t: TrustWithRelations) {
  const mode = t.mode as OperatingMode;
  return {
    id: t.id,
    name: t.name,
    trusteeId: t.trusteeId,
    mode,
    aiRole: aiRoleForMode(mode),
    killSwitchActive: t.killedAt !== null,
    houseExpiry: t.houseExpiry,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    bookId: t.books[0]?.id ?? null,
  };
}

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  try {
    const service = createTrustService();
    const r = await service.getCurrentTrust(auth.userId);
    if (!r.ok) {
      return NextResponse.json(
        { error: r.error.code, message: r.error.message },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (!r.value) {
      return NextResponse.json(
        { trust: null },
        {
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate",
          },
        },
      );
    }
    return NextResponse.json(
      { trust: mapTrust(r.value) },
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

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "invalid-body", message: "Expected JSON body." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    const parsed = OnboardingInputSchema.safeParse(body);
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

    // Auth was checked above — auth.userId is the tenant key.
    const service = createTrustService();

    // v1: one trust per user. If the user already has a trust, refuse
    // to create a second one — onboarding-wizard should call
    // POST /api/trust/positions instead.
    const existing = await service.getCurrentTrust(auth.userId);
    if (existing.ok && existing.value) {
      return NextResponse.json(
        {
          error: "trust-already-exists",
          message:
            "This user already has a trust. Use POST /api/trust/positions to add positions.",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    const r = await service.createTrustWithPositions(parsed.data, auth.userId);
    if (!r.ok) {
      return NextResponse.json(
        { error: r.error.code, message: r.error.message },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { trust: mapTrust(r.value) },
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

/**
 * `DELETE /api/trust` — slett brukerens trust kaskaderende (Task 18).
 *
 * Ingen body kreves. Flow:
 *   1. `requireAuth()` — få userId fra NextAuth session. Hvis ikke
 *      innlogget → 401 returneres fra wrapper-en.
 *   2. `getCurrentTrust(userId)` — finn trusten. Hvis ingen finnes,
 *      returner 404 `{ error: "no-trust" }` (idempotent-caller kan slette
 *      en ikke-eksisterende trust trygt fra API-perspektivet; UI-en viser
 *      da bare onboarding-wizard som allerede er åpen).
 *   3. `service.deleteTrust(trustId)` — slett trusten + alle kaskaderende
 *      relasjoner atomisk i én `$transaction`.
 *   4. Returner 200 `{ ok: true }`.
 *
 * Side-effekt: side-byggerens trust-state går fra `{ kind: "ok" }` →
 * `{ kind: "none" }` etter neste GET; UI-en auto-åpner onboarding-wizard.
 */
export async function DELETE() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  try {
    const service = createTrustService();
    const current = await service.getCurrentTrust(auth.userId);
    if (!current.ok) {
      return NextResponse.json(
        { error: current.error.code, message: current.error.message },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (!current.value) {
      return NextResponse.json(
        { error: "no-trust", message: "No trust to delete." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    const r = await service.deleteTrust(current.value.id);
    if (!r.ok) {
      return NextResponse.json(
        { error: r.error.code, message: r.error.message },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { ok: true },
      {
        status: 200,
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
