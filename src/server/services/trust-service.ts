import { db } from "@/lib/db";
import type {
  Trust,
  Book,
  Account,
  Position,
  MandateVersion,
  EthicsListVersion,
  DecisionLogEntry,
  BookSnapshot,
  Intent,
} from "@prisma/client";

import type { OperatingMode } from "../domain/modes";
import { OperatingMode as OperatingModeEnum } from "../domain/modes";
import type { RiskCategory } from "../domain/bankroll";
import {
  RiskCategory as RC,
  RISK_CATEGORY_ORDER,
  categorizeAsset,
  BankrollPrinciplesSchema,
} from "../domain/bankroll";
import type { BankrollPrinciples } from "../domain/bankroll";
import { categorizePosition, type DeFiPositionType } from "../domain/risk-scoring";
import { DryPowderStatus } from "../domain/advisory";
import {
  type AIRole,
  aiRoleForMode,
  type OnboardingInput,
} from "../domain/trust";
import {
  MandateSchema,
  type Mandate,
  type RiskBudget,
  type OptInSleeves,
  mandateSummary,
} from "../domain/mandate";
import {
  EthicsListSchema,
  type EthicsList,
  type HardExclude,
  type SoftPrefer,
  type EthicsToggles,
} from "../domain/ethics";
import { referencePrice } from "../lib/reference-prices";
import { fetchAggregatedPrices, type AssetPriceDetail, type PriceAggregationSummary } from "../lib/price-aggregator";
import type { AsyncResult } from "./types";
import { HouseError } from "../domain/errors";

/**
 * TrustService (plan §5; owner direction Task 11) — the persistence +
 * aggregation layer for the trust-tenant container.
 *
 * Ansvar:
 *   - Opprette en trust + initielle posisjoner (onboarding-veiviser).
 *   - Hente nåværende trust for en trustee (v1: én trust per bruker).
 *   - Legge til / fjerne posisjoner på trustens book.
 *   - Bytte modus (Observe → Advise → ... → House; default 7-dagers
 *     mandate expiry for House).
 *   - Utløse kill switch (markerer killedAt på trust OG book; v1 markerer
 *     bare — faktisk nøkkelrevokasjon er signer-service).
 *   - Beregne PortfolioSnapshot (NAV + 4 sleeves + dry powder + aiRole).
 *
 * Det service IKKE gjør:
 *   - Signerer intents. Det er Signer (isolated service).
 *   - Kaller AI-en. Det er AIHouse-service.
 *   - Skrudd modus-opp uten bekreftelse (modus-stigen §2 krever fersk
 *     bekreftelse på opp-flytt; det er BFF-en / UI-en som håndterer det).
 *
 * Math caveat: v0 bruker JS Number for regning. Produksjon MÅ bruke
 * fixed-point decimal lib. Ikke installer i v0 — dette er den eksplisitte
 * JSDoc-advarselen.
 */

/**
 * En Trust-populert med books + accounts + positions. Dette er typen som
 * returneres fra service-kall som returnerer Trust (inkludert relasjoner).
 */
export type TrustWithRelations = Trust & {
  books: Array<
    Book & {
      accounts: Account[];
      positions: Position[];
    }
  >;
};

/** Input for `addPosition` — speiler onboarding-position-shapen. */
export interface AddPositionInput {
  assetId: string;
  quantity: string;
  venue: string;
  venueKind:
    | "cex"
    | "evm-wallet"
    | "solana-wallet"
    | "stake-defi"
    | "xrp-wallet"
    | "dex";
  /** Entry price per unit in book currency (only for non-stablecoins). */
  entryPrice?: string;
}

/**
 * PositionRow — en rad i posisjonslisten som /api/trust/positions (GET)
 * returnerer. Inneholder posisjonens persistence-felter + to avledete
 * felter for UI-en:
 *   - `category` : RiskCategory fra `categorizeAsset(assetId)` — for
 *                  sleeve-badge-farge på raden.
 *   - `estValue` : quantity × referencePrice, formatert som fixed-precision
 *                  string (v0 Number-basert; se JSDoc-advarselen i
 *                  getPortfolio). "0.00" hvis assetet ikke har en
 *                  referansepris.
 *   - `venue`     : Account.venue (lable for venue-feltet).
 *   - `venueKind` : Account.kind (cex / evm-wallet / solana-wallet /
 *                   stake-defi).
 *
 * `venue` og `venueKind` hentes fra posisjonens Account-relasjon. Posisjoner
 * uten Account (accountId = null) får venue="<orphan>" og venueKind="cex"
 * (skal ikke skje i v1, men vi defaulter defensive).
 */
export interface PositionRow {
  id: string;
  assetId: string;
  quantity: string;
  venue: string;
  venueKind:
    | "cex"
    | "evm-wallet"
    | "solana-wallet"
    | "stake-defi"
    | "xrp-wallet"
    | "dex";
  state: string;
  source: string;
  confidence: string;
  category: RiskCategory;
  estValue: string;
}

/**
 * PositionsList — respons-shape for GET /api/trust/positions. Inkluderer
 * posisjonene + trust-level felter (NAV, book currency, positionsCount) så
 * panelet kan vise en header uten å kalle /api/portfolio separat.
 */
export interface PositionsList {
  trustId: string;
  trustName: string;
  positions: PositionRow[];
  nav: string;
  bookCurrency: string;
  positionsCount: number;
}

/**
 * En venue hvor et aktivum holdes (børs eller lommebok).
 *
 * Eierens krav (Task 25): "3 meningsfulle dimensjoner: strategisk →
 * taktisk → operasjonelt". Dette er det operasjonelle nivået — custody-
 * distribusjonen: hvor er hver eiendel forvaltet (binance / ledger /
 * metamask / ...).
 *
 * En venue-rad summerer alle posisjoner på samme (account.venue,
 * account.kind) for ett aktivum. Hvis eieren har 0.5 BTC på binance og
 * 0.7 BTC på ledger, får BTC to venue-rader — hver med sin egen mengde,
 * verdi, vekt av NAV, og en `shareOfAssetBps` som angir hvor stor andel
 * av aktivumets totale verdi som ligger på akkurat denne venue-en
 * (summen av `shareOfAssetBps` på tvers av venues for ett asset = 10000).
 *
 * Feltene er string hvor presisjon betyr noe (quantity / value) og tall
 * hvor bps-regning er deterministisk (weightBps / shareOfAssetBps).
 */
export interface PortfolioSnapshotVenue {
  /** Venue-navn (f.eks. "binance", "ledger", "metamask"). */
  venue: string;
  /** Venue-kind (cex | evm-wallet | solana-wallet | stake-defi). */
  venueKind: string;
  /** Mengde av dette aktivum på denne venue (string for fixed-point). */
  quantity: string;
  /** Verdi i book currency på denne venue. */
  value: string;
  /** Vekt av NAV (bps, 0..10000). */
  weightBps: number;
  /** Vekt INNENFOR dette aktivumet (bps, 0..10000). Summen av alle
   *  venues for et asset = 10000 (100%). */
  shareOfAssetBps: number;
}

/**
 * Enkelt-aktivum inne i en sleeve — det taktiske nivået ("hva eier jeg
 * egentlig?"). Eierens krav (Task 25): "3 meningsfulle dimensjoner:
 * strategisk → taktisk → operasjonelt".
 *
 * `quantity` / `value` er totalsummer på tvers av alle venues hvor dette
 * aktivumet holdes. `weightBps` er aktivumets vekt av hele NAV. Hvert
 * aktivum har en `venues[]`-liste som bryter verdien ned per custody-
 * lokasjon — det operasjonelle nivået.
 *
 * Feltene her er identiske med den forrige 2-nivå-shapen (slik at
 * eksisterende UI-komponenter som leser `assetId` / `quantity` / `value`
 * / `weightBps` fortsetter å virke). `venues` er en ren tillegg.
 */
export interface PortfolioSnapshotAsset {
  assetId: string;
  /** Total mengde på tvers av alle venues. */
  quantity: string;
  /** Reference-pris i book currency (v0: REFERENCE_PRICES). */
  price: string;
  /** Total verdi på tvers av alle venues. */
  value: string;
  /** Vekt av NAV (bps, 0..10000). */
  weightBps: number;
  /** Entry price per unit in book currency (null for stablecoins or
   *  assets where the trustee didn't provide a price). Used for P&L. */
  entryPrice: string | null;
  /** Liste over venues hvor dette aktivumet holdes. Ett element per
   *  unik (account.venue, account.kind). */
  venues: PortfolioSnapshotVenue[];
  /** Price source for this asset (e.g. "ftso", "ccxt", "coingecko",
   *  "reference-fallback"). Undefined for backward compatibility. */
  priceSource?: string;
  /** Confidence level: "high" | "medium" | "low" | "fallback".
   *  Undefined for backward compatibility. */
  priceConfidence?: string;
  /** True if this asset's price came from the hardcoded reference
   *  fallback (increases uncertainty). Undefined for backward compat. */
  priceIsFallback?: boolean;
}

/**
 * En sleeve — det strategiske nivået ("hvor stor andel er stable vs
 * aggressive?"). Eierens krav (Task 25): "3 meningsfulle dimensjoner:
 * strategisk → taktisk → operasjonelt".
 *
 * Hver sleeve er en av de fire RiskCategory-verdiene (stable /
 * conservative / balanced / aggressive), og samler alle assets som
 * `categorizeAsset` peker på denne kategorien.
 */
export interface PortfolioSnapshotSleeve {
  category: RiskCategory;
  assets: PortfolioSnapshotAsset[];
  currentWeightBps: number;
  navContribution: string;
}

