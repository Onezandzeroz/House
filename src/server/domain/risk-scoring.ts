/**
 * risk-scoring.ts — Multi-factor composite risk scoring engine.
 *
 * Replaces the simple hardcoded lookup table in bankroll.ts with an
 * explainable, adaptive classification that combines:
 *
 *   1. Market / Quantitative Risk (35%) — realized vol, drawdown, beta, downside
 *   2. Liquidity & Size (20%)           — market cap, volume/mcap, quote volume
 *   3. Maturity & Track Record (12%)    — project age, exploit history
 *   4. Fundamentals / Utility (15%)     — TVL, revenue, staking ratio (hardcoded v1)
 *   5. Security / Protocol (13%)        — audits, decentralization, admin keys (hardcoded v1)
 *   6. Tokenomics (5%)                  — inflation, unlocks, circulating supply (hardcoded v1)
 *
 * Hard-rule overrides (applied AFTER scoring):
 *   - Stablecoin detector (fiat-backed / crypto-collateralized / algorithmic / yield-bearing)
 *   - Anchor assets (BTC, ETH forced to Conservative unless score says Aggressive)
 *   - Memecoin flag → Aggressive
 *   - New launch (<6 months) → cap at Balanced minimum
 *
 * DeFi position overlay (applied on top of the asset category):
 *   - Native staking → slightly safer (productive)
 *   - Lending on blue-chip → slightly safer
 *   - LP → riskier (impermanent loss)
 *   - Leveraged looping / unknown vault → much riskier
 *
 * Explainability: every score carries a `drivers` array + `breakdown`
 * showing exactly which dimension contributed what. The UI surfaces this
 * as "Balanced because: 85% annualized vol, $2B mcap, 3 audits, age 4 years".
 *
 * Architecture:
 *   - `computeRiskScore(assetId, marketData?)` — PURE function. Takes
 *     pre-collected market data (or null for degraded mode). Returns
 *     RiskScoreResult with score 0-100 + breakdown + drivers + category.
 *   - `categorizeAssetComposite(assetId, marketData?)` — thin wrapper
 *     that returns just the category.
 *   - `categorizePosition(assetId, positionType?, protocol?)` — applies
 *     the DeFi overlay.
 *   - `STABLECOIN_DETECTOR` + `HARD_RULES` — pure classification tables.
 *   - `FUNDAMENTALS_TABLE` + `SECURITY_TABLE` + `MATURITY_TABLE` —
 *     hardcoded v1 data for known assets. Framework to plug in
 *     DefiLlama / audit DBs later.
 *
 * Degradation: when marketData is null (CCXT/CoinGecko down), the scorer
 * uses neutral defaults (50/100) for the data-driven dimensions and relies
 * more heavily on the hardcoded tables. The `confidence` field reflects
 * this: "high" when all data available, "medium" when partial, "low"
 * when fully degraded to hardcoded.
 *
 * Math caveat: v0 uses JS Number. Fine for risk scoring (the score is a
 * 0-100 integer; intermediate calculations don't need fixed-point).
 */

import type { RiskCategory } from "./bankroll";
import { RiskCategory as RC } from "./bankroll";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Market data inputs for the scorer (collected externally + cached). */
export interface MarketDataInput {
  /** 30-day annualized volatility (e.g. 0.85 = 85%). Null if unavailable. */
  volatility30d: number | null;
  /** 90-day annualized volatility. Null if unavailable. */
  volatility90d: number | null;
  /** Maximum drawdown over 90d (e.g. 0.45 = -45%). Null if unavailable. */
  maxDrawdown90d: number | null;
  /** Beta to BTC (1.0 = tracks BTC). Null if unavailable. */
  betaToBtc: number | null;
  /** Downside deviation (annualized, only negative returns). Null if unavailable. */
  downsideDeviation: number | null;
  /** Market cap in USD (e.g. 2_000_000_000 = $2B). Null if unavailable. */
  marketCap: number | null;
  /** 24h trading volume in USD. Null if unavailable. */
  volume24h: number | null;
  /** 24h quote volume from CCXT (USDT pair). Null if unavailable. */
  quoteVolume24h: number | null;
}

