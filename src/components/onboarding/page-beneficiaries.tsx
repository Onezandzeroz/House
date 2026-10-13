"use client";

import * as React from "react";
import { Plus, Trash2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  REPORTING_LEVEL_OPTIONS,
  isBeneficiaryEmpty,
  type Beneficiary,
  type ReportingLevel,
  type WizardForm,
} from "./types";

/**
 * PageBeneficiaries — Side 3 of the multi-page onboarding (Task 47-49).
 *
 * The trustee adds named parties who receive reports. Each beneficiary
 * row carries name + email + optional relationship + reporting level.
 * The list is dynamic — the user can add and remove rows; a "Skip for
 * now" link starts the trust with zero beneficiaries.
 *
 * Validation (lifted to the wizard container):
 *   - If ANY non-empty row exists, every started row must be complete
 *     (name + valid email). Empty rows are skipped on submit so the
 *     user can leave the last partial row blank.
 *   - The wizard uses `isBeneficiariesValid(form.beneficiaries)` to
 *     gate the Next button.
 *
 * Visual language:
 *   - Hero heading in serif: "Beneficiaries".
 *   - Subtitle: "Named parties who receive reports. You can add more
 *      later."
 *   - Each row is a bordered card with 4 inputs (name, email,
 *      relationship, reporting-level select) + a remove button.
 *   - On desktop the row is a 4-column grid; on mobile it stacks
 *      vertically inside the card.
 *   - Below the rows: "Add another beneficiary" (Plus icon) + "Skip
 *      for now" link.
 *
 * Accessibility:
 *   - Each input has an associated <Label htmlFor> pair (the label is
 *      visually hidden on desktop via sr-only but visible on mobile).
 *   - The remove button has an aria-label with the row number.
 */
export interface PageBeneficiariesProps {
  /** The beneficiaries slice of the wizard form. */
  form: Pick<WizardForm, "beneficiaries">;
  /** Setter called on every mutation. */
  onFormChange: (
    patch: Partial<Pick<WizardForm, "beneficiaries">>,
  ) => void;
}

/**
 * Render Side 3 — the beneficiaries list.
 */
