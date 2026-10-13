"use client";

import * as React from "react";
import { Bot, ShieldAlert, ShieldCheck, Power, Clock } from "lucide-react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { DEFAULT_HOUSE_DAYS, type TrustSummary } from "./types";

/**
 * AiOperatorPanel — the switch the trustee uses to "call upon the AI to
 * operate" (Task 11 / 15 owner direction).
 *
 * Owner direction (Task 11):
 *   "the AI inside the trust will have the role as advisor but also
 *    able to operate if called upon to do so."
 *
 * Concrete mechanics (plan §2 + §3):
 *   - Switch ON  → POST /api/trust/mode with `{ mode: "house" }`. The
 *                  server defaults the House mandate expiry to
 *                  `now + 7 days`. The AI becomes an operator; the
 *                  policy engine still gates every intent.
 *   - Switch OFF → POST /api/trust/mode with `{ mode: "observe" }`.
 *                  Revokes the operator mandate immediately (moving DOWN
 *                  the ladder is always immediate per plan §2). The AI
 *                  returns to its advisor-in-hovedsak role.
 *   - Kill switch overrides both — when `killSwitchActive`, the switch
 *                  is disabled and the panel shows "Kill switch active".
 *                  The kill switch blocks ALL trade paths regardless of
 *                  mode (plan §3).
 *
 * Confirmation (plan §2: "Moving up a mode requires a fresh
 * confirmation"):
 *   - Activating House mode is an UP-move (House is the top of the
 *     ladder). A confirmation dialog renders the time-boxed mandate
 *     terms before the API call. The dialog is the "fresh
 *     confirmation" surface; the route itself trusts the caller.
 *   - Revoking is a DOWN-move (Observe is the bottom rung). Always
 *     immediate; no confirmation. (Per plan §2: "Moving down is always
 *     immediate.")
 *
 * Time-boxed mandate countdown:
 *   - When House mode is active, the panel shows a live countdown to
 *     `houseExpiry` (days / hours / minutes / seconds). The countdown
 *     ticks every second via `setInterval`; the parent re-renders the
 *     panel only when the trust's `mode` or `houseExpiry` change.
 *   - When the countdown hits zero, the panel shows "Mandate expired"
 *     (the visual signal that the trust has lapsed back to advisor; v1
 *     does not auto-trigger a server-side down-shift, but the operator
 *     panel surfaces the elapse so the trustee sees it without polling).
 *
 * Visual language:
 *   - Role label: large serif gold "Advisor" in advisor mode; large
 *     serif gold "Operator" with a subtle rose-tint border in House
 *     mode (rose signals "AI is operating — policy still gates" —
 *     carries a hint of risk without veering into reject territory).
 *   - Switch: shadcn `Switch`, gold when ON (matches the gold accent
 *     system).
 *   - Tone of the card border-left flips from `border-l-allow/60`
 *     (advisor) to `border-l-primary/80` (operator) so the panel
 *     itself reads as a status signal.
 *
 * The panel is fully controlled — it has no internal state beyond the
 * pending + error states of the API call. The parent owns the
 * `TrustSummary` and updates it via `onTrustUpdate` after a successful
 * API call.
 */
export interface AiOperatorPanelProps {
  /** The current trust state. Read by the panel; never mutated directly. */
  trust: TrustSummary;
  /**
   * Called after a successful mode switch. The page replaces its trust
   * state with `next`, which re-renders the pie chart, header strip,
   * and this panel.
   */
  onTrustUpdate: (next: TrustSummary) => void;
}

/**
 * Pending state for the in-flight API call. Tracks whether we're
 * activating (up-move) or revoking (down-move) so the button label +
 * spinner can react.
 */
type PendingKind = "activate" | "revoke" | null;

/**
 * Render the AI operator panel. Mounts a confirmation dialog for the
 * up-move; revokes immediately on the down-move.
 */