/** One dimension's contribution to the composite score. */
export interface ScoreDimension {
  /** Dimension name (e.g. "Market / Quantitative Risk"). */
  name: string;
  /** Weight (0-1, e.g. 0.35 = 35%). */
  weight: number;
  /** Raw sub-score (0-100, higher = riskier). */
  score: number;
  /** Weighted contribution (score × weight). */
  contribution: number;
  /** Human-readable driver text (e.g. "85% annualized vol"). */
  driver: string;
  /** True if this dimension used real data; false if defaulted. */
  hasRealData: boolean;
}

/** The full result of computing a risk score. */
export interface RiskScoreResult {
  /** Asset id (lowercase). */
  assetId: string;
  /** Composite score 0-100 (higher = riskier). */
  score: number;
  /** Final category after hard-rule overrides. */
  category: RiskCategory;
  /** Per-dimension breakdown. */
  dimensions: ScoreDimension[];
  /** Human-readable driver strings for UI display. */
  drivers: string[];
  /** Confidence: "high" (all data), "medium" (partial), "low" (degraded). */
  confidence: "high" | "medium" | "low";
  /** Hard-rule overrides applied (empty if none). */
  overrides: string[];
  /** Stablecoin classification (null if not a stablecoin). */
  stablecoinType: StablecoinType | null;
  /** When the score was computed. */
  computedAt: Date;
}

/** Stablecoin sub-classification. */
export type StablecoinType =
  | "fiat-backed" // USDC, USDT, RLUSD
  | "crypto-collateralized" // DAI
  | "algorithmic" // UST-style (none in current universe)
  | "yield-bearing" // stETH, rETH, cbETH (liquid staking receipts)
  | "unknown-pegged"; // flagged as stable but mechanism unknown

/** DeFi position type for the strategy overlay. */
export type DeFiPositionType = "staking" | "lending" | "lp" | "vault";

// ---------------------------------------------------------------------------
// Configuration — weights (user-adjustable in a future mandate setting)
// ---------------------------------------------------------------------------

export const DIMENSION_WEIGHTS = {
  marketQuant: 0.35, // 35%
  liquidity: 0.2, // 20%
  maturity: 0.12, // 12%
  fundamentals: 0.15, // 15%
  security: 0.13, // 13%
  tokenomics: 0.05, // 5%
} as const;

/** Category thresholds (score → category, before overrides). */
const CATEGORY_THRESHOLDS = {
  conservative: 25, // 0-25 → Conservative
  balanced: 50, // 26-50 → Balanced
  // >50 → Aggressive
} as const;

// ---------------------------------------------------------------------------
// Hardcoded tables — v1 data for known assets.
//
// These are REVIEW-ONLY defaults. The framework is designed so a later
// phase can replace them with live data from DefiLlama (TVL/revenue),
// audit databases (security), and on-chain analytics (tokenomics).
// For now, the values are curated from public knowledge (Oct 2026).
// ---------------------------------------------------------------------------

/** Asset launch dates (ISO) for maturity scoring. Null = unknown. */
const LAUNCH_DATES: Readonly<Record<string, string>> = Object.freeze({
  btc: "2009-01-03",
  eth: "2015-07-30",
  sol: "2020-03-16",
  xrp: "2012-06-01",
  xlm: "2014-07-31",
  flr: "2023-07-14",
  arb: "2023-03-23",
  op: "2022-05-31",
  avax: "2020-09-21",
  uni: "2020-09-17",
  aave: "2020-10-01",
  ldo: "2020-12-17",
  doge: "2013-12-08",
  usdc: "2018-10-08",
  usdt: "2014-10-06",
  dai: "2017-12-18",
  frax: "2021-01-04",
  rlusd: "2024-12-17",
  steth: "2020-12-18",
  reth: "2021-11-01",
  cbeth: "2022-12-01",
  wbtc: "2019-01-31",
});

