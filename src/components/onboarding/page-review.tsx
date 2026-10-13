"use client";

import * as React from "react";
import { AlertCircle, Snowflake } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

import { PortfolioPieChart } from "@/components/portfolio/portfolio-pie-chart";

import {
  SLEEVE_META,
  buildPreviewOpinion,
  filterCompleteBeneficiaries,
  filterCompletePositionsV2,
  formatNavShort,
  previewPortfolio,
  TRUST_TYPE_OPTIONS,
  type WizardForm,
} from "./types";

/** The dry-powder floor (30%) — from BankrollPrinciplesSchema defaults. */
const DRY_POWDER_FLOOR_BPS = 3000;

/**
 * PageReview — Side 5 of the multi-page onboarding (Task 47-49).
 *
 * The trustee reviews the full collected configuration before the
 * trust is created. The page shows four summary sections + a pie-chart
 * preview + a confirmation checkbox.
 *
 * Sections:
 *   1. Trust    — name, type, currency, description.
 *   2. Trustee  — name, email, phone, address.
 *   3. Beneficiaries — list with name + email + relationship + reporting.
 *   4. Portfolio — mini pie-chart preview + table with assets + venue + est. value.
 *
 * Below the sections:
 *   - Warning if dry powder < 30% → "Dry powder below 30% floor —
 *      consider adding more stablecoins."
 *   - Confirmation checkbox: "I confirm these are my holdings. The
 *      trust will start in Observe mode."
 *
 * Validation: the confirmation checkbox gates the "Create trust"
 * button. The wizard gates Next on `form.confirmed === true`.
 *
 * Visual language:
 *   - Hero heading: "Review your trust".
 *   - Subtitle: "This is your starting configuration. You can change
 *      everything later."
 *   - Each summary section is a card with a header row (label + value
 *      count) + the data rows.
 *   - The pie-chart preview uses the same PortfolioPieChart the live
 *      dashboard uses, fed an AdvisoryOpinion-shaped scaffold via
 *      buildPreviewOpinion.
 */
export interface PageReviewProps {
  /** The full wizard form (we read every page's slice). */
  form: WizardForm;
  /** The trustee email (read-only from session; shown in the Trustee section). */
  email: string;
  /** Setter for the confirmation checkbox. */
  onConfirmedChange: (next: boolean) => void;
  /** Called when the user clicks "Back to assets" on the dry-powder warning. */
  onBackToAssets: () => void;
}

/**
 * Render Side 5 — the review + confirmation page.
 */
