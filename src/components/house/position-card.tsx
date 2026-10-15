"use client";

import * as React from "react";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Wallet,
  Building2,
  Link2,
  Radio,
  Activity,
  ShieldCheck,
  AlertTriangle,
  Newspaper,
  type LucideIcon,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { SLEEVE_META } from "@/components/onboarding/types";
import { categorizeAsset, type RiskCategory } from "@/server/domain/bankroll";

/**
 * PositionCard — a refined, wealth-management-style card for a single
 * asset position. Designed to feel like a private bank statement, not
 * a crypto exchange:
 *
 *   - Serif typography for the asset name + headline value (House brand)
 *   - Descriptive section labels ("Cost basis", "Current valuation",
 *     "Custody") instead of abbreviations
 *   - Muted, elegant tones — no loud green/red P&L arrows
 *   - A "Market commentary" placeholder (italic, muted) that will later
 *     be populated with live news / context per asset
 *   - Subtle hairline dividers between sections
 *   - Refined left accent (very subtle) matching the sleeve tier
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │  Bitcoin                                  Conservative │
 *   │  BTC · blue-chip reserve asset                        │
 *   │  ──────────────────────────────────────────────────── │
 *   │  POSITION SUMMARY                                    │
 *   │  1.2 BTC held at Binance (Exchange)                   │
 *   │  ──────────────────────────────────────────────────── │
 *   │  COST BASIS          CURRENT VALUATION                │
 *   │  $60,000.00 / unit   $83,308.24 / unit  ◉ FTSO       │
 *   │  $72,000.00 total    $99,969.89 total                 │
 *   │                       +$27,969.89 (+46.62%)          │
 *   │  ──────────────────────────────────────────────────── │
 *   │  PORTFOLIO WEIGHT     38.42%                          │
 *   │  ──────────────────────────────────────────────────── │
 *   │  📰 MARKET COMMENTARY                                │
 *   │  Market commentary will appear here when news data    │
 *   │  is connected.                                       │
 *   └──────────────────────────────────────────────────────┘
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PositionCardData {
  assetId: string;
  sleeve: RiskCategory;
  venue: string;
  venueKind: string;
  quantity: string;
  price: string;
  value: string;
  weightBps: number;
  source: "live" | "fallback";
  priceSource?: string;
  priceConfidence?: string;
  priceIsFallback?: boolean;
  entryPrice: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMoney(s: string | number): string {
  const n = typeof s === "string" ? Number.parseFloat(s) : s;
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatNumber(s: string | number): string {
  const n = typeof s === "string" ? Number.parseFloat(s) : s;
  if (!Number.isFinite(n)) return "0";
  if (Number.isInteger(n)) return n.toLocaleString("en-US");
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2);
}

interface PnlValue {
  value: number;
  costBasis: number;
  currentValue: number;
  percent: number | null;
}

function computePnl(row: PositionCardData): PnlValue | null {
  if (row.entryPrice === null) return null;
  const entry = Number.parseFloat(row.entryPrice);
  const qty = Number.parseFloat(row.quantity);
  const current = Number.parseFloat(row.value);
  if (!Number.isFinite(entry) || entry <= 0) return null;
  if (!Number.isFinite(qty) || qty <= 0) return null;
  if (!Number.isFinite(current) || current <= 0) return null;
  const costBasis = entry * qty;
  if (!Number.isFinite(costBasis)) return null;
  const value = current - costBasis;
  const percent = costBasis > 0 ? (value / costBasis) * 100 : null;
  return { value, costBasis, currentValue: current, percent };
}

// ---------------------------------------------------------------------------
// Asset metadata — descriptive names for the "exclusive" feel
// ---------------------------------------------------------------------------

const ASSET_DESCRIPTIONS: Record<string, string> = {
  BTC: "Bitcoin · blue-chip reserve asset",
  ETH: "Ethereum · dominant smart-contract platform",
  SOL: "Solana · high-throughput L1",
  XRP: "XRP · institutional payments network",
  XLM: "Stellar Lumens · cross-border payments",
  FLR: "Flare · on-chain oracle ecosystem",
  USDC: "USD Coin · fiat-backed stablecoin",
  USDT: "Tether · fiat-backed stablecoin",
  RLUSD: "Ripple USD · fiat-backed stablecoin",
  DAI: "DAI · crypto-collateralized stablecoin",
  FRAX: "FRAX · partially-algorithmic stablecoin",
  stETH: "Lido Staked ETH · yield-bearing liquid staking",
  rETH: "Rocket Pool ETH · decentralized liquid staking",
  cbETH: "Coinbase Wrapped ETH · institutional staking",
  WBTC: "Wrapped Bitcoin · ERC-20 BTC representation",
  ARB: "Arbitrum · leading Ethereum L2",
  OP: "Optimism · Ethereum L2 rollup",
  AVAX: "Avalanche · high-speed L1 with subnets",
  UNI: "Uniswap · leading DEX governance",
  AAVE: "Aave · leading lending protocol",
  LDO: "Lido DAO · liquid staking governance",
  DOGE: "Dogecoin · speculative meme asset",
};

function assetDescription(assetId: string): string {
  return ASSET_DESCRIPTIONS[assetId.toUpperCase()] ?? `${assetId} · digital asset`;
}

function assetName(assetId: string): string {
  const desc = ASSET_DESCRIPTIONS[assetId.toUpperCase()];
  if (!desc) return assetId;
  return desc.split(" · ")[0]!;
}

// ---------------------------------------------------------------------------
// Venue description — natural language for the "exclusive" feel
// ---------------------------------------------------------------------------

function venueDescription(venue: string, venueKind: string): string {
  const kindLabel: Record<string, string> = {
    cex: "Exchange",
    "evm-wallet": "EVM Wallet",
    "solana-wallet": "Solana Wallet",
    "stake-defi": "DeFi Protocol",
    "xrp-wallet": "XRP Wallet",
    dex: "DEX",
  };
  const kind = kindLabel[venueKind] ?? venueKind;
  return `${venue} (${kind})`;
}

// ---------------------------------------------------------------------------
// Price-source chip (refined, subtle)
// ---------------------------------------------------------------------------

const PRICE_SOURCE_SHORT: Record<string, string> = {
  ftso: "FTSO",
  ccxt: "CCXT",
  coingecko: "CoinGecko",
  "reference-fallback": "Ref",
  "reference-prices-v0": "Ref",
  "reference-prices-v0-fallback": "Ref",
};

function PriceSourceChip({
  priceSource,
  priceConfidence,
  priceIsFallback,
}: {
  priceSource?: string;
  priceConfidence?: string;
  priceIsFallback?: boolean;
}) {
  if (!priceSource) return null;

  const isFallback = priceIsFallback === true;
  const isLowConfidence = priceConfidence === "low";
  const label = PRICE_SOURCE_SHORT[priceSource] ?? priceSource;

  if (isFallback || isLowConfidence) {
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-warn-foreground/80">
        <AlertTriangle className="size-2.5" aria-hidden />
        {label}
      </span>
    );
  }

  const Icon: LucideIcon =
    priceSource === "ftso" ? Radio : priceSource === "ccxt" ? Activity : ShieldCheck;
  const color =
    priceSource === "ftso"
      ? "text-primary/70"
      : priceSource === "ccxt"
        ? "text-allow-foreground/70"
        : "text-muted-foreground";

  return (
    <span className={cn("inline-flex items-center gap-1 text-[12px]", color)}>
      <Icon className="size-2.5" aria-hidden />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Venue icon
// ---------------------------------------------------------------------------

function VenueIcon({ venueKind }: { venueKind: string }) {
  const iconClass = "size-3.5 text-muted-foreground/60";
  switch (venueKind) {
    case "cex":
      return <Building2 className={iconClass} aria-hidden />;
    case "stake-defi":
      return <Link2 className={iconClass} aria-hidden />;
    case "dex":
      return <Link2 className={iconClass} aria-hidden />;
    default:
      return <Wallet className={iconClass} aria-hidden />;
  }
}

// ---------------------------------------------------------------------------
// The card — wealth-management aesthetic
// ---------------------------------------------------------------------------

/** Subtle sleeve accent — a thin left border in the sleeve tone. */
const SLEEVE_ACCENT: Record<RiskCategory, string> = {
  stable: "before:bg-allow/30",
  conservative: "before:bg-primary/30",
  balanced: "before:bg-warn/30",
  aggressive: "before:bg-reject/30",
};

