import type { BookState, Mark, Position, Account, Lot } from "../domain/book";
import {
  MarkKind,
  PositionState,
  Confidence,
  AccountKind,
  KeyScope,
} from "../domain/book";
import { OperatingMode } from "../domain/modes";
import type { Mandate } from "../domain/mandate";
import {
  MandateObjective,
  AllowedAction,
  RiskBudgetSchema,
} from "../domain/mandate";
import type { BankrollPrinciples } from "../domain/bankroll";
import { BankrollPrinciplesSchema } from "../domain/bankroll";
import type { RegimeMark } from "../services/regime-detector";

import type { TrustWithRelations } from "../services/trust-service";
import { referencePrice } from "./reference-prices";
import { fetchLivePrices } from "./coingecko-client";

/**
 * Bridge fra Trust (Prisma) → advisory-input (BookState + Mandate +
 * Principles + RegimeMark[]) (Task 12; plan §3 + §6).
 *
 * Advisory-ruten (src/app/api/advisory/route.ts) byttet i Task 12 fra å
 * konsumere den in-memory demo-boken til å konsumere NÅVÆRENDE TRUST hvis
 * demo-brukeren har én (ellers fall tilb til demo-boken). Denne filen
 * innkapsler konverteringen slik at ruten holder tynn.
 *
 * Konverteringsregler:
 *   - accounts fra trust.books[0].accounts (rent admin-metadata).
 *   - positions fra trust.books[0].positions (samme shape som DB-raden).
 *   - marks: per assetId fra REFERENCE_PRICES (v0; Phase 1 bytter til
 *     MarketService). BTC + ETH får en 7-sample 90-dagers history så
 *     regime-detektoren har noe å tygge på — samme demo-history som
 *     demo-book.ts bruker.
 *   - mode: fra trust.mode (mode-synk mellom Trust og Book gjøres i
 *     trust-service.setMode).
 *   - killSwitchActive: fra trust.killedAt !== null.
 *   - mandate: samme defaults som demo-book.ts (RiskBudgetSchema.parse
 *     med samme caps; allowedActions [hold, rebalance-spot, stake,
 *     unstake]; optInSleeves { lending: false, lp: false }).
 *   - principles: BankrollPrinciplesSchema.parse({}) = alle defaults.
 *
 * Math caveat: v0 bruker JS Number. Produksjon MÅ bruke fixed-point
 * decimal lib. Ikke installer i v0 — dette er den eksplisitte JSDoc-
 * advarselen.
 */

/** Output av buildAdvisoryInputFromTrust — det advisory-ruten trenger. */
export interface AdvisoryInput {
  bookState: BookState;
  mandate: Mandate;
  principles: BankrollPrinciples;
  marks: RegimeMark[];
  /** "live" hvis marks er bygget med live CoinGecko-priser; "fallback"
   * hvis CoinGecko var nede / ratelimited og vi falt tilbake til
   * REFERENCE_PRICES. Advisory-ruten propagerer dette til /api/advisory
   * så UI-en (Task 38) kan vise Live-pulse vs Fallback-badge. */
  priceSource: "live" | "fallback";
}

/**
 * BTC 90-dagers history (7 samples, slight uptrend) — samme datasett
 * som demo-book.ts bruker, duplikat her så trust-book.ts er selvstendig.
 *
 * 7 samples, log-return over window = ln(60000/40000) = +40.5%. SMA(7)
 * ≈ 50,286 < 60,000 → sma-200 bull. Monoton up → drawdown-from-peak
 * neutral. Realized vol ~ 30-40% annualized.
 *
 * Phase 1 bytter dette ut med live CoinGecko-historikk via MarketService.
 */