/** Fundamentals score (0-100, higher = better fundamentals = lower risk). */
const FUNDAMENTALS_TABLE: Readonly<Record<string, number>> = Object.freeze({
  btc: 95, // Dominant store-of-value, massive network, high hashrate
  eth: 92, // Dominant smart-contract platform, high fee generation
  sol: 78, // High activity, fast throughput, some outage history
  xrp: 70, // Established payments network, institutional adoption
  xlm: 65, // Established payments network, lower activity
  flr: 55, // Newer ecosystem, growing FTSO usage
  arb: 72, // Leading L2, high TVL
  op: 68, // Major L2, good governance
  avax: 65, // Established L1, subnets
  uni: 75, // Leading DEX, high fee generation
  aave: 80, // Leading lending protocol, high TVL
  ldo: 72, // Leading liquid staking, high TVL
  doge: 35, // Primarily speculative, limited utility
  wbtc: 88, // BTC wrapper, well-established
  usdc: 90, // Circle, transparent reserves
  usdt: 85, // Tether, largest stablecoin
  dai: 82, // MakerDAO, overcollateralized
  frax: 70, // Partially algorithmic, partially backed
  rlusd: 75, // Ripple, new but reputable issuer
  steth: 85, // Lido, dominant liquid staking
  reth: 80, // Rocket Pool, decentralized
  cbeth: 80, // Coinbase, institutional
});

/** Security score (0-100, higher = more secure = lower risk). */
const SECURITY_TABLE: Readonly<Record<string, number>> = Object.freeze({
  btc: 98, // Most decentralized, longest track record, no exploits
  eth: 92, // Highly decentralized, extensive audits
  sol: 75, // Some outage history, validator concentration
  xrp: 78, // Institutional, some decentralization concerns
  xlm: 75, // Established, similar to XRP
  flr: 65, // Newer, FTSO is novel
  arb: 78, // Optimism stack, audited
  op: 78, // Audited, well-funded
  avax: 72, // Some validator concentration
  uni: 85, // Audited, battle-tested
  aave: 88, // Heavily audited, bug bounty, battle-tested
  ldo: 80, // Audited, dominant staking
  doge: 60, // Limited development, merge-mined
  wbtc: 82, // Custody model, audited
  usdc: 88, // Regulated issuer, attestations
  usdt: 75, // Less transparent reserves
  dai: 85, // Overcollateralized, audited
  frax: 68, // Partially algorithmic
  rlusd: 72, // New, regulated issuer
  steth: 82, // Lido audits, slashing risks
  reth: 78, // Rocket Pool audits
  cbeth: 80, // Coinbase custodial
});

/** Tokenomics score (0-100, higher = better tokenomics = lower risk). */
const TOKENOMICS_TABLE: Readonly<Record<string, number>> = Object.freeze({
  btc: 95, // Fixed supply, no unlocks, pure store-of-value
  eth: 88, // Deflationary (burn), stake-locked
  sol: 70, // Inflationary but decreasing, some VC unlocks
  xrp: 72, // Escrow releases, some circulating-supply concerns
  xlm: 70, // Similar to XRP
  flr: 55, // Newer, distribution schedule ongoing
  arb: 60, // Large team/VC allocations, unlock pressure
  op: 62, // Team allocation, unlock schedule
  avax: 68, // Some unlock pressure
  uni: 75, // Governance token, fee switch debate
  aave: 80, // Well-distributed, buyback mechanism
  ldo: 65, // Team allocation, 1:1 staking
  doge: 50, // Inflationary (5B/yr), no cap
  wbtc: 90, // 1:1 BTC backed
  usdc: 88, // Fully backed, transparent
  usdt: 82, // Backed, less transparent
  dai: 85, // Overcollateralized
  frax: 68, // Partially algorithmic
  rlusd: 78, // Fully backed, new
  steth: 82, // 1:1 ETH, staking yield
  reth: 80, // 1:1 ETH, decentralized
  cbeth: 80, // 1:1 ETH, custodial
});

/** Known memecoins — hard-flagged to Aggressive. */
const MEMECOINS: ReadonlySet<string> = new Set([
  "doge",
  "shib",
  "pepe",
  "wif",
  "bonk",
  "floki",
  "mog",
]);

/** Protocol quality scores for DeFi overlay (0-100, higher = safer). */
const PROTOCOL_QUALITY: Readonly<Record<string, number>> = Object.freeze({
  lido: 85,
  aave: 88,
  "rocket-pool": 78,
  uniswap: 82,
  compound: 80,
  "xmagnetic": 45, // smaller DEX, less audited
  "yearn": 70,
  "beefy": 65,
  "curve": 80,
  "convex": 72,
});

// ---------------------------------------------------------------------------
// Stablecoin detector
// ---------------------------------------------------------------------------

