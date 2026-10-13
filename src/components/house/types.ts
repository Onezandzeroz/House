/**
 * House-side types for the page integration (Task 15).
 *
 * The `/` route (page.tsx) owns the trust state and renders one of:
 *   - `FirstTimeOnboarding`  — no trust yet, mount the wizard
 *   - `<HouseOverview />`     — trust exists; pie chart + AI operator
 *   - `<AdvisoryDashboard />`  — secondary tab
 *   - `<ArchitectureOverview />` — tertiary tab
 *
 * `TrustSummary` is the client-side shape of the trust payload returned
 * by `GET /api/trust` and `POST /api/trust/mode`. It mirrors the
 * server-side `TrustState` (zod) but is JSON-friendly: every date is an
 * ISO string after `res.json()`. The page-level state stores this shape
 * so the children (operator panel, header strip) can read mode, aiRole,
 * killSwitchActive, and houseExpiry without an extra fetch.
 *
 * The shape:
 *   - `mode`            : the current operating mode (plan §2).
 *   - `aiRole`          : the AI's role derived from `mode` (advisor in
 *                         all modes except House; operator in House;
 *                         advisor-off reserved for future use).
 *   - `killSwitchActive`: derived from `killedAt !== null`.
 *   - `houseExpiry`     : the time-boxed House-mode mandate expiry.
 *                         Only meaningful when `mode === "house"`.
 *   - `bookId`          : the trust's primary book. Used to scope later
 *                         position CRUD.
 *
 * The opinion / snapshot is rådgivning, IKKE en executable intent. The
 * operator switch below changes the trust's mode — the policy engine
 * still gates everything (plan §3).
 */

/**
 * The operating modes (mirrors plan §2 and `OperatingMode` in
 * `src/server/domain/modes.ts`). Re-declared here so the client types
 * stay self-contained; importing the domain enum transitively pulls the
 * zod schema + a Prisma client through the bundler on the client side.
 */
export type TrustMode =
  | "observe"
  | "advise"
  | "confirm"
  | "rules"
  | "house";

/**
 * The AI's role inside the trust. `advisor` = AI proposes, owner /
 * policy gate decides. `operator` = AI is in House mode and emits
 * intents subject to the policy gate. `advisor-off` = AI muted
 * (reserved for future use; v1 never emits this).
 */
export type TrustAiRole = "advisor" | "advisor-off" | "operator";

/**
 * TrustSummary — the trust state the page owns and passes to its
 * children. JSON-transport-friendly (dates are ISO strings).
 *
 * Mode → AI role derivation is server-side (aiRoleForMode); the client
 * trusts the API and reads `aiRole` verbatim instead of re-deriving it
 * (so a future mode → role mapping change lands server-side only).
 */
export interface TrustSummary {
  id: string;
  name: string;
  trusteeId: string;
  mode: TrustMode;
  aiRole: TrustAiRole;
  killSwitchActive: boolean;
  houseExpiry: string | null;
  createdAt: string;
  updatedAt: string;
  bookId: string | null;
}

/**
 * Mode display metadata — label + chip tone + short tagline. Used by the
 * header strip + operator panel. The tone mirrors the advisory status
 * palette in `globals.css` (allow / warn / reject + primary for house).
 *
 *   observe   : muted   — read-only. Most conservative posture.
 *   advise    : allow   — policy engine writes proposals.
 *   confirm   : warn    — owner approves each batch (default product).
 *   rules     : warn    — deterministic rebalance inside caps.
 *   house     : primary — AI proposes; policy still gates.
 */
export const TRUST_MODE_META: Record<
  TrustMode,
  {
    label: string;
    tone: "muted" | "allow" | "warn" | "primary";
    tagline: string;
  }
> = {
  observe: {
    label: "Observe",
    tone: "muted",
    tagline: "Read-only. No execution path.",
  },
  advise: {
    label: "Advise",
    tone: "allow",
    tagline: "Policy engine writes proposals. Owner executes outside the app.",
  },
  confirm: {
    label: "Confirm",
    tone: "warn",
    tagline: "Same proposals, packaged as a batch. Owner approves in-app.",
  },
  rules: {
    label: "Rules",
    tone: "warn",
    tagline: "Deterministic rebalance inside caps.",
  },
  house: {
    label: "House",
    tone: "primary",
    tagline: "AI proposes; policy still gates. Same grants as Rules.",
  },
};

/**
 * Tone → Tailwind chip classes. Centralised so the header strip and the
 * operator panel use the exact same chip colour for a given mode.
 */
export const TONE_CHIP_CLASS: Record<
  "muted" | "allow" | "warn" | "primary",
  string
> = {
  muted: "bg-muted text-muted-foreground border-border/60",
  allow: "bg-allow/15 text-allow-foreground border-allow/40",
  warn: "bg-warn/15 text-warn-foreground border-warn/40",
  primary: "bg-primary/15 text-primary border-primary/40",
};

/**
 * The default number of days the AI operator panel suggests when
 * calling the AI to operate. Matches the server-side default
 * (DEFAULT_HOUSE_EXPIRY_MS in trust-service.ts = 7 days) so the UI
 * stays in sync with what the API actually persists.
 */
export const DEFAULT_HOUSE_DAYS = 7;
