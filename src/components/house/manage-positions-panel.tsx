"use client";

import * as React from "react";
import { z } from "zod";
import {
  AlertCircle,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ScrollArea,
  ScrollBar,
} from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import {
  AssetSelect,
  VenueKindSelect,
} from "@/components/onboarding/step-add-funds";
import {
  SLEEVE_META,
  previewSleeveForAsset,
  type VenueKind,
} from "@/components/onboarding/types";
import {
  TONE_CHIP_CLASS,
  TRUST_MODE_META,
  type TrustSummary,
} from "./types";

/**
 * ManagePositionsPanel — drawer-panel (shadcn Sheet fra høyre) for å
 * administrere posisjoner på trusten (Task 18).
 *
 * Eierens ord (Task 18):
 *   "assets er 'muck' (mock) og vil kunne legge inn ekte assets og mengder."
 *
 * Panelet lar eieren:
 *   - Se alle posisjoner (assetId, sleeve, mengde, venue, est. verdi).
 *   - Fjerne en posisjon (DELETE /api/trust/positions `{ positionId }`).
 *   - Legge til en ny posisjon (POST /api/trust/positions med assetId /
 *      quantity / venue / venueKind).
 *   - Reset trusten (åpner ResetTrustDialog som sletter alt).
 *
 * Dataflyt:
 *   - På open: fetch GET /api/trust/positions → posisjonsliste.
 *   - På add (POST): bruk response = oppdatert PortfolioSnapshot til å
 *      oppdatere NAV-header; refetch GET /api/trust/positions for å få
 *      posisjonslisten med den nye positionId.
 *   - På remove (DELETE): optimistic update — fjern rad umiddelbart fra
 *      lokal liste; på feil, refetch for å rollbacke.
 *   - Etter hver mutasjon: kaller `onPositionsChanged()`-callback slik at
 *      parent (HouseOverview) kan refreshe pie chart (GET /api/portfolio).
 *
 * Validering: client-side zod (ADD_FORM_SCHEMA) før POST. Serveren validerer
 * også (samma schema i /api/trust/positions).
 *
 * Responsiv: SheetContent er full-width på mobil (sheet.tsx default
 * `w-3/4 sm:max-w-sm`); her overrider vi med `sm:max-w-md` og `w-full sm:w-md`
 * for å gi plass til radene. Header sticky på toppen; body scrollable
 * (`max-h-[60vh] overflow-y-auto`); footer sticky på bunnen.
 *
 * Visuelt: posisjonsrader er border-bottom-separerte (ikke boxed cards);
 * add-position-form er ryddig block-layout (lettere på mobil).
 * Reset-knapp i footer er destruktiv-variant (rose-tintet).
 */
export interface ManagePositionsPanelProps {
  /** Controlled open-state. */
  open: boolean;
  /** Controlled setter. */
  onOpenChange: (open: boolean) => void;
  /** The current trust state — used for subheader + mode chip. */
  trust: TrustSummary;
  /**
   * Åpner bekreftelses-dialogen for "Reset trust". Panelet selv renderer
   * ikke ResetTrustDialog (parent gjør det) slik at samme dialog kan
   * åpnes fra flere steder (panel-footer + house-overview-header).
   */
  onOpenReset: () => void;
  /**
   * Kalles etter hver posisjonsmutasjon (add/remove) slik at parent kan
   * refreshe pie chart via /api/portfolio.
   */
  onPositionsChanged: () => void;
}

/** Client-side validering av add-position-form (Task 18). Speiler server-
 * schemaet i /api/trust/positions, men legger til en > 0-check på quantity. */
const ADD_FORM_SCHEMA = z.object({
  assetId: z.string().min(1, "Pick an asset"),
  quantity: z
    .string()
    .min(1, "Enter a quantity")
    .refine((s) => {
      const n = Number(s);
      return Number.isFinite(n) && n > 0;
    }, "Quantity must be > 0"),
  venue: z.string().min(1, "Enter a venue label"),
  venueKind: z.enum(["cex", "evm-wallet", "solana-wallet", "stake-defi"]),
});

