import type { BookState, Mark, Position, Account, Lot } from "../domain/book";
import { MarkKind, PositionState, Confidence, AccountKind, KeyScope } from "../domain/book";
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

/**
 * Demo-bok for rådgivning i fundament-fasen (Task 7).
 *
 * Byttes ut med live book i Phase 1 Observe. The demo book is a
 * synthetic familiefond-style book (~$250k NAV) with positions across
 * all four sleeves so the advisor has something real to chew on.
 *
 * Demo construction (owner direction, Task 6):
 *   - USDC 75,000            (stable, dry powder at ~28% — BELOW the 30%
 *                              floor, so the advisor emits a WARNING)
 *   - BTC 1.2 @ 60,000 = 72,000 (conservative, ~27%)
 *   - ETH 40 @ 2,500 = 100,000 (conservative, ~38%)
 *   - SOL 100 @ 130 = 13,000 (balanced, ~5%)
 *   - ARB 5,000 @ 0.80 = 4,000 (balanced, ~1.5%)
 *   - DOGE 5,000 @ 0.10 = 500 (aggressive, ~0.2% — defaults to aggressive
 *                              because DOGE is not in the categorisation
 *                              table, so the advisor also emits an INFO)
 *
 *   Total NAV ≈ $264,500.
 *   Dry powder = 75,000 / 264,500 ≈ 28.4% = 2835 bps — below 3000 bps floor.
 *
 * BTC has a 7-sample 90-day history with a slight uptrend ($40k → $60k,
 * +50% log return) so the regime detector votes bull (sma-200 bull,
 * momentum bull, drawdown neutral, vol informational).
 *
 * Math caveat: v0 uses JS Number for arithmetic. Production MUST use a
 * fixed-point decimal lib (decimal.js or bignumber.js). Do NOT install a
 * decimal lib in v0 — this is the JSDoc warning.
 */

/** Output shape of createDemoBook — the four things the advisor needs. */
export interface DemoBook {
  bookState: BookState;
  mandate: Mandate;
  principles: BankrollPrinciples;
  marks: RegimeMark[];
}

// ---------------------------------------------------------------------------
// Static asset universe + prices for the demo book. Constants so the
// advisor's output is deterministic across runs.
// ---------------------------------------------------------------------------

const BOOK_ID = "demo-book-001";
const BOOK_CURRENCY = "USDC";
const NOW = new Date("2026-10-09T12:00:00.000Z");

/** Demo positions: assetId, quantity, price (in book currency). */
const DEMO_POSITIONS: { assetId: string; quantity: string; price: string }[] = [
  { assetId: "USDC", quantity: "75000", price: "1" },
  { assetId: "BTC", quantity: "1.2", price: "60000" },
  { assetId: "ETH", quantity: "40", price: "2500" },
  { assetId: "SOL", quantity: "100", price: "130" },
  { assetId: "ARB", quantity: "5000", price: "0.80" },
  { assetId: "DOGE", quantity: "5000", price: "0.10" },
];

/**
 * BTC 90-day history (7 samples, slight uptrend). The "now" sample
 * matches the BTC mark price (60,000) so the detector sees the latest
 * point as the current price.
 *
 * Log-return over window = ln(60000/40000) = 0.405 = +40.5%.
 * SMA(7) = (40000+42500+46000+51000+55000+57500+60000)/7 ≈ 50,286.
 * Current 60,000 > SMA 50,286 → sma-200 bull.
 * Drawdown from peak = 0% (monotonic up) → drawdown-from-peak neutral.
 * Realized vol = stdev of daily log-returns × sqrt(365) ≈ 30-40% annualized.
 */
const BTC_HISTORY: { t: Date; price: string }[] = [
  { t: new Date("2026-07-11T12:00:00.000Z"), price: "40000" },
  { t: new Date("2026-07-26T12:00:00.000Z"), price: "42500" },
  { t: new Date("2026-08-10T12:00:00.000Z"), price: "46000" },
  { t: new Date("2026-08-25T12:00:00.000Z"), price: "51000" },
  { t: new Date("2026-09-09T12:00:00.000Z"), price: "55000" },
  { t: new Date("2026-09-24T12:00:00.000Z"), price: "57500" },
  { t: new Date("2026-10-09T12:00:00.000Z"), price: "60000" },
];

