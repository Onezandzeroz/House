"use client";

import * as React from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  FileDown,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ScrollArea,
  ScrollBar,
} from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type {
  Intent,
  IntentReasonCode,
  IntentSide,
  IntentStatus,
} from "@/server/domain/intent";
import type { DecisionLogKind } from "@/server/domain/decision-log";

/**
 * DecisionLog (Task 38) — the audit-trail table on the History tab.
 *
 * Fetches `/api/trust/decisions?limit=50` and renders one row per
 * decision. Each row pairs a `DecisionLogEntry` (kind, context, fill,
 * signatureId, createdAt) with its parent `Intent` (assetId, side,
 * venue, notional, reasonCode, origin, status) so the owner can scan
 * "what was proposed, what was decided, where, why."
 *
 * Verdict-chip colors per kind:
 *   - policy-accept / user-approve / filled → emerald (allow)
 *   - user-reject / expired                → amber (warn)
 *   - policy-reject / kill-switched / signer-error → rose (reject)
 *
 * Rows are expandable: click to reveal the full PolicyContext JSON +
 * fill data (when present) — the audit "drill-down" view.
 *
 * Export-CSV button downloads the current (filtered) decision list
 * as a CSV file per plan §2 ("Export to CSV"). The CSV is built
 * entirely client-side from the fetched rows — no server round-trip.
 *
 * Loading: a 5-row skeleton.
 * Error:   a destructive Alert with the BFF route's error message.
 * Empty:   a single "No decisions logged yet" row.
 */

// ---------------------------------------------------------------------------
// Types — mirror the wire shape from `/api/trust/decisions`.
//
// `context` and `fill` are stored server-side as JSON strings in Prisma
// TEXT columns (SQLite round-trip safety). The service returns them
// verbatim — they are NOT deserialized on the server. The client
// JSON-parses them on demand for the expandable-row drill-down view.
// ---------------------------------------------------------------------------

/** Fill data, JSON-parsed from the wire string. */
interface Fill {
  price: string;
  fee: string;
  slippageBps: number;
  quantity: string;
  venue: string;
  filledAt: string;
}

/** DecisionLogEntry on the wire — `context` and `fill` are JSON strings. */
interface DecisionLogEntryWire {
  id: string;
  bookId: string;
  intentId: string;
  kind: DecisionLogKind;
  context: string;
  signatureId: string | null;
  fill: string | null;
  createdAt: string;
}

interface DecisionRow {
  entry: DecisionLogEntryWire;
  intent: Intent;
}

interface DecisionsResponse {
  decisions: DecisionRow[];
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; rows: DecisionRow[] }
  | { kind: "error"; message: string };

// ---------------------------------------------------------------------------
// Verdict chip metadata — color + short label per DecisionLogKind.
// ---------------------------------------------------------------------------

const VERDICT_META: Record<DecisionLogKind, { label: string; chip: string }> = {
  "policy-accept": {
    label: "Policy accept",
    chip: "bg-allow/15 text-allow-foreground border-allow/40",
  },
  "policy-reject": {
    label: "Policy reject",
    chip: "bg-reject/15 text-reject-foreground border-reject/40",
  },
  "user-approve": {
    label: "User approved",
    chip: "bg-allow/15 text-allow-foreground border-allow/40",
  },
  "user-reject": {
    label: "User rejected",
    chip: "bg-warn/15 text-warn-foreground border-warn/40",
  },
  "signer-error": {
    label: "Signer error",
    chip: "bg-reject/15 text-reject-foreground border-reject/40",
  },
  filled: {
    label: "Filled",
    chip: "bg-allow/15 text-allow-foreground border-allow/40",
  },
  expired: {
    label: "Expired",
    chip: "bg-muted text-muted-foreground border-border/60",
  },
  "kill-switched": {
    label: "Kill-switched",
    chip: "bg-reject/15 text-reject-foreground border-reject/40",
  },
};

const SIDE_LABEL: Record<IntentSide, string> = {
  buy: "Buy",
  sell: "Sell",
  stake: "Stake",
  unstake: "Unstake",
  "transfer-to-stables": "→ Stables",
};

