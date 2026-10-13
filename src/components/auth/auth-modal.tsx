"use client";

import * as React from "react";
import { signIn } from "next-auth/react";
import { Loader2, Lock, Shield } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * AuthModal — login/signup surface for unauthenticated visitors
 * (Task 42-45).
 *
 * House is multi-tenant. Every visitor who hits `/` without a NextAuth
 * session sees this modal — there is no public read-only mode and no
 * shared demo user any more. They must either sign in (existing
 * trustee) or create an account (new trustee) before they see the
 * dashboard.
 *
 * Layout:
 *   ┌──────────────────────────────────────────┐
 *   │ House wordmark (serif, gold)             │
 *   │ Family Reserve · subtitle                │
 *   │ "Sign in to your trust" undertittel      │
 *   │                                          │
 *   │ [ Sign in ] [ Create account ]  ← Tabs   │
 *   │                                          │
 *   │ Email       [_______________________]   │
 *   │ Password    [_______________________]   │
 *   │ (Confirm pw) (Trust name) ← register    │
 *   │                                          │
 *   │ [    Sign in / Create trust    ]         │
 *   │                                          │
 *   │ ┌─ Demo credentials ─────────────────┐  │
 *   │ │ trustee@house.local / house-demo    │  │
 *   │ └─────────────────────────────────────┘  │
 *   └──────────────────────────────────────────┘
 *
 * Sign-in flow:
 *   - On submit, `signIn("credentials", { email, password, redirect: false })`
 *     is called (no full-page redirect — we handle the result inline).
 *   - `error` truthy → "Invalid email or password".
 *   - Success → `window.location.reload()` so the new JWT cookie is read
 *     by the SSR pass and the dashboard renders with the user's trust.
 *
 * Create-account flow:
 *   - Client validates (email format, password ≥ 8, passwords match,
 *     trust name ≥ 1) before hitting the network.
 *   - `POST /api/auth/register` with `{ email, password, name }`.
 *   - 201 → immediately call `signIn("credentials", ...)` so the user
 *     is logged in without a second form. Then reload.
 *   - 409 → "Email already registered — try signing in instead."
 *   - Other → surface the message.
 *
 * Dark mode + glassmorphism + gold accent — matches the rest of the
 * House dashboard (header wordmark + footer wordmark both use the
 * same `font-serif text-primary` treatment).
 *
 * Accessibility:
 *   - `role="dialog"` + `aria-modal="true"` + `aria-labelledby`.
 *   - Inputs have associated `<Label htmlFor>` pairs.
 *   - The submit button shows a spinner while pending and is
 *     `aria-busy` so screen readers announce the state.
 *   - ESC closes the modal (we re-render the page which re-mounts the
 *     modal at the new auth state — no broken state left behind).
 *
 * NB: there is no `open`/`onOpenChange` controlled-state here — the
 * modal is the entire page when `useSession().status === "unauthenticated"`.
 * `src/app/page.tsx` mounts `<AuthModal />` as a replacement for the
 * dashboard, not as a layer on top of it.
 */

type AuthMode = "signin" | "register";

/**
 * Form state shape for the active tab. We carry both modes in one
 * state object so switching tabs preserves the email the user already
 * typed (small UX win; common pattern on login screens).
 */
interface FormState {
  email: string;
  password: string;
  confirmPassword: string;
  trustName: string;
}

const INITIAL_FORM: FormState = {
  email: "",
  password: "",
  confirmPassword: "",
  trustName: "",
};