const BTC_REFERENCE_HISTORY: { t: Date; price: string }[] = [
  { t: new Date("2026-07-11T12:00:00.000Z"), price: "40000" },
  { t: new Date("2026-07-26T12:00:00.000Z"), price: "42500" },
  { t: new Date("2026-08-10T12:00:00.000Z"), price: "46000" },
  { t: new Date("2026-08-25T12:00:00.000Z"), price: "51000" },
  { t: new Date("2026-09-09T12:00:00.000Z"), price: "55000" },
  { t: new Date("2026-09-24T12:00:00.000Z"), price: "57500" },
  { t: new Date("2026-10-09T12:00:00.000Z"), price: "60000" },
];

/**
 * ETH 90-dagers history (7 samples, slight uptrend) — samme mønster
 * som BTC. Phase 1 bytter ut med live data.
 */
const ETH_REFERENCE_HISTORY: { t: Date; price: string }[] = [
  { t: new Date("2026-07-11T12:00:00.000Z"), price: "1700" },
  { t: new Date("2026-07-26T12:00:00.000Z"), price: "1850" },
  { t: new Date("2026-08-10T12:00:00.000Z"), price: "2000" },
  { t: new Date("2026-08-25T12:00:00.000Z"), price: "2150" },
  { t: new Date("2026-09-09T12:00:00.000Z"), price: "2300" },
  { t: new Date("2026-09-24T12:00:00.000Z"), price: "2400" },
  { t: new Date("2026-10-09T12:00:00.000Z"), price: "2500" },
];

/**
 * Bygg advisory-input fra en trust. Returnerer `null` hvis trusten ikke
 * har en book — advisory-ruten faller da tilbake til demo-boken.
 *
 * Universe: bygd fra trustens posisjoner (samme semantikk som demo-boken
 * — ethvert asset som er på boket er i universe; advisory slår ikke av
 * noe bare fordi det mangler fra en hardkodet liste).
 *
 * Priser (Task 36): henter live CoinGecko-priser (60s cache) ÉN gang
 * i starten av metoden; bruker live pris hvis tilgjengelig, fallback til
 * REFERENCE_PRICES hvis CoinGecko er nede ELLER asset ikke er på CoinGecko.
 * `priceSource` på AdvisoryInput propageres til /api/advisory slik at UI-en
 * (Task 38) kan vise Live-pulse vs Fallback-badge.
 *
 * NB: metoden er nå `async` fordi `fetchLivePrices` er async. Caller MÅ
 * `await`e resultatet.
 */
