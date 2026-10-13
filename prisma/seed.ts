/**
 * Seed-script for demo-trust (Task 12; utvidet Task 37 — mandate + ethics +
 * decisions + snapshots; Task 42-45 — demo-bruker med bcrypt-hashed
 * passord for NextAuth Credentials login).
 *
 * Kjøres én gang etter `bun run db:push` for å opprette:
 *   - En demo User (epost: trustee@house.local, passord: house-demo)
 *     med bcrypt-hashed passwordHash så Credentials login virker.
 *   - En demo Trust "Smith Family Reserve" (mode: observe)
 *   - En Book på trusten ("Smith Family Reserve — Operating Book")
 *   - Tre Account-rader: "binance" (cex) + "xmagnetic.org" (dex) +
 *     "cold storage" (xrp-wallet) — per eier direction
 *   - Åtte posisjoner med eierens foretrukne default portfolio
 *     (BTC + USDC + FLR + XRP + XLM + RLUSD + USDT + SOL).
 *   - En TrustMember-rad med role=trustee.
 *   - Default MandateVersion (version=1) — moderate risk, dry powder 30%
 *     floor, 1.0x leverage cap. Universet er demo-portfolioens assets.
 *   - Default EthicsListVersion (version=1) — empty hard excludes, all soft
 *     prefs on, all toggles off (per EthicsListSchema defaults).
 *   - 5 sample DecisionLogEntry-rader (1:1 med Intent-rader) som viser
 *     audit-trail: policy-accept / policy-reject / user-approve / filled /
 *     expired. Realistiske timestamps spredd over siste 7 dager.
 *   - 7 BookSnapshot-rader (én per dag siste 7 dager) med NAV fra ~$245k til
 *     ~$251.5k, weights per asset, lav drawdown (200-800 bps).
 *
 * Per eier direction: "Now I want FLR, XRP, XLM and RLUSD & Tether
 * (Stable coin) on as default I'm not interested in ETH, ARB, Doge.
 * On the Exchange circumference I want Binance (As is for CEX), I want
 * the https://xmagnetic.org/ as DEX and 'Cold Storage' Not Ledger as
 * self custody wallet"
 *
 * Self-contained: bruker PrismaClient direkte (ikke trust-service) så
 * scriptet kan kjøres uavhengig av Bun's path-alias-støtte. Domain-
 * schemavalidering gjøres inline med MandateSchema.parse() / EthicsListSchema.parse()
 * så seed-dataene er garantert form-korrekte.
 *
 * Idempotent (Task 42-45): hvis demo-brukeren allerede eksisterer MED en
 * passwordHash, overskriver seeden den ikke (v1 demo-brukeren med
 * passord er endepunktet for Credentials login). Hvis brukeren finnes
 * men mangler passwordHash (gammel seed fra Task 12), oppdaterer seeden
 * passwordHash med et friskt bcrypt-hash av `house-demo`. Hvis trusten
 * allerede eksisterer for brukeren, skriver seeden "Demo trust already
 * exists" og avslutter uten å skrive mer.
 *
 * Kjøring:
 *   bun prisma/seed.ts
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  MandateSchema,
  mandateSummary,
} from "../src/server/domain/mandate";
import { EthicsListSchema } from "../src/server/domain/ethics";

const db = new PrismaClient();

const DEMO_TRUSTEE_EMAIL = "trustee@house.local";
const DEMO_TRUSTEE_PASSWORD = "house-demo";
const DEMO_TRUST_NAME = "Smith Family Reserve";

/** bcrypt cost factor for the demo-seed password hash. Mirrors
 * `src/app/api/auth/register/route.ts` (BCRYPT_ROUNDS) so the demo
 * user authenticates via the same Credentials authorize callback. */
const SEED_BCRYPT_ROUNDS = 10;

/**
 * Default portfolio (per eier direction):
 *   - CEX (binance):        BTC + USDC   — blue-chip + dry powder for trading
 *   - DEX (xmagnetic.org):  FLR + XRP    — XRPL ecosystem L1s, DEX-traded
 *   - XRP-wallet (cold storage): XLM + RLUSD + USDT + SOL
 *     — stable dry powder + L1 held in self-custody
 *
 * Mangler fra gammel seed: ETH, ARB, DOGE (per eier "not interested").
 */
