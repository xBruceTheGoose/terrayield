# TerraYield: Autonomous Eco-Arbitrage Middleware for Solana

AI-driven Solana DeFi routing middleware that balances yield maximization with automated climate action.

Built for:
- 🏆 **DoraHacks "Build for Good 2026"** — Web3 Public Goods & AI for Social Good
- 🌍 **IEEE ClimateChain Global Hackathon** — AI & Blockchain for Carbon Markets
- ⚡ **Solana Developer Hackathon** — High-Performance DeFi & Solana Blinks

---

## Architecture

```
┌─────────────────┐       ┌────────────────────┐       ┌────────────────────────┐       ┌──────────────────────┐
│  Client / Blink │──────▶│ Next.js API Routes │──────▶│   NVIDIA NIM Engine    │──────▶│   ExecutionRouter    │
│  (Dialect / UI) │       │ /api/actions/      │       │ (meta/llama-3.1-70b-   │       │                      │
└─────────────────┘       │   terrayield       │       │        instruct)       │       └──────────┬───────────┘
         │                └────────────────────┘       └────────────────────────┘                  │
         │                          │                               │                              │
         ▼                          ▼                               ▼                              ▼
   actions.json               Solana Actions               Strict JSON Mode              Harness-Agnostic
 (Dialect Spec)              CORS + Serialization            Zod Validation             Mock & Web3 Adapters
```

---

## Features

- **NVIDIA NIM Integration**: Powered by `meta/llama-3.1-70b-instruct` via OpenAI SDK with strict JSON mode (`response_format: { type: "json_object" }`).
- **Resilient AI Parser**: Automatically repairs markdown-wrapped blocks, missing UUID placeholders (`<uuid>`), and reconciles floating-point balances.
- **Fail-Safe Offline Simulation**: Automatic deterministic fallback if NVIDIA API key is not configured or network drops during a live demo.
- **100% Principal Protection**: 100% of user capital is routed directly into optimal yield positions; carbon offsets are financed strictly through a pre-committed percentage of earned yield upon withdrawal.
- **Interactive Carbon Footprint Calculator**: Lifestyle presets (Low Impact, Average Citizen, Frequent Traveler, Custom) and activity sliders (flights, commuting miles, home energy) computing exact tokenized carbon credit requirements at `$0.02 / kg CO₂` (`$20 / metric ton`).
- **Real-Time Solana Yield Oracle**: Live read-only oracle feeds (`/api/apys`) querying real-time rates across Kamino, Drift, Marginfi, and Solend/Save with automatic single-vault or 70/30 diversified position routing.
- **Solana Actions & Blinks Compliant**:
  - Full CORS headers (`ACTIONS_CORS_HEADERS`) on `OPTIONS`, `GET`, and `POST`.
  - Domain discovery via `/actions.json`.
  - Shareable `solana-action:` URIs and Dialect `dial.to` inspector integration.
  - Multi-instruction serialized Solana transaction generation with on-chain pre-commitment memo and tokenized carbon credit mint (`CarbCreditNCT111111111111111111111111111111`).
- **Flexible Execution Hub**:
  - Direct wallet connection (Phantom, Solflare, or instant Solana Devnet Signer).
  - 1-click Solana Blink submission (`POST /api/actions/terrayield`).
  - No raw bytecode clutter — clean human-readable transaction receipts.
- **Harness-Agnostic Execution Layer**: Clean `ExecutionAdapter` interface with:
  - `MockExecutionAdapter`: Zero-dependency testing with simulated latency and realistic signatures.
  - `SolanaWeb3Adapter`: Raw `@solana/web3.js` transaction builder for on-chain execution.
- **Dedicated About & Architecture Guide**: Accessible walkthrough at `/about` explaining zero-loss eco-arbitrage, the 4-step pipeline, and IPFS/decentralized hosting viability.

---

## Project Structure

```
src/
├── adapters/
│   ├── execution-adapter.ts    # ExecutionAdapter interface + ExecutionRouter
│   ├── mock-adapter.ts         # MockExecutionAdapter for local simulation
│   └── solana-adapter.ts       # SolanaWeb3Adapter using raw @solana/web3.js
├── schemas/
│   └── terrayield.ts           # Zod schemas for input/output validation
├── services/
│   ├── nim-service.ts          # NVIDIA NIM integration with error handling & repair
│   └── apy-service.ts          # Real-time Solana APY oracle & caching layer
└── app/
    ├── actions.json/
    │   └── route.ts            # Solana Actions discovery mapping
    ├── api/
    │   ├── actions/terrayield/
    │   │   └── route.ts        # Solana Actions endpoint (OPTIONS / GET / POST)
    │   └── apys/
    │       └── route.ts        # Real-time protocol APY oracle endpoint (GET)
    ├── about/
    │   └── page.tsx            # Accessible About & Architecture Guide
    ├── page.tsx                # Interactive TerraYield Demo Dashboard
    ├── layout.tsx
    └── globals.css
scripts/
├── run-tests.js                # Test runner
└── test-suite.ts               # Unit & integration tests
```

---

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Edit `.env.local` with your NVIDIA API key (or leave as placeholder to use deterministic simulation mode):
```env
NVIDIA_API_KEY=nvapi-...
```
Get a key at: https://build.nvidia.com/explore/discover

### 3. Run Automated Tests

Verify all schemas, NIM response parsers, and execution adapters:

```bash
npm test
```

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the interactive dashboard.

### 5. Test Solana Actions API

```bash
# Test GET (Blink metadata)
curl -X GET http://localhost:3000/api/actions/terrayield

# Test POST (Execute simulation with pre-committed % yield offset)
curl -X POST http://localhost:3000/api/actions/terrayield \
  -H "Content-Type: application/json" \
  -d '{
    "total_liquidity": 1000,
    "offset_yield_percent": 25,
    "timeframe_months": 1
  }'
```

---

## Solana Blink Integration

The API implements the [Solana Actions specification](https://github.com/solana-foundation/solana-actions):

- **GET** `/actions.json` — Domain mapping rules
- **OPTIONS** `/api/actions/terrayield` — Preflight CORS headers
- **GET** `/api/actions/terrayield` — Returns action metadata for Blink rendering
- **POST** `/api/actions/terrayield` — Executes routing logic and returns serialized transaction or execution report

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `total_liquidity` | number | Yes | Total USDC available (default: 500) |
| `offset_yield_percent` | number | No | Pre-committed % of subsequent withdrawal's yield for carbon offset (0-100%, default: 25) |
| `timeframe_months` | number | No | Yield accrual simulation timeframe in months (default: 1) |
| `offset_obligation` | number | No | Legacy upfront offset deduction in USD (optional backward compatibility) |
| `apys` | array / string | No | Optional custom APY list (defaults to live cached oracle) |

---

## License

MIT
