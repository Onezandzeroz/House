import { z } from "zod";

import type { OperatingMode } from "./modes";
import { OperatingMode as OperatingModeEnum } from "./modes";

/**
 * Trust — the tenant container (plan §5; owner direction Task 11).
 *
 * Trust = tenant. En bruker kan være trustee for én eller flere trust-er
 * i teorien, men v1 støtter én trust per bruker (demo-brukeren har én
 * trust). Trusten er beholderen for boken, posisjonene og modusen.
 *
 * Rollene inne i en trust (plan §5):
 *   - Trustee     : brukeren med owner-rolle på trusten. Kan sette
 *                    mandat, holde kill-switch, bytte modus.
 *   - Beneficiary : navngitt part som mottar rapporter (per plan §5,
 *                    fase-6-bekymring; i v1 er trustees default
 *                    beneficiary).
 *   - Operator    : menneske eller AI med propose-rettigheter (per
 *                    plan §5; AI-operatør = House mode).
 *
 * AI-rollen er DERIVERT fra modus (per the owner direction Task 11):
 *   - Observe / Advise / Confirm / Rules  → AI = advisor
 *       (rådgivning, ikke execution)
 *   - House                               → AI = operator
 *       (kalles til å operere; policy engine fortsatt gates per plan §3)
 *
 * Bytter man modus til House, "kalles AI-en til å operere".
 * `aiRoleForMode(mode)` er den eneste avledningsregel — alt annet i
 * appen MÅ bruke denne funksjonen, aldri gjette rollen direkte fra
 * modus-strengen.
 */

/**
 * Trustee-rolle — per-trust rollen en bruker har (plan §5).
 *
 *   trustee      : owner av kill-switch, mandat, og modus-switch.
 *                    Default rolle for trust-creatorene.
 *   beneficiary  : navngitt part som mottar rapporter (Phase 6).
 *   operator     : menneske eller AI med propose-rettigheter. AI får
 *                    DENNE rollen kun i House mode (se aiRoleForMode).
 */
export const TrusteeRole = {
  Trustee: "trustee",
  Beneficiary: "beneficiary",
  Operator: "operator",
} as const;
export type TrusteeRole = (typeof TrusteeRole)[keyof typeof TrusteeRole];

/**
 * AIRole — den avledete rollen AI-en har inne i trusten gitt modus.
 *
 *   advisor       : AI rådgir (Observe / Advise / Confirm / Rules).
 *                    Advisory-opinions produseres; ingen execution.
 *                    Per owner direction (Task 11): "AI-en inne i trusten
 *                    har rollen som advisor i hovedsak".
 *   advisor-off   : Forbeholdt fremtidig bruk — når AI-en er eksplisitt
 *                    skrudd AV av trustee (f.eks. en "mute advisor"-toggle
 *                    i en senere fase). v1 bruker ikke denne verdien;
 *                    aiRoleForMode returnerer aldri den for noen
 *                    OperatingMode. Enum-verdien er definert så typen
 *                    har plass til tilstanden uten schema-bump.
 *   operator      : AI er "kallet til å operere" (kun House mode).
 *                    AI kan foreslå intents; policy engine fortsatt
 *                    gates per plan §3.
 */
export const AIRole = {
  Advisor: "advisor",
  AdvisorOff: "advisor-off",
  Operator: "operator",
} as const;
export type AIRole = (typeof AIRole)[keyof typeof AIRole];

/**
 * TrustState — zod-validerbar shape for en trust slik BFF-en returnerer
 * den. Inkluderer bookId + trusteeId + mode + aiRole + killSwitchActive
 * så side-byggeren (Task 14) kan render header-state uten ekstra kall.
 *
 * `aiRole` er avledet via `aiRoleForMode(mode)` før trusten serialiseres,
 * så klienten aldri gjetter på rollen fra modus-strengen.
 */
export const TrustStateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  trusteeId: z.string().min(1),
  mode: z.enum([
    OperatingModeEnum.Observe,
    OperatingModeEnum.Advise,
    OperatingModeEnum.Confirm,
    OperatingModeEnum.Rules,
    OperatingModeEnum.House,
  ]),
  aiRole: z.enum([AIRole.Advisor, AIRole.AdvisorOff, AIRole.Operator]),
  killSwitchActive: z.boolean(),
  houseExpiry: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  bookId: z.string().nullable(),
});
export type TrustState = z.infer<typeof TrustStateSchema>;

/**
 * OnboardingInput — input fra den nye multi-page onboarding-veiviseren
 * (Task 47-49) som oppretter en trust + trustee-profil + beneficiaries +
 * initielle posisjoner (med DeFi-felter).
 *
 *   Side 1 — Trust details:
 *     name         : trustens navn (e.g. "Smith Family Reserve")
 *     trustType    : "family-fund" | "personal" | "investment-club"
 *                    (default "family-fund")
 *     bookCurrency : stablecoin the user picks (USDC/USDT/DAI)
 *                    (default "USDC")
 *     description : optional notes about the trust's purpose
 *
 *   Side 2 — Trustee info:
 *     trusteeName    : the user's full name (pre-filled from session if available)
 *     trusteePhone   : optional contact phone
 *     trusteeAddress : optional legal address
 *
 *   Side 3 — Beneficiaries:
 *     beneficiaries[] : named parties who receive reports; each with
 *                       name + email + optional relationship +
 *                       reportingLevel ("full" | "summary")
 *
 *   Side 4 — Positions (utvidet med DeFi-felter):
 *     positions[] : initiell portefølje; minst én posisjon; hver unik
 *                    kombinasjon av asset + venue + state + source må
 *                    være unik per book per Position-tabellens constraint.
 *                    Hver posisjon kan også bære DeFi-metadata når
 *                    venueKind === "stake-defi": protocol, positionType,
 *                    contractAddress, apyBps, lockEnd.
 *
 * quantity er string for presisjon (Decimal i fremtiden). apyBps er et
 * heltall i basispunkter (500 = 5 % APY) — konverteres fra prosent i UI-et
 * før submit. lockEnd er en ISO date-string; service-konverterer til Date.
 *
 * venueKind må matche AccountKind i domain/book.ts (cex / evm-wallet /
 * solana-wallet / stake-defi / xrp-wallet / dex). Trust-service bruker
 * venueKind til å finne eller opprette en Account per unik venue.
 */