/**
 * PortfolioSnapshot — pie-chart-data for /api/portfolio.
 *
 *   - `mode` / `aiRole` / `killSwitchActive` : trust-state speilet så
 *     UI-en kan vise modus + ai-rolle + kill-switch uten ekstra kall.
 *   - `nav` : sum av (quantity × reference price) over alle posisjoner,
 *              i book currency (default USDC). String for fixed-point.
 *   - `dryPowderBps` : stable-sleeve vekt i bps (0..10000).
 *   - `dryPowderStatus` : fem-soners klassifikasjon (se advisor.ts).
 *   - `sleeves` : 4 sleeves, hver med assets + current weight + NAV-
 *                  contribution. Stable-sleeve er "dry powder". Hver
 *                  asset har i tillegg en `venues[]`-liste som bryter
 *                  verdien ned per custody-lokasjon (Task 25 — 3-nivå
 *                  hierarki: sleeves → assets → venues).
 *   - `positionsCount` : total posisjoner på booket (for header-stat).
 *   - `priceSource` : "live" hvis NAV er beregnet med live CoinGecko-priser;
 *                     "fallback" hvis CoinGecko var nede / ratelimited
 *                     og vi falt tilbake til REFERENCE_PRICES. UI-en
 *                     (Task 38) viser en Live-pulse eller Fallback-badge.
 *   - `asOf` : tidspunktet snapshot ble beregnet.
 */
export interface PortfolioSnapshot {
  trustId: string;
  trustName: string;
  mode: OperatingMode;
  aiRole: AIRole;
  killSwitchActive: boolean;
  nav: string;
  bookCurrency: string;
  dryPowderBps: number;
  dryPowderStatus: DryPowderStatus;
  sleeves: PortfolioSnapshotSleeve[];
  positionsCount: number;
  priceSource: "live" | "fallback";
  asOf: Date;
  /** NEW: per-asset price source detail (keyed by lowercase assetId).
   *  Undefined for backward compatibility (pre-aggregator responses). */
  priceDetails?: Record<string, AssetPriceDetail>;
  /** NEW: aggregate price-quality summary for the data-quality badge. */
  priceSummary?: PriceAggregationSummary;
}

/**
 * DecisionLogEntry rad + tilhørende Intent (1:1 relasjon per schema). Dette
 * er respons-shapen for /api/trust/decisions — UI-et viser beslutningen
 * (kind, context, fill, signatureId, createdAt) sammen med intensjonen
 * som forårsaket den (assetId, side, venue, notional, reasonCode, origin,
 * status) i én rad uten å måtte gjøre en ekstra resolve-kall.
 */
export interface DecisionWithIntent {
  entry: DecisionLogEntry;
  intent: Intent;
}

/**
 * UpdateMandateInput — body for PUT /api/trust/mandate. ALLE felter er
 * valgfrie; updateMandate merger dypere med forrige mandate slik at en
 * partial-oppdatering (kun endre maxSingleAssetWeightBps) etterlater de
 * andre feltene intakte. Hvis trusten ikke har noe mandat enda, opprettes
 * version=1 fra default-verdier utfylt av input (eller MandateSchema-
 * defaultene hvis input er helt tom).
 *
 * `riskBudget.*` og `optInSleeves.*` er dyp-merget. `allowedActions` /
 * `universe` (arrays) overskriver fullstendig hvis de er oppgitt (en
 * partial-oppdatering av arrays ville vært tvetydig: legg-til vs fjern).
 *
 * `summary` overstyrer den auto-genererte `mandateSummary(...)`. Hvis
 * uoppgitt genereres en kort en-linjers oppsummering fra det nye mandatet.
 *
 * `createdBy` er trusteeens userId (BFF-en fyller dette ut fra
 * getOrCreateDemoTrustee() i v1, fra NextAuth-session i Phase 1).
 */
export interface UpdateMandateInput {
  objective?: "max-return-after-costs-vol-dd" | "absolute-return";
  riskBudget?: {
    maxSingleAssetWeightBps?: number;
    /** Also known as `dryPowderFloorBps`. */
    maxStablecoinFloorBps?: number;
    maxVenueConcentrationBps?: number;
    maxPortfolioDrawdownBps?: number;
    leverageCap?: number;
  };
  allowedActions?: string[];
  optInSleeves?: { lending?: boolean; lp?: boolean };
  bookCurrency?: string;
  universe?: string[];
  summary?: string;
  createdBy?: string;
}

/**
 * UpdateEthicsInput — body for PUT /api/trust/ethics. ALLE felter er
 * valgfrie; updateEthicsList merger dypere med forrige ethics-list slik
 * at en partial-oppdatering (kun legg-til en sanctionedAddress) etterlater
 * de andre feltene intakte.
 *
 * `hardExclude.*` arrays dyp-merges per under-felt (appends, dedupes). Hvis
 * caller vil fjerne en adresse kan de sende hele listen på nytt (overskriver).
 * For å være konsistent med updateMandate-semantikk gjør vi en regel:
 * - Hvis feltet er oppgitt i input → overskriver (caller eksplisitt erstatter)
 * - Hvis feltet er uoppgitt → beholdes fra forrige versjon
 *
 * `softPrefer.*` og `toggles.*` dyp-merges per boolean (kun oppdaterte
 * booleaner overskrives).
 *
 * `createdBy` er trusteeens userId (BFF-en fyller dette ut).
 */
export interface UpdateEthicsInput {
  hardExclude?: {
    sanctionedAddresses?: string[];
    knownMixers?: string[];
    unverifiedContracts?: { chainId: string; address: string }[];
    userBlockedAssets?: string[];
  };
  softPrefer?: {
    preferLiquidity?: boolean;
    preferPublishedSupply?: boolean;
    preferWithdrawalHistory?: boolean;
  };
  toggles?: {
    privacyCoins?: boolean;
    gamblingTokens?: boolean;
    memeSleeves?: boolean;
  };
  createdBy?: string;
}

/**
 * TrustService-kontrakten. AsyncResult<T> = Promise<Result<T, HouseError>>.
 * Caller MÅ sjekke r.ok før r.value leses (TypeScript-narrowing virker
 * fordi ok er en literal boolean).
 */
export interface TrustService {
  getCurrentTrust(trusteeId: string): AsyncResult<TrustWithRelations | null>;
  createTrustWithPositions(
    input: OnboardingInput,
    trusteeId: string,
  ): AsyncResult<TrustWithRelations>;
  addPosition(
    trustId: string,
    position: AddPositionInput,
  ): AsyncResult<Position>;
  removePosition(trustId: string, positionId: string): AsyncResult<void>;
  getPositions(trustId: string): AsyncResult<PositionsList>;
  setMode(
    trustId: string,
    mode: OperatingMode,
    houseExpiry?: Date,
  ): AsyncResult<TrustWithRelations>;
  triggerKillSwitch(trustId: string): AsyncResult<TrustWithRelations>;
  deleteTrust(trustId: string): AsyncResult<void>;
  getPortfolio(trustId: string): AsyncResult<PortfolioSnapshot>;

  /** Get the current (latest) mandate for a trust. Returns null if no mandate exists. */
  getCurrentMandate(trustId: string): AsyncResult<MandateVersion | null>;

  /** Get all mandate versions (immutable history). Ordered by version desc. */
  getMandateVersions(trustId: string): AsyncResult<MandateVersion[]>;

  /** Update the mandate — creates a NEW immutable MandateVersion row (never overwrites). */
  updateMandate(
    trustId: string,
    input: UpdateMandateInput,
  ): AsyncResult<MandateVersion>;

  /** Get the current ethics list for a trust. Returns null if none. */
  getCurrentEthicsList(trustId: string): AsyncResult<EthicsListVersion | null>;

  /** Update the ethics list — creates a NEW immutable version. */
  updateEthicsList(
    trustId: string,
    input: UpdateEthicsInput,
  ): AsyncResult<EthicsListVersion>;

  /** Get the decision log (audit trail of accepted/rejected intents). */
  getDecisions(
    trustId: string,
    limit?: number,
  ): AsyncResult<DecisionWithIntent[]>;

  /** Get NAV snapshots (historical NAV for the chart). */
  getSnapshots(
    trustId: string,
    limit?: number,
  ): AsyncResult<BookSnapshot[]>;

  /** Take a snapshot of the current book state (NAV + weights + drawdown). */
  takeSnapshot(trustId: string): AsyncResult<BookSnapshot>;
}

// ---------------------------------------------------------------------------
// PrismaTrustService — v0-implementasjonen.
// ---------------------------------------------------------------------------

/** Trust-relasjoner vi includerer ved get/create. */
const TRUST_INCLUDE = {
  books: {
    include: {
      accounts: true,
      positions: true,
    },
  },
} as const;

/** Default 7 dager for House mode-mandat (plan §2: default 7 dager). */
const DEFAULT_HOUSE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/** Bps-toleranse for "at-target" dry-powder-klassifikasjon (se advisor.ts). */
const AT_TARGET_TOLERANCE_BPS = 50;

/**
 * PrismaTrustService — v0-implementasjon. Bruker `db` fra `@/lib/db`.
 *
 * Feilhåndtering: kaster ikke. Returnerer Result.ok(value) ved suksess,
 * Result.err(HouseError) ved domene-feil (trust ikke funnet, posisjon
 * ikke funnet, unique-constraint breech). Prisma-feil som ikke er
 * domene-feil bubbles opp som ukjent HouseError.
 */
export class PrismaTrustService implements TrustService {
  /**
   * Finn den første trusten for denne trusteesen. v1: én trust per
   * bruker. Inkluderer books + accounts + positions via Prisma-relasjoner.
   *
   * `trusteeId` er nå `session.user.id` (Task 42-45 multi-tenant isolation).
   * API-ruter får userId fra `requireAuth()` (NextAuth session); service-
   * metoden er uavhengig av auth men stoler på at kalleren sender riktig
   * bruker. Spørringen filtrerer på `trusteeId` så en annen brukers trust
   * aldri returneres — isolation skjer her, ikke i API-laget.
   *
   * Returnerer `null` (i Result.ok) hvis brukeren ikke har en trust —
   * BFF-en returnerer 404 / `{ trust: null }` så side-byggeren vet å
   * vise onboarding.
   */
  async getCurrentTrust(
    trusteeId: string,
  ): AsyncResult<TrustWithRelations | null> {
    try {
      const trust = await db.trust.findFirst({
        where: { trusteeId },
        include: TRUST_INCLUDE,
        orderBy: { createdAt: "asc" },
      });
      return { ok: true, value: trust };
    } catch (err) {
      return this.error(err);
    }
  }