export async function buildAdvisoryInputFromTrust(
  trust: TrustWithRelations,
): Promise<AdvisoryInput | null> {
  const book = trust.books[0];
  if (!book) return null;

  // Hent live priser ÉN gang (modul-cache deler på tvers av samtidige
  // kall). Hvis CoinGecko er nede, returneres REFERENCE_PRICES med
  // source="fallback" — vi fortsetter uansett.
  const livePrices = await fetchLivePrices();

  const now = new Date();
  const bookId = book.id;

  const accounts: Account[] = book.accounts.map((a) => ({
    id: a.id,
    bookId: a.bookId,
    kind: a.kind as AccountKind,
    venue: a.venue,
    ref: a.ref,
    keyScope: a.keyScope as KeyScope,
    withdrawAllow: parseWithdrawAllow(a.withdrawAllow),
    active: a.active,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }));

  const positions: Position[] = book.positions.map((p) => ({
    id: p.id,
    bookId: p.bookId,
    accountId: p.accountId,
    assetId: p.assetId,
    state: p.state as PositionState,
    quantity: p.quantity,
    source: p.source,
    confidence: p.confidence as Confidence,
    asOf: p.asOf,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }));

  // Lots: v0 bruker en lot per posisjon med cost = quantity × pris (live
  // hvis tilgjengelig, ellers reference). Phase 3 fyller lots fra fill-
  // reconciliation.
  const lots: Lot[] = book.positions.map((p) => {
    const ref = referencePrice(p.assetId);
    const live = livePrices.prices[p.assetId.toLowerCase()];
    const price =
      typeof live === "number" && Number.isFinite(live) ? live : ref.price;
    const qty = Number(p.quantity);
    const cost = (qty * price).toFixed(2);
    return {
      id: `lot-${p.id}`,
      bookId,
      assetId: p.assetId,
      quantity: p.quantity,
      costLocal: cost,
      venue: accountVenue(accounts, p.accountId),
      acquiredAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 90),
      decisionId: null,
      createdAt: now,
    };
  });

  // Marks: per assetId fra live priser (Task 36) med reference-fallback.
  // BTC + ETH får history så regime-detektoren har noe å tygge på.
  const seenAssets = new Set<string>();
  const marksRecord: Record<string, Mark> = {};
  const regimeMarks: RegimeMark[] = [];
  for (const p of book.positions) {
    if (seenAssets.has(p.assetId)) continue;
    seenAssets.add(p.assetId);
    const ref = referencePrice(p.assetId);
    const live = livePrices.prices[p.assetId.toLowerCase()];
    const price =
      typeof live === "number" && Number.isFinite(live) ? live : ref.price;
    const priceStr = String(price);
    // source: "coingecko" hvis vi brukte live-data, ellers reference-source.
    const source =
      typeof live === "number" && Number.isFinite(live)
        ? (livePrices.source === "live" ? "coingecko" : "reference-fallback")
        : ref.source;
    marksRecord[p.assetId] = {
      id: `mark-${p.assetId.toLowerCase()}`,
      bookId,
      assetId: p.assetId,
      kind: MarkKind.Reference,
      price: priceStr,
      liquidity: null,
      source,
      observedAt: now,
      createdAt: now,
    };
    const history =
      p.assetId.toLowerCase() === "btc"
        ? BTC_REFERENCE_HISTORY
        : p.assetId.toLowerCase() === "eth"
          ? ETH_REFERENCE_HISTORY
          : undefined;
    regimeMarks.push({
      assetId: p.assetId,
      price: priceStr,
      history,
    });
  }

  // Mode fra trusten — Book.mode er synkronisert av trust-service.
  const mode = (trust.mode as OperatingMode) || OperatingMode.Observe;

  const bookState: BookState = {
    bookId,
    mode,
    bookCurrency: book.bookCurrency,
    accounts,
    positions,
    lots,
    marks: marksRecord,
    asOf: now,
    killSwitchActive: trust.killedAt !== null,
  };

  // Mandate — samme defaults som demo-boken. Phase 2 bytter til
  // MandateVersion fra DB.
  const mandate: Mandate = {
    objective: MandateObjective.MaxReturnAfterCostsVolDd,
    riskBudget: RiskBudgetSchema.parse({
      maxSingleAssetWeightBps: 4000,
      maxStablecoinFloorBps: 3000,
      maxVenueConcentrationBps: 5000,
      maxPortfolioDrawdownBps: 2000,
      leverageCap: 1.0,
    }),
    allowedActions: [
      AllowedAction.Hold,
      AllowedAction.RebalanceSpot,
      AllowedAction.Stake,
      AllowedAction.Unstake,
    ],
    optInSleeves: { lending: false, lp: false },
    bookCurrency: book.bookCurrency,
    universe: book.positions.map((p) => p.assetId),
    version: 1,
  };

  const principles: BankrollPrinciples = BankrollPrinciplesSchema.parse({});

  return { bookState, mandate, principles, marks: regimeMarks, priceSource: livePrices.source };
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/**
 * Parse `withdrawAllow`-kolonnen (JSON-array av strings) trygt. Hvis
 * parsing feiler, returner tomt array — vi aldri krasjer BFF-en på en
 * korrupt kolonne.
 */
function parseWithdrawAllow(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

/** Finn venue-navn for en posisjons accountId (default "unknown"). */
function accountVenue(
  accounts: Account[],
  accountId: string | null,
): string {
  if (!accountId) return "unknown";
  return accounts.find((a) => a.id === accountId)?.venue ?? "unknown";
}
