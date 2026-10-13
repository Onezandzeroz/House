"use client";

import * as React from "react";
import {
  AlertCircle,
  Camera,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

/**
 * NavHistoryChart (Task 38) — the NAV-historikk line chart on the
 * History tab.
 *
 * Fetches `/api/trust/snapshots?limit=30` and renders a recharts
 * `AreaChart` (filled line chart) with:
 *   - X-axis: snapshot date (snapshotAt).
 *   - Y-axis: NAV in the book currency.
 *   - Single area: emerald gradient stroke + subtle emerald
 *     gradient fill beneath, smooth `monotone` curve.
 *   - Dark-mode custom tooltip: date + NAV + drawdownBps.
 *
 * The chart is read-only; the only mutation is the "Take snapshot"
 * button (POST /api/trust/snapshots). The parent `HistoryView` owns
 * its own "Take snapshot" button at the top-right; it bumps a
 * `refreshKey` it passes to this component so the chart refetches
 * after a manual snapshot.
 *
 * Empty state: a centred "No history yet" panel with a "Take first
 * snapshot" button. Clicking it POSTs + refetches.
 *
 * Loading: a skeleton that approximates the chart shape.
 * Error:   a destructive Alert.
 */

// ---------------------------------------------------------------------------
// Types — mirror the BookSnapshot Prisma model so the client bundle
// does not pull Prisma's runtime.
// ---------------------------------------------------------------------------

interface BookSnapshotRow {
  id: string;
  bookId: string;
  nav: string;
  weights: string; // JSON blob — not parsed here, not needed for NAV chart
  drawdownBps: number;
  snapshotAt: string;
}

interface SnapshotsResponse {
  snapshots: BookSnapshotRow[];
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; rows: BookSnapshotRow[] }
  | { kind: "error"; message: string };

export interface NavHistoryChartProps {
  /**
   * When this number changes, the chart refetches. The parent
   * `HistoryView` bumps this after its own "Take snapshot" button
   * fires so the chart picks up the new row without a manual reload.
   */
  refreshKey?: number;
}

export function NavHistoryChart({ refreshKey = 0 }: NavHistoryChartProps) {
  const [state, setState] = React.useState<LoadState>({
    kind: "loading",
  });
  const [taking, setTaking] = React.useState(false);

  const refetch = React.useCallback(async () => {
    try {
      const res = await fetch("/api/trust/snapshots?limit=30", {
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; message?: string }
        | SnapshotsResponse
        | null;
      if (!res.ok) {
        if (
          data &&
          typeof data === "object" &&
          "error" in data &&
          data.error === "no-trust"
        ) {
          setState({ kind: "error", message: "The trust no longer exists." });
          return;
        }
        const msg =
          data && typeof data === "object" && typeof data.message === "string"
            ? data.message
            : `HTTP ${res.status} ${res.statusText}`;
        setState({ kind: "error", message: msg });
        return;
      }
      if (!data || typeof data !== "object" || !("snapshots" in data)) {
        setState({ kind: "error", message: "Malformed snapshots response." });
        return;
      }
      const payload = data as SnapshotsResponse;
      setState({ kind: "ok", rows: payload.snapshots });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  React.useEffect(() => {
    void refetch();
  }, [refetch, refreshKey]);

  const handleTakeSnapshot = React.useCallback(async () => {
    setTaking(true);
    try {
      const res = await fetch("/api/trust/snapshots", {
        method: "POST",
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; message?: string; snapshot?: BookSnapshotRow }
        | null;
      if (!res.ok) {
        const msg =
          data && typeof data === "object" && typeof data.message === "string"
            ? data.message
            : `HTTP ${res.status} ${res.statusText}`;
        toast.error("Could not take snapshot", { description: msg });
        return;
      }
      const snap =
        data && typeof data === "object" && "snapshot" in data
          ? data.snapshot
          : undefined;
      const navStr = snap ? formatMoney(snap.nav) : "—";
      toast.success("Snapshot taken", {
        description: `NAV recorded at ${navStr} — the chart now includes this point.`,
      });
      await refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Could not take snapshot", { description: msg });
    } finally {
      setTaking(false);
    }
  }, [refetch]);

  if (state.kind === "loading") {
    return <NavChartSkeleton />;
  }

  if (state.kind === "error") {
    return (
      <Alert variant="destructive">
        <AlertCircle className="size-4" aria-hidden />
        <AlertTitle>Could not load NAV history</AlertTitle>
        <AlertDescription>
          <p>
            The BFF route <code>/api/trust/snapshots</code> returned an error.
          </p>
          <p className="mt-1 font-mono text-xs">{state.message}</p>
        </AlertDescription>
      </Alert>
    );
  }

  if (state.rows.length === 0) {
    return (
      <Card className="relative overflow-hidden">
        <CardContent className="flex flex-col items-center justify-center gap-4 px-6 py-10 text-center sm:py-14">
          <div
            aria-hidden
            className="size-20 rounded-full"
            style={{
              background:
                "radial-gradient(circle at 50% 50%, rgba(16,185,129,0.20), transparent 70%)",
            }}
          />
          <div className="flex flex-col gap-1">
            <h2 className="font-serif text-2xl font-bold tracking-tight text-primary">
              No history yet
            </h2>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              First NAV snapshot
            </p>
          </div>
          <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
            Snapshots record the book&apos;s NAV at a moment in time. The
            chart draws once there is at least one snapshot. Taking a
            snapshot computes the NAV from live CoinGecko prices (or the
            fallback reference prices) + records the drawdown from peak.
          </p>
          <Button
            size="lg"
            onClick={() => void handleTakeSnapshot()}
            disabled={taking}
          >
            {taking ? (
              <RefreshCw className="size-4 animate-spin" aria-hidden />
            ) : (
              <Camera className="size-4" aria-hidden />
            )}
            Take first snapshot
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Sort ascending by snapshotAt for the chart (oldest first).
  const sorted = [...state.rows].sort(
    (a, b) =>
      new Date(a.snapshotAt).getTime() - new Date(b.snapshotAt).getTime(),
  );
  const data = sorted.map((s) => ({
    snapshotAt: s.snapshotAt,
    nav: Number(s.nav) || 0,
    drawdownBps: s.drawdownBps,
    navRaw: s.nav,
  }));

  // Domain: floor the Y axis at 0, ceiling at max NAV + 5% padding.
  const maxNav = Math.max(...data.map((d) => d.nav), 0);
  const yMax = maxNav > 0 ? maxNav * 1.05 : 1000;

  const latest = data[data.length - 1];
  const first = data[0];
  const delta =
    first && latest ? ((latest.nav - first.nav) / Math.max(first.nav, 1)) * 100 : 0;
  const positive = delta >= 0;

  return (
    <Card className="relative overflow-hidden">
      <CardContent className="flex flex-col gap-4 p-4 sm:p-6">
        <header className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex flex-col gap-1">
            <h2 className="font-serif text-xl font-bold tracking-tight text-foreground">
              NAV history
            </h2>
            <p className="text-xs text-muted-foreground">
              {data.length} snapshot{data.length === 1 ? "" : "s"} ·{" "}
              {first ? new Date(first.snapshotAt).toLocaleDateString() : "—"} →{" "}
              {latest ? new Date(latest.snapshotAt).toLocaleDateString() : "—"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={cnBadge(
                positive
                  ? "bg-allow/15 text-allow-foreground border-allow/40"
                  : "bg-reject/15 text-reject-foreground border-reject/40",
              )}
            >
              <span
                aria-hidden
                className={`mr-1 text-xs ${positive ? "▲" : "▼"}`}
              />
              <span className="house-num">
                {positive ? "+" : ""}
                {delta.toFixed(2)}%
              </span>
            </Badge>
            <Badge
              variant="outline"
              className="bg-primary/10 text-primary border-primary/40"
            >
              Latest NAV{" "}
              <span className="ml-1 house-num">${formatMoney(latest?.navRaw ?? "0")}</span>
            </Badge>
          </div>
        </header>
        <div className="h-[300px] w-full" aria-label="NAV history line chart">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 10, right: 12, bottom: 0, left: 0 }}
            >
              <defs>
                <linearGradient id="navStroke" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={1} />
                  <stop offset="100%" stopColor="#14b8a6" stopOpacity={1} />
                </linearGradient>
                <linearGradient id="navFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.32} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(255,255,255,0.06)"
                vertical={false}
              />
              <XAxis
                dataKey="snapshotAt"
                tickFormatter={(iso) => {
                  const d = new Date(iso as string);
                  return d.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  });
                }}
                tick={{ fill: "#a1a1aa", fontSize: 10, fontFamily: "monospace" }}
                axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                tickLine={false}
                minTickGap={20}
              />
              <YAxis
                domain={[0, yMax]}
                tickFormatter={(v) =>
                  `$${Math.round(Number(v)).toLocaleString("en-US")}`
                }
                tick={{ fill: "#a1a1aa", fontSize: 10, fontFamily: "monospace" }}
                axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                tickLine={false}
                width={56}
              />
              <Tooltip
                cursor={{
                  stroke: "rgba(16,185,129,0.4)",
                  strokeWidth: 1,
                  strokeDasharray: "3 3",
                }}
                content={<NavChartTooltip />}
              />
              <Area
                type="monotone"
                dataKey="nav"
                stroke="url(#navStroke)"
                strokeWidth={2}
                fill="url(#navFill)"
                dot={false}
                activeDot={{
                  r: 4,
                  fill: "#10b981",
                  stroke: "#022c22",
                  strokeWidth: 2,
                }}
                isAnimationActive={true}
                animationDuration={400}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// NavChartTooltip — dark-mode custom tooltip. Shows date + NAV +
// drawdownBps. Recharts passes a payload array per tick; we read
// the first item's `payload` (the row object) to access all fields.
// ---------------------------------------------------------------------------

interface NavChartTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: { snapshotAt: string; nav: number; drawdownBps: number; navRaw: string } }>;
}

function NavChartTooltip({ active, payload }: NavChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const date = new Date(row.snapshotAt);
  return (
    <div className="rounded-md border border-border bg-popover/95 px-3 py-2 backdrop-blur shadow-lg">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {date.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </p>
      <p className="mt-1 font-mono text-sm font-bold text-primary house-num">
        ${formatMoney(row.navRaw)}
      </p>
      <p className="mt-0.5 text-[10px] text-muted-foreground house-num">
        Drawdown {(row.drawdownBps / 100).toFixed(2)}%
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function NavChartSkeleton() {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="flex flex-col gap-4 p-4 sm:p-6" aria-busy="true">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
        <Skeleton className="h-[300px] w-full rounded-md" />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function cnBadge(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
