import type { Intent } from "../domain/intent";
import type { PolicyContext } from "../domain/policy";
import type { AsyncResult, ServiceInfo } from "./types";

/**
 * AI house service (plan §3, §5 — Phase 5).
 *
 * PROPOSER ONLY. Returns intents for the policy engine to gate. Has no
 * network path to the signer. Model output is never executed as text —
 * only the intent schema is executable. Build only after Rules mode has
 * a clean decision log (plan §5: "Build only after Rules mode has a
 * clean decision log. The service reads book, mandate, and market
 * features. It returns intents and a short rationale. Policy accepts or
 * resizes. The signer is unchanged.").
 *
 * If the AI is down, the account falls back to Rules or Confirm, never
 * to an open order book (plan §2). House mode is per book, time-boxed,
 * and reversible. Default expiry 7 days until the user extends it.
 *
 * Start with a constrained planner (plan §5):
 *   - rank the allowed universe
 *   - propose weights
 *   - do not invent assets
 * The universe is a list, not a prompt (plan §12).
 *
 * Eval set (plan §5): replay historical books and reject any intent the
 * policy would have rejected. Track regret versus the rules baseline.
 */
export interface AIHouse {
  /**
   * Read the book + mandate + market features and return a list of
   * proposed intents. The policy engine will accept, resize, or reject
   * each. The AI may not override a hard exclude (plan §4).
   *
   * The intents returned here are NOT executable yet — they carry
   * status `pending` and origin `ai`. The executor refuses to sign
   * any AI-origin intent that has not passed the policy gate.
   */
  propose(ctx: PolicyContext): AsyncResult<Intent[]>;

  /**
   * Health probe. If the AI is `down`, the account falls back to Rules
   * (or Confirm) automatically. The fallback is a property of the
   * executor, not the AI service.
   */
  health(): AsyncResult<ServiceInfo>;
}

/**
 * Tool-called AI house stub. Phase 5. The real implementation is a
 * constrained planner: rank the allowed universe, propose weights, do
 * not invent assets. Until then every method throws not-implemented.
 *
 * The "tool-called" naming (plan §6 suggested stack) means the model
 * is invoked via structured tool calls, not free-text generation — the
 * tool's return type IS the intent schema. This is what makes it safe
 * to swap models without touching execution (plan §6).
 */
export class ToolCalledAIHouse implements AIHouse {
  async propose(_ctx: PolicyContext): AsyncResult<Intent[]> {
    throw new Error(
      "not-implemented: ToolCalledAIHouse.propose (Phase 5 — build only after Rules has a clean decision log)",
    );
  }

  async health(): AsyncResult<ServiceInfo> {
    throw new Error(
      "not-implemented: ToolCalledAIHouse.health (Phase 5)",
    );
  }
}