  /**
   * Opprett en trust + en book + account per unik (venue, venueKind) +
   * posisjoner per input. Alt i én transaksjon.
   *
   * Posisjoner med samme (assetId, venue, venueKind) summeres — unika-
   * constraint på Position (bookId, assetId, state, source) krever at
   * kombinasjonen er unik. source avledes fra venueKind (cex →
   * "cex-balance", evm/solana-wallet → "rpc-balance", stake-defi →
   * "staking-contract").
   *
   * Book opprettes med mode=observe (default for new trusts — plan §2:
   * ingen trade keys, ingen signer-call; kill switch har ingenting å
   * skru av). trust.mode settes også til observe.
   *
   * Task 47-49 — multi-page onboarding-utvidelse:
   *   - `trustType` / `bookCurrency` / `description` skrives på Trust-raden
   *     (alle feltene finnes i schema fra Task 46).
   *   - `trusteeName` / `trusteePhone` / `trusteeAddress` oppdaterer
   *     User-raden (feltene `name`, `phone`, `address` finnes i schema).
   *   - `beneficiaries[]` oppretter TrustMember-rader med role=
   *     "beneficiary" + contact info. Eierens egen trustee-rad lages
   *     som før (role="trustee").
   *   - `positions[]` med DeFi-felter: `protocol`, `positionType`,
   *     `contractAddress`, `apyBps`, `lockEnd` skrives på Position-raden
   *     når de er til stede. For venueKind === "stake-defi" avledes
   *     `state` fra `positionType` (staking→staked, lending→lending,
   *     lp→lp, vault→staked) og `source` = "staking-contract". For
   *     andre venueKinds er `state` = "free" og source avledes fra
   *     venueKind som før.
   */
  async createTrustWithPositions(
    input: OnboardingInput,
    trusteeId: string,
  ): AsyncResult<TrustWithRelations> {
    try {
      // Dedupe positions per (assetId, venue, venueKind, positionType) —
      // summer qty. positionType tas med i key så to DeFi-posisjoner på
      // samme asset+venue men ulik positionType ikke merges.
      const deduped = this.dedupePositions(input.positions);

      // Build a set of unique (venue, venueKind) for account-creation.
      const uniqueVenues = Array.from(
        new Set(deduped.map((p) => `${p.venueKind}::${p.venue}`)),
      ).map((key) => {
        const [venueKind, venue] = key.split("::");
        return { venue, venueKind: venueKind as AddPositionInput["venueKind"] };
      });

      const trust = await db.$transaction(async (tx) => {
        // 1. Trust — inkluderer trustType, bookCurrency, description.
        const t = await tx.trust.create({
          data: {
            name: input.name,
            trustType: input.trustType,
            bookCurrency: input.bookCurrency,
            description: input.description,
            trusteeId,
            mode: OperatingModeEnum.Observe,
          },
        });

        // 2. Book on the trust — book currency fra input.
        const book = await tx.book.create({
          data: {
            ownerId: trusteeId,
            name: `${input.name} — Operating Book`,
            bookCurrency: input.bookCurrency,
            mode: OperatingModeEnum.Observe,
            trustId: t.id,
          },
        });

        // 3. Account per unique (venue, venueKind).
        const accountIds: Record<string, string> = {};
        for (const v of uniqueVenues) {
          const acct = await tx.account.create({
            data: {
              bookId: book.id,
              kind: v.venueKind,
              venue: v.venue,
              // v0 placeholder: onboarding samler ikke riktig ref enda.
              // Phase 1 bytter dette mot ekte KMS-ref (CEX) eller
              // public address (wallet).
              ref: `${v.venueKind}-placeholder-${v.venue}`,
              keyScope: "read",
              withdrawAllow: "[]",
              active: true,
            },
          });
          accountIds[`${v.venueKind}::${v.venue}`] = acct.id;
        }

        // 4. Positions per deduped input. source + state avledes fra
        //    venueKind (og positionType for DeFi). DeFi-metadata skrives
        //    på raden når de er til stede.
        for (const p of deduped) {
          const isDefi = p.venueKind === "stake-defi";
          const source = sourceForVenueKind(p.venueKind);
          const confidence = confidenceForVenueKind(p.venueKind);
          const state = isDefi
            ? stateForPositionType(p.positionType)
            : "free";

          // Konverter ISO date-string → Date for lockEnd. Prisma-kolonnen
          // er DateTime? så vi sender Date | undefined.
          const lockEnd = p.lockEnd
            ? new Date(p.lockEnd)
            : undefined;

          await tx.position.create({
            data: {
              bookId: book.id,
              accountId: accountIds[`${p.venueKind}::${p.venue}`],
              assetId: p.assetId,
              state,
              quantity: p.quantity,
              source,
              confidence,
              // DeFi-metadata — kun skrevet når venueKind === "stake-defi".
              protocol: isDefi ? p.protocol : undefined,
              positionType: isDefi ? p.positionType : undefined,
              contractAddress: isDefi ? p.contractAddress : undefined,
              apyBps: isDefi ? p.apyBps : undefined,
              lockEnd: isDefi ? lockEnd : undefined,
              // Entry price per unit in book currency (per eier direction
              // Task 57). Only for non-stablecoin assets; the UI skips
              // entryPrice for stablecoins (they are $1.00 by definition).
              entryPrice: p.entryPrice ?? undefined,
              asOf: new Date(),
            },
          });

          // Create a Lot for cost-basis tracking (plan §7: "Lots —
          // quantity, cost in the book currency, venue, timestamp.
          // Needed for PnL the user can trust"). costLocal = quantity
          // × entryPrice; if no entryPrice, skip the Lot (stablecoins
          // or assets where the user didn't provide a price).
          if (p.entryPrice) {
            const qty = Number.parseFloat(p.quantity);
            const px = Number.parseFloat(p.entryPrice);
            if (Number.isFinite(qty) && Number.isFinite(px)) {
              await tx.lot.create({
                data: {
                  bookId: book.id,
                  assetId: p.assetId,
                  quantity: p.quantity,
                  costLocal: (qty * px).toFixed(2),
                  venue: p.venue,
                  acquiredAt: new Date(),
                },
              });
            }
          }
        }

        // 5. Trustee member row (plan §5 — trustee is a member with role
        // "trustee"). v1 only uses this role actively; beneficiary rows
        // opprettes nedenfor; operator rows er fremtidig.
        await tx.trustMember.create({
          data: {
            trustId: t.id,
            userId: trusteeId,
            role: "trustee",
          },
        });

        // 6. Beneficiary rows (Task 47-49 — Side 3). Hver beneficiary
        // opprettes som en TrustMember med role="beneficiary" og
        // contact info. userId er null fordi beneficiaries ikke er
        // innloggede brukere ennå. Schema-kolonnen `userId` er nå
        // nullable (String?) så vi setter den til null i stedet for
        // å knytte til trusteesens User.id (som tidligere forårsaket
        // en unique-constraint-kollisjon med trustee-radene i steg 5).
        for (const b of input.beneficiaries) {
          await tx.trustMember.create({
            data: {
              trustId: t.id,
              userId: null,
              role: "beneficiary",
              name: b.name,
              email: b.email,
              relationship: b.relationship,
              reportingLevel: b.reportingLevel,
            },
          });
        }

        // 7. Update trustee User-profile — name, phone, address
        // (Task 47-49 — Side 2). Skrives SIST i transaksjonen slik at
        // eventuelle feil ovenfor ruller tilbake uten å ha mutert User.
        const userUpdate: { name?: string; phone?: string; address?: string } =
          {};
        if (input.trusteeName && input.trusteeName.trim().length > 0) {
          userUpdate.name = input.trusteeName.trim();
        }
        if (input.trusteePhone && input.trusteePhone.trim().length > 0) {
          userUpdate.phone = input.trusteePhone.trim();
        }
        if (input.trusteeAddress && input.trusteeAddress.trim().length > 0) {
          userUpdate.address = input.trusteeAddress.trim();
        }
        if (Object.keys(userUpdate).length > 0) {
          await tx.user.update({
            where: { id: trusteeId },
            data: userUpdate,
          });
        }

        // Return the trust with relations populated.
        return tx.trust.findUnique({
          where: { id: t.id },
          include: TRUST_INCLUDE,
        });
      });

      if (!trust) {
        return {
          ok: false,
          error: new HouseError(
            "trust-create-failed",
            "Trust was created but could not be re-fetched with relations.",
          ),
        };
      }
      return { ok: true, value: trust };
    } catch (err) {
      return this.error(err);
    }
  }

