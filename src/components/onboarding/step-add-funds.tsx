"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  ONBOARDING_UNIVERSE,
  SLEEVE_META,
  VENUE_KIND_META,
  formatNavShort,
  isPositionComplete,
  previewPortfolio,
  previewSleeveForAsset,
  type VenueKind,
  type WizardPosition,
} from "./types";

/**
 * StepAddFunds — Step 2 of the onboarding wizard.
 *
 * The trustee enters the crypto assets and quantities they already hold.
 * Each row becomes a position in the trust's book. Each row has:
 *
 *   - Asset         : Select dropdown of known universe + "Other…" path
 *                     for custom assets.
 *   - Quantity      : Number input, step="any", placeholder "0.00".
 *   - Venue kind    : Select with the four AccountKind values (cex /
 *                     evm-wallet / solana-wallet / stake-defi). Default cex.
 *   - Venue label   : Free-text input for the venue's name (e.g. "binance",
 *                     "ledger", "phantom"). Required.
 *   - Sleeve preview: A small badge showing the sleeve this asset lands
 *                     in (via `categorizeAsset`). Stable / Conservative /
 *                     Balanced / Aggressive.
 *   - Remove        : A trash button per row.
 *
 * Below the list is an "Add another fund" button (Plus icon).
 *
 * At the top is a live summary: "X funds · estimated NAV ~$Y" — funds
 * counted as valid rows; NAV computed via the same `previewPortfolio`
 * helper Step 3 uses so the numbers match the pie preview exactly.
 *
 * Visual language:
 *   - Each row is a border-bottom-separated line, not a heavy boxed card.
 *     On desktop the inputs sit in one row; on mobile they stack
 *     vertically inside the same border-bottom.
 *   - The sleeve preview badge uses the same palette as the dashboard
 *     (allow / primary / warn / reject) so the trustee sees the same
 *     colour coding they will see in Observe mode.
 *   - The live summary at the top is a single line — "X funds · estimated
 *     NAV ~$Y" — with the NAV in gold (.text-primary .house-num) so it
 *     reads as the headline number.
 *
 * Validation (lifted to the wizard container):
 *   - At least one row (the parent disables Next if positions.length===0).
 *   - Each row must have a chosen asset + quantity > 0 + venue label
 *     before submit. `isPositionComplete` is the helper; the parent
 *     checks it via `OnboardingInputSchema.parse(input)` on submit.
 */
export interface StepAddFundsProps {
  /** The current positions (controlled). */
  positions: WizardPosition[];
  /** Setter called on every position mutation. */
  onPositionsChange: (next: WizardPosition[]) => void;
}

/**
 * Render Step 2 — the multi-asset form. The parent owns the array; this
 * component emits immutable array replacements on every mutation.
 */
