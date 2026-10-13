import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createTrustService,
  type UpdateEthicsInput,
} from "@/server/services/trust-service";
import { requireAuth } from "@/lib/auth-helpers";

/**
 * /api/trust/ethics — ethics-editor BFF (Task 37).
 *
 * `GET /api/trust/ethics` — returnerer nåværende ethics-liste (latest
 * EthicsListVersion). Respons:
 *   { current: EthicsListVersion | null }
 * Hvis trusten ikke har noen ethics-liste enda (første kall etter
 * onboarding), er `current` null — UI-et vet da å vise "create initial
 * ethics list"-panelet.
 *
 * `PUT /api/trust/ethics` — opprett en NY EthicsListVersion (immutable;
 * oppretter ALLTID en ny rad, aldri overskriver). Body: `UpdateEthicsInput`.
 * Validering: zod-schema under (samme felter som UpdateEthicsInput-typen).
 * Returnerer den nye EthicsListVersion-rad.
 *
 * Hvis trusten ikke har noen trust enda: 404 `{ error: "no-trust" }` så
 * UI-et vet å vise onboarding.
 *
 * `force-dynamic` — ethics muteres (ny versjon hver PUT); responsen må
 * ikke caches (slik at GET etter PUT alltid ser den nye versjonen).
 *
 * Auth (Task 42-45): `requireAuth()` sjekker session. Hvis ikke
 * innlogget → 401. Trust-isolation: `getCurrentTrust(auth.userId)`
 * filtrerer på trusteeId.
 */

export const dynamic = "force-dynamic";

/**
 * Zod-schema for PUT /api/trust/ethics body. Speiler UpdateEthicsInput
 * (fra trust-service.ts) men som zod-validerbar. `safeParse` gir en
 * presis feilmelding per felt hvis klienten sender uventet data.
 *
 * `hardExclude.unverifiedContracts` er et array av { chainId, address }
 * objects — zod validerer at hvert element har begge feltene.
 */
const UPDATE_ETHICS_SCHEMA = z.object({
  hardExclude: z
    .object({
      sanctionedAddresses: z.array(z.string().min(1)).optional(),
      knownMixers: z.array(z.string().min(1)).optional(),
      unverifiedContracts: z
        .array(
          z.object({
            chainId: z.string().min(1),
            address: z.string().min(1),
          }),
        )
        .optional(),
      userBlockedAssets: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  softPrefer: z
    .object({
      preferLiquidity: z.boolean().optional(),
      preferPublishedSupply: z.boolean().optional(),
      preferWithdrawalHistory: z.boolean().optional(),
    })
    .optional(),
  toggles: z
    .object({
      privacyCoins: z.boolean().optional(),
      gamblingTokens: z.boolean().optional(),
      memeSleeves: z.boolean().optional(),
    })
    .optional(),
  createdBy: z.string().min(1).optional(),
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
 * GET — returner nåværende ethics-liste.
 * `current` er den nyeste versjonen (kan være null hvis første kall).
 */
export async function GET() {
  try {
    const lookup = await getTrustIdForUser();
    if (!lookup.ok) return lookup.response;

    const service = createTrustService();
    const r = await service.getCurrentEthicsList(lookup.trustId);
    if (!r.ok) {
      return NextResponse.json(
        { error: r.error.code, message: r.error.message },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { current: r.value },
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
 * PUT — opprett en ny EthicsListVersion (immutable). Validerer body med
 * zod før service-kallet. Service-kallet tar seg av dyp-merge med
 * forrige ethics-liste, version-bump, og EthicsListSchema-validering
 * av den sammensatte listen.
 *
 * Returnerer 201 med `{ version: EthicsListVersion }` ved suksess.
 * 400 ved invalid body; 500 ved service-feil.
 */
export async function PUT(req: Request) {
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
    const parsed = UPDATE_ETHICS_SCHEMA.safeParse(body);
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

    // createdBy default: bruk session.userId hvis ikke oppgitt.
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const input: UpdateEthicsInput = {
      ...parsed.data,
      createdBy: parsed.data.createdBy ?? auth.userId,
    };

    const service = createTrustService();
    const r = await service.updateEthicsList(lookup.trustId, input);
    if (!r.ok) {
      // "ethics-invalid" → 400; everything else → 500.
      const status = r.error.code === "ethics-invalid" ? 400 : 500;
      return NextResponse.json(
        { error: r.error.code, message: r.error.message },
        { status, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { version: r.value },
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