  /**
   * Legg til en posisjon på trustens book. Finner trusten → booken →
   * account per (venue, venueKind) (opretter hvis nødvendig) → oppretter
   * posisjonen.
   *
   * source avledes fra venueKind (samme som createTrustWithPositions).
   */
  async addPosition(
    trustId: string,
    position: AddPositionInput,
  ): AsyncResult<Position> {
    try {
      const trust = await db.trust.findUnique({
        where: { id: trustId },
        include: TRUST_INCLUDE,
      });
      if (!trust) {
        return {
          ok: false,
          error: new HouseError("trust-not-found", `Trust ${trustId} not found.`),
        };
      }
      const book = trust.books[0];
      if (!book) {
        return {
          ok: false,
          error: new HouseError(
            "book-not-found",
            `Trust ${trustId} has no book.`,
          ),
        };
      }

      // Find or create account for (venue, venueKind).
      let account = book.accounts.find(
        (a) => a.venue === position.venue && a.kind === position.venueKind,
      );
      if (!account) {
        account = await db.account.create({
          data: {
            bookId: book.id,
            kind: position.venueKind,
            venue: position.venue,
            ref: `${position.venueKind}-placeholder-${position.venue}`,
            keyScope: "read",
            withdrawAllow: "[]",
            active: true,
          },
        });
      }

      const created = await db.position.create({
        data: {
          bookId: book.id,
          accountId: account.id,
          assetId: position.assetId,
          state: "free",
          quantity: position.quantity,
          source: sourceForVenueKind(position.venueKind),
          confidence: confidenceForVenueKind(position.venueKind),
          entryPrice: position.entryPrice ?? undefined,
          asOf: new Date(),
        },
      });

      // Create a Lot for cost-basis tracking if entryPrice is provided.
      if (position.entryPrice) {
        const qty = Number.parseFloat(position.quantity);
        const px = Number.parseFloat(position.entryPrice);
        if (Number.isFinite(qty) && Number.isFinite(px)) {
          await db.lot.create({
            data: {
              bookId: book.id,
              assetId: position.assetId,
              quantity: position.quantity,
              costLocal: (qty * px).toFixed(2),
              venue: position.venue,
              acquiredAt: new Date(),
            },
          });
        }
      }
      return { ok: true, value: created };
    } catch (err) {
      return this.error(err);
    }
  }

  /**
   * Fjern en posisjon fra trustens book. Sjekker at posisjonen tilhører
   * trustens book før sletting (forhindrer cross-tenant sletting).
   */
  async removePosition(
    trustId: string,
    positionId: string,
  ): AsyncResult<void> {
    try {
      const trust = await db.trust.findUnique({
        where: { id: trustId },
        include: TRUST_INCLUDE,
      });
      if (!trust) {
        return {
          ok: false,
          error: new HouseError("trust-not-found", `Trust ${trustId} not found.`),
        };
      }
      const book = trust.books[0];
      if (!book) {
        return {
          ok: false,
          error: new HouseError(
            "book-not-found",
            `Trust ${trustId} has no book.`,
          ),
        };
      }
      const position = book.positions.find((p) => p.id === positionId);
      if (!position) {
        return {
          ok: false,
          error: new HouseError(
            "position-not-found",
            `Position ${positionId} not found on trust ${trustId}.`,
          ),
        };
      }
      await db.position.delete({ where: { id: positionId } });
      return { ok: true, value: undefined };
    } catch (err) {
      return this.error(err);
    }
  }

  /**
   * Hent posisjonene på trustens book, med Account-relasjon populert, og
   * avled `category` (via categorizeAsset) + `estValue` (via referencePrice).
   *
   * Returnerer en `PositionsList` med trust-navn + book currency + NAV +
   * positionsCount slik at UI-et kan vise en header uten et ekstra kall.
   *
   * Posisjoner sorteres etter category (RISK_CATEGORY_ORDER) og deretter
   * assetId slik at listen har en stabil layout på tvers av refetches.
   */
  async getPositions(trustId: string): AsyncResult<PositionsList> {
    try {
      const trust = await db.trust.findUnique({
        where: { id: trustId },
        include: {
          books: {
            include: {
              accounts: true,
              positions: { include: { account: true } },
            },
          },
        },
      });
      if (!trust) {
        return {
          ok: false,
          error: new HouseError("trust-not-found", `Trust ${trustId} not found.`),
        };
      }
      const book = trust.books[0];
      if (!book) {
        return {
          ok: false,
          error: new HouseError(
            "book-not-found",
            `Trust ${trustId} has no book.`,
          ),
        };
      }

      // Index accounts by id so each position can resolve its venue.
      const accountsById = new Map(book.accounts.map((a) => [a.id, a]));

      let nav = 0;
      const rows: PositionRow[] = book.positions.map((p) => {
        const account = p.account ?? (p.accountId ? accountsById.get(p.accountId) ?? null : null);
        const venue = account?.venue ?? "<orphan>";
        const venueKind = (account?.kind ?? "cex") as PositionRow["venueKind"];
        const category = categorizeAsset(p.assetId);
        const qty = Number(p.quantity);
        const price = referencePrice(p.assetId).price;
        const value = Number.isFinite(qty) && qty > 0 ? qty * price : 0;
        nav += value;
        return {
          id: p.id,
          assetId: p.assetId,
          quantity: p.quantity,
          venue,
          venueKind,
          state: p.state,
          source: p.source,
          confidence: p.confidence,
          category,
          estValue: formatMoney(value),
        };
      });

      // Sort by canonical sleeve order; tiebreak by assetId for stable layout.
      const order: Record<RiskCategory, number> = {
        stable: 0,
        conservative: 1,
        balanced: 2,
        aggressive: 3,
      };
      rows.sort((a, b) => {
        const byCat = order[a.category] - order[b.category];
        if (byCat !== 0) return byCat;
        return a.assetId.localeCompare(b.assetId);
      });

      return {
        ok: true,
        value: {
          trustId: trust.id,
          trustName: trust.name,
          positions: rows,
          nav: formatMoney(nav),
          bookCurrency: book.bookCurrency,
          positionsCount: rows.length,
        },
      };
    } catch (err) {
      return this.error(err);
    }
  }

  /**
   * Bytt modus på trusten. Synkroniserer også trust.books[0].mode slik
   * at BookState-lesere ser oppdateringen uten å traverse til Trust.
   *
   * House-mode: hvis houseExpiry ikke er passert, default = now + 7 dager
   * (plan §2). For andre moduser cleares houseExpiry (House-mandatet er
   * bundet til House-modus).
   *
   * NB: denne metoden sjekker IKKE mode-stigen (canTransition). Det er
   * BFF-en / UI-en sin jobb å kreve bekreftelse på opp-flytt. Service
   * antar at caller allerede har bekreftet.
   */
  async setMode(
    trustId: string,
    mode: OperatingMode,
    houseExpiry?: Date,
  ): AsyncResult<TrustWithRelations> {
    try {
      const expiry =
        mode === OperatingModeEnum.House
          ? (houseExpiry ?? new Date(Date.now() + DEFAULT_HOUSE_EXPIRY_MS))
          : null;

      const trust = await db.$transaction(async (tx) => {
        const t = await tx.trust.update({
          where: { id: trustId },
          data: { mode, houseExpiry: expiry },
        });
        // Sync the book's mode too — BookState-lesere leser Book.mode.
        const books = await tx.book.findMany({ where: { trustId } });
        if (books.length > 0) {
          await tx.book.update({
            where: { id: books[0].id },
            data: { mode, houseExpiry: expiry },
          });
        }
        return t;
      });

      const refreshed = await db.trust.findUnique({
        where: { id: trustId },
        include: TRUST_INCLUDE,
      });
      if (!refreshed) {
        return {
          ok: false,
          error: new HouseError(
            "trust-not-found",
            `Trust ${trustId} was updated but could not be re-fetched.`,
          ),
        };
      }
      void trust; // satisfy linter — used in transaction above
      return { ok: true, value: refreshed };
    } catch (err) {
      return this.error(err);
    }
  }

  /**
   * Utløs kill switch. Setter trust.killedAt = now() OG book.killedAt =
   * now() slik at BookState-lesere (policy engine, signer) ser at kill-
   * switch er aktiv uten å traverse til Trust.
   *
   * v1 markerer bare timestamp — faktisk nøkkelrevokasjon (session keys
   * via KMS, trade-key skruing på CEX) er signer-service sin jobb.
   */
  async triggerKillSwitch(
    trustId: string,
  ): AsyncResult<TrustWithRelations> {
    try {
      const now = new Date();
      await db.$transaction(async (tx) => {
        await tx.trust.update({
          where: { id: trustId },
          data: { killedAt: now },
        });
        const books = await tx.book.findMany({ where: { trustId } });
        for (const book of books) {
          await tx.book.update({
            where: { id: book.id },
            data: { killedAt: now },
          });
        }
      });
      const refreshed = await db.trust.findUnique({
        where: { id: trustId },
        include: TRUST_INCLUDE,
      });
      if (!refreshed) {
        return {
          ok: false,
          error: new HouseError(
            "trust-not-found",
            `Trust ${trustId} kill-switched but could not be re-fetched.`,
          ),
        };
      }
      return { ok: true, value: refreshed };
    } catch (err) {
      return this.error(err);
    }
  }

  /**
   * Slett trusten med kaskaderende books / accounts / positions /
   * mandates / ethics / lots / marks / intents / decisions / snapshots /
   * trustMembers — alt i én `$transaction`.
   *
   * Hvorfor ikke bare `db.trust.delete({ where: { id } })`? Fordi schema-
   * relasjonen `Book.trust` har `onDelete: SetNull` (bookets trustId null-er
   * ut, booket selv forblir), så trust-sletting alene ville etterlate books
   * + alle sub-tabeller. Vi sletter books eksplisitt først; deres sub-
   * tabeller (Account, Position, MandateVersion, EthicsListVersion, Lot,
   * Mark, Intent (med cascade til DecisionApproval + DecisionLogEntry),
   * BookSnapshot) kaskaderer via `onDelete: Cascade` fra Book-relasjonen.
   *
   * TrustMember.trust har `onDelete: Cascade` (medlemmer slettes automatisk
   * når trusten slettes), men vi sletter dem eksplisitt også for å gjøre
   * avhengighetsrekkefølgen åpenbar — og fordi en fremtidig schema-endring
   * til `SetNull` (for å beholde historiske medlemsrader) ellers ville
   * lekke rader.
   *
   * Hvis trusten ikke finnes, returneres `trust-not-found` (idempotent-
   * semantikk: caller kan uansett ikke lenger referere til den).
   */
  async deleteTrust(trustId: string): AsyncResult<void> {
    try {
      await db.$transaction(async (tx) => {
        // 1. Verify the trust exists first — surface a clean
        //    "trust-not-found" instead of a Prisma P2025.
        const trust = await tx.trust.findUnique({
          where: { id: trustId },
          select: { id: true },
        });
        if (!trust) {
          throw new HouseError(
            "trust-not-found",
            `Trust ${trustId} not found.`,
          );
        }

        // 2. Cascade-delete the books. `Book.trust` has onDelete: SetNull,
        //    so the books are NOT auto-deleted with the trust — we do it
        //    ourselves. Deleting the books cascades through their sub-tables
        //    (Account, Position, MandateVersion, EthicsListVersion, Lot,
        //    Mark, Intent→DecisionApproval+DecisionLogEntry, BookSnapshot).
        await tx.book.deleteMany({ where: { trustId } });

        // 3. TrustMember.trust has onDelete: Cascade, so members are auto-
        //    deleted when the trust is deleted. We delete them explicitly
        //    first so the dependency order is unambiguous and a future
        //    schema change (e.g. to SetNull for historical preservation)
        //    does not silently leak orphan rows.
        await tx.trustMember.deleteMany({ where: { trustId } });

        // 4. Finally delete the trust itself.
        await tx.trust.delete({ where: { id: trustId } });
      });
      return { ok: true, value: undefined };
    } catch (err) {
      return this.error(err);
    }
  }

