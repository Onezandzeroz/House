import { z } from "zod";

/**
 * Moderate ethics screen (plan §4). Moderate means a short hard ban plus
 * soft preferences, not a values essay. The screen is data, not a model
 * judgement. The AI may explain a preference. It may not override a hard
 * exclude.
 *
 * Ethics lists are versioned so a later decision can be replayed against
 * the list that was live that day. The full payload is JSON-marshalled
 * into the `EthicsListVersion.payload` column.
 *
 * Hard excludes are LISTS, not prompts. They are machine-checkable.
 */

/**
 * Unverified contract entry. A token contract on a specific chain that
 * is not verified on its explorer (or whose published source does not
 * match the deployed bytecode). The policy engine rejects any intent
 * whose venue touches one of these.
 */
export const UnverifiedContractSchema = z.object({
  chainId: z.string().min(1),
  address: z.string().min(1),
});
export type UnverifiedContract = z.infer<typeof UnverifiedContractSchema>;

/**
 * Hard excludes (plan §4). The AI may not override any of these.
 *
 * - `sanctionedAddresses`: addresses on a sanctioned-actor list.
 * - `knownMixers`: mixers on the execution path. If a venue's recent
 *   inflows touch one of these, the policy engine rejects the intent.
 * - `unverifiedContracts`: per-chain contracts that are not verified.
 *   Used when the intent side is `stake` / `unstake` / `lp` and the
 *   target contract is on this list.
 * - `userBlockedAssets`: asset ids the user personally blocks. These
 *   differ from sanctioned (the user may block for any reason — ESG,
 *   tax, personal).
 *
 * Soft preferences are NOT here — they affect ranking, not the gate.
 */
export const HardExcludeSchema = z.object({
  sanctionedAddresses: z.array(z.string().min(1)).default([]),
  knownMixers: z.array(z.string().min(1)).default([]),
  unverifiedContracts: z.array(UnverifiedContractSchema).default([]),
  userBlockedAssets: z.array(z.string().min(1)).default([]),
});
export type HardExclude = z.infer<typeof HardExcludeSchema>;

/**
 * Soft preferences (plan §4). These change ranking, they do not veto.
 * The AI service uses them when ordering candidate intents; the policy
 * engine does not enforce them.
 *
 * - `preferLiquidity`: rank venues with deeper top-of-book higher.
 * - `preferPublishedSupply`: rank assets with a published, audited
 *   supply higher.
 * - `preferWithdrawalHistory`: rank venues with a clean withdrawal
 *   history higher (i.e. not currently blocking withdrawals).
 */
export const SoftPreferSchema = z.object({
  preferLiquidity: z.boolean().default(true),
  preferPublishedSupply: z.boolean().default(true),
  preferWithdrawalHistory: z.boolean().default(true),
});
export type SoftPrefer = z.infer<typeof SoftPreferSchema>;

/**
 * User toggles (plan §4). Default off. Turning one on is a RECORDED
 * mandate change — a new ethics version row, with the user's id and
 * timestamp.
 *
 * - `privacyCoins`: allow assets with shielded-transfer features.
 * - `gamblingTokens`: allow prediction-market / betting tokens.
 * - `memeSleeves`: allow a small meme-token sleeve inside the universe.
 *
 * These do not bypass hard excludes. A privacy coin on the sanctioned
 * list is still rejected.
 */
export const EthicsTogglesSchema = z.object({
  privacyCoins: z.boolean().default(false),
  gamblingTokens: z.boolean().default(false),
  memeSleeves: z.boolean().default(false),
});
export type EthicsToggles = z.infer<typeof EthicsTogglesSchema>;

/**
 * The full ethics list payload. Stored as JSON in
 * `EthicsListVersion.payload`. Versioned so a later decision can be
 * replayed against the list that was live that day.
 */
export const EthicsListSchema = z.object({
  hardExclude: HardExcludeSchema,
  softPrefer: SoftPreferSchema,
  toggles: EthicsTogglesSchema,
  version: z.number().int().positive(),
});
export type EthicsList = z.infer<typeof EthicsListSchema>;
