import type { HouseError } from "../domain/errors";

/**
 * Result type for service operations. `ok` discriminates success vs
 * error. Used for synchronous logic; `AsyncResult` is the async version.
 *
 * Every service method that can fail returns `AsyncResult<T>`. The
 * caller MUST check `r.ok` before reading `r.value` — TypeScript
 * narrows correctly because `ok` is a literal boolean.
 */
export type Result<T, E = HouseError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/** Promise of a Result. The async analogue of `Result<T, E>`. */
export type AsyncResult<T, E = HouseError> = Promise<Result<T, E>>;

/**
 * Service health. `not-implemented` is for stubs that are shaped for
 * compile-time but have no runtime yet. `degraded` is for partial
 * failures (e.g. one chain reader down but the rest up).
 */
export const ServiceHealth = {
  Healthy: "healthy",
  Degraded: "degraded",
  Down: "down",
  NotImplemented: "not-implemented",
} as const;
export type ServiceHealth =
  (typeof ServiceHealth)[keyof typeof ServiceHealth];

/**
 * Service info — returned by `health()` on services that have one
 * (`Signer`, `AIHouse`). The version is the service's own schema version
 * (e.g. signer protocol version), not the package version.
 */
export interface ServiceInfo {
  name: string;
  health: ServiceHealth;
  version: string;
  notes?: string;
}

/**
 * Map over a Result's success value. The error path is passed through
 * unchanged. Pure function; no side effects.
 */
export function mapResult<T, U, E>(
  r: Result<T, E>,
  f: (v: T) => U,
): Result<U, E> {
  if (r.ok) return { ok: true, value: f(r.value) };
  return r;
}

/**
 * Async map over a Result. Awaits the AsyncResult, then maps the
 * success value (if any). The error path is passed through unchanged.
 */
export async function mapAsyncResult<T, U, E>(
  r: AsyncResult<T, E>,
  f: (v: T) => U,
): AsyncResult<U, E> {
  const resolved = await r;
  if (resolved.ok) return { ok: true, value: f(resolved.value) };
  return resolved;
}
