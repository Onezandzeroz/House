"use client";

import * as React from "react";
import { ShieldCheck, Snowflake, Sparkles } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

import { isValidTrustName } from "./types";

/**
 * StepWelcome — Step 1 of the onboarding wizard.
 *
 * The trustee names the trust (e.g. "Smith Family Reserve") and reads the
 * role cards so the relationship is clear before any fund is added:
 *
 *   - Trustee    : the user — holds the kill switch, sets the mandate,
 *                  decides when AI may operate.
 *   - AI advisor : inside the trust by default — proposes, the trustee
 *                  decides. House mode (AI operating) is opt-in, time-
 *                  boxed, and reversible.
 *
 * Validation: name must be 1..120 chars after trim. The parent wizard
 * gates the Next button on `isValidTrustName(name)`; this component
 * shows the inline error if the field is touched but invalid.
 *
 * Visual language:
 *   - Hero heading in Cormorant serif 3xl — "You are the trustee".
 *     "trustee" is gold (.text-primary) so the role word pops.
 *   - Trust-name input is a single full-width Input with placeholder
 *     "Smith Family Reserve".
 *   - Three role cards at the bottom (Trustee / Advisor / Operator
 *     later) — each is a subtle bordered panel with an icon + one-line
 *     role + longer explanation. The cards mirror the dashboard's
 *     `BankrollSnapshot` card pattern so the trustee sees the same
 *     visual language they will see in Observe mode.
 */
export interface StepWelcomeProps {
  /** The current trust-name value (controlled input). */
  name: string;
  /** Setter called on every keystroke. */
  onNameChange: (next: string) => void;
}

/**
 * Render Step 1 — the welcome / name-the-trust screen.
 */
export function StepWelcome({ name, onNameChange }: StepWelcomeProps) {
  const [touched, setTouched] = React.useState(false);

  const trimmed = name.trim();
  const isValid = isValidTrustName(name);
  const showError = touched && !isValid;

  return (
    <section
      aria-labelledby="step-welcome-title"
      className="flex flex-col gap-6"
    >
      <header className="flex flex-col gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          Onboarding · step 01
        </span>
        <h2
          id="step-welcome-title"
          className="font-serif text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
        >
          You are the <span className="text-primary">trustee</span>
        </h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          Each trust is a separate fond. You — the trustee — hold the kill
          switch, set the mandate, and decide when the AI may operate.
          Start by naming this trust.
        </p>
      </header>

      <div className="house-hairline" aria-hidden />

      <div className="flex flex-col gap-2">
        <Label htmlFor="trust-name" className="text-xs uppercase tracking-widest text-muted-foreground">
          Trust name
        </Label>
        <Input
          id="trust-name"
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
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
          <span>Used as the trust&apos;s display name. Changeable later.</span>
          <span className="house-num">
            {trimmed.length}/120
          </span>
        </div>
        {showError && (
          <p
            id="trust-name-error"
            role="alert"
            className="text-xs text-reject-foreground"
          >
            Name must be between 1 and 120 characters.
          </p>
        )}
      </div>

      <Separator className="house-hairline" />

      {/* Role cards — Trustee / Advisor (default) / Operator (later). */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <RoleCard
          icon={<ShieldCheck className="size-4 text-allow-foreground" aria-hidden />}
          tone="border-allow/40 bg-allow/5"
          label="Trustee"
          headline="You"
          body="Holds the kill switch. Sets the mandate. Decides when the AI may operate. Default role for the trust creator."
        />
        <RoleCard
          icon={<Sparkles className="size-4 text-primary" aria-hidden />}
          tone="border-primary/40 bg-primary/5"
          label="AI · default"
          headline="Advisor"
          body="By default, the AI inside this trust acts as advisor — it proposes, you decide. You can call upon it to operate (House mode) later, time-boxed and reversible."
          highlight
        />
        <RoleCard
          icon={<Snowflake className="size-4 text-warn-foreground" aria-hidden />}
          tone="border-warn/30 bg-warn/5"
          label="AI · later"
          headline="Operator"
          body="When you switch the trust to House mode, the AI is called upon to operate. The policy engine still gates every intent. No new asset, no new venue, no new withdrawal address."
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// RoleCard — the small bordered panel used for the three role columns.
// Mirrors the BankrollSnapshot card pattern (icon + label + value + body).
// ---------------------------------------------------------------------------

interface RoleCardProps {
  icon: React.ReactNode;
  tone: string;
  label: string;
  headline: string;
  body: string;
  /** True for the default card — adds a small gold "default" pill. */
  highlight?: boolean;
}

function RoleCard({
  icon,
  tone,
  label,
  headline,
  body,
  highlight = false,
}: RoleCardProps) {
  return (
    <article
      className={`relative flex flex-col gap-2 rounded-lg border p-4 ${tone}`}
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {label}
          </span>
        </div>
        {highlight && (
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-primary">
            default
          </span>
        )}
      </header>
      <p className="font-serif text-2xl font-bold tracking-tight text-foreground">
        {headline}
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
    </article>
  );
}
