import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createTrustService,
  type UpdateMandateInput,
} from "@/server/services/trust-service";
import { requireAuth } from "@/lib/auth-helpers";

/**
 * /api/trust/mandate — mandate-editor BFF (Task 37).
 *
 * `GET /api/trust/mandate` — returnerer nåværende mandat (latest
 * MandateVersion) + versjons-historikk (siste 10). Respons:
 *   { current: MandateVersion | null, versions: MandateVersion[] }
 * Hvis trusten ikke har noe mandat enda (første kall etter onboarding),
 * er `current` null og `versions` er tom — UI-et vet da å vise
 * "create initial mandate"-panelet.
 *
 * `PUT /api/trust/mandate` — opprett en NY MandateVersion (immutable;
 * oppretter ALLTID en ny rad, aldri overskriver). Body: `UpdateMandateInput`.
 * Validering: zod-schema under (samme felter som UpdateMandateInput-typen).
 * Returnerer den nye MandateVersion-rad.
 *
 * Hvis trusten ikke har noen trust enda: 404 `{ error: "no-trust" }` så
 * UI-et vet å vise onboarding.
 *
 * `force-dynamic` — mandat muteres (ny versjon hver PUT); responsen må
 * ikke caches (slik at GET etter PUT alltid ser den nye versjonen).
 *
 * Auth (Task 42-45): `requireAuth()` sjekker session. Hvis ikke
 * innlogget → 401. Trust-isolation: `getCurrentTrust(auth.userId)`
 * filtrerer på trusteeId.
 */

export const dynamic = "force-dynamic";

/**
 * Zod-schema for PUT /api/trust/mandate body. Speiler UpdateMandateInput
 * (fra trust-service.ts) men som zod-validerbar — `safeParse` gir en
 * presis feilmelding per felt hvis klienten sender uventet data.
 *
 * `riskBudget.*` og `optInSleeves.*` er dyp-merget i service-kallet;
 * zod validerer bare felt-typene (int / boolean / number). Hvis et
 * bps-tall er negativt, feiler valideringen her — service-kallet slipper
 * å håndtere "ugyldig inngang" separat.
 */
const UPDATE_MANDATE_SCHEMA = z.object({
  objective: z
    .enum(["max-return-after-costs-vol-dd", "absolute-return"])
    .optional(),
  riskBudget: z
    .object({
      maxSingleAssetWeightBps: z.number().int().nonnegative().optional(),
      maxStablecoinFloorBps: z.number().int().nonnegative().optional(),
      maxVenueConcentrationBps: z.number().int().nonnegative().optional(),
      maxPortfolioDrawdownBps: z.number().int().nonnegative().optional(),
      leverageCap: z.number().positive().optional(),
    })
    .optional(),
  allowedActions: z
    .array(z.enum(["hold", "rebalance-spot", "stake", "unstake"]))
    .optional(),
  optInSleeves: z
    .object({
      lending: z.boolean().optional(),
      lp: z.boolean().optional(),
    })
    .optional(),
  bookCurrency: z.string().min(1).optional(),
  universe: z.array(z.string().min(1)).optional(),
  summary: z.string().min(1).max(500).optional(),
  createdBy: z.string().min(1).optional(),
});

/**
 * Hjelpefunksjon: sjekk auth + slå opp nåværende trust for DEN innloggede
 * brukeren. Service-metodene tar trustId (ikke userId) fordi de opererer
 * på trust-nivå; userId-isolation skjer her.
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
 * GET — returner nåværende mandat + siste 10 versjoner i én respons.
 * `current` er den nyeste versjonen (kan være null hvis første kall).
 * `versions` er de siste 10 — UI-et viser disse i "Mandate history"-
 * tabellen. Hvis trusten har flere enn 10 versjoner (maks 10+1 i første
 * respons), kan UI-et hente flere via en fremtidig `?offset=`-parameter
 * (ikke implementert i v1).
 */
export async function GET() {
  try {
    const lookup = await getTrustIdForUser();
    if (!lookup.ok) return lookup.response;

    const service = createTrustService();
    const [currentR, versionsR] = await Promise.all([
      service.getCurrentMandate(lookup.trustId),
      service.getMandateVersions(lookup.trustId),
    ]);

    if (!currentR.ok) {
      return NextResponse.json(
        { error: currentR.error.code, message: currentR.error.message },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (!versionsR.ok) {
      return NextResponse.json(
        { error: versionsR.error.code, message: versionsR.error.message },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }

    // Latest 10 versions. Already ordered desc by version (service-contract).
    const versions = versionsR.value.slice(0, 10);

    return NextResponse.json(
      { current: currentR.value, versions },
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
 * PUT — opprett en ny MandateVersion (immutable). Validerer body med
 * zod før service-kallet. Service-kallet tar seg av dyp-merge med
 * forrige mandat, version-bump, og MandateSchema-validering av det
 * sammensatte mandatet.
 *
 * Returnerer 201 med `{ version: MandateVersion }` ved suksess.
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
    const parsed = UPDATE_MANDATE_SCHEMA.safeParse(body);
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
    const input: UpdateMandateInput = {
      ...parsed.data,
      // If caller didn't supply createdBy, default to the session
      // user's id so the audit row records who made the change.
      createdBy: parsed.data.createdBy ?? auth.userId,
    };

    const service = createTrustService();
    const r = await service.updateMandate(lookup.trustId, input);
    if (!r.ok) {
      // "mandate-invalid" → 400 (client sent something zod missed but
      // MandateSchema caught). Everything else → 500.
      const status = r.error.code === "mandate-invalid" ? 400 : 500;
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