export function AuthModal() {
  // Tabs state — defaults to "signin" since most visitors are returning.
  const [tab, setTab] = React.useState<AuthMode>("signin");
  const [form, setForm] = React.useState<FormState>(INITIAL_FORM);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Field-level validation messages for the register tab. The signin
  // tab only needs the "credentials didn't match" error.
  const [fieldErrors, setFieldErrors] = React.useState<
    Partial<Record<keyof FormState, string>>
  >({});

  /**
   * Update a single form field and clear its field error. The single
   * callback is reused for every input so we don't need a closure per
   * field.
   */
  const updateField = React.useCallback(
    (key: keyof FormState) =>
      (e: React.ChangeEvent<HTMLInputElement>) => {
        setForm((prev) => ({ ...prev, [key]: e.target.value }));
        setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
        setError(null);
      },
    [],
  );

  /**
   * Sign in with the Credentials provider. Calls `signIn()` from
   * `next-auth/react` with `redirect: false` so we keep control of the
   * DOM and can show inline errors. On success, reload the page — the
   * SSR pass will read the new JWT cookie and render the dashboard.
   */
  const handleSignIn = React.useCallback(async () => {
    setError(null);
    if (!form.email || !form.password) {
      setError("Enter your email and password.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await signIn("credentials", {
        email: form.email,
        password: form.password,
        redirect: false,
      });
      if (!res || res.error) {
        setError("Invalid email or password.");
        return;
      }
      // Reload so SSR sees the new session cookie and the dashboard
      // mounts with the user's trust. Avoids client-only state hydration.
      window.location.reload();
    } catch {
      setError("Sign-in failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [form.email, form.password]);

  /**
   * Create a new account. Pre-validates (email format, password ≥ 8,
   * passwords match, trust name ≥ 1) then POSTs to
   * `/api/auth/register`. On 201 the user is logged in immediately
   * via `signIn("credentials", ...)` — no second form.
   */
  const handleRegister = React.useCallback(async () => {
    setError(null);
    setFieldErrors({});

    const errors: Partial<Record<keyof FormState, string>> = {};
    if (!form.email) {
      errors.email = "Email is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errors.email = "Enter a valid email address.";
    }
    if (!form.password) {
      errors.password = "Password is required.";
    } else if (form.password.length < 8) {
      errors.password = "Password must be at least 8 characters.";
    }
    if (form.confirmPassword !== form.password) {
      errors.confirmPassword = "Passwords do not match.";
    }
    if (!form.trustName.trim()) {
      errors.trustName = "Trust name is required.";
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          name: form.trustName.trim(),
        }),
      });
      if (res.status === 409) {
        // Email already registered — nudge to the signin tab.
        setFieldErrors({
          email: "Email already registered — try signing in instead.",
        });
        setTab("signin");
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { message?: string }
          | null;
        setError(
          data && typeof data.message === "string"
            ? data.message
            : `Registration failed (HTTP ${res.status}).`,
        );
        return;
      }

      // Auto-login after register — the user just picked a password,
      // they shouldn't have to type it again.
      const signInRes = await signIn("credentials", {
        email: form.email,
        password: form.password,
        redirect: false,
      });
      if (!signInRes || signInRes.error) {
        // Account was created but auto-login failed — fall back to the
        // signin tab so the user can enter credentials manually.
        setTab("signin");
        setError("Account created — please sign in.");
        return;
      }
      toast.success("Welcome to House.", {
        description: "Your trust is being prepared.",
      });
      window.location.reload();
    } catch {
      setError("Registration failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [form.email, form.password, form.confirmPassword, form.trustName]);

  /**
   * Enter key submits the active form. Tab-switch is handled by the
   * Tabs primitive (arrow keys + click).
   */
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !submitting) {
        e.preventDefault();
        if (tab === "signin") void handleSignIn();
        else void handleRegister();
      }
    },
    [tab, submitting, handleSignIn, handleRegister],
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      className="flex min-h-screen items-center justify-center bg-background px-4 py-10"
    >
      <div
        className="house-glass-strong w-full max-w-md rounded-2xl border border-border/60 p-6 shadow-2xl sm:p-8"
        onKeyDown={handleKeyDown}
      >
        {/* Wordmark + subtitle */}
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-4xl font-bold tracking-tight text-primary house-num-accent sm:text-5xl">
              House
            </span>
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            Family Reserve
          </p>
          <p
            id="auth-modal-title"
            className="mt-2 text-sm text-muted-foreground"
          >
            {tab === "signin"
              ? "Sign in to your trust"
              : "Create your trust"}
          </p>
        </div>

        {/* Tabs — Sign in / Create account */}
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as AuthMode)}
          className="mt-6"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signin">Sign in</TabsTrigger>
            <TabsTrigger value="register">Create account</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Form fields */}
        <div className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="auth-email">Email</Label>
            <Input
              id="auth-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={updateField("email")}
              aria-invalid={Boolean(fieldErrors.email)}
              disabled={submitting}
            />
            {fieldErrors.email && (
              <p className="text-xs text-destructive">{fieldErrors.email}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="auth-password">Password</Label>
            <Input
              id="auth-password"
              type="password"
              autoComplete={
                tab === "signin" ? "current-password" : "new-password"
              }
              placeholder="••••••••"
              value={form.password}
              onChange={updateField("password")}
              aria-invalid={Boolean(fieldErrors.password)}
              disabled={submitting}
            />
            {fieldErrors.password && (
              <p className="text-xs text-destructive">
                {fieldErrors.password}
              </p>
            )}
          </div>

          {/* Register-only fields */}
          {tab === "register" && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="auth-confirm">Confirm password</Label>
                <Input
                  id="auth-confirm"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={form.confirmPassword}
                  onChange={updateField("confirmPassword")}
                  aria-invalid={Boolean(fieldErrors.confirmPassword)}
                  disabled={submitting}
                />
                {fieldErrors.confirmPassword && (
                  <p className="text-xs text-destructive">
                    {fieldErrors.confirmPassword}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="auth-trust-name">Trust name</Label>
                <Input
                  id="auth-trust-name"
                  type="text"
                  autoComplete="organization"
                  placeholder="e.g. Smith Family Reserve"
                  value={form.trustName}
                  onChange={updateField("trustName")}
                  aria-invalid={Boolean(fieldErrors.trustName)}
                  disabled={submitting}
                />
                {fieldErrors.trustName && (
                  <p className="text-xs text-destructive">
                    {fieldErrors.trustName}
                  </p>
                )}
              </div>
            </>
          )}

          {/* Top-level error message (sign-in invalid, register server fail) */}
          {error && (
            <p
              role="alert"
              className="text-xs text-destructive"
            >
              {error}
            </p>
          )}

          {/* Submit */}
          <Button
            type="button"
            size="lg"
            className="mt-2 w-full"
            aria-busy={submitting}
            disabled={submitting}
            onClick={() =>
              tab === "signin" ? handleSignIn() : handleRegister()
            }
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {tab === "signin" ? "Signing in..." : "Creating trust..."}
              </>
            ) : (
              <>
                {tab === "signin" ? (
                  <Lock className="size-4" aria-hidden />
                ) : (
                  <Shield className="size-4" aria-hidden />
                )}
                {tab === "signin" ? "Sign in" : "Create trust"}
              </>
            )}
          </Button>
        </div>

        {/* Demo credentials hint */}
        <div className="mt-6 rounded-lg border border-border/60 bg-muted/40 p-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Demo credentials
          </p>
          <p className="mt-1 font-mono text-xs text-foreground">
            trustee@house.local
          </p>
          <p className="font-mono text-xs text-foreground">house-demo</p>
        </div>
      </div>
    </div>
  );
}