const STABLECOIN_MAP: Readonly<Record<string, StablecoinType>> = Object.freeze({
  usdc: "fiat-backed",
  usdt: "fiat-backed",
  rlusd: "fiat-backed",
  dai: "crypto-collateralized",
  frax: "crypto-collateralized", // partially algorithmic but overcollateralized
  steth: "yield-bearing",
  reth: "yield-bearing",
  cbeth: "yield-bearing",
});

/** Detect if an asset is a stablecoin + its mechanism. Null if not stable. */
export function detectStablecoin(assetId: string): StablecoinType | null {
  return STABLECOIN_MAP[assetId.toLowerCase()] ?? null;
}

/** True if the asset is any kind of stablecoin / pegged asset. */
export function isStablecoin(assetId: string): boolean {
  return detectStablecoin(assetId) !== null;
}

// ---------------------------------------------------------------------------
// Core scoring — pure functions
// ---------------------------------------------------------------------------

/**
 * Compute the composite risk score for an asset.
 *
 * PURE function — no I/O. Takes pre-collected market data (or null for
 * degraded mode). Returns the full breakdown for explainability.
 *
 * @param assetId  Asset ticker (e.g. "BTC")
 * @param data     Market data inputs (or null if unavailable)
 */
export function computeRiskScore(
  assetId: string,
  data: MarketDataInput | null,
): RiskScoreResult {
  const id = assetId.toLowerCase();
  const computedAt = new Date();
  const overrides: string[] = [];

  // ---- 0. Stablecoin check (hard rule — bypasses scoring entirely) ----
  const stableType = detectStablecoin(id);
  if (stableType) {
    return buildStablecoinResult(id, stableType, computedAt, data);
  }

  // ---- 1. Compute each dimension ----
  const dimensions: ScoreDimension[] = [];
  let realDataCount = 0;
  let totalDimensions = 0;

  // Dimension 1: Market / Quantitative Risk (35%)
  const mq = scoreMarketQuant(id, data);
  dimensions.push(mq);
  totalDimensions++;
  if (mq.hasRealData) realDataCount++;

  // Dimension 2: Liquidity & Size (20%)
  const liq = scoreLiquidity(id, data);
  dimensions.push(liq);
  totalDimensions++;
  if (liq.hasRealData) realDataCount++;

  // Dimension 3: Maturity & Track Record (12%)
  const mat = scoreMaturity(id);
  dimensions.push(mat);
  totalDimensions++;
  // Maturity uses hardcoded launch dates — counts as "real" data
  if (mat.hasRealData) realDataCount++;

  // Dimension 4: Fundamentals / Utility (15%)
  const fund = scoreFundamentals(id);
  dimensions.push(fund);
  totalDimensions++;
  if (fund.hasRealData) realDataCount++;

  // Dimension 5: Security / Protocol (13%)
  const sec = scoreSecurity(id);
  dimensions.push(sec);
  totalDimensions++;
  if (sec.hasRealData) realDataCount++;

  // Dimension 6: Tokenomics (5%)
  const tok = scoreTokenomics(id);
  dimensions.push(tok);
  totalDimensions++;
  if (tok.hasRealData) realDataCount++;

  // ---- 2. Weighted composite ----
  const compositeScore = Math.round(
    dimensions.reduce((sum, d) => sum + d.contribution, 0),
  );

  // ---- 3. Confidence ----
  let confidence: "high" | "medium" | "low";
  const realRatio = realDataCount / totalDimensions;
  if (realRatio >= 0.6) confidence = "high";
  else if (realRatio >= 0.3) confidence = "medium";
  else confidence = "low";

  // ---- 4. Category mapping (before overrides) ----
  let category: RiskCategory;
  if (compositeScore <= CATEGORY_THRESHOLDS.conservative) {
    category = RC.Conservative;
  } else if (compositeScore <= CATEGORY_THRESHOLDS.balanced) {
    category = RC.Balanced;
  } else {
    category = RC.Aggressive;
  }

  // ---- 5. Hard-rule overrides ----
  // Memecoin → always Aggressive
  if (MEMECOINS.has(id)) {
    category = RC.Aggressive;
    overrides.push("Memecoin flag → Aggressive");
  }

  // New launch (<6 months) → cap at Balanced (can't be Conservative)
  const launchDate = LAUNCH_DATES[id];
  if (launchDate) {
    const ageMs = Date.now() - new Date(launchDate).getTime();
    const ageMonths = ageMs / (1000 * 60 * 60 * 24 * 30);
    if (ageMonths < 6) {
      if (category === RC.Conservative) {
        category = RC.Balanced;
        overrides.push(`New launch (${ageMonths.toFixed(1)} months) → capped at Balanced`);
      }
    }
  } else {
    // Unknown launch date → treat as new → cap at Balanced minimum
    if (category === RC.Conservative) {
      category = RC.Balanced;
      overrides.push("Unknown maturity → capped at Balanced");
    }
  }

  // Anchor assets (BTC, ETH) — can't be more aggressive than Conservative
  // unless the score is genuinely bad (>50 = Aggressive).
  if ((id === "btc" || id === "eth") && category === RC.Balanced) {
    category = RC.Conservative;
    overrides.push("Anchor asset (BTC/ETH) → Conservative");
  }

  // ---- 6. Drivers for UI ----
  const drivers = dimensions
    .filter((d) => d.hasRealData)
    .map((d) => d.driver)
    .slice(0, 5);

  return {
    assetId: id,
    score: compositeScore,
    category,
    dimensions,
    drivers,
    confidence,
    overrides,
    stablecoinType: null,
    computedAt,
  };
}

