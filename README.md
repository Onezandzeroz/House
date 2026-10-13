# House — Family Reserve

A private bankroll operating system for one crypto-owning family. Semi-automatic by design — observation and policy run continuously, execution is staged. The AI is a later service that proposes intents the policy engine must accept. It never sits on the keys.

## Overview

House answers four questions every day: what is held, what it is worth, whether the current mix still matches the chosen strategy, and what action is allowed next.

### Operating Modes (the ladder)

Every trust has exactly one mode. Moving up requires a fresh confirmation and a tighter permission grant. Moving down is always immediate.

| Mode | What runs | Who signs |
|------|-----------|-----------|
| **Observe** | Balances, prices, PnL, drift vs target | Nobody — read-only keys |
| **Advise** | Policy engine writes proposed book + reason | User executes outside the app |
| **Confirm** | Same proposals, packaged as a batch | User approves each batch |
| **Rules** | Deterministic rebalance when drift/schedule fires | Pre-authorised session key |
| **House** | AI proposes; policy still gates; execution uses same grants | Same as Rules; AI cannot widen the grant |

House mode is **not a second product** — it is Rules mode with the proposal source swapped from a ruleset to the AI. If the AI is down, the account falls back to Rules or Confirm.

### Safety Protocol (the policy gate)

The policy engine is the **only** component allowed to emit an executable intent. It runs 8 checks in order:

1. **kill-switch** — if active, immediately reject
2. **universe** — asset must be in the mandate
3. **ethics** — hard excludes (sanctioned, mixers, unverified contracts)
4. **leverage** — total exposure within cap (1.0x default)
5. **concentration** — single-asset + venue concentration within caps
6. **drawdown** — if drawdown > cap, only transfer-to-stables allowed
7. **daily-turnover** — running turnover within daily cap
8. **venue-health** — venue must be healthy

The signer is **isolated** — the AI service has no IAM path to it. Model output is never executed as text; only the **intent schema** is executable:

```
{ asset, side, venue, notional, maxSlippage, expiry, reasonCode }
```

## Tech Stack

- **Framework**: Next.js 16 with App Router (TypeScript 5)
- **Styling**: Tailwind CSS 4 + shadcn/ui (New York style)
- **Database**: Prisma ORM with SQLite (portable to Postgres)
- **Auth**: NextAuth.js v4 (Credentials provider, JWT sessions)
- **Market Data**: CoinGecko API (live prices with 60s cache, reference-price fallback)
- **Charts**: Recharts + Framer Motion
- **Runtime**: Bun

## Features

### Authentication & Multi-Tenancy
- Email + password authentication via NextAuth.js
- Each user is a trustee of their own trust (isolated data)
- Bcrypt password hashing
- Session-protected API routes (401 if unauthenticated)

### Onboarding (5-page full-screen flow)
1. **Trust details** — name, type (Family Fund / Personal / Investment Club), book currency, description
2. **Trustee information** — full name, email, phone, address
3. **Beneficiaries** — name, email, relationship, reporting level (Full / Summary)
4. **Assets & DeFi positions** — asset, quantity, entry price (non-stables only), venue, DeFi metadata (protocol, position type, APY, lock-end, contract address)
5. **Review & confirm** — summary + pie-chart preview + confirmation

After onboarding: full-screen golden checkmark success animation → lands on Portfolio.

### Portfolio Dashboard
- **3-level multi-level pie chart** (sunburst):
  - Inner ring: 4 risk sleeves (Stable / Conservative / Balanced / Aggressive)
  - Middle ring: individual assets (each with its own brand colour — 18+ colours)
  - Outer ring: venue breakdown (where each asset is custodied)
- **Radial in-slice labels** — text inside each slice, top pointing outward from centre
- **Info cards** around the pie with bent lead-lines (Z-shape connectors)
- **Hover-expand** cards (thumbnail → full detail with framer-motion)
- **Live NAV** from CoinGecko prices (60s cache, reference fallback)
- **Positions table** with entry price + P&L per position
- **KPI strip** — dry powder %, NAV, positions count, AI role

### Advisory Dashboard
- **Regime detection** (Bull / Bear / Ranging / Transitional) with signal evidence
- **Dry powder discipline** — 30% floor, 20% critical, 35% target
- **Sleeve allocation** with drift vs regime-posture target
- **Allocation advice** per asset (add / reduce / hold / exit)
- **Opportunities** and **Warnings** (separated — warnings are things to reject)

### Trustee Tab (AI Control Room)
- **AI operator panel** — "Call upon AI to operate" switch (House mode activation)
- **Mandate countdown** — time-boxed (7 days default), reversible
- **Safety protocol reference** — 8 policy-gate checks + intent schema + mode ladder
- **Kill switch** status display

### Mandate Editor
- Risk budget sliders (max single-asset weight, dry powder floor, venue concentration, drawdown cap, leverage cap)
- Universe editor (add/remove allowed assets)
- Ethics screen editor (hard excludes, soft preferences, toggles)
- Immutable version history (every change creates a new version)

### History
- **NAV history chart** (area chart with emerald gradient)
- **Decision log** — audit trail of accepted/rejected intents with verdict chips
- **Entry/Exit price** column in decision log
- **CSV export** of decision log
- **Take snapshot** button (manual NAV snapshot)

## Getting Started

