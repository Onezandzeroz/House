"use client";

import * as React from "react";
import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import {
  ScrollArea,
  ScrollBar,
} from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type {
  PortfolioSnapshot,
  PortfolioSnapshotAsset,
  PortfolioSnapshotSleeve,
  PortfolioSnapshotVenue,
} from "@/components/portfolio/types";
import { SLEEVE_META } from "@/components/onboarding/types";
import { categorizeAsset, type RiskCategory } from "@/server/domain/bankroll";
import { LivePriceBadge } from "./live-price-badge";

/**
 * PositionsTable (Task 38) — a detailed, sortable table view of every
 * position in the trust's book, flattened from the three-level
 * sleeves → assets → venues hierarchy that `/api/portfolio` returns.
 *
 * Each row = one (asset × venue) pair. A trust that holds BTC on two
 * venues gets two rows — one per venue. The table:
 *
 *   - Renders a shadcn Table with sticky-ish header + body inside a
 *     `ScrollArea` so long lists stay scannable on both mobile and
 *     desktop.
 *   - Color-codes the sleeve column with the same chip palette used
 *     across the dashboard (stable=emerald, conservative=gold,
 *     balanced=amber, aggressive=rose).
 *   - Surfaces a Live / Fallback badge in the header (delegates to
 *     `LivePriceBadge`).
 *   - Sorts by Value or Weight (toggle). Default: Value desc.
 *   - Sums the value column + shows "100.00%" weight in a footer row.
 *
 * Task 57 — Entry Price + P&L columns:
 *   - "Entry Price" reads `asset.entryPrice` (per-unit price in book
 *     currency, null for stables / unfilled). Shows "--" when null.
 *   - "P&L" = currentValue - (entryPrice × quantity), per venue-row.
 *     Positive → emerald (text-allow-foreground); negative → rose
 *     (text-reject-foreground); null/zero → muted.
 *
 * Loading: a row-skeleton that mirrors the table shape.
 * Error:   a destructive Alert.
 * Empty:   a single "No positions yet" row (matches the empty-state
 *          pattern in `ManagePositionsPanel`).
 *
 * Math caveat: per asset, the venue's `value` is the per-venue slice;
 * the asset's `price` is the asset-level price (a single number across
 * all venues, sourced from CoinGecko / reference prices in
 * trust-service.ts). The quantity displayed is the per-venue quantity.
 */
