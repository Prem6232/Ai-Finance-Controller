# AI Finance Controller

Production-grade AI-powered financial reconciliation engine built for **Track 04: AI Finance Controller** hackathon.

## Architecture

```
┌─────────────────────────────────────────────┐
│           Next.js Dashboard UI              │
│  (Metrics · Audit Table · Detail Modal)     │
├─────────────────────────────────────────────┤
│              API Route                      │
│           POST /api/reconcile               │
├─────────────────────────────────────────────┤
│        3-Layer Reconciliation Engine        │
│                                             │
│  Layer 1: Deterministic (O(1) Map lookup)   │
│  Layer 2: Gemini AI (structured JSON)       │
│  Layer 3: Exception Logger                  │
├─────────────────────────────────────────────┤
│     Synthetic Dataset (60 records)          │
│  60% Exact · 25% Fuzzy · 15% Exceptions    │
└─────────────────────────────────────────────┘
```

## Tech Stack

- **Frontend**: Next.js 14 (App Router), Tailwind CSS, Lucide Icons
- **Backend**: Next.js API Routes
- **AI**: Google Gemini 2.0 Flash via `@google/genai` SDK with structured JSON output
- **Language**: TypeScript

## Quick Start

### 1. Install dependencies
```bash
cd ai-finance-controller
npm install
```

### 2. Set up environment
```bash
cp .env.example .env.local
# Edit .env.local and add your Gemini API key
```

### 3. Generate synthetic dataset (optional — already included)
```bash
npx tsx scripts/generate_dataset.ts
```

### 4. Run development server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and click **"Run 60-Record Batch Simulation"**.

## How It Works

### Layer 1: Deterministic Engine
- Builds an O(1) `Map<txId, Transaction>` lookup from bank records
- Instantly clears exact `txId + amount` matches — **no AI API calls**
- Typically resolves ~60% of records in <1ms

### Layer 2: AI Exception Agent
- Remaining unmatched items are batched and sent to **Gemini 2.0 Flash**
- Uses `responseSchema` to enforce structured JSON output:
  ```json
  {
    "isMatch": true,
    "confidenceScore": 0.87,
    "feeDeduction": 1234.56,
    "matchReason": "Transaction IDs match. Amount difference of 2.1% consistent with payment gateway fee deduction."
  }
  ```
- Matches with confidence ≥ 0.70 are accepted as AI-Verified

### Layer 3: Exception Logger
- Items below 0.70 confidence or missing a counterpart are flagged
- Exception codes: `UNLINKED_DEBIT`, `EXCESSIVE_VARIANCE`, `MEMO_MISMATCH`, `DUPLICATE_DEBIT`, `MISSING_BANK_ENTRY`

## Dataset Structure

Each record follows this schema:
```typescript
interface Transaction {
  txId: string;       // e.g., "TXN-1001"
  amount: number;     // e.g., 15234.50
  timestamp: string;  // ISO-8601
  memo: string;       // e.g., "Invoice #1001 - Acme Corp"
  source: "ledger" | "bank";
}
```

## Project Structure

```
ai-finance-controller/
├── scripts/
│   └── generate_dataset.ts    # Synthetic data generator
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── reconcile/route.ts   # POST — run reconciliation
│   │   │   └── datasets/route.ts    # GET — preview datasets
│   │   ├── globals.css              # Design system
│   │   ├── layout.tsx               # Root layout
│   │   └── page.tsx                 # Dashboard UI
│   ├── data/
│   │   ├── ledger.json              # Generated ledger records
│   │   └── bank.json                # Generated bank records
│   └── lib/
│       ├── types.ts                 # TypeScript definitions
│       ├── gemini-client.ts         # Gemini API wrapper
│       └── reconciliation-service.ts # 3-layer engine
├── .env.example
└── README.md
```