/**
 * Create the demo book. Deterministic: same output every call. The book
 * is in-memory only — no DB row is written. Phase 1 Observe will
 * replace this with a real BookService.getBookState call.
 */
export function createDemoBook(): DemoBook {
  const accounts: Account[] = [
    {
      id: "acct-cex-1",
      bookId: BOOK_ID,
      kind: AccountKind.Cex,
      venue: "kraken",
      ref: "kms-ref-kraken-readonly",
      keyScope: KeyScope.Read,
      withdrawAllow: [],
      active: true,
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: "acct-evm-1",
      bookId: BOOK_ID,
      kind: AccountKind.EvmWallet,
      venue: "ethereum",
      ref: "0x000000000000000000000000000000000000beef",
      keyScope: KeyScope.Read,
      withdrawAllow: [],
      active: true,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ];

  const positions: Position[] = DEMO_POSITIONS.map((p, i) => ({
    id: `pos-${i + 1}`,
    bookId: BOOK_ID,
    accountId: i % 2 === 0 ? "acct-cex-1" : "acct-evm-1",
    assetId: p.assetId,
    state: PositionState.Free,
    quantity: p.quantity,
    source: "cex-balance",
    confidence: Confidence.High,
    asOf: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  }));

  const lots: Lot[] = DEMO_POSITIONS.map((p, i) => ({
    id: `lot-${i + 1}`,
    bookId: BOOK_ID,
    assetId: p.assetId,
    quantity: p.quantity,
    costLocal: p.quantity, // demo: cost = quantity × 1 in book currency
    venue: i % 2 === 0 ? "kraken" : "ethereum",
    acquiredAt: new Date(NOW.getTime() - 1000 * 60 * 60 * 24 * 90),
    decisionId: null,
    createdAt: NOW,
  }));

  // Marks for NAV. Each asset gets a reference mark in book currency.
  // USDC has price "1" because it IS the book currency.
  const marksRecord: Record<string, Mark> = {};
  for (const p of DEMO_POSITIONS) {
    const mark: Mark = {
      id: `mark-${p.assetId.toLowerCase()}`,
      bookId: BOOK_ID,
      assetId: p.assetId,
      kind: MarkKind.Reference,
      price: p.price,
      liquidity: null,
      source: "demo-coingecko",
      observedAt: NOW,
      createdAt: NOW,
    };
    marksRecord[p.assetId] = mark;
  }

  const bookState: BookState = {
    bookId: BOOK_ID,
    mode: OperatingMode.Advise,
    bookCurrency: BOOK_CURRENCY,
    accounts,
    positions,
    lots,
    marks: marksRecord,
    asOf: NOW,
    killSwitchActive: false,
  };

  const mandate: Mandate = {
    objective: MandateObjective.MaxReturnAfterCostsVolDd,
    riskBudget: RiskBudgetSchema.parse({
      maxSingleAssetWeightBps: 4000, // 40% — ETH at 38% stays under
      maxStablecoinFloorBps: 3000, // 30% — matches principles
      maxVenueConcentrationBps: 5000, // 50%
      maxPortfolioDrawdownBps: 2000, // 20% forces de-risk
      leverageCap: 1.0,
    }),
    allowedActions: [
      AllowedAction.Hold,
      AllowedAction.RebalanceSpot,
      AllowedAction.Stake,
      AllowedAction.Unstake,
    ],
    optInSleeves: { lending: false, lp: false },
    bookCurrency: BOOK_CURRENCY,
    universe: DEMO_POSITIONS.map((p) => p.assetId),
    version: 1,
  };

  const principles: BankrollPrinciples = BankrollPrinciplesSchema.parse({});

  // RegimeMark[] for the detector. Only BTC carries history (others
  // are point-in-time prices); the detector picks BTC as reference.
  const marks: RegimeMark[] = DEMO_POSITIONS.map((p) => ({
    assetId: p.assetId,
    price: p.price,
    history: p.assetId === "BTC" ? BTC_HISTORY : undefined,
  }));

  return { bookState, mandate, principles, marks };
}