/** En posisjonsrad i panel-listen — speiler PositionRow fra services. */
interface PositionRowClient {
  id: string;
  assetId: string;
  quantity: string;
  venue: string;
  venueKind: VenueKind;
  state: string;
  source: string;
  confidence: string;
  category: "stable" | "conservative" | "balanced" | "aggressive";
  estValue: string;
}

/** PositionsList — speiler service-typen (men deserialisert fra JSON). */
interface PositionsListClient {
  trustId: string;
  trustName: string;
  positions: PositionRowClient[];
  nav: string;
  bookCurrency: string;
  positionsCount: number;
}

/** Fetch state for posisjonslisten. */
type PositionsState =
  | { kind: "loading" }
  | { kind: "ok"; data: PositionsListClient }
  | { kind: "error"; message: string };

/**
 * Render panel. Atomic state holder: posisjonsliste + add-form-state +
 * per-mutation-loading-flagg.
 */
export function ManagePositionsPanel({
  open,
  onOpenChange,
  trust,
  onOpenReset,
  onPositionsChanged,
}: ManagePositionsPanelProps) {
  const [positions, setPositions] = React.useState<PositionsState>({
    kind: "loading",
  });
  // Add-form state.
  const [assetId, setAssetId] = React.useState("");
  const [isCustomAsset, setIsCustomAsset] = React.useState(false);
  const [quantity, setQuantity] = React.useState("");
  const [venue, setVenue] = React.useState("");
  const [venueKind, setVenueKind] = React.useState<VenueKind>("cex");
  const [validationError, setValidationError] = React.useState<string | null>(
    null,
  );
  const [adding, setAdding] = React.useState(false);
  // Track which positionId is currently being removed (for button spinner).
  const [removingId, setRemovingId] = React.useState<string | null>(null);

  // ---- Fetch positions on open + whenever trust.id changes --------------
  const refetchPositions = React.useCallback(async () => {
    let ok = false;
    let payload: PositionsListClient | null = null;
    let message = "";
    try {
      const res = await fetch("/api/trust/positions", { cache: "no-store" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null;
        if (data && typeof data === "object" && data.error === "no-trust") {
          // Trust was reset while panel was open. Close panel + let parent
          // flip state to no-trust (which auto-opens wizard).
          onOpenChange(false);
          return;
        }
        message =
          data && typeof data === "object" && typeof data.message === "string"
            ? data.message
            : `HTTP ${res.status} ${res.statusText}`;
      } else {
        payload = (await res.json()) as PositionsListClient;
        ok = true;
      }
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    if (ok && payload) {
      setPositions({ kind: "ok", data: payload });
    } else {
      setPositions({ kind: "error", message });
    }
  }, [onOpenChange]);

  React.useEffect(() => {
    if (!open) return;
    void refetchPositions();
  }, [open, refetchPositions, trust.id]);

  // ---- Reset add-form when panel closes / trust changes -----------------
  React.useEffect(() => {
    if (!open) {
      setAssetId("");
      setIsCustomAsset(false);
      setQuantity("");
      setVenue("");
      setVenueKind("cex");
      setValidationError(null);
      setAdding(false);
      setRemovingId(null);
    }
  }, [open]);

  // ---- Add position -----------------------------------------------------
  const handleAdd = React.useCallback(async () => {
    setValidationError(null);
    const parsed = ADD_FORM_SCHEMA.safeParse({
      assetId: assetId.trim(),
      quantity: quantity.trim(),
      venue: venue.trim(),
      venueKind,
    });
    if (!parsed.success) {
      setValidationError(
        parsed.error.issues.map((i) => i.message).join("; "),
      );
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/trust/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
        cache: "no-store",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null;
        const msg =
          data && typeof data === "object" && typeof data.message === "string"
            ? data.message
            : `HTTP ${res.status} ${res.statusText}`;
        // duplicate-position er en sannsynlig feil her (Task 18 spek);
        // gi brukeren en forklarings-toast.
        const label =
          data && typeof data === "object" && data.error === "duplicate-position"
            ? "Position already exists"
            : "Could not add position";
        toast.error(label, { description: msg });
        return;
      }
      toast.success("Position added.");
      // Reset the form (keep venueKind for convenience).
      setAssetId("");
      setIsCustomAsset(false);
      setQuantity("");
      setVenue("");
      setValidationError(null);
      // Refetch the list to pick up the new positionId.
      await refetchPositions();
      onPositionsChanged();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Could not add position", { description: msg });
    } finally {
      setAdding(false);
    }
  }, [
    assetId,
    quantity,
    venue,
    venueKind,
    refetchPositions,
    onPositionsChanged,
  ]);

  // ---- Remove position (optimistic) ------------------------------------
  const handleRemove = React.useCallback(
    async (positionId: string) => {
      if (!positions || positions.kind !== "ok") return;
      const snapshot = positions.data;
      const before = snapshot.positions;
      // Optimistic: remove the row from the local list immediately.
      setPositions({
        kind: "ok",
        data: {
          ...snapshot,
          positions: before.filter((p) => p.id !== positionId),
          positionsCount: Math.max(0, snapshot.positionsCount - 1),
        },
      });
      setRemovingId(positionId);
      try {
        const res = await fetch("/api/trust/positions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ positionId }),
          cache: "no-store",
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as
            | { error?: string; message?: string }
            | null;
          const msg =
            data && typeof data === "object" && typeof data.message === "string"
              ? data.message
              : `HTTP ${res.status} ${res.statusText}`;
          toast.error("Could not remove position", { description: msg });
          // Rollback — refetch the full list.
          await refetchPositions();
          return;
        }
        toast.success("Position removed.");
        // Refetch for a clean state (NAV + count are server-derived).
        await refetchPositions();
        onPositionsChanged();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error("Could not remove position", { description: msg });
        await refetchPositions();
      } finally {
        setRemovingId(null);
      }
    },
    [positions, refetchPositions, onPositionsChanged],
  );

  // ---- Sleeve preview badge (live) -------------------------------------
  const sleevePreview =
    assetId.trim() === ""
      ? null
      : previewSleeveForAsset(assetId.trim());
  const sleeveMeta = sleevePreview ? SLEEVE_META[sleevePreview] : null;

  // ---- Add button disabled state ---------------------------------------
  const canAdd =
    !adding &&
    assetId.trim().length >= 1 &&
    quantity.trim().length >= 1 &&
    venue.trim().length >= 1;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        {/* ---- Header -------------------------------------------------- */}
        <SheetHeader className="flex flex-col gap-2 border-b border-border/60 p-4 sm:p-6">
          <SheetTitle className="font-serif text-xl font-bold tracking-tight text-foreground">
            Manage positions
          </SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="font-serif text-base font-semibold text-primary">
                {trust.name}
              </span>
              <Badge
                variant="outline"
                className={`text-[10px] uppercase tracking-widest ${
                  TONE_CHIP_CLASS[TRUST_MODE_META[trust.mode].tone]
                }`}
              >
                {TRUST_MODE_META[trust.mode].label} mode
              </Badge>
              <AiRoleBadge
                aiRole={trust.aiRole}
                killSwitchActive={trust.killSwitchActive}
              />
              <span className="text-muted-foreground">
                Add or remove real holdings.
              </span>
            </div>
          </SheetDescription>
        </SheetHeader>

        {/* ---- Body (positions list + add form) ----------------------- */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-6 p-4 sm:p-6">
              {/* Positions list */}
              <section
                aria-labelledby="positions-list-title"
                className="flex flex-col gap-2"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3
                    id="positions-list-title"
                    className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                  >
                    Positions
                  </h3>
                  <PositionsCount state={positions} />
                </div>

                {positions.kind === "loading" && <PositionsListSkeleton />}

                {positions.kind === "error" && (
                  <Alert variant="destructive">
                    <AlertCircle className="size-4" aria-hidden />
                    <AlertTitle>Could not load positions</AlertTitle>
                    <AlertDescription>
                      <p className="font-mono text-xs">{positions.message}</p>
                    </AlertDescription>
                  </Alert>
                )}

                {positions.kind === "ok" &&
                  positions.data.positions.length === 0 && (
                    <p className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-sm text-muted-foreground">
                      No positions yet. Add your first holding below.
                    </p>
                  )}

                {positions.kind === "ok" &&
                  positions.data.positions.length > 0 && (
                    <ul className="flex flex-col">
                      {positions.data.positions.map((p) => (
                        <PositionRow
                          key={p.id}
                          position={p}
                          onRemove={() => handleRemove(p.id)}
                          isRemoving={removingId === p.id}
                        />
                      ))}
                    </ul>
                  )}
              </section>

              <Separator className="house-hairline" />

              {/* Add-position form */}
              <section
                aria-labelledby="add-position-title"
                className="flex flex-col gap-3"
              >
                <h3
                  id="add-position-title"
                  className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                >
                  Add position
                </h3>

                <div className="flex flex-col gap-2">
                  <Label
                    htmlFor="manage-asset"
                    className="text-xs text-muted-foreground"
                  >
                    Asset
                  </Label>
                  {isCustomAsset ? (
                    <div className="flex flex-col gap-1.5">
                      <Input
                        id="manage-asset"
                        type="text"
                        value={assetId}
                        onChange={(e) => setAssetId(e.target.value)}
                        placeholder="Custom asset id"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setIsCustomAsset(false);
                          setAssetId("");
                        }}
                        className="self-start text-[10px] text-muted-foreground underline-offset-2 hover:underline"
                      >
                        Use known list instead
                      </button>
                    </div>
                  ) : (
                    <AssetSelect
                      value={assetId}
                      onChange={(id, isCustom) => {
                        setAssetId(isCustom ? "" : id);
                        setIsCustomAsset(isCustom);
                      }}
                      ariaLabel="Manage positions — pick an asset"
                    />
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <Label
                    htmlFor="manage-quantity"
                    className="text-xs text-muted-foreground"
                  >
                    Quantity
                  </Label>
                  <Input
                    id="manage-quantity"
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder="0.00"
                    className="house-num"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label
                    htmlFor="manage-venue-kind"
                    className="text-xs text-muted-foreground"
                  >
                    Venue kind
                  </Label>
                  <VenueKindSelect
                    value={venueKind}
                    onChange={(next) => setVenueKind(next)}
                    ariaLabel="Manage positions — venue kind"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label
                    htmlFor="manage-venue"
                    className="text-xs text-muted-foreground"
                  >
                    Venue label
                  </Label>
                  <Input
                    id="manage-venue"
                    type="text"
                    value={venue}
                    onChange={(e) => setVenue(e.target.value)}
                    placeholder={venuePlaceholderFor(venueKind)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>

                {/* Sleeve preview + add button */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Sleeve
                    </span>
                    {sleeveMeta ? (
                      <Badge
                        variant="outline"
                        className={`gap-1 ${sleeveMeta.chip}`}
                      >
                        <span
                          aria-hidden
                          className={`size-1.5 rounded-full ${sleeveMeta.dot}`}
                        />
                        {sleeveMeta.label}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Pick an asset to preview
                      </span>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleAdd()}
                    disabled={!canAdd}
                  >
                    {adding ? (
                      <RefreshCw className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Plus className="size-4" aria-hidden />
                    )}
                    Add position
                  </Button>
                </div>

                {validationError && (
                  <p className="text-xs text-reject-foreground" role="alert">
                    {validationError}
                  </p>
                )}
              </section>
            </div>
            <ScrollBar />
          </ScrollArea>
        </div>

        {/* ---- Footer (Done + Reset) ---------------------------------- */}
        <SheetFooter className="flex-row flex-wrap items-center justify-between gap-2 border-t border-border/60 p-4 sm:p-6">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-muted-foreground hover:text-reject-foreground"
          >
            <ShieldAlert className="size-4" aria-hidden />
            Reset trust
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Done
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// PositionRow — one row in the panel list. Border-bottom-separated, stacks
// gracefully on narrow widths inside the panel (sm:max-w-md).
// ---------------------------------------------------------------------------

interface PositionRowProps {
  position: PositionRowClient;
  onRemove: () => void;
  isRemoving: boolean;
}

function PositionRow({ position, onRemove, isRemoving }: PositionRowProps) {
  const sleeveMeta = SLEEVE_META[position.category];
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border/40 px-1 py-3 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-mono text-sm font-bold text-foreground">
          {position.assetId}
        </span>
        <Badge
          variant="outline"
          className={`text-[10px] uppercase tracking-widest ${sleeveMeta.chip}`}
        >
          <span
            aria-hidden
            className={`size-1.5 rounded-full ${sleeveMeta.dot}`}
          />
          {sleeveMeta.label}
        </Badge>
        <span className="font-mono text-xs text-muted-foreground house-num">
          {trimNumber(position.quantity)}
        </span>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          on
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {position.venue}
        </span>
        <span className="text-[10px] text-muted-foreground">·</span>
        <span className="font-mono text-xs text-foreground house-num">
          ${trimMoney(position.estValue)}
        </span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRemove}
        disabled={isRemoving}
        aria-label={`Remove ${position.assetId} on ${position.venue}`}
        className="text-muted-foreground hover:text-reject-foreground"
      >
        {isRemoving ? (
          <RefreshCw className="size-4 animate-spin" aria-hidden />
        ) : (
          <Trash2 className="size-4" aria-hidden />
        )}
      </Button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// PositionsListSkeleton — three Skeleton rows while the list is loading.
// ---------------------------------------------------------------------------

function PositionsListSkeleton() {
  return (
    <ul className="flex flex-col" aria-busy="true">
      {Array.from({ length: 3 }).map((_, i) => (
        <li
          key={i}
          className="flex items-center gap-2 border-b border-border/40 px-1 py-3 last:border-b-0"
        >
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="size-8 rounded-md" />
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// PositionsCount — small stat showing total positions + NAV.
// ---------------------------------------------------------------------------

function PositionsCount({ state }: { state: PositionsState }) {
  if (state.kind === "loading") {
    return <Skeleton className="h-4 w-24" />;
  }
  if (state.kind === "error") {
    return null;
  }
  return (
    <span className="text-xs text-muted-foreground">
      <span className="font-mono text-foreground house-num">
        {state.data.positionsCount}
      </span>{" "}
      positions · NAV{" "}
      <span className="font-mono text-foreground house-num">
        ${trimMoney(state.data.nav)}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// AiRoleBadge — a compact chip for AI role (mirrors TrustHeaderStrip).
// ---------------------------------------------------------------------------

function AiRoleBadge({
  aiRole,
  killSwitchActive,
}: {
  aiRole: TrustSummary["aiRole"];
  killSwitchActive: boolean;
}) {
  if (killSwitchActive) {
    return (
      <Badge
        variant="outline"
        className="bg-reject/15 text-reject-foreground border-reject/40 text-[10px] uppercase tracking-widest"
      >
        <ShieldAlert className="size-3" aria-hidden />
        Halted
      </Badge>
    );
  }
  if (aiRole === "operator") {
    return (
      <Badge
        variant="outline"
        className="bg-primary/15 text-primary border-primary/40 text-[10px] uppercase tracking-widest"
      >
        Operator
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="bg-allow/15 text-allow-foreground border-allow/40 text-[10px] uppercase tracking-widest"
    >
      Advisor
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pick a sensible placeholder for the venue label input. */
function venuePlaceholderFor(kind: VenueKind): string {
  switch (kind) {
    case "cex":
      return "binance";
    case "evm-wallet":
      return "ledger";
    case "solana-wallet":
      return "phantom";
    case "stake-defi":
      return "lido";
    default:
      return "venue";
  }
}

/** Trim a money string to a short display form. Strips the leading "$" the
 * server adds (we add our own) so the markup stays semantic. */
function trimMoney(s: string): string {
  if (typeof s !== "string") return "0.00";
  const trimmed = s.trim();
  if (trimmed.startsWith("$")) return trimmed.slice(1);
  return trimmed;
}

/** Trim a numeric string: drop trailing zeros after the decimal but keep
 * at least 2 decimals. Mirrors the server's formatNumber for display. */
function trimNumber(s: string): string {
  if (typeof s !== "string") return "0";
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return Number(n.toFixed(6)).toString();
}