export function PositionCard({ row }: { row: PositionCardData }) {
  const sleeveMeta = SLEEVE_META[row.sleeve];
  const pnl = computePnl(row);
  const isStable = categorizeAsset(row.assetId) === "stable";
  const name = assetName(row.assetId);
  const description = assetDescription(row.assetId);

  return (
    <Card
      className={cn(
        "relative overflow-hidden border-border/40 bg-card/30 transition-colors hover:bg-card/50",
        "before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px]",
        SLEEVE_ACCENT[row.sleeve],
      )}
    >
      <CardContent className="flex flex-col gap-4 p-5 sm:p-6">
        {/* ── Header: asset name + sleeve ────────────────────── */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h3 className="font-serif text-xl font-bold tracking-tight text-foreground">
              {name}
            </h3>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {description}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
              {sleeveMeta.label}
            </span>
            <span
              aria-hidden
              className={cn("size-2 rounded-full", sleeveMeta.dot)}
            />
          </div>
        </div>

        {/* ── Hairline divider ──────────────────────────────── */}
        <div className="house-hairline" aria-hidden />

        {/* ── Position summary ──────────────────────────────── */}
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground/60">
            Position Summary
          </span>
          <p className="text-base leading-relaxed text-foreground/90">
            <span className="font-mono font-semibold house-num">
              {formatNumber(row.quantity)}
            </span>{" "}
            <span className="font-mono text-muted-foreground">{row.assetId}</span>{" "}
            held at{" "}
            <span className="font-medium text-foreground">{row.venue}</span>
            <span className="text-muted-foreground">
              {" "}({row.venueKind})
            </span>
          </p>
        </div>

        {/* ── Cost basis + Current valuation ────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          {/* Cost basis */}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground/60">
              Cost Basis
            </span>
            {isStable || row.entryPrice === null ? (
              <>
                <span className="font-mono text-base text-muted-foreground/50">
                  $1.00 / unit
                </span>
                <span className="font-mono text-xs text-muted-foreground/50">
                  Par value
                </span>
              </>
            ) : (
              <>
                <span className="font-mono text-base text-muted-foreground">
                  ${formatMoney(row.entryPrice)}
                  <span className="text-[12px] text-muted-foreground/60"> / unit</span>
                </span>
                <span className="font-mono text-[13px] text-muted-foreground/70 house-num">
                  ${formatMoney(pnl?.costBasis ?? 0)}
                  <span className="text-[12px] text-muted-foreground/60"> total</span>
                </span>
              </>
            )}
          </div>

          {/* Current valuation */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground/60">
                Current Valuation
              </span>
              <PriceSourceChip
                priceSource={row.priceSource}
                priceConfidence={row.priceConfidence}
                priceIsFallback={row.priceIsFallback}
              />
            </div>
            <span className="font-serif text-xl font-bold text-foreground house-num">
              ${formatMoney(row.price)}
              <span className="text-[12px] font-normal text-muted-foreground/60"> / unit</span>
            </span>
            <span className="font-mono text-[13px] text-muted-foreground/70 house-num">
              ${formatMoney(row.value)}
              <span className="text-[12px] text-muted-foreground/60"> total</span>
            </span>
          </div>
        </div>

        {/* ── P&L + Weight (if P&L available) ───────────────── */}
        {(pnl || row.weightBps > 0) && (
          <>
            <div className="house-hairline" aria-hidden />
            <div className="flex items-end justify-between gap-3">
              {pnl && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground/60">
                    Unrealized P&L
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className={cn(
                          "font-serif text-lg font-semibold house-num cursor-default",
                          pnl.value > 0
                            ? "text-allow-foreground/80"
                            : pnl.value < 0
                              ? "text-reject-foreground/80"
                              : "text-muted-foreground",
                        )}
                      >
                        {pnl.value > 0 ? "+" : ""}
                        {formatMoney(pnl.value)}
                        {pnl.percent !== null && (
                          <span className="ml-1.5 text-[13px] font-normal opacity-70">
                            ({pnl.value > 0 ? "+" : ""}
                            {pnl.percent.toFixed(2)}%)
                          </span>
                        )}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[16rem]">
                      <div className="flex flex-col gap-1 text-xs">
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">Cost basis</span>
                          <span className="font-mono house-num">
                            ${formatMoney(pnl.costBasis)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">Current value</span>
                          <span className="font-mono house-num">
                            ${formatMoney(pnl.currentValue)}
                          </span>
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}
              {row.weightBps > 0 && (
                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground/60">
                    Portfolio Weight
                  </span>
                  <span className="font-serif text-base font-semibold text-foreground house-num">
                    {bpsToPercent(row.weightBps)}%
                  </span>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Market commentary (placeholder for news) ──────── */}
        <div className="house-hairline" aria-hidden />
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <Newspaper className="size-3 text-muted-foreground/50" aria-hidden />
            <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground/60">
              Market Commentary
            </span>
          </div>
          <p className="text-[13px] italic leading-relaxed text-muted-foreground/50">
            Market commentary and relevant news for {name} will appear here
            when the news feed is connected.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// PositionCardGrid — single-column stack (full width, one under another)
// ---------------------------------------------------------------------------

export function PositionCardGrid({ rows }: { rows: PositionCardData[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-sm text-muted-foreground">
        No positions yet.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, i) => (
        <PositionCard key={`${row.assetId}-${row.venue}-${row.venueKind}-${i}`} row={row} />
      ))}
    </div>
  );
}
