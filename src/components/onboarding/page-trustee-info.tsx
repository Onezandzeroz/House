"use client";

import * as React from "react";
import { ShieldCheck } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import type { WizardForm } from "./types";

/**
 * PageTrusteeInfo — Side 2 of the multi-page onboarding (Task 47-49).
 *
 * The trustee enters their own contact information. This data lands on
 * the User row (name, phone, address). The email is read-only — it
 * comes from the NextAuth session and is the login credential; the
 * trustee can't change their login email from the onboarding.
 *
 * Fields:
 *   - Full name (Input, required) — pre-filled from session.user.name
 *      if the user registered with a name (AuthModal collects trustName
 *      which becomes the user's name initially).
 *   - Email (Input, readonly) — from session.user.email.
 *   - Phone (Input, optional) — "+47 ..." or any format.
 *   - Address (Textarea, optional) — "For legal documentation".
 *
 * Validation: full name must be at least 1 char. The wizard gates the
 * Next button on `form.trusteeName.trim().length >= 1`.
 *
 * Visual language:
 *   - Hero heading in serif: "Trustee details".
 *   - Subtitle: "You are the trustee. This information is used for
 *      trust documentation."
 *   - The email field is rendered with a small lock icon to communicate
 *      "read-only — this is your login".
 *   - A small explanation card at the bottom: "The trustee holds the
 *      kill switch, sets the mandate, and decides when the AI may
 *      operate." — same language as the old StepWelcome role card so
 *      the role is clear before any beneficiary is added.
 *
 * The component is controlled — receives the form slice + setter.
 */
export interface PageTrusteeInfoProps {
  /** The trustee-info slice of the wizard form. */
  form: Pick<WizardForm, "trusteeName" | "trusteePhone" | "trusteeAddress">;
  /** Setter called on every mutation. */
  onFormChange: (
    patch: Partial<
      Pick<WizardForm, "trusteeName" | "trusteePhone" | "trusteeAddress">
    >,
  ) => void;
  /**
   * The trustee's email from the NextAuth session. Rendered read-only
   * (the email is the login credential — it can't be changed from
   * onboarding).
   */
  email: string;
}

/**
 * Render Side 2 — the trustee contact form.
 */
export function PageTrusteeInfo({
  form,
  onFormChange,
  email,
}: PageTrusteeInfoProps) {
  const [touched, setTouched] = React.useState(false);
  const showError = touched && form.trusteeName.trim().length === 0;

  return (
    <section
      aria-labelledby="page-trustee-info-title"
      className="flex flex-col gap-6"
    >
      <header className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          Onboarding · page 02 of 05
        </span>
        <h2
          id="page-trustee-info-title"
          className="font-serif text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
        >
          Trustee <span className="text-primary">details</span>
        </h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          You are the trustee. This information is used for trust
          documentation and beneficiary reports. You can update it
          later from the Mandate tab.
        </p>
      </header>

      <div className="house-hairline" aria-hidden />

      <div className="flex flex-col gap-5">
        {/* Full name */}
        <div className="flex flex-col gap-2">
          <Label
            htmlFor="trustee-name"
            className="text-xs uppercase tracking-widest text-muted-foreground"
          >
            Full name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="trustee-name"
            type="text"
            value={form.trusteeName}
            onChange={(e) => onFormChange({ trusteeName: e.target.value })}
            onBlur={() => setTouched(true)}
            placeholder="John Smith Sr."
            autoComplete="name"
            aria-invalid={showError}
            aria-describedby={showError ? "trustee-name-error" : undefined}
            className="font-serif text-lg"
          />
          {showError && (
            <p
              id="trustee-name-error"
              role="alert"
              className="text-xs text-destructive"
            >
              Your full name is required.
            </p>
          )}
        </div>

        {/* Email — readonly */}
        <div className="flex flex-col gap-2">
          <Label
            htmlFor="trustee-email"
            className="text-xs uppercase tracking-widest text-muted-foreground"
          >
            Email
          </Label>
          <Input
            id="trustee-email"
            type="email"
            value={email}
            readOnly
            disabled
            aria-describedby="trustee-email-hint"
            className="cursor-not-allowed font-mono text-sm text-muted-foreground"
          />
          <p
            id="trustee-email-hint"
            className="flex items-center gap-1 text-[11px] text-muted-foreground"
          >
            <span aria-hidden>Locked</span> — this is your login email.
            Change it from your account settings (Phase 2).
          </p>
        </div>

        {/* Phone + Address — phone on top, address below (full width). */}
        <div className="flex flex-col gap-2">
          <Label
            htmlFor="trustee-phone"
            className="text-xs uppercase tracking-widest text-muted-foreground"
          >
            Phone <span className="text-muted-foreground/60">(optional)</span>
          </Label>
          <Input
            id="trustee-phone"
            type="tel"
            value={form.trusteePhone}
            onChange={(e) => onFormChange({ trusteePhone: e.target.value })}
            placeholder="+47 ..."
            autoComplete="tel"
            aria-describedby="trustee-phone-hint"
            className="font-mono text-sm"
          />
          <p
            id="trustee-phone-hint"
            className="text-[11px] text-muted-foreground"
          >
            Used for time-sensitive alerts (kill switch, mode change).
            Phone format is free-text in v1.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label
            htmlFor="trustee-address"
            className="text-xs uppercase tracking-widest text-muted-foreground"
          >
            Address <span className="text-muted-foreground/60">(optional)</span>
          </Label>
          <Textarea
            id="trustee-address"
            value={form.trusteeAddress}
            onChange={(e) => onFormChange({ trusteeAddress: e.target.value })}
            placeholder="For legal documentation"
            className="min-h-[88px] resize-y"
            aria-describedby="trustee-address-hint"
          />
          <p
            id="trustee-address-hint"
            className="text-[11px] text-muted-foreground"
          >
            Plain text. Stored on your user profile; surfaced in trust
            documentation exports.
          </p>
        </div>
      </div>

      {/* Trustee-role explanation card. Same language as the old
          StepWelcome role cards so the role is unambiguous before
          any beneficiary is added on Side 3. */}
      <article className="flex items-start gap-3 rounded-lg border border-allow/30 bg-allow/5 p-4">
        <ShieldCheck
          className="mt-0.5 size-5 shrink-0 text-allow-foreground"
          aria-hidden
        />
        <div className="flex flex-col gap-1">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-allow-foreground">
            Your role as trustee
          </p>
          <p className="text-xs leading-relaxed text-foreground/90">
            The trustee holds the kill switch, sets the mandate, and
            decides when the AI may operate. The trust starts in{" "}
            <span className="font-semibold text-primary">Observe</span>{" "}
            mode — read-only, no execution path.
          </p>
        </div>
      </article>
    </section>
  );
}
