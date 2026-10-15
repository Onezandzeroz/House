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
 * PositionCard — a rich card for a single asset position in the
 * portfolio. Replaces the flat table row with a visually richer layout
 * that shows all the position's data at a glance:
 *
 *   ┌─────────────────────────────────────────────┐
 *   │  BTC                          Conservative  │
 *   │  Bitcoin · blue-chip                         │
 *   │  ─────────────────────────────────────────── │
 *   │  Quantity          1.2 BTC                   │
 *   │  Entry price       $60,000.00                │
 *   │  Current price     $83,308.24  ◉ FTSO       │
 *   │  Market value      $99,969.89                │
 *   │  P&L               +$27,969.89  (+46.6%)    │
 *   │  Weight            38.42%                   │
 *   │  ─────────────────────────────────────────── │
 *   │  📍 binance (CEX) · cold storage (XRP wallet)│
 *   └─────────────────────────────────────────────┘
 *
 * Each card carries the sleeve colour as a left-border accent so the
 * trustee can see the risk tier at a glance.
 */

// ---------------------------------------------------------------------------
// Types (mirror the FlatRow from positions-table.tsx but self-contained)
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
// Helpers (reused from positions-table.tsx — kept here so the card is
// self-contained)
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
  return { value: current - costBasis, costBasis, currentValue: current };
}

// ---------------------------------------------------------------------------
// Price-source indicator (reused logic from positions-table.tsx)
// ---------------------------------------------------------------------------

const PRICE_SOURCE_SHORT: Record<string, string> = {
  ftso: "FTSO",
  ccxt: "CCXT",
  coingecko: "CoinGecko",
  "reference-fallback": "Ref (live down)",
  "reference-prices-v0": "Reference",
  "reference-prices-v0-fallback": "Ref $1.00",
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
      <Badge
        variant="outline"
        className="gap-1 border-warn/40 bg-warn/10 text-[9px] text-warn-foreground"
      >
        <AlertTriangle className="size-2.5" aria-hidden />
        {label}
      </Badge>
    );
  }

  const Icon =
    priceSource === "ftso" ? Radio : priceSource === "ccxt" ? Activity : ShieldCheck;
  const color =
    priceSource === "ftso"
      ? "border-primary/40 bg-primary/10 text-primary"
      : priceSource === "ccxt"
        ? "border-allow/40 bg-allow/10 text-allow-foreground"
        : "border-border/40 bg-muted/40 text-muted-foreground";

  return (
    <Badge variant="outline" className={cn("gap-1 text-[9px]", color)}>
      <Icon className="size-2.5" aria-hidden />
      {label}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Venue icon
// ---------------------------------------------------------------------------

function VenueIcon({ venueKind }: { venueKind: string }) {
  const iconClass = "size-3.5 text-muted-foreground";
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
// The card
// ---------------------------------------------------------------------------

const SLEEVE_BORDER: Record<RiskCategory, string> = {
  stable: "border-l-allow/60",
  conservative: "border-l-primary/60",
  balanced: "border-l-warn/60",
  aggressive: "border-l-reject/60",
};

export function PositionCard({ row }: { row: PositionCardData }) {
  const sleeveMeta = SLEEVE_META[row.sleeve];
  const pnl = computePnl(row);
  const isStable = categorizeAsset(row.assetId) === "stable";

  const pnlPercent =
    pnl && pnl.costBasis > 0
      ? ((pnl.value / pnl.costBasis) * 100).toFixed(2)
      : null;

  const PnlIcon =
    pnl === null ? null : pnl.value > 0 ? TrendingUp : pnl.value < 0 ? TrendingDown : Minus;

  return (
    <Card
      className={cn(
        "relative overflow-hidden border-l-4 transition-colors hover:bg-muted/20",
        SLEEVE_BORDER[row.sleeve],
      )}
    >
      <CardContent className="flex flex-col gap-3 p-4">
        {/* Header: asset id + sleeve chip */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-lg font-bold text-foreground">
              {row.assetId}
            </span>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {sleeveMeta.label}
            </span>
          </div>
          <Badge
            variant="outline"
            className={cn("gap-1 text-[10px]", sleeveMeta.chip)}
          >
            <span
              aria-hidden
              className={cn("size-1.5 rounded-full", sleeveMeta.dot)}
            />
            {sleeveMeta.label}
          </Badge>
        </div>

        {/* Key metrics grid */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          {/* Quantity */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
              Quantity
            </span>
            <span className="font-mono house-num text-foreground">
              {formatNumber(row.quantity)}
            </span>
          </div>

          {/* Weight */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
              Weight
            </span>
            <span className="font-mono house-num text-foreground">
              {bpsToPercent(row.weightBps)}%
            </span>
          </div>

          {/* Entry price */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
              Entry price
            </span>
            {isStable || row.entryPrice === null ? (
              <span className="font-mono text-muted-foreground/60">--</span>
            ) : (
              <span className="font-mono house-num text-muted-foreground">
                ${formatMoney(row.entryPrice)}
              </span>
            )}
          </div>

          {/* Current price + source chip */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
              Current price
            </span>
            <div className="flex items-center gap-1.5">
              <span className="font-mono house-num text-foreground">
                ${formatMoney(row.price)}
              </span>
              <PriceSourceChip
                priceSource={row.priceSource}
                priceConfidence={row.priceConfidence}
                priceIsFallback={row.priceIsFallback}
              />
            </div>
          </div>
        </div>

        {/* Market value + P&L — the headline numbers */}
        <div className="flex items-end justify-between gap-2 border-t border-border/40 pt-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
              Market value
            </span>
            <span className="font-serif text-lg font-bold text-primary house-num">
              ${formatMoney(row.value)}
            </span>
          </div>

          {pnl !== null && PnlIcon && (
            <div className="flex flex-col items-end gap-0.5">
              <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
                P&L
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={cn(
                      "flex items-center gap-1 font-mono text-sm font-semibold house-num",
                      pnl.value > 0
                        ? "text-allow-foreground"
                        : pnl.value < 0
                          ? "text-reject-foreground"
                          : "text-muted-foreground",
                    )}
                  >
                    <PnlIcon className="size-3.5" aria-hidden />
                    {pnl.value > 0 ? "+" : ""}
                    {formatMoney(pnl.value)}
                    {pnlPercent && (
                      <span className="text-[10px] opacity-70">
                        ({pnl.value > 0 ? "+" : ""}
                        {pnlPercent}%)
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
                      <span className="text-muted-foreground">Current</span>
                      <span className="font-mono house-num">
                        ${formatMoney(pnl.currentValue)}
                      </span>
                    </div>
                    <div className="mt-1 border-t border-border/40 pt-1 text-[10px] text-muted-foreground">
                      P&L = current − (entry × qty)
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>

        {/* Venue footer */}
        <div className="flex items-center gap-1.5 border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
          <VenueIcon venueKind={row.venueKind} />
          <span className="font-mono">{row.venue}</span>
          <span className="text-muted-foreground/50">·</span>
          <span className="uppercase tracking-widest">{row.venueKind}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// PositionCardGrid — renders a responsive grid of PositionCards
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
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {rows.map((row, i) => (
        <PositionCard key={`${row.assetId}-${row.venue}-${row.venueKind}-${i}`} row={row} />
      ))}
    </div>
  );
}