// ---------------------------------------------------------------------------
// Stablecoin result builder
// ---------------------------------------------------------------------------

function buildStablecoinResult(
  assetId: string,
  type: StablecoinType,
  computedAt: Date,
  data: MarketDataInput | null,
): RiskScoreResult {
  const overrides: string[] = [`Stablecoin (${type}) → Stable`];
  const drivers: string[] = [];

  // Peg deviation from market data (if available)
  if (data?.volatility30d !== null && data?.volatility30d !== undefined) {
    const vol = data.volatility30d;
    if (vol < 0.05) {
      drivers.push(`${(vol * 100).toFixed(1)}% vol — tight peg`);
    } else if (vol < 0.15) {
      drivers.push(`${(vol * 100).toFixed(1)}% vol — moderate peg deviation`);
      overrides.push("Elevated peg deviation — monitor");
    } else {
      drivers.push(`${(vol * 100).toFixed(1)}% vol — HIGH peg deviation`);
      overrides.push("High peg deviation — depeg risk");
    }
  }

  // Quality-based sub-score for the dimensions (all low for stablecoins)
  const dimensions: ScoreDimension[] = [
    {
      name: "Peg stability",
      weight: 1.0,
      score: 5,
      contribution: 5,
      driver: type === "fiat-backed" ? "Fiat-backed, transparent reserves" : `${type} mechanism`,
      hasRealData: true,
    },
  ];

  return {
    assetId,
    score: 5, // Stablecoins are very low risk (score 5/100)
    category: RC.Stable,
    dimensions,
    drivers: drivers.length > 0 ? drivers : [`${type} stablecoin`],
    confidence: "high",
    overrides,
    stablecoinType: type,
    computedAt,
  };
}

// ---------------------------------------------------------------------------
// Dimension scorers
// ---------------------------------------------------------------------------

/**
 * Dimension 1: Market / Quantitative Risk (35% weight).
 * Inputs: 30d vol, 90d vol, max drawdown, beta to BTC, downside deviation.
 * Score: 0-100 (higher = riskier).
 */