const REASON_LABEL: Record<IntentReasonCode, string> = {
  "drift-rebalance": "Drift rebalance",
  "drawdown-de-risk": "Drawdown de-risk",
  "scheduled-rebalance": "Scheduled rebalance",
  "ai-proposal": "AI proposal",
  "user-approve": "User approve",
};

const STATUS_LABEL: Record<IntentStatus, string> = {
  pending: "Pending",
  "policy-rejected": "Policy rejected",
  "user-rejected": "User rejected",
  signed: "Signed",
  filled: "Filled",
  expired: "Expired",
  "kill-switched": "Kill-switched",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DecisionLog() {
  const [state, setState] = React.useState<LoadState>({ kind: "loading" });
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");

  const refetch = React.useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/trust/decisions?limit=50", {
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; message?: string }
        | DecisionsResponse
        | null;
      if (!res.ok) {
        if (
          data &&
          typeof data === "object" &&
          "error" in data &&
          data.error === "no-trust"
        ) {
          setState({
            kind: "error",
            message: "The trust no longer exists.",
          });
          return;
        }
        const msg =
          data && typeof data === "object" && typeof data.message === "string"
            ? data.message
            : `HTTP ${res.status} ${res.statusText}`;
        setState({ kind: "error", message: msg });
        return;
      }
      if (!data || typeof data !== "object" || !("decisions" in data)) {
        setState({ kind: "error", message: "Malformed decisions response." });
        return;
      }
      const payload = data as DecisionsResponse;
      setState({ kind: "ok", rows: payload.decisions });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  React.useEffect(() => {
    void refetch();
  }, [refetch]);

  const sortedRows = React.useMemo(() => {
    if (state.kind !== "ok") return [];
    const rows = [...state.rows];
    rows.sort((a, b) => {
      const at = new Date(a.entry.createdAt).getTime();
      const bt = new Date(b.entry.createdAt).getTime();
      return sortDir === "asc" ? at - bt : bt - at;
    });
    return rows;
  }, [state, sortDir]);

  const toggleSort = React.useCallback(() => {
    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
  }, []);

  const handleExport = React.useCallback(() => {
    if (state.kind !== "ok" || state.rows.length === 0) {
      toast.info("Nothing to export", {
        description: "The decision log is empty.",
      });
      return;
    }
    const csv = buildCsv(state.rows);
    downloadCsv(csv, `decisions-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success("CSV exported", {
      description: `${state.rows.length} decisions written to the file.`,
    });
  }, [state]);

  return (
    <Card className="relative overflow-hidden">
      <CardContent className="flex flex-col gap-4 p-4 sm:p-6">
        <header className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex flex-col gap-1">
            <h2 className="font-serif text-xl font-bold tracking-tight text-foreground">
              Decision log
            </h2>
            <p className="text-xs text-muted-foreground">
              Audit trail of every accepted or rejected intent. Click a row
              to expand the policy-context snapshot.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void refetch()}
              aria-label="Reload decision log"
            >
              <RefreshCw className="size-4" aria-hidden />
              Reload
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleExport}
              disabled={state.kind !== "ok" || state.rows.length === 0}
            >
              <FileDown className="size-4" aria-hidden />
              Export CSV
            </Button>
          </div>
        </header>

        {state.kind === "loading" && <DecisionLogSkeleton />}

        {state.kind === "error" && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" aria-hidden />
            <AlertTitle>Could not load the decision log</AlertTitle>
            <AlertDescription>
              <p>
                The BFF route <code>/api/trust/decisions</code> returned an
                error.
              </p>
              <p className="mt-1 font-mono text-xs">{state.message}</p>
            </AlertDescription>
          </Alert>
        )}

        {state.kind === "ok" && sortedRows.length === 0 && (
          <p className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-sm text-muted-foreground">
            No decisions logged yet. Decisions are written when the policy
            engine or the owner accepts / rejects an intent.
          </p>
        )}

        {state.kind === "ok" && sortedRows.length > 0 && (
          <ScrollArea className="max-h-[600px] overflow-y-auto rounded-md border border-border/40">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card/95 backdrop-blur">
                <TableRow className="border-b border-border/60 hover:bg-transparent">
                  <TableHead className="w-8 pl-3" />
                  <TableHead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={toggleSort}
                      className="h-auto p-0 text-[10px] uppercase tracking-widest text-muted-foreground hover:bg-transparent hover:text-foreground"
                    >
                      Date
                      {sortDir === "asc" ? " ↑" : " ↓"}
                    </Button>
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Intent
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Verdict
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Reason
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Venue
                  </TableHead>
                  <TableHead className="text-right text-[10px] uppercase tracking-widest text-muted-foreground">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default underline-offset-2 hover:underline">
                          Entry/Exit
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[20rem]">
                        <p className="text-xs leading-relaxed">
                          Per-unit fill price. Entry is logged when the
                          intent opens a position (buy / stake). Exit is
                          logged when the intent closes one (sell /
                          unstake). Other verdicts show &quot;--&quot;.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="text-right text-[10px] uppercase tracking-widest text-muted-foreground">
                    Notional
                  </TableHead>
                  <TableHead className="pr-3 text-[10px] uppercase tracking-widest text-muted-foreground">
                    Status
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.map((row) => {
                  const isExpanded = expandedId === row.entry.id;
                  const verdict = VERDICT_META[row.entry.kind];
                  return (
                    <DecisionRowItem
                      key={row.entry.id}
                      row={row}
                      isExpanded={isExpanded}
                      onToggle={() =>
                        setExpandedId((prev) =>
                          prev === row.entry.id ? null : row.entry.id,
                        )
                      }
                      verdictLabel={verdict.label}
                      verdictChip={verdict.chip}
                    />
                  );
                })}
              </TableBody>
            </Table>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// DecisionRowItem — one expandable row + the optional context JSON
// section beneath.
// ---------------------------------------------------------------------------

interface DecisionRowItemProps {
  row: DecisionRow;
  isExpanded: boolean;
  onToggle: () => void;
  verdictLabel: string;
  verdictChip: string;
}

function DecisionRowItem({
  row,
  isExpanded,
  onToggle,
  verdictLabel,
  verdictChip,
}: DecisionRowItemProps) {
  const { entry, intent } = row;
  const date = new Date(entry.createdAt);
  const isoTitle = date.toISOString();
  const relative = formatRelative(entry.createdAt);
  // Task 57 — Entry/Exit price label + fill.price (if any). Entry when
  // the intent opens a position (buy / stake), Exit when it closes one
  // (sell / unstake). Filled decisions without a fill blob, or non-
  // filled verdicts (policy-reject, user-approve, etc.), render "--".
  const fill = entry.fill ? parseFill(entry.fill) : null;
  const entryExit = resolveEntryExit(intent.side, entry.kind, fill);

  return (
    <>
      <TableRow
        className={cn(
          "cursor-pointer border-b border-border/40 last:border-b-0 transition-colors",
          isExpanded && "bg-muted/30",
        )}
        onClick={onToggle}
      >
        <TableCell className="w-8 pl-3">
          {isExpanded ? (
            <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
          )}
        </TableCell>
        <TableCell className="font-mono text-[10px] house-num text-muted-foreground">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="underline-offset-2 hover:underline">
                {relative} ago
              </span>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              className="bg-popover text-popover-foreground border border-border"
            >
              <p className="font-mono text-[10px]">{isoTitle}</p>
            </TooltipContent>
          </Tooltip>
        </TableCell>
        <TableCell>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-xs font-bold text-foreground">
              {intent.assetId}
            </span>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {SIDE_LABEL[intent.side]}
            </span>
          </div>
        </TableCell>
        <TableCell>
          <Badge
            variant="outline"
            className={cn("text-[10px] uppercase tracking-widest", verdictChip)}
          >
            {verdictLabel}
          </Badge>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {REASON_LABEL[intent.reasonCode]}
        </TableCell>
        <TableCell className="font-mono text-xs text-muted-foreground">
          {intent.venue}
        </TableCell>
        <TableCell className="text-right">
          {entryExit === null ? (
            <span className="text-[10px] text-muted-foreground/60">--</span>
          ) : (
            <div className="flex flex-col items-end gap-0.5">
              <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
                {entryExit.label}
              </span>
              <span className="font-mono text-xs house-num text-foreground">
                ${formatMoney(entryExit.price)}
              </span>
            </div>
          )}
        </TableCell>
        <TableCell className="text-right font-mono text-xs house-num text-foreground">
          ${formatMoney(intent.notional)}
        </TableCell>
        <TableCell className="pr-3 text-[10px] uppercase tracking-widest text-muted-foreground">
          {STATUS_LABEL[intent.status]}
        </TableCell>
      </TableRow>
      {isExpanded && (
        <TableRow className="bg-muted/20 hover:bg-muted/20">
          <TableCell colSpan={9} className="p-3">
            <DecisionContext entry={entry} intent={intent} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// DecisionContext — the expanded JSON drill-down. Renders the full
// policy context, signature id, and fill data (if any). The context
// blob is JSON-stringified for display since it carries the
// PolicyContext snapshot from decision time.
// ---------------------------------------------------------------------------

interface DecisionContextProps {
  entry: DecisionLogEntryWire;
  intent: Intent;
}

function DecisionContext({ entry, intent }: DecisionContextProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <ContextItem
          label="Intent id"
          value={intent.id}
          mono
        />
        <ContextItem
          label="Client id"
          value={intent.clientId}
          mono
        />
        <ContextItem
          label="Book id"
          value={intent.bookId}
          mono
        />
        <ContextItem
          label="Max slippage (bps)"
          value={String(intent.maxSlippageBps)}
          mono
        />
        <ContextItem
          label="Origin"
          value={intent.origin}
        />
        <ContextItem
          label="Expires at"
          value={new Date(intent.expiresAt).toISOString()}
          mono
        />
        <ContextItem
          label="Signature id"
          value={entry.signatureId ?? "—"}
          mono
        />
        <ContextItem
          label="Created at"
          value={new Date(intent.createdAt).toISOString()}
          mono
        />
        <ContextItem
          label="Decision id"
          value={entry.id}
          mono
        />
      </div>
      {entry.fill && (() => {
        const parsed = parseFill(entry.fill);
        return parsed ? <FillDetails fill={parsed} /> : null;
      })()}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Policy context snapshot
        </span>
        <pre className="max-h-72 overflow-auto rounded-md border border-border/40 bg-muted/30 p-3 text-[10px] leading-snug text-muted-foreground">
          {formatJson(entry.context)}
        </pre>
      </div>
    </div>
  );
}

function FillDetails({ fill }: { fill: Fill }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-allow/40 bg-allow/5 p-3">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-allow-foreground">
        Fill data
      </span>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <ContextItem label="Price" value={`$${formatMoney(fill.price)}`} mono />
        <ContextItem label="Fee" value={`$${formatMoney(fill.fee)}`} mono />
        <ContextItem
          label="Slippage (bps)"
          value={String(fill.slippageBps)}
          mono
        />
        <ContextItem label="Quantity" value={formatNumber(fill.quantity)} mono />
        <ContextItem label="Filled at" value={new Date(fill.filledAt).toISOString()} mono />
      </div>
    </div>
  );
}

function ContextItem({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "text-xs text-foreground break-all",
          mono && "font-mono house-num",
        )}
      >
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DecisionLogSkeleton — matches the table's shape so the loading
// to loaded transition is not a visual jump.
// ---------------------------------------------------------------------------

function DecisionLogSkeleton() {
  return (
    <div
      className="flex flex-col gap-1 rounded-md border border-border/40 p-2"
      aria-busy="true"
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-2 border-b border-border/30 px-1 py-3 last:border-b-0"
        >
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a money string — strip leading $, two decimals, space sep. */
function formatMoney(s: string): string {
  const trimmed = String(s ?? "").trim();
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

/** Format a quantity — drop trailing zeros but keep at least 2 decimals. */
function formatNumber(s: string): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return Number(n.toFixed(6)).toString();
}

/**
 * Format an ISO timestamp as a short relative "2d / 5h / 12m" string.
 */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diff = Date.now() - then;
  if (diff < 0) return "now";
  if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1000))}s`;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

/**
 * Pretty-print the policy-context JSON string as a 2-space-indented
 * object so the audit drill-down view reads cleanly. The wire shape
 * is a JSON string (Prisma TEXT round-trip safety); parse-then-
 * re-stringify so the field order is deterministic.
 */
function formatJson(ctx: string): string {
  try {
    return JSON.stringify(JSON.parse(ctx), null, 2);
  } catch {
    return ctx;
  }
}

/**
 * JSON-parse the `fill` wire string into a typed Fill. Returns null
 * for missing / malformed fills.
 */
function parseFill(raw: string): Fill | null {
  try {
    const parsed = JSON.parse(raw) as Partial<Fill>;
    if (
      !parsed ||
      typeof parsed.price !== "string" ||
      typeof parsed.fee !== "string" ||
      typeof parsed.slippageBps !== "number" ||
      typeof parsed.quantity !== "string" ||
      typeof parsed.venue !== "string" ||
      typeof parsed.filledAt !== "string"
    ) {
      return null;
    }
    return parsed as Fill;
  } catch {
    return null;
  }
}

/**
 * Task 57 — resolve the entry/exit price label + per-unit fill price
 * for a decision row.
 *
 *   Entry : intent.side is "buy" or "stake" → the trustee added a
 *           position; the fill.price is the per-unit entry cost.
 *   Exit  : intent.side is "sell" or "unstake" → the trustee closed a
 *           position; the fill.price is the per-unit exit value.
 *
 * Returns null when:
 *   - decision.kind is not "filled" (policy-reject, user-approve,
 *     expired, etc. — no fill exists to read), OR
 *   - the fill blob is missing / malformed, OR
 *   - the intent.side is "transfer-to-stables" (a de-risk side that
 *     doesn't fit either bucket; the fill.price is still surfaced in
 *     the expanded view, but the row shows "--" to keep the column
 *     focused on entries/exits).
 *
 * The label is short ("Entry" / "Exit") so the column stays scannable.
 */
function resolveEntryExit(
  side: IntentSide,
  kind: DecisionLogKind,
  fill: Fill | null,
): { label: "Entry" | "Exit"; price: string } | null {
  if (kind !== "filled") return null;
  if (fill === null) return null;
  if (side === "buy" || side === "stake") {
    return { label: "Entry", price: fill.price };
  }
  if (side === "sell" || side === "unstake") {
    return { label: "Exit", price: fill.price };
  }
  // transfer-to-stables — surface the fill data in the expanded view
  // only; the row shows "--" to keep the column focused.
  return null;
}

/**
 * Build the CSV string from the current decision rows. Includes a
 * header row, one row per decision, and proper CSV escaping (double
 * the quotes inside a field, wrap fields containing commas / quotes /
 * newlines in double-quotes).
 */
function buildCsv(rows: DecisionRow[]): string {
  const header = [
    "decisionId",
    "decisionKind",
    "decisionCreatedAt",
    "intentId",
    "assetId",
    "side",
    "venue",
    "notional",
    "reasonCode",
    "origin",
    "status",
    "signatureId",
    "fillPrice",
    "fillFee",
    "fillSlippageBps",
    "fillQuantity",
    "fillVenue",
    "fillFilledAt",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const { entry, intent } = r;
    // Parse the fill string (or null) once per row.
    const fill = entry.fill ? parseFill(entry.fill) : null;
    const cells = [
      entry.id,
      entry.kind,
      new Date(entry.createdAt).toISOString(),
      intent.id,
      intent.assetId,
      intent.side,
      intent.venue,
      intent.notional,
      intent.reasonCode,
      intent.origin,
      intent.status,
      entry.signatureId ?? "",
      fill?.price ?? "",
      fill?.fee ?? "",
      fill ? String(fill.slippageBps) : "",
      fill?.quantity ?? "",
      fill?.venue ?? "",
      fill ? new Date(fill.filledAt).toISOString() : "",
    ];
    lines.push(cells.map(csvEscape).join(","));
  }
  return lines.join("\n");
}

/** CSV-escape a single field per RFC 4180. */
function csvEscape(input: string): string {
  if (input == null) return "";
  const s = String(input);
  if (s.includes(",") || s.includes("\"") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Trigger a client-side file download of the CSV string. */
function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