const DEMO_POSITIONS = [
  // CEX (binance) — blue-chip + USDC for trading
  { assetId: "BTC", quantity: "1.2", venue: "binance", venueKind: "cex" as const, entryPrice: "60000" },
  { assetId: "USDC", quantity: "75000", venue: "binance", venueKind: "cex" as const },
  // DEX (xmagnetic.org) — XRPL ecosystem L1s, DEX-traded
  { assetId: "FLR", quantity: "50000", venue: "xmagnetic.org", venueKind: "dex" as const, entryPrice: "0.020" },
  { assetId: "XRP", quantity: "10000", venue: "xmagnetic.org", venueKind: "dex" as const, entryPrice: "2.30" },
  // XRP-wallet (cold storage) — self-custody of XRP-ecosystem + stablecoins
  { assetId: "XLM", quantity: "50000", venue: "cold storage", venueKind: "xrp-wallet" as const, entryPrice: "0.35" },
  { assetId: "RLUSD", quantity: "25000", venue: "cold storage", venueKind: "xrp-wallet" as const },
  { assetId: "USDT", quantity: "25000", venue: "cold storage", venueKind: "xrp-wallet" as const },
  { assetId: "SOL", quantity: "100", venue: "cold storage", venueKind: "xrp-wallet" as const, entryPrice: "130" },
] as const;

// ---------------------------------------------------------------------------
// Default mandate + ethics — per Task 37 spec.
// ---------------------------------------------------------------------------

/** Demo-portfolioens asset-univers (i mandate.universe). */
const DEMO_UNIVERSE = [
  "BTC",
  "USDC",
  "FLR",
  "XRP",
  "XLM",
  "RLUSD",
  "USDT",
  "SOL",
];

/**
 * Default mandate — moderate risk per src/server/domain/mandate.ts
 * MandateSchema.parse({}):
 *   - objective: "max-return-after-costs-vol-dd"
 *   - riskBudget: maxSingleAssetWeightBps=4000, maxStablecoinFloorBps=3000,
 *     maxVenueConcentrationBps=5000, maxPortfolioDrawdownBps=2500,
 *     leverageCap=1.0
 *   - allowedActions: ["hold", "rebalance-spot", "stake", "unstake"]
 *   - optInSleeves: { lending: false, lp: false }
 *   - bookCurrency: "USDC"
 *   - universe: demo-portfolio assets
 */
const DEMO_MANDATE_PAYLOAD = MandateSchema.parse({
  objective: "max-return-after-costs-vol-dd",
  riskBudget: {
    maxSingleAssetWeightBps: 4000,
    maxStablecoinFloorBps: 3000,
    maxVenueConcentrationBps: 5000,
    maxPortfolioDrawdownBps: 2500,
    leverageCap: 1.0,
  },
  allowedActions: ["hold", "rebalance-spot", "stake", "unstake"],
  optInSleeves: { lending: false, lp: false },
  bookCurrency: "USDC",
  universe: DEMO_UNIVERSE,
  version: 1,
});

const DEMO_MANDATE_SUMMARY =
  "Initial mandate — moderate risk, dry powder 30% floor, 1.0x leverage cap";

/**
 * Default ethics-list — per EthicsListSchema defaults:
 *   - hardExclude: empty lists (trustee can add later)
 *   - softPrefer: all true
 *   - toggles: all false (default off)
 */
const DEMO_ETHICS_PAYLOAD = EthicsListSchema.parse({
  hardExclude: {
    sanctionedAddresses: [],
    knownMixers: [],
    unverifiedContracts: [],
    userBlockedAssets: [],
  },
  softPrefer: {
    preferLiquidity: true,
    preferPublishedSupply: true,
    preferWithdrawalHistory: true,
  },
  toggles: {
    privacyCoins: false,
    gamblingTokens: false,
    memeSleeves: false,
  },
  version: 1,
});

// ---------------------------------------------------------------------------
// Sample decisions (5) + matching Intent-rader (5) — Task 37.
// ---------------------------------------------------------------------------

/**
 * Shape for a sample decision. Hver entry trenger en Intent-rad først;
 * context + fill JSON-blobs bygges inline.
 */