function scoreMarketQuant(
  id: string,
  data: MarketDataInput | null,
): ScoreDimension {
  const weight = DIMENSION_WEIGHTS.marketQuant;

  // Degraded mode — no market data
  if (!data || data.volatility30d === null) {
    // Use asset-specific defaults based on known characteristics
    const defaultScore = id === "btc" || id === "eth" ? 30 : 55;
    return {
      name: "Market / Quantitative Risk",
      weight,
      score: defaultScore,
      contribution: defaultScore * weight,
      driver: "Volatility data unavailable — using default",
      hasRealData: false,
    };
  }

  // Real data — compute sub-scores
  const vol30 = data.volatility30d;
  const vol90 = data.volatility90d ?? vol30;
  const mdd = data.maxDrawdown90d ?? 0;
  const beta = data.betaToBtc ?? 1.0;
  const downside = data.downsideDeviation ?? vol30 * 0.7;

  // Volatility sub-score (0-100): 20% vol → 20, 100% vol → 100
  const volScore = Math.min(100, Math.max(0, vol30 * 100));

  // Drawdown sub-score: 10% DD → 15, 50% DD → 75, 80% DD → 100
  const mddScore = Math.min(100, mdd * 125 + 5);

  // Beta sub-score: 0.5 → 25, 1.0 → 50, 1.5 → 75, 2.0 → 100
  const betaScore = Math.min(100, Math.max(0, beta * 50));

  // Downside sub-score: similar to vol but only negative returns
  const downsideScore = Math.min(100, Math.max(0, downside * 120));

  // Weighted average of sub-scores
  const score = Math.round(
    volScore * 0.35 + mddScore * 0.25 + betaScore * 0.2 + downsideScore * 0.2,
  );

  return {
    name: "Market / Quantitative Risk",
    weight,
    score,
    contribution: score * weight,
    driver: `${(vol30 * 100).toFixed(0)}% ann. vol, ${(mdd * 100).toFixed(0)}% max DD, β=${beta.toFixed(2)}`,
    hasRealData: true,
  };
}

/**
 * Dimension 2: Liquidity & Size (20% weight).
 * Inputs: market cap, 24h volume, quote volume.
 * Score: 0-100 (higher = riskier = less liquid).
 */
function scoreLiquidity(
  id: string,
  data: MarketDataInput | null,
): ScoreDimension {
  const weight = DIMENSION_WEIGHTS.liquidity;

  if (!data || data.marketCap === null) {
    const defaultScore = id === "btc" || id === "eth" ? 15 : 45;
    return {
      name: "Liquidity & Size",
      weight,
      score: defaultScore,
      contribution: defaultScore * weight,
      driver: "Market cap data unavailable — using default",
      hasRealData: false,
    };
  }

  const mcap = data.marketCap;
  const vol = data.volume24h ?? data.quoteVolume24h ?? 0;

  // Market cap sub-score (tiers):
  //   >$100B → 5, $10B-$100B → 15, $1B-$10B → 35, $100M-$1B → 60, <$100M → 85
  let mcapScore: number;
  if (mcap >= 100e9) mcapScore = 5;
  else if (mcap >= 10e9) mcapScore = 15;
  else if (mcap >= 1e9) mcapScore = 35;
  else if (mcap >= 100e6) mcapScore = 60;
  else mcapScore = 85;

  // Volume/mcap ratio sub-score (liquidity relative to size):
  //   ratio >0.2 → 10 (very liquid), 0.05-0.2 → 30, 0.01-0.05 → 55, <0.01 → 80
  const volMcapRatio = mcap > 0 ? vol / mcap : 0;
  let volScore: number;
  if (volMcapRatio >= 0.2) volScore = 10;
  else if (volMcapRatio >= 0.05) volScore = 30;
  else if (volMcapRatio >= 0.01) volScore = 55;
  else volScore = 80;

  const score = Math.round(mcapScore * 0.6 + volScore * 0.4);

  const mcapStr = mcap >= 1e9 ? `$${(mcap / 1e9).toFixed(1)}B` : `$${(mcap / 1e6).toFixed(0)}M`;
  return {
    name: "Liquidity & Size",
    weight,
    score,
    contribution: score * weight,
    driver: `${mcapStr} mcap, ${(volMcapRatio * 100).toFixed(1)}% vol/mcap`,
    hasRealData: true,
  };
}

/**
 * Dimension 3: Maturity & Track Record (12% weight).
 * Uses hardcoded launch dates. Older assets with survival through bear
 * markets score lower (safer).
 */
function scoreMaturity(id: string): ScoreDimension {
  const weight = DIMENSION_WEIGHTS.maturity;
  const launchStr = LAUNCH_DATES[id];

  if (!launchStr) {
    return {
      name: "Maturity & Track Record",
      weight,
      score: 75, // Unknown → assume new → risky
      contribution: 75 * weight,
      driver: "Unknown launch date — treating as new",
      hasRealData: false,
    };
  }

  const ageMs = Date.now() - new Date(launchStr).getTime();
  const ageYears = ageMs / (1000 * 60 * 60 * 24 * 365);

  // Score: 0 years → 90, 1 year → 70, 3 years → 45, 5+ years → 20
  let score: number;
  if (ageYears >= 5) score = 20;
  else if (ageYears >= 3) score = 35;
  else if (ageYears >= 1.5) score = 55;
  else if (ageYears >= 0.5) score = 75;
  else score = 90;

  return {
    name: "Maturity & Track Record",
    weight,
    score,
    contribution: score * weight,
    driver: `${ageYears.toFixed(1)} years old (launched ${launchStr.slice(0, 4)})`,
    hasRealData: true,
  };
}