export function PageBeneficiaries({
  form,
  onFormChange,
}: PageBeneficiariesProps) {
  const beneficiaries = form.beneficiaries;

  // ---- Mutations ---------------------------------------------------------
  const addRow = () => {
    onFormChange({
      beneficiaries: [
        ...beneficiaries,
        {
          id: makeRowId(),
          name: "",
          email: "",
          relationship: "",
          reportingLevel: "full" as ReportingLevel,
        },
      ],
    });
  };

  const removeRow = (id: string) => {
    onFormChange({
      beneficiaries: beneficiaries.filter((b) => b.id !== id),
    });
  };

  const updateRow = (id: string, patch: Partial<Beneficiary>) => {
    onFormChange({
      beneficiaries: beneficiaries.map((b) =>
        b.id === id ? { ...b, ...patch } : b,
      ),
    });
  };

  const skipAll = () => {
    onFormChange({ beneficiaries: [] });
  };

  // ---- Render ------------------------------------------------------------
  return (
    <section
      aria-labelledby="page-beneficiaries-title"
      className="flex flex-col gap-6"
    >
      <header className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          Onboarding · page 03 of 05
        </span>
        <h2
          id="page-beneficiaries-title"
          className="font-serif text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
        >
          Beneficiaries
        </h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          Named parties who receive reports. You can add more later from
          the Mandate tab. Beneficiaries are not signed in to House;
          they receive reports at the email you enter here.
        </p>
      </header>

      <div className="house-hairline" aria-hidden />

      {/* Empty state — when the user clicked "Skip for now". */}
      {beneficiaries.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border/60 px-4 py-12 text-center">
          <div
            aria-hidden
            className="flex size-12 items-center justify-center rounded-full border border-border bg-muted/40"
          >
            <Users className="size-5 text-muted-foreground" aria-hidden />
          </div>
          <div className="flex flex-col gap-1">
            <p className="font-serif text-lg font-semibold text-foreground">
              No beneficiaries yet
            </p>
            <p className="max-w-md text-xs text-muted-foreground">
              The trust can start without beneficiaries. You can add
              them later from the Mandate tab when you are ready to
              send reports.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addRow}
          >
            <Plus className="size-4" aria-hidden />
            Add a beneficiary
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {beneficiaries.map((b, idx) => (
            <BeneficiaryRow
              key={b.id}
              beneficiary={b}
              index={idx}
              onChange={(patch) => updateRow(b.id, patch)}
              onRemove={() => removeRow(b.id)}
              canRemove={beneficiaries.length > 1}
            />
          ))}
        </ul>
      )}

      {/* Footer actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          <Plus className="size-4" aria-hidden />
          Add another beneficiary
        </Button>
        {beneficiaries.length > 0 && (
          <button
            type="button"
            onClick={skipAll}
            className="self-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline sm:self-auto"
          >
            Skip for now — start without beneficiaries
          </button>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// BeneficiaryRow — one editable beneficiary card.
// ---------------------------------------------------------------------------

interface BeneficiaryRowProps {
  beneficiary: Beneficiary;
  index: number;
  onChange: (patch: Partial<Beneficiary>) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function BeneficiaryRow({
  beneficiary,
  index,
  onChange,
  onRemove,
  canRemove,
}: BeneficiaryRowProps) {
  const isEmpty = isBeneficiaryEmpty(beneficiary);

  return (
    <li className="relative rounded-lg border border-border/60 bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Beneficiary · {String(index + 1).padStart(2, "0")}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          disabled={!canRemove}
          aria-label={`Remove beneficiary ${index + 1}`}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Name */}
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={`bene-${beneficiary.id}-name`}
            className="text-[10px] uppercase tracking-widest text-muted-foreground"
          >
            Name <span className="text-destructive">*</span>
          </Label>
          <Input
            id={`bene-${beneficiary.id}-name`}
            type="text"
            value={beneficiary.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="John Smith Jr."
            autoComplete="off"
            aria-label={`Beneficiary ${index + 1} name`}
          />
        </div>

        {/* Email */}
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={`bene-${beneficiary.id}-email`}
            className="text-[10px] uppercase tracking-widest text-muted-foreground"
          >
            Email <span className="text-destructive">*</span>
          </Label>
          <Input
            id={`bene-${beneficiary.id}-email`}
            type="email"
            value={beneficiary.email}
            onChange={(e) => onChange({ email: e.target.value })}
            placeholder="john.jr@example.com"
            autoComplete="off"
            aria-label={`Beneficiary ${index + 1} email`}
          />
        </div>

        {/* Relationship */}
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={`bene-${beneficiary.id}-relationship`}
            className="text-[10px] uppercase tracking-widest text-muted-foreground"
          >
            Relationship <span className="text-muted-foreground/60">(optional)</span>
          </Label>
          <Input
            id={`bene-${beneficiary.id}-relationship`}
            type="text"
            value={beneficiary.relationship}
            onChange={(e) => onChange({ relationship: e.target.value })}
            placeholder="Son · Spouse · ..."
            autoComplete="off"
            aria-label={`Beneficiary ${index + 1} relationship`}
          />
        </div>

        {/* Reporting level */}
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={`bene-${beneficiary.id}-reporting`}
            className="text-[10px] uppercase tracking-widest text-muted-foreground"
          >
            Reporting level
          </Label>
          <Select
            value={beneficiary.reportingLevel}
            onValueChange={(v) =>
              onChange({ reportingLevel: v as ReportingLevel })
            }
          >
            <SelectTrigger
              id={`bene-${beneficiary.id}-reporting`}
              aria-label={`Beneficiary ${index + 1} reporting level`}
              className="w-full"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REPORTING_LEVEL_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <span className="flex flex-col items-start">
                    <span>{opt.label}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {opt.hint}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isEmpty && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Empty row — leave blank and click Next, or fill in to add.
        </p>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stable id for new beneficiary rows (re-exported only for this file). */
function makeRowId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