interface SampleDecision {
  intent: {
    assetId: string;
    side: "buy" | "sell" | "stake" | "unstake" | "transfer-to-stables";
    venue: string;
    notional: string;
    maxSlippageBps: number;
    reasonCode:
      | "drift-rebalance"
      | "drawdown-de-risk"
      | "scheduled-rebalance"
      | "ai-proposal"
      | "user-approve";
    origin: "rules" | "ai" | "user";
    status:
      | "pending"
      | "policy-rejected"
      | "user-rejected"
      | "signed"
      | "filled"
      | "expired"
      | "kill-switched";
  };
  decision: {
    kind:
      | "policy-reject"
      | "policy-accept"
      | "user-approve"
      | "user-reject"
      | "signer-error"
      | "filled"
      | "expired"
      | "kill-switched";
    context: Record<string, unknown>;
    fill?: { price: string; fee: string; slippageBps: number; quantity: string; venue: string; filledAt: string };
    signatureId?: string;
    ageDays: number;
  };
}

/**
 * Fem sample-beslutninger spredd over siste 7 dager (Task 37 spec):
 *   1. policy-accept — drift rebalance BTC→stables accepted (drift was 8% over target).
 *   2. policy-reject — leverage intent rejected (would exceed 1.0x cap).
 *   3. user-approve  — user approved scheduled rebalance.
 *   4. filled        — rebalance filled: sold 0.1 BTC, bought 6000 USDC.
 *   5. expired       — intent expired before execution.
 */
const SAMPLE_DECISIONS: SampleDecision[] = [
  {
    intent: {
      assetId: "BTC",
      side: "sell",
      venue: "binance",
      notional: "6000",
      maxSlippageBps: 50,
      reasonCode: "drift-rebalance",
      origin: "rules",
      status: "signed",
    },
    decision: {
      kind: "policy-accept",
      context: {
        universe: "ok",
        ethics: "ok",
        concentration: {
          beforeBps: 4200,
          afterBps: 3800,
          capBps: 4000,
          verdict: "allow",
        },
        drawdown: { bps: 350, capBps: 2500, verdict: "allow" },
        leverage: { afterCap: 1.0, verdict: "allow" },
        venueHealth: { venue: "binance", healthy: true, verdict: "allow" },
        verdict: "allow",
        reason: "Drift rebalance BTC→stables accepted (drift was 8% over target).",
      },
      signatureId: "sig_demo_001",
      ageDays: 6,
    },
  },
  {
    intent: {
      assetId: "BTC",
      side: "buy",
      venue: "binance",
      notional: "30000",
      maxSlippageBps: 75,
      reasonCode: "ai-proposal",
      origin: "ai",
      status: "policy-rejected",
    },
    decision: {
      kind: "policy-reject",
      context: {
        universe: "ok",
        ethics: "ok",
        concentration: { verdict: "skip" },
        leverage: {
          currentCap: 1.0,
          proposedCap: 1.12,
          capBps: 10000,
          verdict: "reject",
        },
        verdict: "reject",
        reason: "Leverage intent rejected (leverage would exceed 1.0x cap).",
      },
      ageDays: 5,
    },
  },
  {
    intent: {
      assetId: "USDC",
      side: "buy",
      venue: "binance",
      notional: "4000",
      maxSlippageBps: 30,
      reasonCode: "scheduled-rebalance",
      origin: "rules",
      status: "signed",
    },
    decision: {
      kind: "user-approve",
      context: {
        universe: "ok",
        ethics: "ok",
        concentration: { verdict: "allow" },
        leverage: { verdict: "allow" },
        verdict: "allow",
        reason: "User approved scheduled rebalance.",
      },
      signatureId: "sig_demo_003",
      ageDays: 4,
    },
  },
  {
    intent: {
      assetId: "BTC",
      side: "sell",
      venue: "binance",
      notional: "6000",
      maxSlippageBps: 50,
      reasonCode: "drift-rebalance",
      origin: "rules",
      status: "filled",
    },
    decision: {
      kind: "filled",
      context: {
        universe: "ok",
        verdict: "allow",
        reason: "Rebalance filled: sold 0.1 BTC, bought 6000 USDC.",
      },
      fill: {
        price: "60000.00",
        fee: "6.00",
        slippageBps: 18,
        quantity: "0.1",
        venue: "binance",
        filledAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      },
      signatureId: "sig_demo_004",
      ageDays: 3,
    },
  },
  {
    intent: {
      assetId: "SOL",
      side: "stake",
      venue: "cold storage",
      notional: "5000",
      maxSlippageBps: 100,
      reasonCode: "ai-proposal",
      origin: "ai",
      status: "expired",
    },
    decision: {
      kind: "expired",
      context: {
        universe: "ok",
        verdict: "expired",
        reason: "Intent expired before execution.",
      },
      ageDays: 1,
    },
  },
];