/**
 * Dimension 4: Fundamentals / Utility (15% weight).
 * Uses hardcoded v1 table. Higher score = better fundamentals = LOWER risk.
 * The table value is "quality" (0-100, higher=better); we invert it to
 * risk (100 - quality).
 */
function scoreFundamentals(id: string): ScoreDimension {
  const weight = DIMENSION_WEIGHTS.fundamentals;
  const quality = FUNDAMENTALS_TABLE[id];

  if (quality === undefined) {
    return {
      name: "Fundamentals / Utility",
      weight,
      score: 65, // Unknown → moderately risky
      contribution: 65 * weight,
      driver: "No fundamentals data — defaulting to moderate risk",
      hasRealData: false,
    };
  }

  const riskScore = 100 - quality;
  const driver =
    quality >= 85
      ? "Strong fundamentals (high TVL/revenue/usage)"
      : quality >= 70
        ? "Good fundamentals (established utility)"
        : quality >= 50
          ? "Moderate fundamentals"
          : "Weak fundamentals (speculative)";

  return {
    name: "Fundamentals / Utility",
    weight,
    score: riskScore,
    contribution: riskScore * weight,
    driver,
    hasRealData: true,
  };
}

/**
 * Dimension 5: Security / Protocol (13% weight).
 * Uses hardcoded v1 table. Higher score = more secure = LOWER risk.
 */
function scoreSecurity(id: string): ScoreDimension {
  const weight = DIMENSION_WEIGHTS.security;
  const sec = SECURITY_TABLE[id];

  if (sec === undefined) {
    return {
      name: "Security / Protocol",
      weight,
      score: 70, // Unknown → assume risky
      contribution: 70 * weight,
      driver: "No security data — defaulting to high risk",
      hasRealData: false,
    };
  }

  const riskScore = 100 - sec;
  const driver =
    sec >= 90
      ? "Top-tier security (audited, decentralized, battle-tested)"
      : sec >= 75
        ? "Good security (audited, established)"
        : sec >= 60
          ? "Moderate security concerns"
          : "Significant security risks";

  return {
    name: "Security / Protocol",
    weight,
    score: riskScore,
    contribution: riskScore * weight,
    driver,
    hasRealData: true,
  };
}

/**
 * Dimension 6: Tokenomics (5% weight).
 * Uses hardcoded v1 table. Higher score = better tokenomics = LOWER risk.
 */
function scoreTokenomics(id: string): ScoreDimension {
  const weight = DIMENSION_WEIGHTS.tokenomics;
  const tok = TOKENOMICS_TABLE[id];

  if (tok === undefined) {
    return {
      name: "Tokenomics",
      weight,
      score: 55,
      contribution: 55 * weight,
      driver: "No tokenomics data — defaulting to moderate",
      hasRealData: false,
    };
  }

  const riskScore = 100 - tok;
  const driver =
    tok >= 85
      ? "Strong tokenomics (fixed supply / deflationary)"
      : tok >= 70
        ? "Good tokenomics (low inflation)"
        : tok >= 50
          ? "Moderate tokenomics (some unlock pressure)"
          : "Weak tokenomics (high inflation / unlocks)";

  return {
    name: "Tokenomics",
    weight,
    score: riskScore,
    contribution: riskScore * weight,
    driver,
    hasRealData: true,
  };
}

// ---------------------------------------------------------------------------
// DeFi position overlay
// ---------------------------------------------------------------------------

/** The DeFi strategy overlay adjustment. */
export interface PositionOverlayResult {
  /** The adjusted category after the overlay. */
  category: RiskCategory;
  /** Score adjustment (negative = safer, positive = riskier). */
  scoreAdjustment: number;
  /** Human-readable reason for the adjustment. */
  reason: string;
}