### Prerequisites
- [Bun](https://bun.sh/) runtime
- Node.js 18+ (for NextAuth.js compatibility)

### Installation

```bash
# Clone the repo
git clone <your-repo-url>
cd house

# Install dependencies
bun install

# Set up environment
cp .env.example .env
# Edit .env — set NEXTAUTH_SECRET to: openssl rand -base64 32

# Push database schema
bun run db:push

# Seed demo data (creates demo user + trust + positions + mandate + decisions + snapshots)
bun prisma/seed.ts
```

### Running

```bash
# Start dev server
bun run dev
```

Open `http://localhost:3000` in your browser.

### Demo Credentials

- **Email**: `trustee@house.local`
- **Password**: `house-demo`

### Default Portfolio

The demo trust "Smith Family Reserve" includes:
- **BTC** 1.2 on Binance (CEX)
- **USDC** 75,000 on Binance (CEX)
- **FLR** 50,000 on XMagnetic (DEX)
- **XRP** 10,000 on XMagnetic (DEX)
- **XLM** 50,000 on Cold Storage (XRP wallet)
- **RLUSD** 25,000 on Cold Storage (XRP wallet)
- **USDT** 25,000 on Cold Storage (XRP wallet)
- **SOL** 100 on Cold Storage (XRP wallet)

## Project Structure

```
├── docs/                          # Architecture documentation
│   ├── non-custody-statement.md  # Phase 0 deliverable
│   ├── mandate.md                 # Mandate reference
│   ├── intent-schema.md          # Intent contract
│   ├── architecture.md           # Service map + data model
│   ├── build-phases.md           # Phase 0–6 build order
│   └── glossary.md               # Terms
├── prisma/
│   ├── schema.prisma             # Database schema (Trust, Book, Position, Lot, Intent, DecisionLog, etc.)
│   └── seed.ts                   # Demo seed script
├── public/                        # Static assets
├── src/
│   ├── app/
│   │   ├── page.tsx               # Main route (auth gate + tabs)
│   │   ├── layout.tsx            # Root layout (fonts, SessionProvider)
│   │   ├── globals.css           # Design system (dark mode, glassmorphism)
│   │   └── api/                  # BFF API routes
│   │       ├── auth/             # NextAuth + register
│   │       ├── trust/            # Trust CRUD + positions + mandate + ethics + decisions + snapshots + mode
│   │       ├── portfolio/        # Portfolio snapshot (3-level hierarchy)
│   │       ├── advisory/         # Advisory opinion (regime + dry powder + allocation)
│   │       └── foundation/       # Foundation status
│   ├── components/
│   │   ├── ui/                   # shadcn/ui component library
│   │   ├── auth/                 # Login/signup modal
│   │   ├── onboarding/           # 5-page multi-page wizard + success overlay
│   │   ├── house/                # Dashboard views (portfolio, trustee, mandate, history)
│   │   ├── portfolio/            # Pie chart + info cards + legend
│   │   └── advisory/             # Regime banner + dry powder + sleeve allocation + warnings
│   ├── server/
│   │   ├── domain/               # Type contracts (Intent, Mandate, Policy, Ethics, Book, etc.)
│   │   ├── services/            # Service interfaces (BookService, MarketService, PolicyEngine, Signer, AIHouse)
│   │   └── lib/                  # CoinGecko client, reference prices, demo book, trust-book adapter
│   ├── lib/
│   │   ├── auth.ts               # NextAuth options
│   │   ├── auth-helpers.ts       # requireAuth() + getAuthUserId()
│   │   ├── db.ts                 # Prisma client
│   │   └── utils.ts              # Shared utilities
│   ├── hooks/                    # use-mobile
│   └── types/                    # next-auth.d.ts (module augmentation)
├── .env.example                  # Environment template
├── .gitignore
├── components.json               # shadcn/ui config
├── eslint.config.mjs
├── next.config.ts
├── package.json
├── postcss.config.mjs
├── tailwind.config.ts
└── tsconfig.json
```

## Key Design Decisions

### Non-Custody
The app **never holds seed phrases**. Trade keys are scoped (read-only for Observe, trade-no-withdraw for Confirm/Rules). The DB stores only a KMS reference, never the secret.

### Immutable Audit Trail
- Mandate versions are immutable rows — a change never overwrites history
- Ethics list versions are immutable — a later decision can be replayed against the list that was live that day
- Decision log is append-only — every accepted or rejected intent is logged

### Dry Powder Discipline
30% of NAV must always be in stablecoins ("dry powder") — ready for a good trade. Below 30% = warning. Below 20% = critical (force de-risk). This mirrors the casino bankroll principle: the House always keeps powder dry.

### Entry Price Tracking
Non-stablecoin assets collect an entry price during onboarding (per-unit cost in book currency). This becomes the cost basis for P&L tracking. Stablecoins are $1.00 by definition — no entry price needed.

## Scripts

```bash
bun run dev        # Start dev server (port 3000)
bun run lint        # ESLint check
bun run db:push     # Push schema to database
bun run db:generate # Regenerate Prisma client
bun prisma/seed.ts  # Seed demo data
```

## License

Private — for family use only.

## Acknowledgements

Built on the construction plan outlined in `docs/build-phases.md`. The plan follows a phased approach (Phase 0–6) from mandate schema through to AI house service, ensuring the policy gate is built before any live order.