export function StepAddFunds({
  positions,
  onPositionsChange,
}: StepAddFundsProps) {
  const preview = React.useMemo(
    () => previewPortfolio(positions),
    [positions],
  );

  // ---- Mutations ---------------------------------------------------------
  const addRow = () => {
    onPositionsChange([
      ...positions,
      {
        id: makeRowId(),
        assetId: "",
        quantity: "",
        venueKind: "cex",
        venue: "",
        isCustomAsset: false,
      },
    ]);
  };

  const removeRow = (id: string) => {
    onPositionsChange(positions.filter((p) => p.id !== id));
  };

  const updateRow = (id: string, patch: Partial<WizardPosition>) => {
    onPositionsChange(
      positions.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  };

  // ---- Render ------------------------------------------------------------
  return (
    <section
      aria-labelledby="step-add-funds-title"
      className="flex flex-col gap-5"
    >
      <header className="flex flex-col gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          Onboarding · step 02
        </span>
        <h2
          id="step-add-funds-title"
          className="font-serif text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
        >
          Add your <span className="text-primary">starting funds</span>
        </h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          Enter the crypto assets and quantities you already hold. Each row
          becomes a position in the trust&apos;s book. You can add or remove
          positions later.
        </p>
      </header>

      {/* Live summary — funds + NAV preview. */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Live summary
          </span>
          <span className="font-serif text-lg font-semibold text-foreground house-num">
            {preview.positionsCount}
          </span>
          <span className="text-sm text-muted-foreground">
            {preview.positionsCount === 1 ? "fund" : "funds"}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            estimated NAV
          </span>
          <span className="font-serif text-2xl font-bold text-primary house-num">
            {formatNavShort(preview.nav)}
          </span>
        </div>
      </div>

      {/* Row list — border-bottom separated lines, not boxed cards. */}
      <div className="flex flex-col">
        {/* Header row — visible on lg+ only. */}
        <div className="hidden grid-cols-[1.4fr_1fr_1fr_1fr_auto] items-center gap-3 border-b border-border/60 px-1 pb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground lg:grid">
          <span>Asset</span>
          <span>Quantity</span>
          <span>Venue kind</span>
          <span>Venue</span>
          <span className="text-right">Sleeve</span>
        </div>

        <ul className="flex flex-col">
          {positions.map((p, idx) => (
            <PositionRow
              key={p.id}
              position={p}
              index={idx}
              onChange={(patch) => updateRow(p.id, patch)}
              onRemove={() => removeRow(p.id)}
              canRemove={positions.length > 1}
            />
          ))}
        </ul>

        {positions.length === 0 && (
          <p className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-sm text-muted-foreground">
            No funds yet — add your first asset below.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          <Plus className="size-4" aria-hidden />
          Add another fund
        </Button>
        <span className="text-xs text-muted-foreground">
          Each row = one position. Required: asset, quantity &gt; 0, venue.
        </span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// PositionRow — one editable row. Border-bottom-separated, stacks on
// mobile, single row on desktop.
// ---------------------------------------------------------------------------

interface PositionRowProps {
  position: WizardPosition;
  index: number;
  onChange: (patch: Partial<WizardPosition>) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function PositionRow({
  position,
  index,
  onChange,
  onRemove,
  canRemove,
}: PositionRowProps) {
  const sleeve = previewSleeveForAsset(position.assetId);
  const sleeveMeta = SLEEVE_META[sleeve];
  const isComplete = isPositionComplete(position);
  const showIncompleteDot = position.assetId !== "" || position.quantity !== "";

  return (
    <li className="border-b border-border/40 px-1 py-3 last:border-b-0">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_1fr_1fr_1fr_auto] lg:items-end">
        {/* Asset select / custom input. */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground lg:hidden">
            Asset
          </span>
          {position.isCustomAsset ? (
            <Input
              type="text"
              value={position.assetId}
              onChange={(e) => onChange({ assetId: e.target.value })}
              placeholder="Custom asset id"
              autoComplete="off"
              spellCheck={false}
              aria-label={`Row ${index + 1} custom asset id`}
            />
          ) : (
            <AssetSelect
              value={position.assetId}
              onChange={(assetId, isCustom) =>
                onChange({
                  assetId: isCustom ? "" : assetId,
                  isCustomAsset: isCustom,
                })
              }
              ariaLabel={`Row ${index + 1} asset`}
            />
          )}
          {position.isCustomAsset && (
            <button
              type="button"
              onClick={() =>
                onChange({ isCustomAsset: false, assetId: "" })
              }
              className="self-start text-[10px] text-muted-foreground underline-offset-2 hover:underline"
            >
              Use known list instead
            </button>
          )}
        </div>

        {/* Quantity. */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground lg:hidden">
            Quantity
          </span>
          <Input
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={position.quantity}
            onChange={(e) => onChange({ quantity: e.target.value })}
            placeholder="0.00"
            aria-label={`Row ${index + 1} quantity`}
            className="house-num"
          />
        </div>

        {/* Venue kind. */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground lg:hidden">
            Venue kind
          </span>
          <VenueKindSelect
            value={position.venueKind}
            onChange={(next) => onChange({ venueKind: next })}
            ariaLabel={`Row ${index + 1} venue kind`}
          />
        </div>

        {/* Venue label. */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground lg:hidden">
            Venue
          </span>
          <Input
            type="text"
            value={position.venue}
            onChange={(e) => onChange({ venue: e.target.value })}
            placeholder={venuePlaceholderFor(position.venueKind)}
            autoComplete="off"
            spellCheck={false}
            aria-label={`Row ${index + 1} venue label`}
          />
        </div>

        {/* Sleeve preview + remove. */}
        <div className="flex items-center justify-between gap-2 lg:justify-end">
          <div className="flex items-center gap-2">
            {showIncompleteDot && !isComplete && (
              <span
                aria-label="Row incomplete"
                className="size-1.5 rounded-full bg-warn-foreground"
              />
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="cursor-default"
                  aria-label={`Sleeve preview: ${sleeveMeta.label}`}
                  tabIndex={-1}
                >
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
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-[14rem]">
                <p className="text-xs leading-relaxed">
                  This asset lands in the {sleeveMeta.label} sleeve. Unknown
                  assets default to Aggressive — opt them down deliberately
                  later via a mandate change.
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemove}
            disabled={!canRemove}
            aria-label={`Remove row ${index + 1}`}
            className="text-muted-foreground hover:text-reject-foreground"
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// AssetSelect — the dropdown of known assets + "Other…" custom path.
// Exported (Task 18) so the manage-positions-panel can reuse the same
// select without duplicating the universe list + custom-asset path.
// ---------------------------------------------------------------------------

export interface AssetSelectProps {
  value: string;
  onChange: (assetId: string, isCustom: boolean) => void;
  ariaLabel?: string;
}

export function AssetSelect({ value, onChange, ariaLabel }: AssetSelectProps) {
  // Group by sleeve so the dropdown reads low-to-high risk.
  const grouped = groupUniverseBySleeve();

  // The "Other…" sentinel value — when selected, the parent swaps the row
  // to the custom-asset text input.
  const OTHER_SENTINEL = "__other__";

  return (
    <Select
      value={value === "" ? undefined : value}
      onValueChange={(next) => {
        if (next === OTHER_SENTINEL) {
          onChange("", true);
        } else {
          onChange(next, false);
        }
      }}
    >
      <SelectTrigger aria-label={ariaLabel} className="w-full">
        <SelectValue placeholder="Pick an asset" />
      </SelectTrigger>
      <SelectContent>
        {grouped.map((group) => (
          <SelectGroup key={group.category}>
            <SelectLabel className="uppercase tracking-widest">
              {SLEEVE_META[group.category].label}
            </SelectLabel>
            {group.assets.map((asset) => (
              <SelectItem key={asset.id} value={asset.id}>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-xs">{asset.id}</span>
                  <span className="text-muted-foreground">{asset.name}</span>
                </span>
              </SelectItem>
            ))}
            <SelectSeparator />
          </SelectGroup>
        ))}
        <SelectItem value={OTHER_SENTINEL}>
          <span className="flex items-center gap-2 italic text-muted-foreground">
            Other… (custom)
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// VenueKindSelect — the four AccountKind values.
// Exported (Task 18) so the manage-positions-panel can reuse the same
// select without duplicating the venue-kind metadata.
// ---------------------------------------------------------------------------

export interface VenueKindSelectProps {
  value: VenueKind;
  onChange: (next: VenueKind) => void;
  ariaLabel?: string;
}

export function VenueKindSelect({ value, onChange, ariaLabel }: VenueKindSelectProps) {
  const options = Object.entries(VENUE_KIND_META) as Array<
    [VenueKind, { label: string; hint: string }]
  >;
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as VenueKind)}
    >
      <SelectTrigger aria-label={ariaLabel} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([kind, meta]) => (
          <SelectItem key={kind} value={kind}>
            <span className="flex flex-col items-start">
              <span>{meta.label}</span>
              <span className="text-[10px] text-muted-foreground">
                {meta.hint}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Group the universe by sleeve so the AssetSelect reads low-to-high risk. */
function groupUniverseBySleeve(): Array<{
  category: (typeof ONBOARDING_UNIVERSE)[number]["category"];
  assets: ReadonlyArray<(typeof ONBOARDING_UNIVERSE)[number]>;
}> {
  const order = ["stable", "conservative", "balanced", "aggressive"] as const;
  return order.map((category) => ({
    category,
    assets: ONBOARDING_UNIVERSE.filter((a) => a.category === category),
  }));
}

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
    case "xrp-wallet":
      return "cold storage";
    case "dex":
      return "xmagnetic.org";
    default:
      return "venue";
  }
}

/** Generate a stable row id. crypto.randomUUID when available; fallback otherwise. */
function makeRowId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