  /**
   * Beregn PortfolioSnapshot: NAV + 4 sleeves + dry powder + aiRole.
   *
   * Owner direction (Task 25): "think really hard on how to make it more
   * detailed and how the multi level should be structured (which data
   * should represented)". 3-nivå hierarki:
   *
   *   1. sleeves (strategisk) — RiskCategory per `categorizeAsset`:
   *      hvor stor andel er stable vs aggressive?
   *   2. assets (taktisk) — per assetId inni hver sleeve:
   *      hva eier jeg egentlig?
   *   3. venues (operasjonelt) — per (account.venue, account.kind) inni
   *      hver asset: hvor er hver eiendel forvaltet?
   *
   * NAV = sum av (quantity × referencePrice) over alle posisjoner. For
   * ukjente assets (ikke i REFERENCE_PRICES) brukkes fallback 1.0 —
   * confidence markeres lavt av caller (v0: ingen confidence i
   * PortfolioSnapshot; advisory har warnings).
   *
   * Posisjoner hentes med `account`-relasjon populert slik at venue +
   * venueKind kan leses per posisjon. Orphan-posisjoner (ingen Account)
   * får venue="<orphan>" + venueKind="cex" (defensive default; skal
   * ikke skje i v1 siden onboarding oppretter en Account per posisjon).
   *
   * dryPowderBps = stable-sleeve vekt i bps. dryPowderStatus = fem-soners
   * klassifikasjon (samma logikk som advisor.ts sin private metode).
   *
   * Bakoverkompatibilitet: alle eksisterende felt på PortfolioSnapshot /
   * Sleeve / Asset er bevart uendret. `venues` er en ren tillegg på
   * Asset-nivå. Eksisterende UI-komponenter som leser `assetId` /
   * `quantity` / `value` / `weightBps` fortsetter å virke.
   */
  async getPortfolio(trustId: string): AsyncResult<PortfolioSnapshot> {
    try {
      // Inline include — samme shape som TRUST_INCLUDE, men med
      // `positions.account` populert så vi kan lese venue + venueKind
      // per posisjon uten et ekstra db-kall. (TRUST_INCLUDE har kun
      // `positions: true` — den returnerer Position uten account.)
      const trust = await db.trust.findUnique({
        where: { id: trustId },
        include: {
          books: {
            include: {
              accounts: true,
              positions: { include: { account: true } },
            },
          },
        },
      });
      if (!trust) {
        return {
          ok: false,
          error: new HouseError("trust-not-found", `Trust ${trustId} not found.`),
        };
      }
      const book = trust.books[0];
      if (!book) {
        return {
          ok: false,
          error: new HouseError(
            "book-not-found",
            `Trust ${trustId} has no book.`,
          ),
        };
      }

      const positions = book.positions;
      const principles: BankrollPrinciples = BankrollPrinciplesSchema.parse({});

      // Live prices — Task 36. Hent ÉN gang per kall (modul-cache deler
      // på tvers av samtidige kall). Hvis CoinGecko er nede / ratelimited
      // returneres REFERENCE_PRICES med source="fallback" — vi fortsetter
      // uansett; UI-en viser Live-pulse ELLER Fallback-badge (Task 38).
      const livePrices = await fetchAggregatedPrices();

      // Index accounts by id so we can resolve venue for orphan positions
      // (Position.accountId satt men Account-relasjonen ikke populert).
      const accountsById = new Map(book.accounts.map((a) => [a.id, a]));

      // 3-level hierarchical accumulator:
      //   sleeve (RiskCategory) → asset (assetId) → venue (venueKey)
      //
      // Hver asset-bucket har en `venueByVenueKey`-Map som grupperer
      // posisjoner per unik (venueKind, venue). `valueSum` på asset-
      // bucketen er summen av venue-verdier (= assetets totale verdi).
      const sleeveByCat: Record<
        RiskCategory,
        Map<
          string,
          {
            venueByVenueKey: Map<
              string,
              {
                venue: string;
                venueKind: string;
                quantitySum: number;
                valueSum: number;
              }
            >;
            quantitySum: number;
            valueSum: number;
            price: number;
            known: boolean;
            entryPrice: string | null;
            priceSource?: string;
            priceConfidence?: string;
            priceIsFallback?: boolean;
          }
        >
      > = {
        stable: new Map(),
        conservative: new Map(),
        balanced: new Map(),
        aggressive: new Map(),
      };

      let nav = 0;
      const valueByCategory: Record<RiskCategory, number> = {
        stable: 0,
        conservative: 0,
        balanced: 0,
        aggressive: 0,
      };

      for (const p of positions) {
        const qty = Number(p.quantity);
        if (!Number.isFinite(qty) || qty <= 0) continue;

        // Resolve price: live CoinGecko først (Task 36), så reference.
        // `livePrices.prices` inneholder ALLTID alle REFERENCE_PRICES (vi
        // merger inn live-data over reference-data i fetchLivePrices), så
        // lookup her vil normalt returnere en pris; hvis asset ikke er i
        // noen tabell, fall tilb til referencePrice sin 1.0 fallback.
        const key = p.assetId.toLowerCase();
        const live = livePrices.prices[key];
        const ref = referencePrice(p.assetId);
        const price =
          typeof live === "number" && Number.isFinite(live)
            ? live
            : ref.price;
        const value = qty * price;
        nav += value;

        // Composite risk scoring upgrade: when a position carries DeFi
        // metadata (positionType + protocol), use categorizePosition to
        // apply the strategy overlay (staking → safer, LP → riskier, etc).
        // For spot positions, categorizeAsset (which now reads from the
        // composite cache) is sufficient.
        const category =
          p.positionType && p.protocol
            ? categorizePosition(p.assetId, p.positionType as DeFiPositionType, p.protocol)
            : categorizeAsset(p.assetId);
        valueByCategory[category] += value;

        // Resolve venue + venueKind from Position.account. Orphan
        // positions (no Account) get defensive defaults — see JSDoc.
        const account =
          p.account ??
          (p.accountId ? accountsById.get(p.accountId) ?? null : null);
        const venue = account?.venue ?? "<orphan>";
        const venueKind = account?.kind ?? "cex";

        const sleeveBucket = sleeveByCat[category];
        let assetBucket = sleeveBucket.get(p.assetId);
        if (!assetBucket) {
          const detail = livePrices.details[key];
          assetBucket = {
            venueByVenueKey: new Map(),
            quantitySum: 0,
            valueSum: 0,
            price,
            known: ref.known,
            entryPrice: p.entryPrice ?? null,
            priceSource: detail?.source,
            priceConfidence: detail?.confidence,
            priceIsFallback: detail?.isFallback,
          };
          sleeveBucket.set(p.assetId, assetBucket);
        }
        assetBucket.quantitySum += qty;
        assetBucket.valueSum += value;

        // Venue key kombinert av (venueKind, venue) så to accounts med
        // samme venue-navn men forskjellig kind (f.eks. cex "binance" +
        // evm-wallet "binance") behandles som to separate custody-rader.
        const venueKey = `${venueKind}::${venue}`;
        let venueBucket = assetBucket.venueByVenueKey.get(venueKey);
        if (!venueBucket) {
          venueBucket = {
            venue,
            venueKind,
            quantitySum: 0,
            valueSum: 0,
          };
          assetBucket.venueByVenueKey.set(venueKey, venueBucket);
        }
        venueBucket.quantitySum += qty;
        venueBucket.valueSum += value;
      }

      const dryPowderBps = nav > 0
        ? Math.round((valueByCategory[RC.Stable] / nav) * 10000)
        : 0;
      const dryPowderStatus = this.classifyDryPowder(dryPowderBps, principles);

      const sleeves: PortfolioSnapshotSleeve[] = RISK_CATEGORY_ORDER.map(
        (category) => {
          const bucket = sleeveByCat[category];
          const sleeveValue = valueByCategory[category];
          const currentWeightBps = nav > 0
            ? Math.round((sleeveValue / nav) * 10000)
            : 0;

          // Sorter assets etter verdi (desc) for stabil layout i
          // pie-chartet. Insertion-order (Map) er ikke deterministisk
          // på tvers av refetches; verdi-desc gir et forutsigbart synk.
          const assetEntries = Array.from(bucket.entries()).sort(
            ([, x], [, y]) => y.valueSum - x.valueSum,
          );

          const assets: PortfolioSnapshotAsset[] = assetEntries.map(
            ([assetId, a]) => {
              const assetValue = a.valueSum;
              const weightBps = nav > 0
                ? Math.round((assetValue / nav) * 10000)
                : 0;

              // Sorter venues etter verdi (desc) — største custody-raden
              // først i listen, slik at pie-byggeren kan rendere den
              // tydeligste lokasjonen først i den ytterste ringen.
              const venueEntries = Array.from(
                a.venueByVenueKey.values(),
              ).sort((x, y) => y.valueSum - x.valueSum);

              const venues: PortfolioSnapshotVenue[] = venueEntries.map(
                (v) => {
                  const venueWeightBps = nav > 0
                    ? Math.round((v.valueSum / nav) * 10000)
                    : 0;
                  // shareOfAssetBps = denne venue-andel av aktivumets
                  // totale verdi (ikke NAV). Summen på tvers av venues
                  // for ett asset = 10000 (100%).
                  const shareOfAssetBps = assetValue > 0
                    ? Math.round((v.valueSum / assetValue) * 10000)
                    : 0;
                  return {
                    venue: v.venue,
                    venueKind: v.venueKind,
                    quantity: formatNumber(v.quantitySum),
                    value: formatMoney(v.valueSum),
                    weightBps: venueWeightBps,
                    shareOfAssetBps,
                  };
                },
              );

              return {
                assetId,
                quantity: formatNumber(a.quantitySum),
                price: formatNumber(a.price),
                value: formatMoney(assetValue),
                weightBps,
                entryPrice: a.entryPrice ?? null,
                venues,
                priceSource: a.priceSource,
                priceConfidence: a.priceConfidence,
                priceIsFallback: a.priceIsFallback,
              };
            },
          );

          return {
            category,
            assets,
            currentWeightBps,
            navContribution: formatMoney(sleeveValue),
          };
        },
      );

      const aiRole = aiRoleForMode(trust.mode as OperatingMode);
      const snapshot: PortfolioSnapshot = {
        trustId: trust.id,
        trustName: trust.name,
        mode: trust.mode as OperatingMode,
        aiRole,
        killSwitchActive: trust.killedAt !== null,
        nav: formatMoney(nav),
        bookCurrency: book.bookCurrency,
        dryPowderBps,
        dryPowderStatus,
        sleeves,
        positionsCount: positions.length,
        priceSource: livePrices.source,
        asOf: new Date(),
        priceDetails: livePrices.details,
        priceSummary: livePrices.summary,
      };
      return { ok: true, value: snapshot };
    } catch (err) {
      return this.error(err);
    }
  }