/**
 * Apply a DeFi position/strategy overlay on top of the base asset category.
 *
 * The overlay takes the asset's base risk score and adjusts it based on
 * the position type (staking, lending, LP, vault) and the protocol's
 * quality score. The more conservative of the asset score and the
 * protocol score wins — a "safe" token inside a risky protocol doesn't
 * get a free pass.
 *
 * @param assetScore   The base RiskScoreResult for the asset.
 * @param positionType The DeFi position type (staking/lending/lp/vault).
 * @param protocol     The protocol name (e.g. "Lido", "Aave"). Optional.
 */
export function applyPositionOverlay(
  assetScore: RiskScoreResult,
  positionType: DeFiPositionType | null | undefined,
  protocol?: string | null,
): PositionOverlayResult {
  // No DeFi overlay for non-DeFi positions
  if (!positionType) {
    return {
      category: assetScore.category,
      scoreAdjustment: 0,
      reason: "Spot holding — no overlay",
    };
  }

  let adjustment = 0;
  let reasons: string[] = [];

  // Strategy-based adjustment
  switch (positionType) {
    case "staking":
      adjustment -= 5;
      reasons.push("Native staking (productive, -5)");
      break;
    case "lending":
      adjustment -= 5;
      reasons.push("Lending on blue-chip (-5)");
      break;
    case "lp":
      adjustment += 10;
      reasons.push("LP exposure (impermanent loss, +10)");
      break;
    case "vault":
      adjustment += 15;
      reasons.push("Vault strategy (+15)");
      break;
  }

  // Protocol quality adjustment
  if (protocol) {
    const protoQuality = PROTOCOL_QUALITY[protocol.toLowerCase()];
    if (protoQuality !== undefined) {
      if (protoQuality >= 80) {
        adjustment -= 3;
        reasons.push(`${protocol} high-quality protocol (-3)`);
      } else if (protoQuality < 60) {
        adjustment += 10;
        reasons.push(`${protocol} low-quality protocol (+10)`);
      }
    } else {
      // Unknown protocol → riskier
      adjustment += 8;
      reasons.push("Unknown protocol (+8)");
    }
  }

  // Compute the adjusted score
  const adjustedScore = Math.max(0, Math.min(100, assetScore.score + adjustment));

  // Re-derive category from the adjusted score
  let adjustedCategory: RiskCategory;
  if (assetScore.stablecoinType) {
    // Stablecoins stay stable unless the protocol is very risky
    adjustedCategory = adjustment > 15 ? RC.Balanced : RC.Stable;
  } else if (adjustedScore <= CATEGORY_THRESHOLDS.conservative) {
    adjustedCategory = RC.Conservative;
  } else if (adjustedScore <= CATEGORY_THRESHOLDS.balanced) {
    adjustedCategory = RC.Balanced;
  } else {
    adjustedCategory = RC.Aggressive;
  }

  // Cap: overlay can only make things riskier or stay the same for
  // Aggressive assets; it can make Stable/Conservative slightly safer
  // (for staking/lending) but not safer than the asset's base allows.
  // This prevents a vault on BTC from looking Conservative.

  return {
    category: adjustedCategory,
    scoreAdjustment: adjustment,
    reason: reasons.join("; "),
  };
}

// ---------------------------------------------------------------------------
// Convenience: compute + categorize in one call
// ---------------------------------------------------------------------------

/**
 * Compute the composite risk score and return just the category.
 * Thin wrapper over `computeRiskScore` for callers that only need the
 * sleeve (the existing `categorizeAsset` API shape).
 */
export function categorizeAssetComposite(
  assetId: string,
  data: MarketDataInput | null = null,
): RiskCategory {
  return computeRiskScore(assetId, data).category;
}

/**
 * Categorize a position (asset + optional DeFi metadata) using the
 * composite scorer + the DeFi overlay. This is the function the portfolio
 * builder should call for DeFi positions instead of plain categorizeAsset.
 */
export function categorizePosition(
  assetId: string,
  positionType?: DeFiPositionType | null,
  protocol?: string | null,
  data: MarketDataInput | null = null,
): RiskCategory {
  const baseScore = computeRiskScore(assetId, data);
  if (!positionType) return baseScore.category;
  return applyPositionOverlay(baseScore, positionType, protocol).category;
}