export function PageReview({
  form,
  email,
  onConfirmedChange,
  onBackToAssets,
}: PageReviewProps) {
  // Use only complete rows for the preview so the pie doesn't render
  // with partial positions skewing the NAV.
  const completePositions = React.useMemo(
    () => filterCompletePositionsV2(form.positions),
    [form.positions],
  );
  const completeBeneficiaries = React.useMemo(
    () => filterCompleteBeneficiaries(form.beneficiaries),
    [form.beneficiaries],
  );

  const opinion = React.useMemo(
    () => buildPreviewOpinion(completePositions),
    [completePositions],
  );
  const preview = React.useMemo(
    () => previewPortfolio(completePositions),
    [completePositions],
  );

  const dryPowderPct = (preview.dryPowderBps / 100).toFixed(1);
  const belowFloor = preview.dryPowderBps < DRY_POWDER_FLOOR_BPS;

  // Look up human labels for trust type + book currency.
  const trustTypeLabel =
    TRUST_TYPE_OPTIONS.find((o) => o.value === form.trustType)?.label ??
    form.trustType;

  return (
    <section
      aria-labelledby="page-review-title"
      className="flex flex-col gap-6"
    >
      <header className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          Onboarding · page 05 of 05
        </span>
        <h2
          id="page-review-title"
          className="font-serif text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
        >
          Review your <span className="text-primary">trust</span>
        </h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          This is your starting configuration. You can change everything
          later — the trust&apos;s name, the beneficiaries, the positions,
          the mandate, and the mode.
        </p>
      </header>

      <div className="house-hairline" aria-hidden />

      {/* Section 1 — Trust */}
      <ReviewSection
        label="Trust"
        value={form.name || "—"}
        subValue={`${trustTypeLabel} · ${form.bookCurrency}`}
      >
        <div className="flex flex-col gap-1 text-sm">
          <Row label="Name" value={form.name || "—"} />
          <Row label="Type" value={trustTypeLabel} />
          <Row label="Currency" value={form.bookCurrency} />
          {form.description.trim().length > 0 && (
            <Row label="Description" value={form.description.trim()} multiline />
          )}
        </div>
      </ReviewSection>

      {/* Section 2 — Trustee */}
      <ReviewSection
        label="Trustee"
        value={form.trusteeName || "—"}
        subValue={email}
      >
        <div className="flex flex-col gap-1 text-sm">
          <Row label="Name" value={form.trusteeName || "—"} />
          <Row label="Email" value={email} mono />
          {form.trusteePhone.trim().length > 0 && (
            <Row label="Phone" value={form.trusteePhone} mono />
          )}
          {form.trusteeAddress.trim().length > 0 && (
            <Row label="Address" value={form.trusteeAddress} multiline />
          )}
        </div>
      </ReviewSection>

      {/* Section 3 — Beneficiaries */}
      <ReviewSection
        label="Beneficiaries"
        value={`${completeBeneficiaries.length} named`}
        subValue={
          completeBeneficiaries.length === 0
            ? "Trust starts without beneficiaries"
            : "Will receive reports"
        }
      >
        {completeBeneficiaries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No beneficiaries named — the trust will start without
            recipients for reports. You can add them later from the
            Mandate tab.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {completeBeneficiaries.map((b, idx) => (
              <li
                key={b.id}
                className="flex flex-col gap-1 rounded-md border border-border/40 bg-muted/20 p-3 text-sm"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-foreground">
                    {b.name}
                  </span>
                  <Badge
                    variant="outline"
                    className="text-[10px] text-muted-foreground"
                  >
                    {b.reportingLevel === "full" ? "Full view" : "Summary only"}
                  </Badge>
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  {b.email}
                </div>
                {b.relationship.trim().length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    Relationship: {b.relationship}
                  </div>
                )}
                <div className="mt-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                  Beneficiary · {String(idx + 1).padStart(2, "0")}
                </div>
              </li>
            ))}
          </ul>
        )}
      </ReviewSection>

      {/* Section 4 — Portfolio (pie preview + table) */}
      <ReviewSection
        label="Portfolio"
        value={`${preview.positionsCount} ${
          preview.positionsCount === 1 ? "asset" : "assets"
        }`}
        subValue={`NAV ~${formatNavShort(preview.nav)}`}
      >
        <div className="flex flex-col gap-4">
          {/* Pie preview */}
          <div className="min-h-[360px]">
            <PortfolioPieChart
              opinion={opinion}
              bookCurrency={form.bookCurrency}
              mode="observe"
              aiRole="advisor"
              killSwitchActive={false}
            />
          </div>

          <Separator className="house-hairline" />

          {/* Position table */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border/60 text-[10px] uppercase tracking-widest text-muted-foreground">
                  <th className="py-2 pr-3 text-left font-semibold">Asset</th>
                  <th className="py-2 px-3 text-right font-semibold">Qty</th>
                  <th className="py-2 px-3 text-right font-semibold">Entry</th>
                  <th className="py-2 px-3 text-left font-semibold">Venue</th>
                  <th className="py-2 px-3 text-left font-semibold">Sleeve</th>
                  <th className="py-2 pl-3 text-right font-semibold">Est. value</th>
                </tr>
              </thead>
              <tbody>
                {completePositions.map((p) => {
                  const sleeve = previewSleeve(p.assetId);
                  const sleeveMeta = SLEEVE_META[sleeve];
                  const value = previewValue(p.assetId, p.quantity);
                  const isStable = p.assetId !== "" && sleeve === "stable";
                  const entry =
                    isStable || p.entryPrice.trim() === ""
                      ? null
                      : p.entryPrice.trim();
                  return (
                    <tr
                      key={p.id}
                      className="border-b border-border/40 last:border-b-0"
                    >
                      <td className="py-2 pr-3 font-mono font-semibold">
                        {p.assetId}
                      </td>
                      <td className="py-2 px-3 text-right font-mono house-num">
                        {p.quantity}
                      </td>
                      <td className="py-2 px-3 text-right font-mono house-num text-muted-foreground">
                        {entry === null ? (
                          <span className="text-muted-foreground/60">--</span>
                        ) : (
                          `$${entry}`
                        )}
                      </td>
                      <td className="py-2 px-3 text-muted-foreground">
                        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                          {p.venueKind}
                        </span>
                        <br />
                        {p.venue}
                      </td>
                      <td className="py-2 px-3">
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
                      </td>
                      <td className="py-2 pl-3 text-right font-mono house-num text-foreground">
                        {value}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-border/60">
                  <td className="py-2 pr-3 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    NAV
                  </td>
                  <td colSpan={4} />
                  <td className="py-2 pl-3 text-right font-serif text-lg font-bold text-primary house-num">
                    {formatNavShort(preview.nav)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </ReviewSection>

      {/* Dry-powder warning */}
      {belowFloor && preview.hasPositions && (
        <DryPowderWarning onBack={onBackToAssets} />
      )}

      {/* Confirmation checkbox */}
      <div
        className={`flex items-start gap-3 rounded-lg border p-4 transition-colors ${
          form.confirmed
            ? "border-allow/40 bg-allow/5"
            : "border-border/60 bg-muted/30"
        }`}
      >
        <Checkbox
          id="confirm-holdings"
          checked={form.confirmed}
          onCheckedChange={(v) => onConfirmedChange(v === true)}
          className="mt-0.5"
        />
        <Label
          htmlFor="confirm-holdings"
          className="text-sm leading-relaxed text-foreground"
        >
          I confirm these are my holdings. The trust will start in{" "}
          <span className="font-semibold text-primary">Observe</span> mode —
          read-only, no execution path. The AI acts as advisor; the policy
          engine gates every proposal.
        </Label>
      </div>

      <p className="text-xs text-muted-foreground">
        Click <span className="font-semibold text-primary">Create trust</span>{" "}
        in the footer to write the trust + beneficiaries + positions to the
        ledger. The trust starts in Observe mode; trade keys are NOT
        connected in v1.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// ReviewSection — a summary card with a header row + body.
// ---------------------------------------------------------------------------

interface ReviewSectionProps {
  label: string;
  value: string;
  subValue?: string;
  children: React.ReactNode;
}

function ReviewSection({
  label,
  value,
  subValue,
  children,
}: ReviewSectionProps) {
  return (
    <article className="rounded-lg border border-border/60 bg-muted/20 p-4">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <div className="flex flex-col items-end gap-0.5 text-right">
          <span className="font-serif text-base font-semibold text-foreground">
            {value}
          </span>
          {subValue && (
            <span className="text-[11px] text-muted-foreground">
              {subValue}
            </span>
          )}
        </div>
      </header>
      {children}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Row — a key/value row inside a review section.
// ---------------------------------------------------------------------------

interface RowProps {
  label: string;
  value: string;
  mono?: boolean;
  multiline?: boolean;
}

function Row({ label, value, mono, multiline }: RowProps) {
  return (
    <div
      className={`flex gap-3 ${multiline ? "flex-col" : "flex-row items-baseline"}`}
    >
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span
        className={`flex-1 text-foreground ${mono ? "font-mono text-xs" : ""} ${
          multiline ? "leading-relaxed" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DryPowderWarning — mirrors the advisory `WarningsList` warn-severity
// card so the trustee sees the same warning language across onboarding
// and Observe mode.
// ---------------------------------------------------------------------------

interface DryPowderWarningProps {
  onBack: () => void;
}

function DryPowderWarning({ onBack }: DryPowderWarningProps) {
  return (
    <article
      className="flex flex-col gap-3 rounded-lg border border-l-2 border-border/60 border-l-warn/60 bg-card p-4"
      aria-labelledby="dry-powder-warn-title"
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Snowflake className="size-4 text-warn-foreground" aria-hidden />
          <h4
            id="dry-powder-warn-title"
            className="font-serif text-base font-semibold tracking-tight"
          >
            Dry powder below the 30% floor
          </h4>
        </div>
        <Badge
          variant="outline"
          className="bg-warn/15 text-warn-foreground border-warn/40 text-[10px]"
        >
          warn
        </Badge>
      </header>
      <p className="text-xs leading-relaxed text-foreground/90">
        Dry powder below 30% floor — consider adding more stablecoins so
        the book is ready for a good trade. The House keeps a stable
        sleeve so a regime change or an opportunity can be deployed on
        without selling down.
      </p>
      <footer className="mt-auto flex items-center justify-between gap-3 rounded-md border border-border/40 bg-muted/40 p-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Remediation
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Go back to Page 4 and add USDC / USDT / DAI / FRAX or staked
            ETH (stETH, rETH, cbETH) until the stable sleeve crosses 30%.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onBack}
        >
          <AlertCircle className="size-3.5" aria-hidden />
          Back to assets
        </Button>
      </footer>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Helpers — value/quantity for the portfolio table.
// ---------------------------------------------------------------------------

import { REFERENCE_PRICES } from "@/server/lib/reference-prices";
import { categorizeAsset, type RiskCategory } from "@/server/domain/bankroll";

/** Look up the sleeve for an asset (mirrors previewSleeveForAsset). */
function previewSleeve(assetId: string): RiskCategory {
  if (!assetId) return "aggressive";
  return categorizeAsset(assetId);
}

/** Compute the est. value string for a position row (quantity × reference price). */
function previewValue(assetId: string, quantity: string): string {
  const qty = Number.parseFloat(quantity);
  if (!Number.isFinite(qty) || qty <= 0) return "$0";
  const price = REFERENCE_PRICES[assetId.toLowerCase()] ?? 1.0;
  const value = qty * price;
  if (!Number.isFinite(value) || value <= 0) return "$0";
  const rounded = Math.round(value);
  return `$${rounded.toLocaleString("en-US").replace(/,/g, " ")}`;
}