  // -----------------------------------------------------------------------
  // Mandate + ethics + decisions + snapshots — Task 37.
  // -----------------------------------------------------------------------

  /**
   * Finn nåværende (latest) mandate for trusten. Leter på book.id og
   * sorterer etter version desc. Returnerer null (i Result.ok) hvis trusten
   * ikke har noe mandat enda — BFF-en returnerer da `{ current: null }`
   * så UI-et vet å vise "create initial mandate"-panelet.
   */
  async getCurrentMandate(trustId: string): AsyncResult<MandateVersion | null> {
    try {
      const book = await this.getBookIdForTrust(trustId);
      if (!book.ok) return book;
      const latest = await db.mandateVersion.findFirst({
        where: { bookId: book.value },
        orderBy: { version: "desc" },
      });
      return { ok: true, value: latest };
    } catch (err) {
      return this.error(err);
    }
  }

  /**
   * Hent alle mandate-versjoner (immutable history). Sortert etter version
   * desc slik at nyeste versjon er først i listen. UI-et rendrer en
   * "Mandate history"-tabell fra denne listen.
   */
  async getMandateVersions(trustId: string): AsyncResult<MandateVersion[]> {
    try {
      const book = await this.getBookIdForTrust(trustId);
      if (!book.ok) return book;
      const versions = await db.mandateVersion.findMany({
        where: { bookId: book.value },
        orderBy: { version: "desc" },
      });
      return { ok: true, value: versions };
    } catch (err) {
      return this.error(err);
    }
  }

  /**
   * Oppdater mandatet. Oppretter ALLTID en ny immutable MandateVersion-rad
   * (se schema §7 — mandate-endringer overskriver aldri historikk).
   *
   * Flow:
   *   1. Finn trust + book. 404 hvis trusten ikke finnes / ingen book.
   *   2. Finn latest mandate (kan være null hvis first-time).
   *   3. Dyp-merge previous.payload med input. Hvis previous er null,
   *      fallback til MandateSchema-defaults (`MandateSchema.parse({})`).
   *   4. `version = (previous?.version ?? 0) + 1`. Bump på den nye raden.
   *   5. Valider hele det nye Mandate-objektet med MandateSchema.parse(...).
   *      Hvis valideringen feiler, returneres "mandate-invalid" uten å skrive.
   *   6. JSON.stringify payload. Lagre ny rad. Returner den.
   *
   * `summary` defaulter til `mandateSummary(parsed)` hvis ikke oppgitt.
   * `createdBy` defaulter til "system" hvis ikke oppgitt.
   */
  async updateMandate(
    trustId: string,
    input: UpdateMandateInput,
  ): AsyncResult<MandateVersion> {
    try {
      const book = await this.getBookIdForTrust(trustId);
      if (!book.ok) return book;

      const latest = await db.mandateVersion.findFirst({
        where: { bookId: book.value },
        orderBy: { version: "desc" },
      });

      // Start from the previous mandate (or defaults if first version).
      // If the stored payload fails validation (shouldn't happen, but be
      // defensive — a corrupted JSON should not brick the mandate editor),
      // fall back to schema defaults so the trustee can recover by saving
      // a fresh version.
      let prev: Mandate | null = null;
      if (latest) {
        const parsedPrev = MandateSchema.safeParse(JSON.parse(latest.payload));
        if (parsedPrev.success) prev = parsedPrev.data;
      }
      const base: Mandate = prev ?? MandateSchema.parse({ version: 1 });

      // Deep-merge riskBudget (per-field override).
      const nextRiskBudget: RiskBudget = {
        maxSingleAssetWeightBps:
          input.riskBudget?.maxSingleAssetWeightBps ??
          base.riskBudget.maxSingleAssetWeightBps,
        maxStablecoinFloorBps:
          input.riskBudget?.maxStablecoinFloorBps ??
          base.riskBudget.maxStablecoinFloorBps,
        maxVenueConcentrationBps:
          input.riskBudget?.maxVenueConcentrationBps ??
          base.riskBudget.maxVenueConcentrationBps,
        maxPortfolioDrawdownBps:
          input.riskBudget?.maxPortfolioDrawdownBps ??
          base.riskBudget.maxPortfolioDrawdownBps,
        leverageCap:
          input.riskBudget?.leverageCap ?? base.riskBudget.leverageCap,
      };

      // Deep-merge optInSleeves.
      const nextOptInSleeves: OptInSleeves = {
        lending: input.optInSleeves?.lending ?? base.optInSleeves.lending,
        lp: input.optInSleeves?.lp ?? base.optInSleeves.lp,
      };

      // allowedActions + universe overwrite (caller-supplied arrays win).
      const nextAllowedActions = input.allowedActions ?? base.allowedActions;
      const nextUniverse = input.universe ?? base.universe;

      const nextVersion = (latest?.version ?? 0) + 1;

      // Compose the new Mandate object. The schema validates everything
      // (positive integers, non-empty universe, valid objective enum, etc).
      const draft: Mandate = {
        objective: input.objective ?? base.objective,
        riskBudget: nextRiskBudget,
        allowedActions: nextAllowedActions,
        optInSleeves: nextOptInSleeves,
        bookCurrency: input.bookCurrency ?? base.bookCurrency,
        universe: nextUniverse,
        version: nextVersion,
      };

      const parsed = MandateSchema.safeParse(draft);
      if (!parsed.success) {
        return {
          ok: false,
          error: new HouseError(
            "mandate-invalid",
            `Mandate validation failed: ${parsed.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; ")}`,
          ),
        };
      }
      const payload = JSON.stringify(parsed.data);
      const summary = input.summary ?? mandateSummary(parsed.data);
      const createdBy = input.createdBy ?? "system";

      // Atomic insert — never update an existing row. The unique constraint
      // on (bookId, version) guards against a race that double-creates the
      // same version (would surface as a Prisma P2002 → "mandate-version-conflict").
      const created = await db.$transaction(async (tx) => {
        return tx.mandateVersion.create({
          data: {
            bookId: book.value,
            version: nextVersion,
            payload,
            summary,
            createdBy,
          },
        });
      });
      return { ok: true, value: created };
    } catch (err) {
      return this.error(err);
    }
  }

  /**
   * Finn nåværende ethics-liste for trusten. Returnerer null hvis ingen
   * finnes — UI-et viser da en "create initial ethics list"-knapp.
   */
  async getCurrentEthicsList(
    trustId: string,
  ): AsyncResult<EthicsListVersion | null> {
    try {
      const book = await this.getBookIdForTrust(trustId);
      if (!book.ok) return book;
      const latest = await db.ethicsListVersion.findFirst({
        where: { bookId: book.value },
        orderBy: { version: "desc" },
      });
      return { ok: true, value: latest };
    } catch (err) {
      return this.error(err);
    }
  }

