import { NextResponse } from "next/server";
import { z } from "zod";

import { OperatingMode as OperatingModeEnum } from "@/server/domain/modes";
import type { OperatingMode } from "@/server/domain/modes";
import { aiRoleForMode } from "@/server/domain/trust";
import {
  createTrustService,
  type TrustWithRelations,
} from "@/server/services/trust-service";
import { requireAuth } from "@/lib/auth-helpers";

/**
 * /api/trust/mode — switch the trust's operating mode (Task 15).
 *
 * The owner direction (Task 11 / 15):
 *   "and the AI inside the trust will have the role as advisor but also
 *    able to operate if called upon to do so."
 *
 * Calling upon the AI to operate = switching the trust to House mode.
 * Switching back to Observe (or any lower mode) = "revoke". The policy
 * engine still gates everything in either case (plan §3); the kill
 * switch overrides both (it blocks all trade paths regardless of mode).
 *
 * Body:
 *   {
 *     mode: "observe" | "advise" | "confirm" | "rules" | "house",
 *     houseExpiry?: string (ISO-8601 datetime)
 *   }
 *
 * House mode:
 *   - If `houseExpiry` is omitted, TrustService defaults to
 *     `now + 7 days` (per plan §2: "Default expiry 7 days until the user
 *     extends it"). The route does not need to supply one.
 *   - If `houseExpiry` is provided, it must be a future datetime and not
 *     more than 30 days out. The 30-day cap is a v1 safety rail — the
 *     plan says the mandate is time-boxed and reversible; an indefinite
 *     House mandate is the opposite of time-boxed.
 *
 * Non-house mode:
 *   - `houseExpiry` is ignored — the TrustService clears it (the House
 *     mandate is bound to House mode per plan §2).
 *
 * Mode ladder (plan §2):
 *   - Moving UP the ladder requires a fresh confirmation per plan §2.
 *     The UI (Task 15 `AiOperatorPanel`) shows a confirmation dialog
 *     before any up-move — that's the "fresh confirmation" surface.
 *   - Moving DOWN the ladder is always immediate. The "Revoke now"
 *     button in the operator panel switches to `observe` (the lowest
 *     rung) so the trust returns to its safest posture.
 *
 * The route itself does not call `canTransition()` because the
 * confirmation is recorded by the BFF + UI; this route trusts the
 * caller. A later phase will persist a confirmation token and validate
 * it server-side (per modes.ts JSDoc).
 *
 * Auth (Task 42-45): `requireAuth()` sjekker session. Hvis ikke
 * innlogget → 401. Trust-isolation: `getCurrentTrust(auth.userId)`
 * filtrerer på trusteeId.
 *
 * Response shape:
 *   `{ trust: TrustState | null }` — same shape as GET /api/trust's
 *   `trust` field, so the client can update its state in place without
 *   a separate refetch.
 *
 * `force-dynamic` so the response never caches; mode + houseExpiry +
 * killedAt can change at any moment.
 */

export const dynamic = "force-dynamic";

/** Maximum days into the future the trustee may extend House mode. */
const MAX_HOUSE_DAYS = 30;

/**
 * Zod schema for the mode-switch body. `mode` is the runtime enum
 * (mirrors `OperatingMode`); `houseExpiry` is optional and only
 * meaningful for House mode. The route re-validates the future + cap
 * constraints manually because zod's `datetime()` does not enforce a
 * future bound.
 */
const TrustModeInputSchema = z.object({
  mode: z.enum([
    OperatingModeEnum.Observe,
    OperatingModeEnum.Advise,
    OperatingModeEnum.Confirm,
    OperatingModeEnum.Rules,
    OperatingModeEnum.House,
  ]),
  houseExpiry: z
    .string()
    .datetime({ message: "houseExpiry must be an ISO-8601 datetime" })
    .optional(),
});

/**
 * Map a Prisma Trust (with relations) to the BFF TrustState shape.
 * Mirrors `mapTrust` in `/api/trust/route.ts` — duplicated (not shared)
 * to keep the two routes independent. If the shape drifts in the
 * future, the lint check + integration test will catch it.
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
    const parsed = TrustModeInputSchema.safeParse(body);
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

    // Find the user's current trust (v1: one trust per user).
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
        {
          error: "no-trust",
          message: "Create a trust first via POST /api/trust.",
        },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    const { mode, houseExpiry } = parsed.data;

    // Validate houseExpiry for House mode (future + cap). For non-House
    // modes, the value is silently dropped — TrustService clears the
    // expiry anyway.
    let expiry: Date | undefined;
    if (mode === OperatingModeEnum.House && houseExpiry) {
      const d = new Date(houseExpiry);
      if (!Number.isFinite(d.getTime())) {
        return NextResponse.json(
          {
            error: "invalid-input",
            message: "houseExpiry is not a valid ISO datetime.",
          },
          { status: 400, headers: { "Cache-Control": "no-store" } },
        );
      }
      const now = Date.now();
      if (d.getTime() <= now) {
        return NextResponse.json(
          {
            error: "invalid-input",
            message: "houseExpiry must be in the future.",
          },
          { status: 400, headers: { "Cache-Control": "no-store" } },
        );
      }
      const maxFuture = now + MAX_HOUSE_DAYS * 24 * 60 * 60 * 1000;
      if (d.getTime() > maxFuture) {
        return NextResponse.json(
          {
            error: "invalid-input",
            message: `houseExpiry cannot be more than ${MAX_HOUSE_DAYS} days out.`,
          },
          { status: 400, headers: { "Cache-Control": "no-store" } },
        );
      }
      expiry = d;
    }

    // Hand off to the service. It will:
    //   - default expiry to now + 7 days when mode=house and no expiry
    //   - clear expiry when mode != house
    //   - sync trust.books[0].mode + houseExpiry so BookState readers
    //     see the change without traversing to Trust
    const r = await service.setMode(current.value.id, mode, expiry);
    if (!r.ok) {
      return NextResponse.json(
        { error: r.error.code, message: r.error.message },
        { status: 500, headers: { "Cache-Control": "no-store" } },
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
