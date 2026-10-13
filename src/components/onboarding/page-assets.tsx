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
  AssetSelect,
  VenueKindSelect,
} from "./step-add-funds";
import {
  DEFI_POSITION_TYPE_OPTIONS,
  SLEEVE_META,
  formatNavShort,
  isPositionV2Complete,
  makeEmptyPositionV2,
  previewPortfolio,
  previewSleeveForAsset,
  type DeFiPositionType,
  type VenueKind,
  type WizardForm,
  type WizardPositionV2,
} from "./types";
import { categorizeAsset } from "@/server/domain/bankroll";

/**
 * PageAssets — Side 4 of the multi-page onboarding (Task 47-49).
 *
 * The trustee enters the crypto assets and DeFi positions they
 * already hold. Each row becomes a position in the trust's book.
 *
 * Each row has:
 *   - Asset         : Select dropdown of known universe + "Other…"
 *   - Quantity      : Number input
 *   - Entry price   : Number input (only for non-stablecoin assets —
 *                      Task 57 per eier direction; stables are $1.00
 *                      by definition so the field is hidden entirely)
 *   - Venue kind    : Select with the six AccountKind values
 *   - Venue label   : Free-text input
 *   - Sleeve preview: A small badge showing the sleeve this asset
 *                      lands in (via categorizeAsset).
 *   - Remove        : Trash button per row
 *
 * When venueKind === "stake-defi" the row expands to show:
 *   - Protocol        : free-text ("Aave", "Lido", "XMagnetic")
 *   - Position type   : Select (Staking / Lending / LP / Vault)
 *   - APY             : Number input (percent; converted to bps on submit)
 *   - Lock end        : Date input (yyyy-mm-dd)
 *   - Contract address: free-text input (optional)
 *
 * Validation (lifted to the wizard container):
 *   - At least one complete row (asset + quantity > 0 + venue label).
 *   - Empty rows are skipped on submit so the user can leave the last
 *     partial row blank.
 *
 * Visual language:
 *   - Hero heading: "Your starting portfolio".
 *   - Subtitle: "Enter the crypto assets and DeFi positions you
 *      already hold."
 *   - Live summary at the top: "X assets · estimated NAV ~$Y" with NAV
 *     in gold (.text-primary .house-num).
 *   - Each row is a border-bottom-separated line on desktop (single
 *      row, grid layout); stacks on mobile.
 *   - DeFi rows expand vertically when venueKind === "stake-defi" so
 *      the extra fields don't crowd the top row.
 */
export interface PageAssetsProps {
  /** The positions slice of the wizard form. */
  form: Pick<WizardForm, "positions">;
  /** Setter called on every mutation. */
  onFormChange: (
    patch: Partial<Pick<WizardForm, "positions">>,
  ) => void;
}

/**
 * Render Side 4 — the assets & DeFi positions list.
 */