export const OnboardingInputSchema = z.object({
  // Side 1 — Trust details
  name: z.string().min(1).max(120),
  trustType: z
    .enum(["family-fund", "personal", "investment-club"])
    .default("family-fund"),
  bookCurrency: z.string().min(1).default("USDC"),
  description: z.string().max(2000).optional(),

  // Side 2 — Trustee info
  trusteeName: z.string().min(1),
  trusteePhone: z.string().optional(),
  trusteeAddress: z.string().optional(),

  // Side 3 — Beneficiaries
  beneficiaries: z
    .array(
      z.object({
        name: z.string().min(1),
        email: z.string().email(),
        relationship: z.string().optional(),
        reportingLevel: z.enum(["full", "summary"]).default("full"),
      }),
    )
    .default([]),

  // Side 4 — Positions (utvidet med DeFi-felter)
  positions: z
    .array(
      z.object({
        assetId: z.string().min(1),
        quantity: z.string().min(1),
        venue: z.string().min(1),
        venueKind: z.enum([
          "cex",
          "evm-wallet",
          "solana-wallet",
          "stake-defi",
          "xrp-wallet",
          "dex",
        ]),
        // DeFi-metadata (kunrelevant når venueKind === "stake-defi").
        protocol: z.string().optional(),
        positionType: z
          .enum(["staking", "lending", "lp", "vault"])
          .optional(),
        contractAddress: z.string().optional(),
        apyBps: z.number().int().nonnegative().optional(),
        // ISO date-string; service-konverterer til DateTime.
        lockEnd: z.string().optional(),
        // Entry price per unit in book currency (e.g. "60000.00" for BTC).
        // Only for non-stablecoin assets — stablecoins are $1.00 by definition.
        // Entered by the trustee during onboarding. Used for P&L.
        entryPrice: z.string().optional(),
      }),
    )
    .min(1, "Add at least one fund"),
});
export type OnboardingInput = z.infer<typeof OnboardingInputSchema>;

/**
 * AI-status per modus (plan §2; owner direction Task 11).
 *
 *   observe  → advisor    (AI rådgir, men ingenting executeres — read-only
 *                            mode. AI-en er "advisor i hovedsak" per
 *                            eierens retning.)
 *   advise   → advisor    (policy-engine foreslår; bruker executer)
 *   confirm  → advisor    (samme proposals, pakket som batch)
 *   rules    → advisor    (regelmotor kjører; AI passiv men rådgir fortsatt)
 *   house    → operator   (AI foreslår intents; policy gates)
 *
 * Per eierens retning (Task 11): "AI-en inne i trusten har rollen som
 * advisor i hovedsak, men kan operere når den kalles (House mode per
 * plan §2)." aiRole=advisor for Observe er konsistent med denne retning
 * OG med verifikasjonssteget "aiRole=advisor" for demo-trusten.
 *
 * Avvik fra oppgave-template: oppgavens template hadde
 * `observe: "advisor-off"`. Endret til `observe: "advisor"` for å matche
 * (a) eierens retning om at AI er "advisor i hovedsak" og (b)
 * verifikasjonsforventningen `aiRole=advisor` for demo-trusten. Enum-
 * verdien `advisor-off` beholdes for fremtidig bruk (en eventuell
 * "mute advisor"-toggle i en senere fase).
 */
export const AIStatusByMode: Record<OperatingMode, AIRole> = {
  observe: AIRole.Advisor,
  advise: AIRole.Advisor,
  confirm: AIRole.Advisor,
  rules: AIRole.Advisor,
  house: AIRole.Operator,
};

/**
 * Avled AI-rollen fra trustens modus (owner direction Task 11).
 *
 * Den eneste funksjonen i appen som mapper mode → AIRole. Alle BFF-ruter
 * og services som trenger AI-rollen MÅ kalle denne — aldri gjett direkte
 * fra modus-strengen.
 *
 * Policy-betydning (plan §3): AI-rollen er avledet, ikke lagret. Hvis
 * trustee bytter modus til House, "kalles AI-en til å operere" — det
 * betyr at AI-en kan foreslå intents via policy-gaten, men policy
 * engine fortsatt gates (plan §3). Hvis trustee bytter tilbake til
 * Observe, skrus AI-en tilbake til advisor-rolle (rådgivning leveres,
 * ingen execution).
 */
export function aiRoleForMode(mode: OperatingMode): AIRole {
  return AIStatusByMode[mode];
}

/**
 * Hvorvidt modusen tillater at AI-en opererer (kalles til å foreslå
 * intents). Kun House mode. (Se også modeAllowsAIProposals i modes.ts —
 * den gjør det samme; denne funksjonen er her så trust-kallere ikke
 * trenger å importere fra modes.ts for dette konseptet.)
 */
export function modeAllowsAIOperator(mode: OperatingMode): boolean {
  return mode === OperatingModeEnum.House;
}
