import type { BookState, Mark, Position, Lot } from "../domain/book";
import type { AsyncResult } from "./types";

/**
 * A snapshot of a book at a moment in time (plan §7). Stored as the
 * `BookSnapshot` row; used by the drift view (daily mark-to-book-
 * currency, target vs actual weights, drawdown from peak).
 *
 * `weights` maps assetId -> { target, actual } where both are basis-point
 * weights (0..10000). `drawdownBps` is the drawdown from peak at this
 * snapshot, in basis points.
 */
export interface BookSnapshot {
  bookId: string;
  nav: string;
  weights: Record<string, { target: number; actual: number }>;
  drawdownBps: number;
  snapshotAt: Date;
}

/**
 * Book service (plan §6): positions, cost basis, lots, and target
 * weights. This is the persistence + aggregation layer between chain
 * readers / venue adapters (which feed it raw data) and the policy
 * engine (which reads `BookState` snapshots).
 *
 * `appendPosition` / `upsertMark` / `recordLot` are called by chain
 * readers and venue adapters after they pull fresh data. They are NOT
 * called by the AI service or the policy engine.
 *
 * `getBookState` is called by the policy engine at decision time and
 * by the BFF when rendering the audit / drift views.
 */
export interface BookService {
  /** Full in-memory snapshot of a book at decision time. */
  getBookState(bookId: string): AsyncResult<BookState>;
  /** Append a position reported by a chain reader or venue adapter. */
  appendPosition(bookId: string, position: Position): AsyncResult<Position>;
  /** Insert or update a mark (reference or executable). */
  upsertMark(bookId: string, mark: Mark): AsyncResult<Mark>;
  /** Record a new lot (cost-basis entry). Used by fill reconciliation. */
  recordLot(bookId: string, lot: Lot): AsyncResult<Lot>;
  /** Daily mark-to-book-currency snapshot for the drift view. */
  snapshotDaily(bookId: string): AsyncResult<BookSnapshot>;
}

/**
 * Stub implementation. Phase 1 Observe implements this against one CEX +
 * one wallet (plan §13). Until then every method throws not-implemented
 * so callers fail loudly — silent stubs are worse than no stub.
 */
export class BookServiceImpl implements BookService {
  async getBookState(_bookId: string): AsyncResult<BookState> {
    throw new Error(
      "not-implemented: BookService.getBookState (Phase 1 Observe)",
    );
  }

  async appendPosition(
    _bookId: string,
    _position: Position,
  ): AsyncResult<Position> {
    throw new Error(
      "not-implemented: BookService.appendPosition (Phase 1 Observe)",
    );
  }

  async upsertMark(_bookId: string, _mark: Mark): AsyncResult<Mark> {
    throw new Error(
      "not-implemented: BookService.upsertMark (Phase 1 Observe)",
    );
  }

  async recordLot(_bookId: string, _lot: Lot): AsyncResult<Lot> {
    throw new Error(
      "not-implemented: BookService.recordLot (Phase 1 Observe — fill reconciliation in Phase 3 Confirm)",
    );
  }

  async snapshotDaily(_bookId: string): AsyncResult<BookSnapshot> {
    throw new Error(
      "not-implemented: BookService.snapshotDaily (Phase 1 Observe)",
    );
  }
}
