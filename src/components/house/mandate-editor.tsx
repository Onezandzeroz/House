"use client";

import * as React from "react";
import {
  AlertCircle,
  Info,
  RefreshCw,
  Save,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ScrollArea,
  ScrollBar,
} from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { ONBOARDING_UNIVERSE } from "@/components/onboarding/types";
import type { Mandate, RiskBudget } from "@/server/domain/mandate";
import type {
  EthicsList,
  HardExclude,
  SoftPrefer,
  EthicsToggles,
} from "@/server/domain/ethics";

/**
 * MandateEditor (Task 38) — the third tab on the new 5-tab `/` route.
 *
 * Renders four scrollable sections that let the owner edit the
 * trust's mandate + ethics list, plus an immutable version-history
 * audit trail at the bottom:
 *
 *   A. Risk Budget      — 5 sliders (single-asset weight, stablecoin
 *                         floor, venue concentration, drawdown, leverage
 *                         cap). Persists via PUT /api/trust/mandate.
 *   B. Universe         — checkbox list of ONBOARDING_UNIVERSE; the
 *                         `universe` field is overwritten on save.
 *   C. Ethics Screen    — textareas for hard-exclude lists (sanctioned
 *                         addresses, known mixers, user-blocked assets),
 *                         three soft-preference checkboxes, and three
 *                         toggle checkboxes (privacy / gambling / meme).
 *                         Persists via PUT /api/trust/ethics.
 *   D. Version History  — the immutable MandateVersion audit rows from
 *                         GET /api/trust/mandate `versions` field.
 *
 * Save logic:
 *   - "Save mandate" → PUT /api/trust/mandate with riskBudget (only the
 *     fields the user touched, as partial deep-merge is server-side)
 *     + universe + summary + createdBy.
 *   - "Save ethics"  → PUT /api/trust/ethics with hardExclude arrays +
 *     softPrefer booleans + toggles.
 *
 * Loading: skeleton form while GET /api/trust/mandate resolves.
 * Empty:   a "No mandate yet" panel with a "Create initial mandate"
 *          button that submits the default mandate via PUT.
 *
 * The mandate + ethics payloads are stored server-side as JSON strings
 * in MandateVersion.payload / EthicsListVersion.payload (Prisma TEXT
 * column). The editor parses them on read; the Save buttons send
 * partial UpdateMandateInput / UpdateEthicsInput bodies.
 */

// ---------------------------------------------------------------------------
// MandateVersion / EthicsListVersion shapes — mirror the Prisma models.
// Re-declared here so the client bundle does not pull Prisma's runtime.
// ---------------------------------------------------------------------------

interface MandateVersionRow {
  id: string;
  bookId: string;
  version: number;
  payload: string; // JSON-stringified Mandate
  summary: string;
  createdBy: string;
  createdAt: string;
}

interface EthicsListVersionRow {
  id: string;
  bookId: string;
  version: number;
  payload: string; // JSON-stringified EthicsList
  createdBy: string;
  createdAt: string;
}

interface MandateGetResponse {
  current: MandateVersionRow | null;
  versions: MandateVersionRow[];
}

interface EthicsGetResponse {
  current: EthicsListVersionRow | null;
}

// ---------------------------------------------------------------------------
// Local draft state — what the owner is typing before pressing Save.
// ---------------------------------------------------------------------------

interface RiskBudgetDraft {
  maxSingleAssetWeightBps: number;
  maxStablecoinFloorBps: number;
  maxVenueConcentrationBps: number;
  maxPortfolioDrawdownBps: number;
  leverageCap: number;
}

interface EthicsDraft {
  sanctionedAddresses: string;
  knownMixers: string;
  userBlockedAssets: string;
  preferLiquidity: boolean;
  preferPublishedSupply: boolean;
  preferWithdrawalHistory: boolean;
  privacyCoins: boolean;
  gamblingTokens: boolean;
  memeSleeves: boolean;
}

type MandateState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "ok"; current: MandateVersionRow; versions: MandateVersionRow[] }
  | { kind: "error"; message: string };

