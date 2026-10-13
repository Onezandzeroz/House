import type { OperatingMode } from "./modes";

/**
 * Account kinds (plan §6, §7):
 *   cex           — exchange connection (CCXT adapter)
 *   evm-wallet    — self-custody EVM address (read via Alchemy / QuickNode)
 *   solana-wallet — self-custody Solana address (read via Helius)
 *   stake-defi    — a staking / lending / LP position identified by
 *                   contract address (read via chain reader or the
 *                   protocol's own indexer)
 *
 * No seeds. The DB stores a KMS reference id for CEX keys and a public
 * address for wallets (plan §10).
 */
export const AccountKind = {
  Cex: "cex",
  EvmWallet: "evm-wallet",
  SolanaWallet: "solana-wallet",
  StakeDefi: "stake-defi",
  XrpWallet: "xrp-wallet",
  Dex: "dex",
} as const;
export type AccountKind = (typeof AccountKind)[keyof typeof AccountKind];

/**
 * Key scope (plan §6, §10):
 *   read              — Observe mode. Read-only keys and public addresses.
 *   trade-no-withdraw  — Confirm / Rules. Trade keys without withdrawal.
 *                        Withdrawal allowlist, if the venue forces the
 *                        scope, contains only addresses the user already
 *                        controls.
 *   session-key       — Rules / House. Pre-authorised session keys, inside
 *                       caps. Revoked by the kill switch.
 */
export const KeyScope = {
  Read: "read",
  TradeNoWithdraw: "trade-no-withdraw",
  SessionKey: "session-key",
} as const;
export type KeyScope = (typeof KeyScope)[keyof typeof KeyScope];

/**
 * Account row — mirrors the `Account` Prisma model. `ref` holds either a
 * KMS reference id (CEX) or a public address (wallets). The actual secret
 * never lives in the DB. `withdrawAllow` is empty unless the venue forces
 * a withdrawal scope; even then, only addresses the user already controls.
 */
export interface Account {
  id: string;
  bookId: string;
  kind: AccountKind;
  venue: string;
  ref: string;
  keyScope: KeyScope;
  withdrawAllow: string[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Position state (plan §7). Free, locked, staked, claimable, lending, lp.
 * DeFi positions and exchange earn balances do not share one balance
 * shape — store source and confidence, do not force a single number.
 *
 *   free       — available immediately (CEX spot balance, EOA balance)
 *   locked     — pending order / lock-up
 *   staked     — staked on a named protocol
 *   claimable  — staked + reward, ready to withdraw
 *   lending    — lent on an opted-in protocol
 *   lp         — LP position in an opted-in pool
 */
export const PositionState = {
  Free: "free",
  Locked: "locked",
  Staked: "staked",
  Claimable: "claimable",
  Lending: "lending",
  Lp: "lp",
} as const;
export type PositionState = (typeof PositionState)[keyof typeof PositionState];

/**
 * Confidence (plan §12 — false precision risk). Do not force a single
 * number; store source and confidence.
 *
 *   high   — cex-balance, rpc-balance. The venue / chain is the source
 *            of truth; the number is exact as of `asOf`.
 *   medium — staking, lp. Indexer dependent; the indexer may lag or
 *            disagree with the protocol's own view.
 *   low    — user-manual. The user typed it in; no on-chain or venue
 *            confirmation.
 */
export const Confidence = {
  High: "high",
  Medium: "medium",
  Low: "low",
} as const;
export type Confidence = (typeof Confidence)[keyof typeof Confidence];

/**
 * Position row — mirrors the `Position` Prisma model. `quantity` is a
 * string for precision (DB column is TEXT). `source` is one of
 * "cex-balance" | "rpc-balance" | "staking-contract" | "lp-receipt" |
 * "user-manual"; `confidence` follows from `source` per the rules in
 * the schema comment.
 */
export interface Position {
  id: string;
  bookId: string;
  accountId: string | null;
  assetId: string;
  state: PositionState;
  quantity: string;
  source: string;
  confidence: Confidence;
  asOf: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Lot — quantity, cost in book currency, venue, timestamp (plan §7).
 * Needed for PnL the user can trust. `quantity` decreases on sell /
 * transfer-out; `costLocal` is the cost basis in the book currency
 * (e.g. USDC) at acquisition. Optional `decisionId` links the lot to
 * the decision that opened it.
 */
export interface Lot {
  id: string;
  bookId: string;
  assetId: string;
  quantity: string;
  costLocal: string;
  venue: string;
  acquiredAt: Date;
  decisionId: string | null;
  createdAt: Date;
}

/**
 * Mark kind (plan §7). Reference price AND executable price, both stored.
 * Do not collapse them. Reference comes from CoinGecko or equivalent;
 * executable comes from venue mids.
 *
 *   reference  — aggregate mid used for NAV, drift, drawdown.
 *   executable — the price the venue would actually fill at, including
 *                slippage for the intent's notional.
 */
export const MarkKind = {
  Reference: "reference",
  Executable: "executable",
} as const;
export type MarkKind = (typeof MarkKind)[keyof typeof MarkKind];

/**
 * Mark row — mirrors the `Mark` Prisma model. `price` and `liquidity`
 * are strings for precision. `liquidity` is the liquidity context
 * (e.g. 24h volume, top-of-book depth) used by the policy engine's
 * venue-health and slippage checks.
 */
export interface Mark {
  id: string;
  bookId: string;
  assetId: string;
  kind: MarkKind;
  price: string;
  liquidity: string | null;
  source: string;
  observedAt: Date;
  createdAt: Date;
}

/**
 * BookState — the in-memory snapshot of a book at decision time. This is
 * the input the policy engine consumes (wrapped inside `PolicyContext`).
 *
 * `killSwitchActive` is duplicated on the BookState AND on the
 * PolicyContext so the snapshot is self-contained — a later replay of
 * the decision log does not need to look up the book row.
 */
export interface BookState {
  bookId: string;
  mode: OperatingMode;
  bookCurrency: string;
  accounts: Account[];
  positions: Position[];
  lots: Lot[];
  marks: Record<string, Mark>;
  asOf: Date;
  killSwitchActive: boolean;
}