// ---------------------------------------------------------------------------
// NAV snapshots — 7 rader, én per dag siste 7 dager (Task 37 spec).
// ---------------------------------------------------------------------------

/**
 * 7 sample-snapshots. NAV starter ~$245k for 7 dager siden, øker gradvis
 * til ~$251.5k i dag. weights = JSON-blob med per-asset vekter (stabile
 * +/- små justeringer fordi rebalances i sample-decisions flytter litt
 * verdi). drawdownBps = lav (200-800, under cap på 2500).
 *
 * v0: hardkodete verdier basert på demo-positions + reference-priser. Ikke
 * generert dynamisk fordi seeden skal være deterministisk (replay-verdi).
 */
const SAMPLE_SNAPSHOTS: Array<{
  nav: string;
  weights: Record<string, number>;
  drawdownBps: number;
  ageDays: number;
}> = [
  {
    nav: "245000.00",
    weights: {
      BTC: 2939,
      USDC: 3061,
      FLR: 41,
      XRP: 94,
      XLM: 71,
      RLUSD: 102,
      USDT: 102,
      SOL: 5310,
    },
    drawdownBps: 200,
    ageDays: 6,
  },
  {
    nav: "246500.00",
    weights: {
      BTC: 2921,
      USDC: 3044,
      FLR: 41,
      XRP: 94,
      XLM: 71,
      RLUSD: 102,
      USDT: 102,
      SOL: 3625,
    },
    drawdownBps: 150,
    ageDays: 5,
  },
  {
    nav: "247200.00",
    weights: {
      BTC: 2913,
      USDC: 3036,
      FLR: 41,
      XRP: 93,
      XLM: 71,
      RLUSD: 101,
      USDT: 101,
      SOL: 3644,
    },
    drawdownBps: 350,
    ageDays: 4,
  },
  {
    nav: "249000.00",
    weights: {
      BTC: 2892,
      USDC: 3014,
      FLR: 40,
      XRP: 92,
      XLM: 70,
      RLUSD: 100,
      USDT: 100,
      SOL: 3692,
    },
    drawdownBps: 800,
    ageDays: 3,
  },
  {
    nav: "250100.00",
    weights: {
      BTC: 2879,
      USDC: 3022,
      FLR: 40,
      XRP: 92,
      XLM: 70,
      RLUSD: 100,
      USDT: 100,
      SOL: 3697,
    },
    drawdownBps: 600,
    ageDays: 2,
  },
  {
    nav: "251000.00",
    weights: {
      BTC: 2870,
      USDC: 3011,
      FLR: 40,
      XRP: 92,
      XLM: 70,
      RLUSD: 100,
      USDT: 100,
      SOL: 3717,
    },
    drawdownBps: 400,
    ageDays: 1,
  },
  {
    nav: "251500.00",
    weights: {
      BTC: 2864,
      USDC: 3005,
      FLR: 40,
      XRP: 92,
      XLM: 70,
      RLUSD: 100,
      USDT: 100,
      SOL: 3729,
    },
    drawdownBps: 200,
    ageDays: 0,
  },
];

/**
 * Hjelpefunksjon: generer en ISO-timestamp for "N dager siden, kl 12:00 UTC".
 * Brukes for å spre sample-decisions + snapshots jevnt over siste 7 dager
 * (ikke midnatt — da er datogrenser ikkje deterministiske på tideg i UTC).
 */
function daysAgoAtNoon(daysAgo: number): Date {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d;
}