  /**
   * Oppdater ethics-listen. Oppretter ALLTID en ny immutable
   * EthicsListVersion-rad. Dyp-merger med forrige versjon (se
   * updateMandate for merge-semantikk).
   *
   * `hardExclude.*` arrays overskriver hvis oppgitt; ellers beholdes forrige.
   * `softPrefer.*` og `toggles.*` dyp-merges per boolean.
   */
  async updateEthicsList(
    trustId: string,
    input: UpdateEthicsInput,
  ): AsyncResult<EthicsListVersion> {
    try {
      const book = await this.getBookIdForTrust(trustId);
      if (!book.ok) return book;

      const latest = await db.ethicsListVersion.findFirst({
        where: { bookId: book.value },
        orderBy: { version: "desc" },
      });

      // Start from the previous ethics list (or defaults if first version).
      // Defensive: a corrupted JSON should not brick the editor.
      let prev: EthicsList | null = null;
      if (latest) {
        const parsedPrev = EthicsListSchema.safeParse(
          JSON.parse(latest.payload),
        );
        if (parsedPrev.success) prev = parsedPrev.data;
      }

      // EthicsListSchema requires version; parse with default to seed defaults
      // for the other fields (arrays default [], booleans default per schema).
      const base: EthicsList = prev ?? EthicsListSchema.parse({ version: 1 });

      // Hard exclude — per-array overwrite.
      const nextHard: HardExclude = {
        sanctionedAddresses:
          input.hardExclude?.sanctionedAddresses ?? base.hardExclude.sanctionedAddresses,
        knownMixers:
          input.hardExclude?.knownMixers ?? base.hardExclude.knownMixers,
        unverifiedContracts:
          input.hardExclude?.unverifiedContracts ??
          base.hardExclude.unverifiedContracts,
        userBlockedAssets:
          input.hardExclude?.userBlockedAssets ??
          base.hardExclude.userBlockedAssets,
      };

      // Soft prefer — per-boolean merge.
      const nextSoft: SoftPrefer = {
        preferLiquidity: input.softPrefer?.preferLiquidity ?? base.softPrefer.preferLiquidity,
        preferPublishedSupply:
          input.softPrefer?.preferPublishedSupply ??
          base.softPrefer.preferPublishedSupply,
        preferWithdrawalHistory:
          input.softPrefer?.preferWithdrawalHistory ??
          base.softPrefer.preferWithdrawalHistory,
      };

      // Toggles — per-boolean merge.
      const nextToggles: EthicsToggles = {
        privacyCoins: input.toggles?.privacyCoins ?? base.toggles.privacyCoins,
        gamblingTokens: input.toggles?.gamblingTokens ?? base.toggles.gamblingTokens,
        memeSleeves: input.toggles?.memeSleeves ?? base.toggles.memeSleeves,
      };

      const nextVersion = (latest?.version ?? 0) + 1;
      const draft: EthicsList = {
        hardExclude: nextHard,
        softPrefer: nextSoft,
        toggles: nextToggles,
        version: nextVersion,
      };

      const parsed = EthicsListSchema.safeParse(draft);
      if (!parsed.success) {
        return {
          ok: false,
          error: new HouseError(
            "ethics-invalid",
            `Ethics list validation failed: ${parsed.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; ")}`,
          ),
        };
      }
      const payload = JSON.stringify(parsed.data);
      const createdBy = input.createdBy ?? "system";

      const created = await db.$transaction(async (tx) => {
        return tx.ethicsListVersion.create({
          data: {
            bookId: book.value,
            version: nextVersion,
            payload,
            createdBy,
          },
        });
      });
      return { ok: true, value: created };
    } catch (err) {
      return this.error(err);
    }
  }

  /**
   * Hent beslutningsloggen (audit trail av accepterte/avviste intents).
   * Sortert etter createdAt desc (nyeste først). `limit` defaulter til 50
   * og caps til 200 for å unngå at et tungt UI-kall spiser hele tabellen.
   *
   * Hver DecisionLogEntry returneres sammen med sin 1:1 Intent-relasjon
   * slik at UI-et kan vise "intent X for asset Y → decided Z" i én rad
   * uten et ekstra resolve-kall.
   */
  async getDecisions(
    trustId: string,
    limit?: number,
  ): AsyncResult<DecisionWithIntent[]> {
    try {
      const book = await this.getBookIdForTrust(trustId);
      if (!book.ok) return book;

      const cappedLimit = Math.max(1, Math.min(limit ?? 50, 200));
      // `include: { intent: true }` joins the 1:1 Intent per DecisionLogEntry
      // so we can return both objects in one row (see DecisionWithIntent).
      const rows = await db.decisionLogEntry.findMany({
        where: { bookId: book.value },
        include: { intent: true },
        orderBy: { createdAt: "desc" },
        take: cappedLimit,
      });

      // Strip the nested `intent` from `entry` so the response shape is clean
      // (the outer `intent` already carries the same data — Prisma's include
      // would otherwise duplicate it inside `entry.intent`).
      const out: DecisionWithIntent[] = rows.map(
        ({ intent: _intent, ...entry }) => ({
          entry,
          intent: _intent,
        }),
      );
      return { ok: true, value: out };
    } catch (err) {
      return this.error(err);
    }
  }

  /**
   * Hent BookSnapshot-rader (NAV-historikk for chartet). Sortert etter
   * snapshotAt desc (nyeste først). `limit` defaulter til 30 og caps til 365
   * (ett år med daglige snapshots er maks UI-et prøver å vise).
   */
  async getSnapshots(
    trustId: string,
    limit?: number,
  ): AsyncResult<BookSnapshot[]> {
    try {
      const book = await this.getBookIdForTrust(trustId);
      if (!book.ok) return book;

      const cappedLimit = Math.max(1, Math.min(limit ?? 30, 365));
      const rows = await db.bookSnapshot.findMany({
        where: { bookId: book.value },
        orderBy: { snapshotAt: "desc" },
        take: cappedLimit,
      });
      return { ok: true, value: rows };
    } catch (err) {
      return this.error(err);
    }
  }

