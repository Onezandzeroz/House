"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  BOOK_CURRENCY_OPTIONS,
  TRUST_TYPE_OPTIONS,
  isValidTrustName,
  type BookCurrency,
  type TrustType,
  type WizardForm,
} from "./types";

/**
 * PageTrustDetails — Side 1 of the multi-page onboarding (Task 47-49).
 *
 * The trustee sets up the trust itself: name, type, book currency, and
 * an optional description. This is the foundation — every later page
 * layers onto the trust created here.
 *
 * Fields:
 *   - Trust name (Input, required) — f.eks. "Smith Family Reserve"
 *   - Trust type (Select) — Family Fund (default) / Personal / Investment Club
 *   - Book currency (Select) — USDC (default) / USDT / DAI
 *   - Description (Textarea, optional) — "Notes about this trust's
 *      purpose, goals, etc."
 *
 * Validation: trust name must be 1..120 chars after trim. The wizard
 * gates the Next button on `isValidTrustName(form.name)`.
 *
 * Visual language:
 *   - Hero heading in Cormorant serif 2xl/3xl: "Set up your trust".
 *   - Subtitle in muted text: "Every trust is a separate fond..."
 *   - The form is a vertical stack of Label + control pairs inside the
 *     glass card (the card lives in the wizard container, not here).
 *   - Trust name carries a character counter (X/120) so the user sees
 *     the limit.
 *
 * The component is controlled — it receives the form slice + a setter
 * and emits immutable replacements on every keystroke.
 */
export interface PageTrustDetailsProps {
  /** The trust-details slice of the wizard form. */
  form: Pick<WizardForm, "name" | "trustType" | "bookCurrency" | "description">;
  /** Setter called on every mutation. */
  onFormChange: (
    patch: Partial<Pick<WizardForm, "name" | "trustType" | "bookCurrency" | "description">>,
  ) => void;
}

/**
 * Render Side 1 — the trust setup form.
 */
export function PageTrustDetails({
  form,
  onFormChange,
}: PageTrustDetailsProps) {
  const [touched, setTouched] = React.useState(false);

  const trimmed = form.name.trim();
  const isValid = isValidTrustName(form.name);
  const showError = touched && !isValid;

  return (
    <section
      aria-labelledby="page-trust-details-title"
      className="flex flex-col gap-6"
    >
      <header className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          Onboarding · page 01 of 05
        </span>
        <h2
          id="page-trust-details-title"
          className="font-serif text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
        >
          Set up your <span className="text-primary">trust</span>
        </h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          Every trust is a separate fond. This is the foundation — the
          name, the type, the book currency. You can change all of this
          later from the Mandate tab.
        </p>
      </header>

      <div className="house-hairline" aria-hidden />

      <div className="flex flex-col gap-5">
        {/* Trust name */}
        <div className="flex flex-col gap-2">
          <Label
            htmlFor="trust-name"
            className="text-xs uppercase tracking-widest text-muted-foreground"
          >
            Trust name
          </Label>
          <Input
            id="trust-name"
            type="text"
            value={form.name}
            onChange={(e) => onFormChange({ name: e.target.value })}
            onBlur={() => setTouched(true)}
            placeholder="Smith Family Reserve"
            maxLength={120}
            aria-invalid={showError}
            aria-describedby={showError ? "trust-name-error" : undefined}
            autoComplete="off"
            spellCheck={false}
            className="font-serif text-lg"
          />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>The display name for this fond. Changeable later.</span>
            <span className="house-num">{trimmed.length}/120</span>
          </div>
          {showError && (
            <p
              id="trust-name-error"
              role="alert"
              className="text-xs text-destructive"
            >
              Name must be between 1 and 120 characters.
            </p>
          )}
        </div>

        {/* Trust type + Book currency — two-up on desktop, stacked on mobile. */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label
              htmlFor="trust-type"
              className="text-xs uppercase tracking-widest text-muted-foreground"
            >
              Trust type
            </Label>
            <Select
              value={form.trustType}
              onValueChange={(v) =>
                onFormChange({ trustType: v as TrustType })
              }
            >
              <SelectTrigger id="trust-type" className="w-full">
                <SelectValue placeholder="Pick a type" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel className="uppercase tracking-widest">
                    Fond type
                  </SelectLabel>
                  {TRUST_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <span className="flex flex-col items-start">
                        <span>{opt.label}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {opt.hint}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label
              htmlFor="book-currency"
              className="text-xs uppercase tracking-widest text-muted-foreground"
            >
              Book currency
            </Label>
            <Select
              value={form.bookCurrency}
              onValueChange={(v) =>
                onFormChange({ bookCurrency: v as BookCurrency })
              }
            >
              <SelectTrigger id="book-currency" className="w-full">
                <SelectValue placeholder="Pick a stablecoin" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel className="uppercase tracking-widest">
                    Stablecoin
                  </SelectLabel>
                  {BOOK_CURRENCY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <span className="flex flex-col items-start">
                        <span>{opt.label}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {opt.hint}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Description */}
        <div className="flex flex-col gap-2">
          <Label
            htmlFor="trust-description"
            className="text-xs uppercase tracking-widest text-muted-foreground"
          >
            Description <span className="text-muted-foreground/60">(optional)</span>
          </Label>
          <Textarea
            id="trust-description"
            value={form.description}
            onChange={(e) => onFormChange({ description: e.target.value })}
            placeholder="Notes about this trust's purpose, goals, etc."
            maxLength={2000}
            aria-describedby="trust-description-hint"
            className="min-h-[120px] resize-y"
          />
          <p
            id="trust-description-hint"
            className="text-[11px] text-muted-foreground"
          >
            Plain text. Stored on the trust row; surfaced in the Mandate
            tab and beneficiary reports.
          </p>
        </div>
      </div>
    </section>
  );
}
