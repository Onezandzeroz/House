import type { Confidence } from "../domain/book";
import type { AsyncResult } from "./types";

/** A single EVM balance read returned by a chain reader. */
export interface EvmBalance {
  assetId: string;
  quantity: string;
  confidence: Confidence;
}

/** A single Solana balance read returned by a chain reader. */
export interface SolanaBalance {
  assetId: string;
  quantity: string;
  confidence: Confidence;
}

/**
 * Chain reader (plan §6): Alchemy or QuickNode for EVM balances and
 * logs; Helius if Solana is in the first chain set. Wallet portfolio
 * enrichment from CoinStats, GoldRush, or DeBank where it saves indexer
 * work.
 *
 * Provider-agnostic: a different provider can be swapped per chain when
 * a real book needs it. Add chains only when a real book needs them
 * (plan §12 — key sprawl is a documented risk).
 *
 * `readEvmBalance` returns balances with confidence `high` (RPC is the
 * source of truth for an EOA's free balance). `readSolanaBalance` is
 * the same for Solana. Staked / LP / lending positions on either chain
 * are read via the protocol's own contract or indexer; confidence there
 * is `medium`.
 */
export interface ChainReader {
  /**
   * Read all balances held by an EVM address on a specific chain.
   * Includes native + ERC-20 tokens; the reader is responsible for
   * mapping contract addresses to the book's asset ids.
   */
  readEvmBalance(
    chainId: string,
    address: string,
  ): AsyncResult<EvmBalance[]>;

  /** Read all SPL token balances held by a Solana address. */
  readSolanaBalance(address: string): AsyncResult<SolanaBalance[]>;

  /** Provider name (e.g. "alchemy", "helius"). Used in the audit log. */
  name(): string;
}

/**
 * Alchemy chain reader stub. Used for EVM chains (Ethereum, L2s).
 * Provider selection happens per-chain when a real book needs it; do
 * not instantiate until Phase 1 Observe.
 */
export class AlchemyChainReader implements ChainReader {
  async readEvmBalance(
    _chainId: string,
    _address: string,
  ): AsyncResult<EvmBalance[]> {
    throw new Error(
      "not-implemented: AlchemyChainReader.readEvmBalance (Phase 1 Observe)",
    );
  }

  async readSolanaBalance(_address: string): AsyncResult<SolanaBalance[]> {
    throw new Error(
      "not-implemented: AlchemyChainReader.readSolanaBalance (Solana uses Helius, not Alchemy)",
    );
  }

  name(): string {
    return "alchemy";
  }
}

/**
 * Helius chain reader stub. Used for Solana only. EVM reads route to
 * Alchemy instead — keep the providers per-chain to avoid key sprawl
 * (plan §12).
 */
export class HeliusChainReader implements ChainReader {
  async readEvmBalance(
    _chainId: string,
    _address: string,
  ): AsyncResult<EvmBalance[]> {
    throw new Error(
      "not-implemented: HeliusChainReader.readEvmBalance (EVM uses Alchemy, not Helius)",
    );
  }

  async readSolanaBalance(_address: string): AsyncResult<SolanaBalance[]> {
    throw new Error(
      "not-implemented: HeliusChainReader.readSolanaBalance (Phase 1 Observe)",
    );
  }

  name(): string {
    return "helus";
  }
}