type EthicsState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "ok"; current: EthicsListVersionRow }
  | { kind: "error"; message: string };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MandateEditor() {
  const [mandateState, setMandateState] = React.useState<MandateState>({
    kind: "loading",
  });
  const [ethicsState, setEthicsState] = React.useState<EthicsState>({
    kind: "loading",
  });

  const [riskDraft, setRiskDraft] = React.useState<RiskBudgetDraft | null>(
    null,
  );
  const [universeDraft, setUniverseDraft] = React.useState<string[] | null>(
    null,
  );
  const [ethicsDraft, setEthicsDraft] = React.useState<EthicsDraft | null>(
    null,
  );
  const [universeFilter, setUniverseFilter] = React.useState("");

  const [savingMandate, setSavingMandate] = React.useState(false);
  const [savingEthics, setSavingEthics] = React.useState(false);
  const [creatingInitial, setCreatingInitial] = React.useState(false);

  const refetchMandate = React.useCallback(async () => {
    try {
      const res = await fetch("/api/trust/mandate", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; message?: string }
        | MandateGetResponse
        | null;
      if (!res.ok) {
        if (
          data &&
          typeof data === "object" &&
          "error" in data &&
          data.error === "no-trust"
        ) {
          setMandateState({
            kind: "error",
            message: "The trust no longer exists.",
          });
          return;
        }
        const msg =
          data && typeof data === "object" && typeof data.message === "string"
            ? data.message
            : `HTTP ${res.status} ${res.statusText}`;
        setMandateState({ kind: "error", message: msg });
        return;
      }
      if (
        !data ||
        typeof data !== "object" ||
        !("current" in data) ||
        !("versions" in data)
      ) {
        setMandateState({
          kind: "error",
          message: "Malformed mandate response.",
        });
        return;
      }
      const payload = data as MandateGetResponse;
      if (!payload.current) {
        setMandateState({ kind: "empty" });
        return;
      }
      setMandateState({
        kind: "ok",
        current: payload.current,
        versions: payload.versions,
      });
      // Seed the drafts from the latest version's payload.
      const parsed = parseMandate(payload.current.payload);
      if (parsed) {
        setRiskDraft({ ...parsed.riskBudget });
        setUniverseDraft([...parsed.universe]);
      }
    } catch (err) {
      setMandateState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const refetchEthics = React.useCallback(async () => {
    try {
      const res = await fetch("/api/trust/ethics", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; message?: string }
        | EthicsGetResponse
        | null;
      if (!res.ok) {
        if (
          data &&
          typeof data === "object" &&
          "error" in data &&
          data.error === "no-trust"
        ) {
          setEthicsState({
            kind: "error",
            message: "The trust no longer exists.",
          });
          return;
        }
        const msg =
          data && typeof data === "object" && typeof data.message === "string"
            ? data.message
            : `HTTP ${res.status} ${res.statusText}`;
        setEthicsState({ kind: "error", message: msg });
        return;
      }
      if (!data || typeof data !== "object" || !("current" in data)) {
        setEthicsState({ kind: "error", message: "Malformed ethics response." });
        return;
      }
      const payload = data as EthicsGetResponse;
      if (!payload.current) {
        setEthicsState({ kind: "empty" });
        // Seed defaults so the owner can create a v1.
        setEthicsDraft({
          sanctionedAddresses: "",
          knownMixers: "",
          userBlockedAssets: "",
          preferLiquidity: true,
          preferPublishedSupply: true,
          preferWithdrawalHistory: true,
          privacyCoins: false,
          gamblingTokens: false,
          memeSleeves: false,
        });
        return;
      }
      setEthicsState({ kind: "ok", current: payload.current });
      const parsed = parseEthics(payload.current.payload);
      if (parsed) {
        setEthicsDraft({
          sanctionedAddresses: parsed.hardExclude.sanctionedAddresses.join(", "),
          knownMixers: parsed.hardExclude.knownMixers.join(", "),
          userBlockedAssets: parsed.hardExclude.userBlockedAssets.join(", "),
          preferLiquidity: parsed.softPrefer.preferLiquidity,
          preferPublishedSupply: parsed.softPrefer.preferPublishedSupply,
          preferWithdrawalHistory: parsed.softPrefer.preferWithdrawalHistory,
          privacyCoins: parsed.toggles.privacyCoins,
          gamblingTokens: parsed.toggles.gamblingTokens,
          memeSleeves: parsed.toggles.memeSleeves,
        });
      }
    } catch (err) {
      setEthicsState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  React.useEffect(() => {
    void refetchMandate();
    void refetchEthics();
  }, [refetchMandate, refetchEthics]);

  // ---- Save mandate -----------------------------------------------------
  const handleSaveMandate = React.useCallback(async () => {
    if (!riskDraft || !universeDraft) return;
    if (universeDraft.length === 0) {
      toast.error("Universe cannot be empty", {
        description:
          "The mandate must allow at least one asset. Pick at least one below.",
      });
      return;
    }
    setSavingMandate(true);
    try {
      const body: Record<string, unknown> = {
        riskBudget: {
          maxSingleAssetWeightBps: riskDraft.maxSingleAssetWeightBps,
          maxStablecoinFloorBps: riskDraft.maxStablecoinFloorBps,
          maxVenueConcentrationBps: riskDraft.maxVenueConcentrationBps,
          maxPortfolioDrawdownBps: riskDraft.maxPortfolioDrawdownBps,
          leverageCap: riskDraft.leverageCap,
        },
        universe: universeDraft,
        summary: `Risk caps: single ${bpsToPercent(riskDraft.maxSingleAssetWeightBps)}% / venue ${bpsToPercent(riskDraft.maxVenueConcentrationBps)}% / DD ${bpsToPercent(riskDraft.maxPortfolioDrawdownBps)}% / lev ${riskDraft.leverageCap}x. Universe: ${universeDraft.length} assets.`,
      };
      const res = await fetch("/api/trust/mandate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; message?: string; version?: MandateVersionRow }
        | null;
      if (!res.ok) {
        const msg =
          data && typeof data === "object" && typeof data.message === "string"
            ? data.message
            : `HTTP ${res.status} ${res.statusText}`;
        toast.error("Could not save mandate", { description: msg });
        return;
      }
      const newVersion =
        data && typeof data === "object" && "version" in data
          ? data.version
          : undefined;
      toast.success("Mandate updated", {
        description:
          newVersion && typeof newVersion.version === "number"
            ? `Version ${newVersion.version} created — the previous mandate is preserved in the audit trail.`
            : "New version created.",
      });
      await refetchMandate();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Could not save mandate", { description: msg });
    } finally {
      setSavingMandate(false);
    }
  }, [riskDraft, universeDraft, refetchMandate]);

  // ---- Save ethics -----------------------------------------------------
  const handleSaveEthics = React.useCallback(async () => {
    if (!ethicsDraft) return;
    setSavingEthics(true);
    try {
      const body: Record<string, unknown> = {
        hardExclude: {
          sanctionedAddresses: splitList(ethicsDraft.sanctionedAddresses),
          knownMixers: splitList(ethicsDraft.knownMixers),
          userBlockedAssets: splitList(ethicsDraft.userBlockedAssets),
        },
        softPrefer: {
          preferLiquidity: ethicsDraft.preferLiquidity,
          preferPublishedSupply: ethicsDraft.preferPublishedSupply,
          preferWithdrawalHistory: ethicsDraft.preferWithdrawalHistory,
        },
        toggles: {
          privacyCoins: ethicsDraft.privacyCoins,
          gamblingTokens: ethicsDraft.gamblingTokens,
          memeSleeves: ethicsDraft.memeSleeves,
        },
      };
      const res = await fetch("/api/trust/ethics", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; message?: string }
        | null;
      if (!res.ok) {
        const msg =
          data && typeof data === "object" && typeof data.message === "string"
            ? data.message
            : `HTTP ${res.status} ${res.statusText}`;
        toast.error("Could not save ethics list", { description: msg });
        return;
      }
      toast.success("Ethics list updated", {
        description:
          "New version created — the previous ethics list is preserved in the audit trail.",
      });
      await refetchEthics();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Could not save ethics list", { description: msg });
    } finally {
      setSavingEthics(false);
    }
  }, [ethicsDraft, refetchEthics]);

  // ---- Create initial mandate (when empty) -----------------------------
  const handleCreateInitial = React.useCallback(async () => {
    setCreatingInitial(true);
    try {
      // Send empty body — server fills MandateSchema defaults.
      const res = await fetch("/api/trust/mandate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; message?: string }
        | null;
      if (!res.ok) {
        const msg =
          data && typeof data === "object" && typeof data.message === "string"
            ? data.message
            : `HTTP ${res.status} ${res.statusText}`;
        toast.error("Could not create initial mandate", { description: msg });
        return;
      }
      toast.success("Initial mandate created", {
        description: "Version 1 is live. Edit fields below and save to record changes.",
      });
      await refetchMandate();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Could not create initial mandate", { description: msg });
    } finally {
      setCreatingInitial(false);
    }
  }, [refetchMandate]);

  const filteredUniverse = React.useMemo(() => {
    if (!universeFilter.trim()) return ONBOARDING_UNIVERSE;
    const q = universeFilter.trim().toLowerCase();
    return ONBOARDING_UNIVERSE.filter(
      (a) =>
        a.id.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q),
    );
  }, [universeFilter]);

  // ---- Render ----------------------------------------------------------
  if (mandateState.kind === "loading" && ethicsState.kind === "loading") {
    return <MandateEditorSkeleton />;
  }

  if (mandateState.kind === "error") {
    return (
      <Alert variant="destructive">
        <AlertCircle className="size-4" aria-hidden />
        <AlertTitle>Could not load the mandate</AlertTitle>
        <AlertDescription>
          <p>
            The BFF route <code>/api/trust/mandate</code> returned an error.
          </p>
          <p className="mt-1 font-mono text-xs">{mandateState.message}</p>
        </AlertDescription>
      </Alert>
    );
  }

  if (mandateState.kind === "empty") {
    return (
      <Card className="relative overflow-hidden">
        <CardContent className="flex flex-col items-center justify-center gap-5 px-6 py-12 text-center sm:py-16">
          <div
            aria-hidden
            className="size-24 rounded-full"
            style={{
              background:
                "radial-gradient(circle at 50% 50%, rgba(201, 162, 39, 0.22), transparent 70%)",
            }}
          />
          <div className="flex flex-col gap-1">
            <h2 className="font-serif text-2xl font-bold tracking-tight text-primary">
              No mandate yet
            </h2>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Initial mandate version
            </p>
          </div>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            The trust does not have a strategy mandate recorded yet. The
            initial mandate sets sensible defaults — moderate risk caps, a
            30% stablecoin floor, 1.0x leverage, and the full onboarding
            universe. You can edit any field after creating it; every
            change is preserved as a new immutable version.
          </p>
          <Button
            size="lg"
            onClick={() => void handleCreateInitial()}
            disabled={creatingInitial}
          >
            {creatingInitial ? (
              <RefreshCw className="size-4 animate-spin" aria-hidden />
            ) : (
              <ShieldCheck className="size-4" aria-hidden />
            )}
            Create initial mandate
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (mandateState.kind !== "ok" || !riskDraft || !universeDraft) {
    return <MandateEditorSkeleton />;
  }

  const parsedMandate = parseMandate(mandateState.current.payload);
  const versions = mandateState.versions;

  return (
    <div className="flex flex-col gap-6">
      {/* Header — version + summary of the live mandate */}
      <Card className="relative overflow-hidden">
        <CardContent className="flex flex-col gap-2 p-4 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Live mandate
              </span>
              <h2 className="font-serif text-xl font-bold tracking-tight text-primary house-num-accent">
                Version {mandateState.current.version}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void refetchMandate()}
                aria-label="Reload mandate"
              >
                <RefreshCw className="size-4" aria-hidden />
                Reload
              </Button>
              <Button
                size="sm"
                onClick={() => void handleSaveMandate()}
                disabled={savingMandate}
              >
                {savingMandate ? (
                  <RefreshCw className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Save className="size-4" aria-hidden />
                )}
                Save mandate
              </Button>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {mandateState.current.summary}
          </p>
        </CardContent>
      </Card>

      <ScrollArea className="max-h-[80vh]">
        <div className="flex flex-col gap-6 pr-2">
          {/* ---- A. Risk Budget ----------------------------------------- */}
          <Card className="relative overflow-hidden">
            <CardContent className="flex flex-col gap-5 p-4 sm:p-6">
              <div className="flex flex-col gap-1">
                <h3 className="font-serif text-lg font-bold tracking-tight text-foreground">
                  Risk budget
                </h3>
                <p className="text-xs text-muted-foreground">
                  Five caps the policy engine enforces on every intent.
                  Sliders snap to 1%; leverage is 1.0x by default.
                </p>
              </div>
              <Separator className="house-hairline" />
              <RiskSlider
                label="Max single-asset weight"
                help="Cap on one asset's weight in the book. Breach resizes the intent."
                value={riskDraft.maxSingleAssetWeightBps}
                min={0}
                max={10000}
                step={100}
                onChange={(bps) =>
                  setRiskDraft({
                    ...riskDraft,
                    maxSingleAssetWeightBps: bps,
                  })
                }
              />
              <RiskSlider
                label="Stablecoin floor (dry powder)"
                help="Minimum stablecoin weight — the dry-powder cushion the trust must keep."
                value={riskDraft.maxStablecoinFloorBps}
                min={0}
                max={10000}
                step={100}
                onChange={(bps) =>
                  setRiskDraft({
                    ...riskDraft,
                    maxStablecoinFloorBps: bps,
                  })
                }
              />
              <RiskSlider
                label="Max venue concentration"
                help="Cap on a single venue's share. Breach rejects — venue choice is part of the intent."
                value={riskDraft.maxVenueConcentrationBps}
                min={0}
                max={10000}
                step={100}
                onChange={(bps) =>
                  setRiskDraft({
                    ...riskDraft,
                    maxVenueConcentrationBps: bps,
                  })
                }
              />
              <RiskSlider
                label="Max portfolio drawdown"
                help="Drawdown from peak that forces a de-risk to stables."
                value={riskDraft.maxPortfolioDrawdownBps}
                min={0}
                max={5000}
                step={50}
                onChange={(bps) =>
                  setRiskDraft({
                    ...riskDraft,
                    maxPortfolioDrawdownBps: bps,
                  })
                }
              />
              <RiskSlider
                label="Leverage cap"
                help="1.0x = no leverage. Above 1.0x is an explicit opt-in and stays off in v1."
                value={Math.round(riskDraft.leverageCap * 100)}
                min={100}
                max={300}
                step={10}
                display={(v) => `${(v / 100).toFixed(1)}x`}
                onChange={(v) =>
                  setRiskDraft({
                    ...riskDraft,
                    leverageCap: Number((v / 100).toFixed(1)),
                  })
                }
              />
            </CardContent>
          </Card>

          {/* ---- B. Universe -------------------------------------------- */}
          <Card className="relative overflow-hidden">
            <CardContent className="flex flex-col gap-4 p-4 sm:p-6">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <h3 className="font-serif text-lg font-bold tracking-tight text-foreground">
                    Universe
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Allowed asset list. Unchecked = not permitted. The
                    policy engine rejects any intent whose assetId is not
                    in this list.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    value={universeFilter}
                    onChange={(e) => setUniverseFilter(e.target.value)}
                    placeholder="Filter by id / name / sleeve"
                    className="h-9 w-56 max-w-[60vw] font-mono text-xs"
                    aria-label="Filter universe"
                  />
                  <Badge variant="outline" className="house-num">
                    {universeDraft.length} selected
                  </Badge>
                </div>
              </div>
              <Separator className="house-hairline" />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {filteredUniverse.map((asset) => {
                  const checked = universeDraft.includes(asset.id);
                  return (
                    <label
                      key={asset.id}
                      className={cn(
                        "flex items-center gap-3 rounded-md border border-border/40 p-2.5 transition-colors hover:bg-muted/40",
                        checked && "border-allow/40 bg-allow/10",
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          if (v) {
                            setUniverseDraft([...universeDraft, asset.id]);
                          } else {
                            setUniverseDraft(
                              universeDraft.filter((id) => id !== asset.id),
                            );
                          }
                        }}
                        aria-label={`Toggle ${asset.id} in the universe`}
                      />
                      <div className="flex flex-1 flex-col">
                        <span className="font-mono text-sm font-bold text-foreground">
                          {asset.id}
                        </span>
                        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                          {asset.name} · {asset.category}
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* ---- C. Ethics Screen --------------------------------------- */}
          {ethicsState.kind === "error" ? (
            <Alert variant="destructive">
              <AlertCircle className="size-4" aria-hidden />
              <AlertTitle>Could not load the ethics list</AlertTitle>
              <AlertDescription>
                <p className="font-mono text-xs">{ethicsState.message}</p>
              </AlertDescription>
            </Alert>
          ) : ethicsDraft ? (
            <Card className="relative overflow-hidden">
              <CardContent className="flex flex-col gap-5 p-4 sm:p-6">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div className="flex flex-col gap-1">
                    <h3 className="font-serif text-lg font-bold tracking-tight text-foreground">
                      Ethics screen
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Hard excludes are lists, not prompts. The AI may not
                      override a hard exclude.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => void handleSaveEthics()}
                    disabled={savingEthics}
                  >
                    {savingEthics ? (
                      <RefreshCw className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Save className="size-4" aria-hidden />
                    )}
                    Save ethics
                  </Button>
                </div>
                <Separator className="house-hairline" />
                <div className="flex flex-col gap-4">
                  <EthicsTextarea
                    id="sanctioned"
                    label="Sanctioned addresses"
                    help="Comma-separated list of sanctioned-actor addresses."
                    value={ethicsDraft.sanctionedAddresses}
                    onChange={(v) =>
                      setEthicsDraft({ ...ethicsDraft, sanctionedAddresses: v })
                    }
                  />
                  <EthicsTextarea
                    id="mixers"
                    label="Known mixers"
                    help="Comma-separated list of mixers on the execution path."
                    value={ethicsDraft.knownMixers}
                    onChange={(v) =>
                      setEthicsDraft({ ...ethicsDraft, knownMixers: v })
                    }
                  />
                  <EthicsTextarea
                    id="blocked"
                    label="User-blocked assets"
                    help="Comma-separated asset IDs the owner personally blocks (ESG, tax, personal)."
                    value={ethicsDraft.userBlockedAssets}
                    onChange={(v) =>
                      setEthicsDraft({ ...ethicsDraft, userBlockedAssets: v })
                    }
                  />
                </div>
                <Separator className="house-hairline" />
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <Info className="size-3.5 text-muted-foreground" aria-hidden />
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Soft preferences
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <EthicsToggle
                      label="Prefer liquidity"
                      help="Rank venues with deeper top-of-book higher."
                      checked={ethicsDraft.preferLiquidity}
                      onChange={(v) =>
                        setEthicsDraft({ ...ethicsDraft, preferLiquidity: v })
                      }
                    />
                    <EthicsToggle
                      label="Prefer published supply"
                      help="Rank assets with audited supply higher."
                      checked={ethicsDraft.preferPublishedSupply}
                      onChange={(v) =>
                        setEthicsDraft({
                          ...ethicsDraft,
                          preferPublishedSupply: v,
                        })
                      }
                    />
                    <EthicsToggle
                      label="Prefer withdrawal history"
                      help="Rank venues with a clean withdrawal history higher."
                      checked={ethicsDraft.preferWithdrawalHistory}
                      onChange={(v) =>
                        setEthicsDraft({
                          ...ethicsDraft,
                          preferWithdrawalHistory: v,
                        })
                      }
                    />
                  </div>
                </div>
                <Separator className="house-hairline" />
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <Info className="size-3.5 text-muted-foreground" aria-hidden />
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Toggles — recorded mandate changes (default off)
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <EthicsToggle
                      label="Privacy coins"
                      help="Allow assets with shielded-transfer features."
                      checked={ethicsDraft.privacyCoins}
                      onChange={(v) =>
                        setEthicsDraft({ ...ethicsDraft, privacyCoins: v })
                      }
                    />
                    <EthicsToggle
                      label="Gambling tokens"
                      help="Allow prediction-market / betting tokens."
                      checked={ethicsDraft.gamblingTokens}
                      onChange={(v) =>
                        setEthicsDraft({ ...ethicsDraft, gamblingTokens: v })
                      }
                    />
                    <EthicsToggle
                      label="Meme sleeves"
                      help="Allow a small meme-token sleeve inside the universe."
                      checked={ethicsDraft.memeSleeves}
                      onChange={(v) =>
                        setEthicsDraft({ ...ethicsDraft, memeSleeves: v })
                      }
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Skeleton className="h-48 w-full rounded-xl" />
          )}

          {/* ---- D. Version History ------------------------------------- */}
          <Card className="relative overflow-hidden">
            <CardContent className="flex flex-col gap-4 p-4 sm:p-6">
              <div className="flex flex-col gap-1">
                <h3 className="font-serif text-lg font-bold tracking-tight text-foreground">
                  Version history
                </h3>
                <p className="text-xs text-muted-foreground">
                  Immutable audit trail. A change never overwrites history.
                  The latest version is highlighted.
                </p>
              </div>
              <Separator className="house-hairline" />
              {versions.length === 0 ? (
                <p className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-sm text-muted-foreground">
                  No versions yet.
                </p>
              ) : (
                <ScrollArea>
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                          Version
                        </TableHead>
                        <TableHead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                          Summary
                        </TableHead>
                        <TableHead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                          Created
                        </TableHead>
                        <TableHead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                          Created by
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {versions.map((v) => {
                        const isLatest =
                          mandateState.kind === "ok" &&
                          v.version === mandateState.current.version;
                        return (
                          <TableRow
                            key={v.id}
                            className={cn(
                              "border-b border-border/40 last:border-b-0",
                              isLatest && "bg-primary/5",
                            )}
                          >
                            <TableCell className="font-mono text-xs house-num text-foreground">
                              <span className="flex items-center gap-1.5">
                                {isLatest && (
                                  <span
                                    aria-hidden
                                    className="size-1.5 rounded-full bg-primary"
                                  />
                                )}
                                v{v.version}
                              </span>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {v.summary}
                            </TableCell>
                            <TableCell
                              className="font-mono text-[10px] house-num text-muted-foreground"
                              title={v.createdAt}
                            >
                              {formatRelative(v.createdAt)} ago
                            </TableCell>
                            <TableCell className="font-mono text-[10px] text-muted-foreground">
                              {v.createdBy.slice(0, 12)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface RiskSliderProps {
  label: string;
  help: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display?: (v: number) => string;
  onChange: (v: number) => void;
}

/**
 * RiskSlider — a labelled slider for one risk-budget field, with a
 * value Badge on the right and a short help line below. Default
 * display formats bps as a percent with two decimals (e.g. "40.00%");
 * the leverage slider overrides via the `display` prop to show "1.5x".
 */
function RiskSlider({
  label,
  help,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: RiskSliderProps) {
  const displayStr = display
    ? display(value)
    : `${bpsToPercent(value)}%`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label className="text-sm font-medium text-foreground">{label}</Label>
        <Badge
          variant="outline"
          className="bg-primary/10 text-primary border-primary/30 house-num text-xs"
        >
          {displayStr}
        </Badge>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => {
          const next = Array.isArray(v) ? v[0] : v;
          if (typeof next === "number") onChange(next);
        }}
        aria-label={label}
      />
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  );
}

interface EthicsTextareaProps {
  id: string;
  label: string;
  help: string;
  value: string;
  onChange: (v: string) => void;
}

/** EthicsTextarea — a labelled textarea for one hard-exclude list. */
function EthicsTextarea({
  id,
  label,
  help,
  value,
  onChange,
}: EthicsTextareaProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0x…, 0x…"
        className="font-mono text-xs min-h-16"
        spellCheck={false}
      />
      <p className="text-[10px] text-muted-foreground">{help}</p>
    </div>
  );
}

interface EthicsToggleProps {
  label: string;
  help: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

/** EthicsToggle — a labelled checkbox row for one boolean preference. */
function EthicsToggle({
  label,
  help,
  checked,
  onChange,
}: EthicsToggleProps) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border/40 p-2.5 transition-colors hover:bg-muted/40">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(Boolean(v))}
        aria-label={label}
        className="mt-0.5"
      />
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-[10px] leading-snug text-muted-foreground">
          {help}
        </span>
      </div>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a MandateVersion.payload JSON string into a typed Mandate. */
function parseMandate(payload: string): Mandate | null {
  try {
    const raw = JSON.parse(payload) as Partial<Mandate> & {
      riskBudget?: Partial<RiskBudget>;
    };
    if (!raw || typeof raw !== "object") return null;
    if (!raw.riskBudget) return null;
    return raw as Mandate;
  } catch {
    return null;
  }
}

/** Parse an EthicsListVersion.payload JSON string into a typed EthicsList. */
function parseEthics(payload: string): EthicsList | null {
  try {
    const raw = JSON.parse(payload) as Partial<EthicsList> & {
      hardExclude?: Partial<HardExclude>;
      softPrefer?: Partial<SoftPrefer>;
      toggles?: Partial<EthicsToggles>;
    };
    if (!raw || typeof raw !== "object") return null;
    if (!raw.hardExclude) return null;
    return raw as EthicsList;
  } catch {
    return null;
  }
}

/** Split a comma-separated textarea string into a clean string array. */
function splitList(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** bps → "12.34" percent string. */
function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2);
}

/**
 * Format an ISO timestamp as a short relative "2d / 5h / 12m" string.
 * Falls back to a localized date for > 30 days.
 */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diff = Date.now() - then;
  if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1000))}s`;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// MandateEditorSkeleton — matches the editor's section shape so the
// loading-to-loaded transition is not a visual jump.
// ---------------------------------------------------------------------------

function MandateEditorSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-72 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
      <Skeleton className="h-80 w-full rounded-xl" />
      <Skeleton className="h-56 w-full rounded-xl" />
    </div>
  );
}