export function PageAssets({ form, onFormChange }: PageAssetsProps) {
  const positions = form.positions;

  // The preview uses the legacy WizardPosition shape — WizardPositionV2
  // extends it, so we can pass the array directly. The DeFi fields are
  // ignored by the preview helpers (they only read assetId + quantity).
  const preview = React.useMemo(
    () => previewPortfolio(positions),
    [positions],
  );

  // ---- Mutations ---------------------------------------------------------
  const addRow = () => {
    onFormChange({ positions: [...positions, makeEmptyPositionV2()] });
  };

  const removeRow = (id: string) => {
    onFormChange({
      positions: positions.filter((p) => p.id !== id),
    });
  };

  const updateRow = (id: string, patch: Partial<WizardPositionV2>) => {
    onFormChange({
      positions: positions.map((p) =>
        p.id === id ? { ...p, ...patch } : p,
      ),
    });
  };

  return (
    <section
      aria-labelledby="page-assets-title"
      className="flex flex-col gap-5"
    >
      <header className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          Onboarding · page 04 of 05
        </span>
        <h2
          id="page-assets-title"
          className="font-serif text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
        >
          Your starting <span className="text-primary">portfolio</span>
        </h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          Enter the crypto assets and DeFi positions you already hold.
          Each row becomes a position in the trust&apos;s book. You can
          add or remove positions later from the Portfolio tab.
        </p>
      </header>

      {/* Live summary — assets + NAV preview. */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Live summary
          </span>
          <span className="font-serif text-lg font-semibold text-foreground house-num">
            {preview.positionsCount}
          </span>
          <span className="text-sm text-muted-foreground">
            {preview.positionsCount === 1 ? "asset" : "assets"}
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

      {/* Row list */}
      <div className="flex flex-col">
        {/* Header row — visible on md+ only. Six columns: Asset + Qty +
            Entry price + Venue kind + Venue + Sleeve/Remove. The Entry
            price column is always rendered in the header (even for
            stable rows) so the column alignment stays stable across
            mixed-asset portfolios. */}
        <div className="hidden grid-cols-[1.3fr_0.9fr_0.9fr_0.9fr_0.9fr_auto] items-center gap-3 border-b border-border/60 px-1 pb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground md:grid">
          <span>Asset</span>
          <span>Quantity</span>
          <span>Entry price</span>
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
            No assets yet — add your first position below.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          <Plus className="size-4" aria-hidden />
          Add another asset
        </Button>
        <span className="text-xs text-muted-foreground">
          Required: asset, quantity &gt; 0, venue.
        </span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// PositionRow — one editable row. Border-bottom-separated, stacks on
// mobile, single row on desktop. Expands to show DeFi metadata fields
// when venueKind === "stake-defi".
// ---------------------------------------------------------------------------

interface PositionRowProps {
  position: WizardPositionV2;
  index: number;
  onChange: (patch: Partial<WizardPositionV2>) => void;
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
  const isComplete = isPositionV2Complete(position);
  const showIncompleteDot =
    position.assetId !== "" || position.quantity !== "";
  const isDefi = position.venueKind === "stake-defi";
  // Entry price is only collected for non-stablecoin assets (per eier
  // direction Task 57 — "I need to know entry prices of the assets (not
  // stable coins)"). Stablecoins are $1.00 by definition; the field is
  // hidden entirely so the trustee never sees a redundant input.
  const isStableAsset =
    position.assetId.trim().length > 0 &&
    categorizeAsset(position.assetId.trim()) === "stable";
  const showEntryPrice = position.assetId.trim().length > 0 && !isStableAsset;

  // Live cost preview: qty × entryPrice (only when both are valid numbers).
  // We don't auto-clear entryPrice when the asset becomes a stable; the
  // submit helper (`positionsV2ToInput`) strips entryPrice for stables
  // anyway, and keeping the value preserves the user's input if they
  // swap back to the original non-stable asset.
  const entryPricePreview = React.useMemo(() => {
    if (!showEntryPrice) return null;
    const qty = Number.parseFloat(position.quantity);
    const px = Number.parseFloat(position.entryPrice);
    if (!Number.isFinite(qty) || qty <= 0) return null;
    if (!Number.isFinite(px) || px <= 0) return null;
    const cost = qty * px;
    if (!Number.isFinite(cost) || cost <= 0) return null;
    return cost;
  }, [showEntryPrice, position.quantity, position.entryPrice]);

  return (
    <li className="border-b border-border/40 px-1 py-3 last:border-b-0">
      {/* Top row — the always-shown fields. Six columns: Asset + Qty +
          Entry price + Venue kind + Venue + Sleeve/Remove. Entry price
          is hidden entirely for stablecoin rows (USDC, USDT, DAI, FRAX,
          RLUSD, stETH, rETH, cbETH — all categorised as "stable"). */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.3fr_0.9fr_0.9fr_0.9fr_0.9fr_auto] md:items-end">
        {/* Asset select / custom input. */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground md:hidden">
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
              onClick={() => onChange({ isCustomAsset: false, assetId: "" })}
              className="self-start text-[10px] text-muted-foreground underline-offset-2 hover:underline"
            >
              Use known list instead
            </button>
          )}
        </div>

        {/* Quantity. */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground md:hidden">
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

        {/* Entry price — only shown for non-stablecoin assets. */}
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={`pos-${position.id}-entryPrice`}
            className="text-[10px] uppercase tracking-widest text-muted-foreground md:hidden"
          >
            Entry price {isStableAsset ? "(n/a for stables)" : "(USDC)"}
          </Label>
          {showEntryPrice ? (
            <>
              <Input
                id={`pos-${position.id}-entryPrice`}
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={position.entryPrice}
                onChange={(e) => onChange({ entryPrice: e.target.value })}
                placeholder="0.00"
                aria-label={`Row ${index + 1} entry price per unit`}
                className="house-num"
              />
              {entryPricePreview !== null ? (
                <span className="text-[10px] text-muted-foreground house-num">
                  Cost: ${formatPreviewCost(entryPricePreview)}
                </span>
              ) : (
                <span className="text-[10px] text-muted-foreground">
                  Per-unit cost · used for P&amp;L
                </span>
              )}
            </>
          ) : (
            <div
              className="flex h-9 items-center rounded-md border border-dashed border-border/40 bg-muted/20 px-3 text-[10px] text-muted-foreground"
              aria-label={`Row ${index + 1} entry price not applicable`}
            >
              {position.assetId.trim() === ""
                ? "Pick an asset first"
                : "Stables are $1.00"}
            </div>
          )}
        </div>

        {/* Venue kind. */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground md:hidden">
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
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground md:hidden">
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
        <div className="flex items-center justify-between gap-2 md:justify-end">
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
                  This asset lands in the {sleeveMeta.label} sleeve.
                  Unknown assets default to Aggressive — opt them down
                  deliberately later via a mandate change.
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
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      {/* DeFi metadata — only shown when venueKind === "stake-defi". */}
      {isDefi && (
        <DeFiMetadataFields
          position={position}
          index={index}
          onChange={onChange}
        />
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// DeFiMetadataFields — protocol, positionType, APY, lockEnd, contractAddress.
// Rendered inline below the top row when venueKind === "stake-defi".
// ---------------------------------------------------------------------------

interface DeFiMetadataFieldsProps {
  position: WizardPositionV2;
  index: number;
  onChange: (patch: Partial<WizardPositionV2>) => void;
}

function DeFiMetadataFields({
  position,
  index,
  onChange,
}: DeFiMetadataFieldsProps) {
  return (
    <div className="mt-4 rounded-lg border border-primary/20 bg-primary/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-primary">
          DeFi position metadata
        </span>
        <span className="text-[10px] text-muted-foreground">
          Optional except where noted — improves the policy engine&apos;s
          accuracy.
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        {/* Protocol */}
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={`pos-${position.id}-protocol`}
            className="text-[10px] uppercase tracking-widest text-muted-foreground"
          >
            Protocol
          </Label>
          <Input
            id={`pos-${position.id}-protocol`}
            type="text"
            value={position.protocol}
            onChange={(e) => onChange({ protocol: e.target.value })}
            placeholder="Aave · Lido · XMagnetic"
            autoComplete="off"
            aria-label={`Row ${index + 1} protocol`}
          />
        </div>

        {/* Position type */}
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={`pos-${position.id}-positionType`}
            className="text-[10px] uppercase tracking-widest text-muted-foreground"
          >
            Position type
          </Label>
          <Select
            value={position.positionType === "" ? undefined : position.positionType}
            onValueChange={(v) =>
              onChange({ positionType: v as DeFiPositionType })
            }
          >
            <SelectTrigger
              id={`pos-${position.id}-positionType`}
              aria-label={`Row ${index + 1} position type`}
              className="w-full"
            >
              <SelectValue placeholder="Pick a type" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel className="uppercase tracking-widest">
                  DeFi position type
                </SelectLabel>
                {DEFI_POSITION_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <span className="flex flex-col items-start">
                      <span>{opt.label}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {opt.hint}
                      </span>
                    </span>
                  </SelectItem>
                ))}
                <SelectSeparator />
                <SelectItem value="__none__">
                  <span className="italic text-muted-foreground">
                    Clear selection
                  </span>
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        {/* APY */}
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={`pos-${position.id}-apy`}
            className="text-[10px] uppercase tracking-widest text-muted-foreground"
          >
            APY (% per year)
          </Label>
          <div className="relative">
            <Input
              id={`pos-${position.id}-apy`}
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={position.apyPercent}
              onChange={(e) => onChange({ apyPercent: e.target.value })}
              placeholder="5.2"
              aria-label={`Row ${index + 1} APY percent`}
              className="house-num pr-8"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground"
            >
              %
            </span>
          </div>
        </div>

        {/* Lock end */}
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={`pos-${position.id}-lockEnd`}
            className="text-[10px] uppercase tracking-widest text-muted-foreground"
          >
            Lock end <span className="text-muted-foreground/60">(optional)</span>
          </Label>
          <Input
            id={`pos-${position.id}-lockEnd`}
            type="date"
            value={position.lockEnd}
            onChange={(e) => onChange({ lockEnd: e.target.value })}
            aria-label={`Row ${index + 1} lock end date`}
            className="house-num"
          />
        </div>

        {/* Contract address */}
        <div className="flex flex-col gap-1.5 sm:col-span-2 md:col-span-2">
          <Label
            htmlFor={`pos-${position.id}-contract`}
            className="text-[10px] uppercase tracking-widest text-muted-foreground"
          >
            Contract address <span className="text-muted-foreground/60">(optional)</span>
          </Label>
          <Input
            id={`pos-${position.id}-contract`}
            type="text"
            value={position.contractAddress}
            onChange={(e) => onChange({ contractAddress: e.target.value })}
            placeholder="0x... · for verification"
            autoComplete="off"
            spellCheck={false}
            aria-label={`Row ${index + 1} contract address`}
            className="font-mono text-xs"
          />
        </div>
      </div>
    </div>
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
    case "xrp-wallet":
      return "cold storage";
    case "dex":
      return "xmagnetic.org";
    default:
      return "venue";
  }
}

/**
 * Format a USDC cost preview as a short, space-thousands string. Two
 * decimals, no leading $ (the caller prefixes it). Mirrors the money
 * formatting used elsewhere so the cost preview reads the same as the
 * dashboard.
 */
function formatPreviewCost(cost: number): string {
  if (!Number.isFinite(cost) || cost <= 0) return "0.00";
  return cost
    .toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    .replace(/,/g, " ");
}