export function PositionsTable() {
  const [state, setState] = React.useState<PositionsState>({
    kind: "loading",
  });
  const [sortKey, setSortKey] = React.useState<SortKey>("value");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/portfolio", { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as
          | { error?: string; message?: string }
          | PortfolioSnapshot
          | null;
        if (!res.ok) {
          if (
            data &&
            typeof data === "object" &&
            "error" in data &&
            data.error === "no-trust"
          ) {
            if (!cancelled) {
              setState({
                kind: "error",
                message: "The trust no longer exists.",
              });
            }
            return;
          }
          throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }
        if (
          !data ||
          typeof data !== "object" ||
          !("sleeves" in data) ||
          !("nav" in data)
        ) {
          throw new Error("Malformed portfolio response.");
        }
        if (!cancelled) {
          setState({ kind: "ok", data: data as PortfolioSnapshot });
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = React.useMemo(() => {
    if (state.kind !== "ok") return [];
    return flattenPositions(state.data).sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortKey === "value") {
        return (Number(a.value) - Number(b.value)) * dir;
      }
      // weight
      return (a.weightBps - b.weightBps) * dir;
    });
  }, [state, sortKey, sortDir]);

  const totalValue = React.useMemo(() => {
    if (state.kind !== "ok") return "0";
    return state.data.sleeves
      .flatMap((s) => s.assets.flatMap((a) => a.venues))
      .reduce((sum, v) => sum + Number(v.value || "0"), 0)
      .toFixed(2);
  }, [state]);

  // Aggregate the unrealized P&L across all venues — surfaced in the
  // footer so the owner sees the book-level gain / loss at a glance.
  const totalPnl = React.useMemo(() => {
    if (state.kind !== "ok") return null;
    let sum = 0;
    let hasAny = false;
    for (const flat of flattenPositions(state.data)) {
      const pnl = computePnl(flat);
      if (pnl !== null) {
        sum += pnl.value;
        hasAny = true;
      }
    }
    return hasAny ? sum : null;
  }, [state]);

  const handleSort = React.useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir("desc");
      return key;
    });
  }, []);

  return (
    <Card className="relative overflow-hidden">
      <CardContent className="flex flex-col gap-4 p-4 sm:p-6">
        <header className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex flex-col gap-1">
            <h2 className="font-serif text-xl font-bold tracking-tight text-foreground">
              Positions
            </h2>
            <p className="text-xs text-muted-foreground">
              Per-asset × per-venue breakdown. Sort by Value or Weight to
              scan the largest exposures first. Entry price + P&amp;L are
              shown for non-stable assets.
            </p>
          </div>
          <LivePriceBadge />
        </header>

        {state.kind === "loading" && <PositionsTableSkeleton />}

        {state.kind === "error" && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" aria-hidden />
            <AlertTitle>Could not load positions</AlertTitle>
            <AlertDescription>
              <p>
                The BFF route <code>/api/portfolio</code> returned an error.
              </p>
              <p className="mt-1 font-mono text-xs">{state.message}</p>
            </AlertDescription>
          </Alert>
        )}

        {state.kind === "ok" && rows.length === 0 && (
          <p className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-sm text-muted-foreground">
            No positions yet. Use the &quot;Add funds&quot; button above to
            record your first holding.
          </p>
        )}

        {state.kind === "ok" && rows.length > 0 && (
          <ScrollArea className="max-h-96 overflow-y-auto rounded-md border border-border/40">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card/95 backdrop-blur">
                <TableRow className="border-b border-border/60 hover:bg-transparent">
                  <TableHead className="pl-3 text-[10px] uppercase tracking-widest text-muted-foreground">
                    Asset
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Sleeve
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Venue
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Kind
                  </TableHead>
                  <TableHead className="text-right text-[10px] uppercase tracking-widest text-muted-foreground">
                    Qty
                  </TableHead>
                  <TableHead className="text-right text-[10px] uppercase tracking-widest text-muted-foreground">
                    Entry
                  </TableHead>
                  <TableHead className="text-right text-[10px] uppercase tracking-widest text-muted-foreground">
                    Price
                  </TableHead>
                  <TableHead className="text-right text-[10px] uppercase tracking-widest text-muted-foreground">
                    <SortHeader
                      label="Value"
                      active={sortKey === "value"}
                      dir={sortDir}
                      onClick={() => handleSort("value")}
                    />
                  </TableHead>
                  <TableHead className="text-right text-[10px] uppercase tracking-widest text-muted-foreground">
                    P&amp;L
                  </TableHead>
                  <TableHead className="pr-3 text-right text-[10px] uppercase tracking-widest text-muted-foreground">
                    <SortHeader
                      label="Weight"
                      active={sortKey === "weight"}
                      dir={sortDir}
                      onClick={() => handleSort("weight")}
                    />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const pnl = computePnl(row);
                  return (
                    <TableRow
                      key={`${row.assetId}-${row.venue}-${row.venueKind}`}
                      className="border-b border-border/40 last:border-b-0"
                    >
                      <TableCell className="pl-3">
                        <span className="font-mono text-sm font-bold text-foreground">
                          {row.assetId}
                        </span>
                      </TableCell>
                      <TableCell>
                        <SleeveChip category={row.sleeve} />
                      </TableCell>
                      <TableCell className="font-mono text-xs text-foreground">
                        {row.venue}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.venueKind}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs house-num text-foreground">
                        {formatNumber(row.quantity)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs house-num text-muted-foreground">
                        {row.entryPrice === null ? (
                          <span className="text-muted-foreground/60">--</span>
                        ) : (
                          <span className="text-muted-foreground">
                            ${formatMoney(row.entryPrice)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs house-num text-foreground">
                        ${formatMoney(row.price)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs house-num text-primary">
                        ${formatMoney(row.value)}
                      </TableCell>
                      <TableCell className={cn(
                        "text-right font-mono text-xs house-num",
                        pnl === null
                          ? "text-muted-foreground/60"
                          : pnl.value > 0
                            ? "text-allow-foreground"
                            : pnl.value < 0
                              ? "text-reject-foreground"
                              : "text-muted-foreground",
                      )}>
                        <PnlCell pnl={pnl} />
                      </TableCell>
                      <TableCell className="pr-3 text-right font-mono text-xs house-num text-foreground">
                        {bpsToPercent(row.weightBps)}%
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow className="bg-muted/40 hover:bg-transparent">
                  <TableCell
                    colSpan={7}
                    className="pl-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                  >
                    Total
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-bold house-num text-primary">
                    ${formatMoney(totalValue)}
                  </TableCell>
                  <TableCell className={cn(
                    "text-right font-mono text-sm font-bold house-num",
                    totalPnl === null
                      ? "text-muted-foreground/60"
                      : totalPnl > 0
                        ? "text-allow-foreground"
                        : totalPnl < 0
                          ? "text-reject-foreground"
                          : "text-muted-foreground",
                  )}>
                    {totalPnl === null ? (
                      <span>--</span>
                    ) : (
                      <span>
                        {totalPnl > 0 ? "+" : ""}
                        {formatMoney(totalPnl)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="pr-3 text-right font-mono text-sm font-bold house-num text-foreground">
                    100.00%
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Internal types + helpers
// ---------------------------------------------------------------------------

type PositionsState =
  | { kind: "loading" }
  | { kind: "ok"; data: PortfolioSnapshot }
  | { kind: "error"; message: string };

type SortKey = "value" | "weight";
type SortDir = "asc" | "desc";

/** A computed P&L value with sign info so the UI can color-code. */
interface PnlValue {
  /** Signed delta (currentValue - costBasis). Positive = gain, negative = loss. */
  value: number;
  /** Cost basis (entryPrice × quantity) — surfaced in the tooltip. */
  costBasis: number;
  /** Current market value (quantity × price). */
  currentValue: number;
}

interface FlatRow {
  assetId: string;
  sleeve: RiskCategory;
  venue: string;
  venueKind: string;
  quantity: string;
  price: string;
  value: string;
  weightBps: number;
  source: "live" | "fallback";
  /**
   * Entry price per unit (book currency). Null when the asset is a
   * stablecoin (stables are $1.00 by definition so no entry is collected)
   * or when the trustee didn't provide one during onboarding (Task 57).
   */
  entryPrice: string | null;
}

/**
 * Flatten the three-level sleeves → assets → venues hierarchy into a
 * single list of (asset × venue) rows. Each row carries the parent
 * sleeve so the chip can color-code it without re-walking the tree,
 * and the asset-level entryPrice so P&L can be computed per row.
 */
function flattenPositions(snapshot: PortfolioSnapshot): FlatRow[] {
  const source = snapshot.priceSource === "live" ? "live" : "fallback";
  const out: FlatRow[] = [];
  for (const sleeve of snapshot.sleeves as PortfolioSnapshotSleeve[]) {
    for (const asset of sleeve.assets as PortfolioSnapshotAsset[]) {
      // Stables don't carry an entry price (see onboarding logic).
      const isStable = categorizeAsset(asset.assetId) === "stable";
      const assetEntry = isStable ? null : (asset.entryPrice ?? null);
      for (const venue of asset.venues as PortfolioSnapshotVenue[]) {
        out.push({
          assetId: asset.assetId,
          sleeve: sleeve.category,
          venue: venue.venue,
          venueKind: venue.venueKind,
          quantity: venue.quantity,
          // Asset-level price — one number per asset (see JSDoc).
          price: asset.price,
          value: venue.value,
          weightBps: venue.weightBps,
          source,
          entryPrice: assetEntry,
        });
      }
    }
  }
  return out;
}

/**
 * Compute the unrealized P&L for a flat row. Returns null when entry
 * price is missing (stablecoin, or the trustee didn't provide one).
 *
 *   pnl = currentValue - (entryPrice × quantity)
 *
 * Per venue-row quantity — the snapshot's `value` field is per-venue
 * so the comparison is apples-to-apples. Math is JS Number (same caveat
 * as elsewhere in v0; production MUST use a fixed-point decimal lib).
 */
function computePnl(row: FlatRow): PnlValue | null {
  if (row.entryPrice === null) return null;
  const entry = Number(row.entryPrice);
  const qty = Number(row.quantity);
  const current = Number(row.value);
  if (!Number.isFinite(entry) || entry <= 0) return null;
  if (!Number.isFinite(qty) || qty <= 0) return null;
  if (!Number.isFinite(current) || current <= 0) return null;
  const costBasis = entry * qty;
  if (!Number.isFinite(costBasis)) return null;
  return {
    value: current - costBasis,
    costBasis,
    currentValue: current,
  };
}

/**
 * PnlCell — renders the P&L value with a tooltip showing the cost
 * basis + current value breakdown. The tooltip is read-only and
 * stays open on hover; click is not required.
 */
function PnlCell({ pnl }: { pnl: PnlValue | null }) {
  if (pnl === null) {
    return <span className="text-muted-foreground/60">--</span>;
  }
  const sign = pnl.value > 0 ? "+" : "";
  const label = `${sign}${formatMoney(pnl.value)}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default underline-offset-2 hover:underline">
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[18rem]">
        <div className="flex flex-col gap-1 text-xs">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-muted-foreground">Cost basis</span>
            <span className="font-mono house-num">${formatMoney(pnl.costBasis)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-muted-foreground">Current</span>
            <span className="font-mono house-num">${formatMoney(pnl.currentValue)}</span>
          </div>
          <div className="mt-1 border-t border-border/40 pt-1 text-[10px] text-muted-foreground">
            P&amp;L = current − (entry × qty)
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * SleeveChip — re-uses the SLEEVE_META palette so the per-row chip
 * stays visually identical to the onboarding wizard + manage-
 * positions panel chips.
 */
function SleeveChip({ category }: { category: RiskCategory }) {
  const meta = SLEEVE_META[category];
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 text-[10px] uppercase tracking-widest",
        meta.chip,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </Badge>
  );
}

/**
 * SortHeader — a button-style column header that shows the current
 * sort direction with an arrow icon. Clicking toggles asc / desc on
 * the same column; clicking a new column resets to desc.
 */
function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={cn(
        "h-auto p-0 text-[10px] uppercase tracking-widest hover:bg-transparent hover:text-foreground",
        active ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {label}
      {active ? (
        dir === "asc" ? (
          <ArrowUp className="ml-1 size-3" aria-hidden />
        ) : (
          <ArrowDown className="ml-1 size-3" aria-hidden />
        )
      ) : (
        <ArrowUpDown className="ml-1 size-3 opacity-50" aria-hidden />
      )}
    </Button>
  );
}

/**
 * Format a quantity string — drop trailing zeros after the decimal
 * but keep at least 2 decimals. Mirrors `trimNumber` in
 * manage-positions-panel.tsx.
 */
function formatNumber(s: string): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return Number(n.toFixed(6)).toString();
}

/**
 * Format a money string — keep two decimals, comma-thousands separator
 * replaced with thin-space. Mirrors `trimMoney` in
 * manage-positions-panel.tsx (strips any leading $).
 */
function formatMoney(s: string): string {
  const trimmed = String(s).trim();
  const withoutDollar = trimmed.startsWith("$") ? trimmed.slice(1) : trimmed;
  const n = Number(withoutDollar);
  if (!Number.isFinite(n)) return withoutDollar || "0.00";
  return n
    .toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    .replace(/,/g, " ");
}

/** bps → "12.34" percent string. */
function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2);
}

// ---------------------------------------------------------------------------
// PositionsTableSkeleton — mirrors the table's shape so the loading
// to loaded transition is not a visual jump.
// ---------------------------------------------------------------------------

function PositionsTableSkeleton() {
  return (
    <div
      className="flex flex-col gap-1 rounded-md border border-border/40 p-2"
      aria-busy="true"
    >
      <div className="flex items-center justify-between border-b border-border/40 px-1 py-2">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-3 w-12" />
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-2 border-b border-border/30 px-1 py-2 last:border-b-0"
        >
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-16 rounded-full" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