async function main(): Promise<void> {
  // 1. Upsert demo user (idempotent). Task 42-45: legger til passwordHash
  //    så Credentials login virker. Hvis brukeren allerede eksisterer uten
  //    passwordHash (gammel seed fra Task 12), oppdaterer vi feltet med et
  //    friskt bcrypt-hash. Hvis den allerede har et hash, rører vi det ikke.
  const existingUser = await db.user.findUnique({
    where: { email: DEMO_TRUSTEE_EMAIL },
    select: { id: true, passwordHash: true },
  });
  let user: { id: string; email: string; name: string | null };
  if (!existingUser) {
    user = await db.user.create({
      data: {
        email: DEMO_TRUSTEE_EMAIL,
        name: "Demo Trustee",
        role: "owner",
        passwordHash: await bcrypt.hash(DEMO_TRUSTEE_PASSWORD, SEED_BCRYPT_ROUNDS),
      },
      select: { id: true, email: true, name: true },
    });
    console.log(
      `[seed] User created: ${user.email} (${user.id}) — password hash set`,
    );
  } else if (!existingUser.passwordHash) {
    user = await db.user.update({
      where: { id: existingUser.id },
      data: {
        name: "Demo Trustee",
        passwordHash: await bcrypt.hash(DEMO_TRUSTEE_PASSWORD, SEED_BCRYPT_ROUNDS),
      },
      select: { id: true, email: true, name: true },
    });
    console.log(
      `[seed] User updated: ${user.email} (${user.id}) — password hash added`,
    );
  } else {
    user = await db.user.findUniqueOrThrow({
      where: { email: DEMO_TRUSTEE_EMAIL },
      select: { id: true, email: true, name: true },
    });
    console.log(
      `[seed] User ok: ${user.email} (${user.id}) — password hash already set`,
    );
  }

  // 2. Check if demo trust exists; if so, exit idempotently.
  const existing = await db.trust.findFirst({
    where: { trusteeId: user.id },
    include: { books: { include: { positions: true, accounts: true } } },
  });
  if (existing) {
    console.log(
      `[seed] Demo trust already exists: ${existing.name} (${existing.id}) — mode=${existing.mode}, books=${existing.books.length}, positions=${existing.books[0]?.positions.length ?? 0}`,
    );
    return;
  }

  // 3. Create trust + book + accounts + positions + mandate + ethics +
  //    decisions + snapshots in one transaction.
  const result = await db.$transaction(async (tx) => {
    // Trust
    const trust = await tx.trust.create({
      data: {
        name: DEMO_TRUST_NAME,
        trusteeId: user.id,
        mode: "observe",
      },
    });
    console.log(`[seed] Trust created: ${trust.name} (${trust.id})`);

    // Book on the trust
    const book = await tx.book.create({
      data: {
        ownerId: user.id,
        name: `${DEMO_TRUST_NAME} — Operating Book`,
        bookCurrency: "USDC",
        mode: "observe",
        trustId: trust.id,
      },
    });
    console.log(`[seed] Book created: ${book.name} (${book.id})`);

    // Account per unique (venue, venueKind)
    const accountIds: Record<string, string> = {};
    type DemoVenueKind = (typeof DEMO_POSITIONS)[number]["venueKind"];
    const uniqueVenues = Array.from(
      new Set(DEMO_POSITIONS.map((p) => `${p.venueKind}::${p.venue}`)),
    ).map((key) => {
      const [venueKind, venue] = key.split("::");
      return { venue, venueKind: venueKind as DemoVenueKind };
    });
    for (const v of uniqueVenues) {
      const acct = await tx.account.create({
        data: {
          bookId: book.id,
          kind: v.venueKind,
          venue: v.venue,
          ref: `${v.venueKind}-placeholder-${v.venue}`,
          keyScope: "read",
          withdrawAllow: "[]",
          active: true,
        },
      });
      accountIds[`${v.venueKind}::${v.venue}`] = acct.id;
      console.log(`[seed] Account created: ${v.venueKind}/${v.venue} (${acct.id})`);
    }

    // Positions
    for (const p of DEMO_POSITIONS) {
      // Source by venueKind — same logic as TrustService.sourceForVenueKind.
      let source = "rpc-balance";
      if (p.venueKind === "cex") source = "cex-balance";
      else if (p.venueKind === "dex") source = "dex-balance";
      else if (p.venueKind === "stake-defi") source = "staking-contract";
      // evm/solana/xrp-wallet → "rpc-balance" (default)
      // Confidence: high for cex + wallets; medium for stake-defi + dex.
      const confidence =
        p.venueKind === "stake-defi" || p.venueKind === "dex"
          ? "medium"
          : "high";
      const pos = await tx.position.create({
        data: {
          bookId: book.id,
          accountId: accountIds[`${p.venueKind}::${p.venue}`],
          assetId: p.assetId,
          state: "free",
          quantity: p.quantity,
          source,
          confidence,
          asOf: new Date(),
        },
      });
      console.log(
        `[seed] Position created: ${p.assetId} qty=${p.quantity} on ${p.venue} (${pos.id})`,
      );
    }

    // Trustee member row
    const member = await tx.trustMember.create({
      data: {
        trustId: trust.id,
        userId: user.id,
        role: "trustee",
      },
    });
    console.log(`[seed] TrustMember created: role=trustee (${member.id})`);

    // --- Task 37: default mandate + ethics + decisions + snapshots ---

    // Default MandateVersion (version=1, immutable).
    const mandate = await tx.mandateVersion.create({
      data: {
        bookId: book.id,
        version: 1,
        payload: JSON.stringify(DEMO_MANDATE_PAYLOAD),
        summary: DEMO_MANDATE_SUMMARY,
        createdBy: user.id,
      },
    });
    console.log(
      `[seed] MandateVersion created: v${mandate.version} (${mandate.id}) — ${mandateSummary(DEMO_MANDATE_PAYLOAD)}`,
    );

    // Default EthicsListVersion (version=1, immutable).
    const ethics = await tx.ethicsListVersion.create({
      data: {
        bookId: book.id,
        version: 1,
        payload: JSON.stringify(DEMO_ETHICS_PAYLOAD),
        createdBy: user.id,
      },
    });
    console.log(
      `[seed] EthicsListVersion created: v${ethics.version} (${ethics.id})`,
    );

    // Sample decisions + matching Intent-rader (5).
    for (const sd of SAMPLE_DECISIONS) {
      const expiresAt = new Date(
        daysAgoAtNoon(sd.decision.ageDays).getTime() + 60 * 60 * 1000,
      );
      const createdAt = daysAgoAtNoon(sd.decision.ageDays);
      const intent = await tx.intent.create({
        data: {
          bookId: book.id,
          clientId: `seed-${sd.decision.kind}-${sd.decision.ageDays}d-${sd.intent.assetId}-${sd.intent.side}`,
          assetId: sd.intent.assetId,
          side: sd.intent.side,
          venue: sd.intent.venue,
          notional: sd.intent.notional,
          maxSlippageBps: sd.intent.maxSlippageBps,
          expiresAt,
          reasonCode: sd.intent.reasonCode,
          origin: sd.intent.origin,
          status: sd.intent.status,
          createdAt,
          updatedAt: createdAt,
        },
      });
      const decision = await tx.decisionLogEntry.create({
        data: {
          bookId: book.id,
          intentId: intent.id,
          kind: sd.decision.kind,
          context: JSON.stringify(sd.decision.context),
          signatureId: sd.decision.signatureId ?? null,
          fill: sd.decision.fill ? JSON.stringify(sd.decision.fill) : null,
          createdAt,
        },
      });
      console.log(
        `[seed] DecisionLogEntry created: kind=${decision.kind} (intent ${intent.id})`,
      );
    }

    // Sample BookSnapshots (7, én per dag siste 7 dager).
    for (const snap of SAMPLE_SNAPSHOTS) {
      const snapshotAt = daysAgoAtNoon(snap.ageDays);
      const created = await tx.bookSnapshot.create({
        data: {
          bookId: book.id,
          nav: snap.nav,
          weights: JSON.stringify(snap.weights),
          drawdownBps: snap.drawdownBps,
          snapshotAt,
        },
      });
      console.log(
        `[seed] BookSnapshot created: nav=${created.nav} drawdownBps=${created.drawdownBps} @ ${created.snapshotAt.toISOString()}`,
      );
    }

    return { trust, book };
  });

  console.log(
    `[seed] Done. Trust ${result.trust.id} (mode=${result.trust.mode}); book ${result.book.id}.`,
  );
}

main()
  .catch((err) => {
    console.error("[seed] Failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