  /**
   * Ta et nytt snapshot av nåværende book-tilstand. Beregner:
   *   - `nav` : sum (qty × referencePrice) over alle posisjoner, i book
   *              currency. v0 Number-basert (se JSDoc-advarsel på
   *              getPortfolio).
   *   - `weights` : JSON-blob `{ assetId: weightBps }` for drift-view.
   *              Ett entry per posisjon-asset (aggregert over venues).
   *   - `drawdownBps` : (peakNAV - currentNAV) / peakNAV × 10000, clamped
   *              til 0 hvis currentNAV > peak (ny topp). peak leses fra
   *              alle tidligere snapshots — hvis ingen finnes (first
   *              snapshot) blir drawdown 0.
   *
   * Lagrer raden med `snapshotAt = now()` (eller caller-suppliert via en
   * fremtidig opt-in; ikke i v1). Returnerer den nye raden.
   *
   * Atomic: kalkyle og insert skjer i én `$transaction` så to samtidige
   * `takeSnapshot`-kall aldri ser et inkonsistent peak.
   */
  async takeSnapshot(trustId: string): AsyncResult<BookSnapshot> {
    try {
      const bookId = await this.getBookIdForTrust(trustId);
      if (!bookId.ok) return bookId;

      // Hent live-priser ÉN gang før transaksjonen (utenfor tx fordi
      // fetchLivePrices har modul-cache + dedup; å pakke den inni tx ville
      // holdt transaksjonen åpen under nettverks-IOen).
      const livePrices = await fetchAggregatedPrices();

      const created = await db.$transaction(async (tx) => {
        // 1. Hent book + posisjoner (med account for venue-resolve,
        //    selv om vi ikke trenger venue her — vi aggregerer per asset).
        const book = await tx.book.findUnique({
          where: { id: bookId.value },
          include: { positions: true },
        });
        if (!book) {
          throw new HouseError(
            "book-not-found",
            `Book ${bookId.value} not found.`,
          );
        }

        // 2. Beregn NAV + per-asset vekter. Bruk live-pris først (Task 36),
        //    reference-pris som fallback for assets som ikke er på CoinGecko
        //    (f.eks. rlusd). Samme logikk som getPortfolio — slik at en ny
        //    snapshot matcher /api/portfolio sin NAV, ikke et uventet
        //    avvik fra reference-pris-regnet.
        let nav = 0;
        const valueByAsset = new Map<string, number>();
        for (const p of book.positions) {
          const qty = Number(p.quantity);
          if (!Number.isFinite(qty) || qty <= 0) continue;
          const key = p.assetId.toLowerCase();
          const live = livePrices.prices[key];
          const ref = referencePrice(p.assetId);
          const price =
            typeof live === "number" && Number.isFinite(live)
              ? live
              : ref.price;
          const value = qty * price;
          nav += value;
          valueByAsset.set(p.assetId, (valueByAsset.get(p.assetId) ?? 0) + value);
        }

        // 3. weights JSON-blob: { assetId: weightBps }. vekt av NAV i bps.
        const weights: Record<string, number> = {};
        for (const [assetId, value] of valueByAsset.entries()) {
          weights[assetId] = nav > 0 ? Math.round((value / nav) * 10000) : 0;
        }

        // 4. Beregn drawdown fra peak. Les peak fra alle snapshots.
        //    (v0 Number-basert — se JSDoc-advarsel.)
        const previousSnapshots = await tx.bookSnapshot.findMany({
          where: { bookId: book.id },
          orderBy: { snapshotAt: "asc" },
          select: { nav: true },
        });
        let peak = nav;
        for (const s of previousSnapshots) {
          const prevNav = Number(s.nav);
          if (Number.isFinite(prevNav) && prevNav > peak) {
            peak = prevNav;
          }
        }
        const drawdownBps = peak > 0
          ? Math.max(0, Math.round(((peak - nav) / peak) * 10000))
          : 0;

        // 5. Lagre ny rad. Prisma @default(now()) setter snapshotAt.
        return tx.bookSnapshot.create({
          data: {
            bookId: book.id,
            nav: formatMoney(nav),
            weights: JSON.stringify(weights),
            drawdownBps,
          },
        });
      });
      return { ok: true, value: created };
    } catch (err) {
      return this.error(err);
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers.
  // -----------------------------------------------------------------------

  /**
   * Finn bookId for en trust. Hjelpefunksjon for mandate/ethics/decisions/
   * snapshots-metodene (Task 37) — disse opererer på book-nivå men tar
   * trustId som parameter fra BFF-en. Forenkler kallesiden (UI-et har
   * kun trustId etter /api/trust).
   *
   * Returnerer enten `{ ok: true, value: bookId }` eller en Result-err
   * (samme shape som alle andre metoder). Caller-bruk:
   *   const book = await this.getBookIdForTrust(trustId);
   *   if (!book.ok) return book;
   */
  private async getBookIdForTrust(
    trustId: string,
  ): AsyncResult<string> {
    try {
      const trust = await db.trust.findUnique({
        where: { id: trustId },
        select: {
          id: true,
          books: { select: { id: true } },
        },
      });
      if (!trust) {
        return {
          ok: false,
          error: new HouseError(
            "trust-not-found",
            `Trust ${trustId} not found.`,
          ),
        };
      }
      const book = trust.books[0];
      if (!book) {
        return {
          ok: false,
          error: new HouseError(
            "book-not-found",
            `Trust ${trustId} has no book.`,
          ),
        };
      }
      return { ok: true, value: book.id };
    } catch (err) {
      return this.error(err);
    }
  }

  /**
   * Fem-soners dry-powder-klassifikasjon (samma logikk som advisor.ts
   * sin private classifyDryPowder). Holdt her så getPortfolio ikke
   * trenger å instansiere advisor (som krever BookState + RegimeState).
   */
  private classifyDryPowder(
    dryPowderBps: number,
    principles: BankrollPrinciples,
  ): DryPowderStatus {
    const { dryPowderFloorBps, dryPowderCriticalBps, dryPowderTargetBps } =
      principles;
    if (dryPowderBps < dryPowderCriticalBps) return DryPowderStatus.Critical;
    if (dryPowderBps < dryPowderFloorBps) return DryPowderStatus.BelowFloor;
    if (
      Math.abs(dryPowderBps - dryPowderTargetBps) <= AT_TARGET_TOLERANCE_BPS
    ) {
      return DryPowderStatus.AtTarget;
    }
    if (dryPowderBps > dryPowderTargetBps) return DryPowderStatus.AboveTarget;
    return DryPowderStatus.AboveFloor;
  }

  /**
   * Dedupe positions per (assetId, venue, venueKind, positionType) —
   * summer kvanta. Nødvendig fordi Position-tabellen har unique constraint
   * på (bookId, assetId, state, source), og state avledes fra positionType
   * for DeFi-posisjoner. To DeFi-posisjoner på samme asset+venue men ulik
   * positionType (f.eks. "staking" og "lending") vil få ulik state og må
   * derfor IKKE merges — de er separate rader i boken.
   *
   * positionType inkluderes i key bare når den er definert; udefinert
   * positionType (vanlig for cex / wallet-posisjoner) gir samme key som
   * før så legacy-oppførsel er bevart.
   */
  private dedupePositions<P extends AddPositionInput>(positions: P[]): P[] {
    const map = new Map<string, P>();
    for (const p of positions) {
      const positionType = (p as { positionType?: string }).positionType;
      const key = `${p.assetId}::${p.venue}::${p.venueKind}::${positionType ?? ""}`;
      const existing = map.get(key);
      if (existing) {
        const sum = Number(existing.quantity) + Number(p.quantity);
        map.set(key, { ...existing, quantity: String(sum) });
      } else {
        map.set(key, { ...p });
      }
    }
    return Array.from(map.values());
  }

  /**
   * Konverter en ukjent feil til HouseError. Prisma-feil (P2002 unique-
   * constraint, P2025 not-found) mappes til domene-feil; alt annet blir
   * "trust-service-error".
   *
   * P2002 cases per table:
   *   - Position unique constraint → "duplicate-position" (legacy code path).
   *   - MandateVersion (bookId, version) → "mandate-version-conflict" (race
   *     where two concurrent updates both bumped to the same version).
   *   - EthicsListVersion (bookId, version) → "ethics-version-conflict".
   */
  private error(err: unknown): {
    ok: false;
    error: HouseError;
  } {
    if (err instanceof HouseError) {
      return { ok: false, error: err };
    }
    const message = err instanceof Error ? err.message : String(err);
    // Prisma unique-constraint — branch on the table being violated.
    if (message.includes("Unique constraint")) {
      const lowered = message.toLowerCase();
      if (lowered.includes("mandateversion")) {
        return {
          ok: false,
          error: new HouseError(
            "mandate-version-conflict",
            `A mandate version conflict occurred (race). Reload the latest version and try again. ${message}`,
          ),
        };
      }
      if (lowered.includes("ethicslistversion")) {
        return {
          ok: false,
          error: new HouseError(
            "ethics-version-conflict",
            `An ethics list version conflict occurred (race). Reload the latest version and try again. ${message}`,
          ),
        };
      }
      if (lowered.includes("trustmember")) {
        return {
          ok: false,
          error: new HouseError(
            "trust-service-error",
            `A trust member with this (trustId, userId) already exists. This usually means you already have a trust — try signing out and back in. ${message}`,
          ),
        };
      }
      return {
        ok: false,
        error: new HouseError(
          "duplicate-position",
          `A position with this (asset, venue, state, source) already exists. ${message}`,
        ),
      };
    }
    return {
      ok: false,
      error: new HouseError("trust-service-error", message),
    };
  }
}

/**
 * Factory. Returnerer PrismaTrustService. En senere fase kan bytte
 * implementasjon (e.g. en CachingTrustService som caches getPortfolio i
 * 5 sekunder) ved å bytte kroppen her.
 */
export function createTrustService(): TrustService {
  return new PrismaTrustService();
}

// ---------------------------------------------------------------------------
// Demo-trustee — v0 stand-in. DEPRECATED in Phase 1 (Task 42-45).
//
// House is now multi-tenant: every BFF route resolves the userId from the
// NextAuth session via `requireAuth()` (see src/lib/auth-helpers.ts) and
// passes it to `getCurrentTrust(userId)` / `createTrustWithPositions(
// input, userId)`. The demo trustee constant + helper remain in tree for
// the seed script (which writes the demo row with a bcrypt password) and
// for legacy callers that have not been migrated yet. New code MUST NOT
// import this — it is a code-smell signal in review.
// ---------------------------------------------------------------------------

/** Demo-trustee epost — seedes av `prisma/seed.ts` med passwordHash. */
export const DEMO_TRUSTEE_EMAIL = "trustee@house.local";

/**
 * Get-or-create demo-trustee. DEPRECATED (Task 42-45).
 *
 * @deprecated Use `requireAuth()` from `src/lib/auth-helpers.ts` instead —
 *             it reads the userId from the NextAuth session and returns
 *             401 if unauthenticated. This helper is retained only for
 *             the seed script and legacy callers that have not been
 *             migrated; new code MUST NOT call it.
 *
 * First call creates the row; subsequent calls return it. Idempotent.
 *
 * NB: in v0 this was the only trust-key path; in Phase 1 it has been
 * replaced by NextAuth session.userId in every BFF route. Trust isolation
 * depends on the new path — this helper returns the SHARED demo user and
 * must not be used in any multi-tenant code.
 */
export async function getOrCreateDemoTrustee(): Promise<{
  id: string;
  email: string;
}> {
  const existing = await db.user.findUnique({
    where: { email: DEMO_TRUSTEE_EMAIL },
  });
  if (existing) {
    return { id: existing.id, email: existing.email };
  }
  const created = await db.user.create({
    data: {
      email: DEMO_TRUSTEE_EMAIL,
      name: "Demo Trustee",
      role: "owner",
    },
  });
  return { id: created.id, email: created.email };
}

// ---------------------------------------------------------------------------
// Helpers — source/confidence avledning.
// ---------------------------------------------------------------------------

/**
 * Map venueKind → Position.source (per book.ts JSDoc).
 *
 *   cex           → "cex-balance"   (CEX spot balance)
 *   evm-wallet    → "rpc-balance"   (on-chain EOA balance)
 *   solana-wallet → "rpc-balance"   (on-chain Solana balance)
 *   stake-defi    → "staking-contract" (staked position)
 *
 * NB: specen sa "Bruk categorizeAsset for å sette source", men
 * categorizeAsset returnerer en RiskCategory (sleeve), ikke en source.
 * source er WHERE posisjonen kom fra (CEX vs on-chain vs DeFi). Vi
 * avleder source fra venueKind — det er semantisk riktig. categorizeAsset
 * brukes i getPortfolio for å gruppere posisjoner per sleeve (dens
 * faktiske bruk).
 */
function sourceForVenueKind(
  venueKind: AddPositionInput["venueKind"],
): string {
  switch (venueKind) {
    case "cex":
      return "cex-balance";
    case "evm-wallet":
    case "solana-wallet":
    case "xrp-wallet":
      return "rpc-balance";
    case "stake-defi":
      return "staking-contract";
    case "dex":
      return "dex-balance";
  }
}

/**
 * Map venueKind → Position.confidence (per book.ts JSDoc).
 *
 *   cex / evm-wallet / solana-wallet → "high"  (venue/rpc = source of truth)
 *   stake-defi                       → "medium" (indexer dependent)
 */
function confidenceForVenueKind(
  venueKind: AddPositionInput["venueKind"],
): "high" | "medium" | "low" {
  switch (venueKind) {
    case "cex":
    case "evm-wallet":
    case "solana-wallet":
    case "xrp-wallet":
      return "high";
    case "stake-defi":
    case "dex":
      return "medium";
  }
}

/**
 * Map DeFi positionType → Position.state (Task 47-49 — Side 4 DeFi-felter).
 *
 *   staking → "staked"
 *   lending → "lending"
 *   lp      → "lp"
 *   vault   → "staked"  (vault aksjer behandles som staked inntil egen state)
 *   undefined / unknown → "staked" (defensive fallback for DeFi uten type)
 *
 * Kalles kun når venueKind === "stake-defi"; andre venueKinds bruker "free".
 */
function stateForPositionType(
  positionType?: "staking" | "lending" | "lp" | "vault",
): string {
  switch (positionType) {
    case "staking":
    case "vault":
      return "staked";
    case "lending":
      return "lending";
    case "lp":
      return "lp";
    default:
      // Defensive — DeFi-posisjon uten positionType. "staked" er det
      // minst overraskende default for en stake-defi venue.
      return "staked";
  }
}

/** Format a number to a precision-2 money string. v0 Number-based. */
function formatMoney(n: number): string {
  return n.toFixed(2);
}

/** Format a number to a precision-6 string for quantity / price display. */
function formatNumber(n: number): string {
  // Trim trailing zeros after the decimal but keep at least 2 decimals.
  return Number(n.toFixed(6)).toString();
}