export function AiOperatorPanel({
  trust,
  onTrustUpdate,
}: AiOperatorPanelProps) {
  const [pending, setPending] = React.useState<PendingKind>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const isOperating = trust.mode === "house";
  const isHalted = trust.killSwitchActive;
  const switchDisabled = isHalted || pending !== null;

  // ---- API calls --------------------------------------------------------

  /**
   * Switch to House mode (the UP-move). Called from the confirmation
   * dialog's "Activate" button. The dialog is the "fresh confirmation"
   * surface per plan §2.
   */
  const activate = React.useCallback(async () => {
    setConfirmOpen(false);
    setPending("activate");
    setError(null);
    try {
      const res = await fetch("/api/trust/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "house" }),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as
        | { trust?: TrustSummary; message?: string }
        | null;
      if (!res.ok || !data || !data.trust) {
        const message =
          data?.message ?? `HTTP ${res.status} ${res.statusText}`;
        setError(message);
        toast.error("Could not activate operator mode", {
          description: message,
        });
        return;
      }
      onTrustUpdate(data.trust);
      toast.success("AI promoted to operator", {
        description: `Time-boxed to ${DEFAULT_HOUSE_DAYS} days. Policy still gates.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error";
      setError(message);
      toast.error("Could not activate operator mode", { description: message });
    } finally {
      setPending(null);
    }
  }, [onTrustUpdate]);

  /**
   * Revoke — switch back to Observe (the DOWN-move). Always immediate
   * per plan §2; no confirmation. The trust returns to its safest
   * posture and the AI reverts to advisor role.
   */
  const revoke = React.useCallback(async () => {
    setPending("revoke");
    setError(null);
    try {
      const res = await fetch("/api/trust/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "observe" }),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as
        | { trust?: TrustSummary; message?: string }
        | null;
      if (!res.ok || !data || !data.trust) {
        const message =
          data?.message ?? `HTTP ${res.status} ${res.statusText}`;
        setError(message);
        toast.error("Could not revoke operator mode", { description: message });
        return;
      }
      onTrustUpdate(data.trust);
      toast.success("AI reverted to advisor", {
        description: "Trust back to Observe mode. Read-only.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error";
      setError(message);
      toast.error("Could not revoke operator mode", { description: message });
    } finally {
      setPending(null);
    }
  }, [onTrustUpdate]);

  // ---- Render state -----------------------------------------------------

  // Kill switch overrides everything — the panel is locked.
  if (isHalted) {
    return <HaltedStateCard pending={pending} />;
  }

  // House mode active — show the operator state + countdown + revoke.
  if (isOperating && trust.houseExpiry) {
    return (
      <OperatorActiveCard
        trust={trust}
        onRevoke={revoke}
        pending={pending}
        error={error}
      />
    );
  }

  // Default — advisor state with the activation switch + confirm dialog.
  return (
    <Card
      aria-labelledby="ai-operator-title"
      className="relative overflow-hidden border-l-2 border-l-allow/60"
    >
      <CardHeader className="gap-2 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle
            id="ai-operator-title"
            className="font-serif text-2xl font-bold tracking-tight"
          >
            AI inside the trust
          </CardTitle>
          <RoleLabel
            role={trust.aiRole}
            killSwitchActive={trust.killSwitchActive}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          The AI is in advisor role — it proposes, the owner / policy gate
          decides. Call upon it to operate when you want it to emit intents
          subject to the policy gate.
        </p>
        <Separator className="house-hairline" />
      </CardHeader>

      <CardContent className="flex flex-col gap-4 p-6 pt-0">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Switch
              aria-label="Call upon the AI to operate"
              role="switch"
              checked={false}
              disabled={switchDisabled}
              onCheckedChange={(checked) => {
                if (checked) setConfirmOpen(true);
              }}
            />
            <div className="flex flex-col gap-1">
              <span className="font-mono text-xs uppercase tracking-widest text-foreground">
                Call upon AI to operate
              </span>
              <span className="text-[11px] text-muted-foreground">
                OFF — advisor only.
              </span>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setConfirmOpen(true)}
            disabled={switchDisabled}
          >
            <Bot className="size-4" aria-hidden />
            Activate operator mode
          </Button>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          When ON, the AI inside this trust may propose intents. The policy
          engine still gates. Time-boxed to {DEFAULT_HOUSE_DAYS} days. Reversible
          any time — moving back to Observe is always immediate.
        </p>
        {error && (
          <p
            role="alert"
            className="font-mono text-xs text-reject-foreground"
          >
            {error}
          </p>
        )}
        {pending === "activate" && (
          <p className="text-[11px] text-muted-foreground" aria-live="polite">
            Activating operator mode…
          </p>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif">
              Call upon the AI to operate?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed">
              Activating operator mode lets the AI propose intents. The
              policy engine still gates everything — the AI never sits on
              the keys. The mandate is time-boxed to {DEFAULT_HOUSE_DAYS}{" "}
              days and reversible any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Prevent Radix's auto-close so activate() can flush the
                // pending spinner before the dialog snaps shut. activate()
                // itself closes the dialog via setConfirmOpen(false).
                e.preventDefault();
                void activate();
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Activate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// RoleLabel — the large serif gold "Advisor" / "Operator" label. The
// operator variant uses a subtle rose-tint so the panel reads as "AI is
// operating — policy still gates" without veering into reject territory.
// ---------------------------------------------------------------------------

function RoleLabel({
  role,
  killSwitchActive,
}: {
  role: TrustSummary["aiRole"];
  killSwitchActive: boolean;
}) {
  if (killSwitchActive) {
    return (
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-5 text-reject-foreground" aria-hidden />
        <span className="font-serif text-2xl font-bold tracking-tight text-reject-foreground">
          Halted
        </span>
      </div>
    );
  }
  if (role === "operator") {
    return (
      <div className="flex items-center gap-2">
        <Bot className="size-5 text-operator" aria-hidden />
        <span className="font-serif text-2xl font-bold tracking-tight text-operator house-pulse-operator rounded px-1">
          Operator
        </span>
        <Badge
          variant="outline"
          className="bg-reject/10 text-reject-foreground/80 border-reject/30 text-[10px] uppercase tracking-widest"
        >
          active
        </Badge>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <ShieldCheck className="size-5 text-allow-foreground" aria-hidden />
      <span className="font-serif text-2xl font-bold tracking-tight text-foreground">
        Advisor
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OperatorActiveCard — House mode is ON. Renders the live countdown to
// houseExpiry and a "Revoke now" button. The parent's trust update
// (after revoke) re-mounts this component as the advisor state.
// ---------------------------------------------------------------------------

function OperatorActiveCard({
  trust,
  onRevoke,
  pending,
  error,
}: {
  trust: TrustSummary;
  onRevoke: () => void;
  pending: PendingKind;
  error: string | null;
}) {
  return (
    <Card
      aria-labelledby="ai-operator-title"
      className="relative overflow-hidden border-l-2 border-l-primary/80"
    >
      <CardHeader className="gap-2 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle
            id="ai-operator-title"
            className="font-serif text-2xl font-bold tracking-tight"
          >
            AI inside the trust
          </CardTitle>
          <RoleLabel
            role={trust.aiRole}
            killSwitchActive={trust.killSwitchActive}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          The AI is operating. It may propose intents — the policy engine
          still gates. Revoke any time; moving back is always immediate.
        </p>
        <Separator className="house-hairline" />
      </CardHeader>

      <CardContent className="flex flex-col gap-4 p-6 pt-0">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <CountdownCell houseExpiry={trust.houseExpiry ?? ""} />
          <ExpiryCell houseExpiry={trust.houseExpiry ?? ""} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onRevoke}
            disabled={pending !== null}
            className="border-reject/40 text-reject-foreground hover:bg-reject/10"
          >
            <Power className="size-4" aria-hidden />
            Revoke now
          </Button>
          {pending === "revoke" && (
            <span
              className="text-[11px] text-muted-foreground"
              aria-live="polite"
            >
              Revoking…
            </span>
          )}
        </div>
        {error && (
          <p
            role="alert"
            className="font-mono text-xs text-reject-foreground"
          >
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// HaltedStateCard — kill switch is active. The panel is locked; the
// only action surfaced is a (placeholder) "kill switch active" message.
// v1 has no kill-switch-untrigger UI here; the kill switch is read-only
// at the page level (Task 15).
// ---------------------------------------------------------------------------

function HaltedStateCard({ pending }: { pending: PendingKind }) {
  return (
    <Card
      aria-labelledby="ai-operator-title"
      className="relative overflow-hidden border-l-2 border-l-reject/80 bg-reject/5"
    >
      <CardHeader className="gap-2 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle
            id="ai-operator-title"
            className="font-serif text-2xl font-bold tracking-tight"
          >
            AI inside the trust
          </CardTitle>
          <RoleLabel role="operator" killSwitchActive />
        </div>
        <p className="text-sm text-muted-foreground">
          The kill switch is active. Trade permission is revoked — no
          intent executes. Switching modes is disabled until the kill
          switch is lifted.
        </p>
        <Separator className="house-hairline" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-6 pt-0">
        <div className="flex items-center gap-3">
          <Switch
            aria-label="Call upon the AI to operate"
            role="switch"
            checked={false}
            disabled
          />
          <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Kill switch active
          </span>
        </div>
        {pending && (
          <p className="text-[11px] text-muted-foreground" aria-live="polite">
            A change is in flight…
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// CountdownCell — live countdown to houseExpiry. Ticks every second.
// Isolated so the parent (and the rest of the panel) doesn't re-render
// every tick.
// ---------------------------------------------------------------------------

/**
 * Compute the remaining seconds to the target ISO datetime. Returns 0
 * when the target has passed.
 */
function computeRemainingSeconds(iso: string): number {
  if (!iso) return 0;
  const target = new Date(iso).getTime();
  if (!Number.isFinite(target)) return 0;
  const diff = target - Date.now();
  return Math.max(0, Math.floor(diff / 1000));
}

/**
 * Format a remaining-seconds count as "2d 03h 14m 22s" (days only when
 * non-zero). The format is monotonic so the width is stable across
 * ticks (avoiding layout-shift on every render).
 */
function formatRemaining(totalSeconds: number): string {
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return d > 0 ? `${d}d ${hh}h ${mm}m ${ss}s` : `${hh}h ${mm}m ${ss}s`;
}

function CountdownCell({ houseExpiry }: { houseExpiry: string }) {
  const [remaining, setRemaining] = React.useState(() =>
    computeRemainingSeconds(houseExpiry),
  );

  React.useEffect(() => {
    setRemaining(computeRemainingSeconds(houseExpiry));
    const interval = setInterval(() => {
      setRemaining(computeRemainingSeconds(houseExpiry));
    }, 1000);
    return () => clearInterval(interval);
  }, [houseExpiry]);

  const expired = remaining === 0;

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border/40 bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Mandate remaining
        </span>
        <Clock className="size-3.5 text-muted-foreground" aria-hidden />
      </div>
      {expired ? (
        <p className="font-serif text-2xl font-bold tracking-tight text-warn-foreground">
          Expired
        </p>
      ) : (
        <p className="font-serif text-2xl font-bold tracking-tight house-num text-operator">
          {formatRemaining(remaining)}
        </p>
      )}
      <p className="text-[10px] text-muted-foreground">
        {expired
          ? "The mandate has elapsed; the trust has reverted to advisor."
          : "Time-boxed operator mandate. Reversible any time."}
      </p>
    </div>
  );
}

/**
 * ExpiryCell — the absolute timestamp the mandate elapses. Pinned next
 * to the countdown so the trustee can read both "how long" and
 * "exactly when".
 */
function ExpiryCell({ houseExpiry }: { houseExpiry: string }) {
  if (!houseExpiry) return null;
  const d = new Date(houseExpiry);
  const label = Number.isFinite(d.getTime())
    ? d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
        timeZoneName: "short",
      })
    : "—";
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border/40 bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Mandate expires
        </span>
        <Clock className="size-3.5 text-muted-foreground" aria-hidden />
      </div>
      <p className="font-serif text-lg font-semibold tracking-tight house-num text-foreground">
        {label}
      </p>
      <p className="text-[10px] text-muted-foreground">
        Time displayed in your local timezone.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton — used by the page when the trust is still loading. The
// skeleton's shape matches the operator panel's advisor state so the
// visual transition is minimal.
// ---------------------------------------------------------------------------

/**
 * AiOperatorPanelSkeleton — a static placeholder shown while the trust
 * is loading. Mirrors the advisor-state panel shape.
 */
export function AiOperatorPanelSkeleton() {
  return (
    <Card className="relative overflow-hidden border-l-2 border-l-allow/60">
      <CardHeader className="gap-2 p-6">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-3/4" />
        <Separator className="house-hairline" />
      </CardHeader>
      <CardContent className="flex flex-col gap-4 p-6 pt-0">
        <div className="flex items-center gap-3">
          <Skeleton className="h-5 w-9 rounded-full" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-3 w-3/4" />
      </CardContent>
    </Card>
  );
}
