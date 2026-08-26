/**
 * Synthetic Dataset Generator for AI Finance Controller
 *
 * Generates ledger.json and bank.json with 50+ records containing:
 *   60% Exact Matches
 *   25% Fuzzy / Edge-Case Matches
 *   15% Hard Exceptions
 */

import * as fs from "fs";
import * as path from "path";

interface Transaction {
  txId: string;
  amount: number;
  timestamp: string;
  memo: string;
  source: "ledger" | "bank";
}

// ─── Deterministic seeded PRNG ───────────────────────────────────────────────
class SeededRandom {
  private seed: number;
  constructor(seed: number) {
    this.seed = seed;
  }
  next(): number {
    this.seed = (this.seed * 16807 + 0) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  pick<T>(arr: T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }
}

const rng = new SeededRandom(42);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateTxId(index: number): string {
  return `TXN-${String(index).padStart(4, "0")}`;
}

function generateDate(dayOffset: number): string {
  const base = new Date("2026-08-01T09:00:00Z");
  base.setDate(base.getDate() + dayOffset);
  base.setHours(rng.int(8, 18), rng.int(0, 59), rng.int(0, 59));
  return base.toISOString();
}

function roundAmount(n: number): number {
  return Math.round(n * 100) / 100;
}

const vendors = [
  "Acme Corp",
  "CloudVault Inc",
  "DataSync Ltd",
  "Nexus Payments",
  "Orion Services",
  "Pinnacle Tech",
  "Quasar Labs",
  "Redshift IO",
  "Summit Digital",
  "Zenith Solutions",
];

const invoicePrefixes = [
  "Invoice",
  "Inv",
  "INV",
  "Payment for Invoice",
  "Settlement",
];

// ─── Generator ───────────────────────────────────────────────────────────────

const TOTAL = 60;
const EXACT_COUNT = Math.round(TOTAL * 0.6); // 36
const FUZZY_COUNT = Math.round(TOTAL * 0.25); // 15
const EXCEPTION_COUNT = TOTAL - EXACT_COUNT - FUZZY_COUNT; // 9

const ledger: Transaction[] = [];
const bank: Transaction[] = [];

let txIndex = 1001;

// ──── Category 1: Exact Matches (60%) ────────────────────────────────────────
for (let i = 0; i < EXACT_COUNT; i++) {
  const txId = generateTxId(txIndex++);
  const amount = roundAmount(rng.int(500, 250000) + rng.next());
  const date = generateDate(rng.int(0, 25));
  const vendor = rng.pick(vendors);
  const memo = `${rng.pick(invoicePrefixes)} #${txIndex - 1} - ${vendor}`;

  ledger.push({ txId, amount, timestamp: date, memo, source: "ledger" });
  bank.push({ txId, amount, timestamp: date, memo, source: "bank" });
}

// ──── Category 2: Fuzzy / Edge-Case Matches (25%) ───────────────────────────
const fuzzyMemoTransforms: Array<
  (memo: string, vendor: string, invNum: number) => [string, string]
> = [
  // Memo wording difference
  (_m, vendor, inv) => [
    `Invoice #${inv} Payout - ${vendor}`,
    `Razorpay Settlement Inv #${inv} ${vendor}`,
  ],
  (_m, vendor, inv) => [
    `Payment #${inv} to ${vendor}`,
    `NEFT Transfer Ref#${inv} ${vendor}`,
  ],
  (_m, vendor, inv) => [
    `${vendor} - Monthly Retainer #${inv}`,
    `${vendor} Retainer Payment ${inv}`,
  ],
  (_m, vendor, inv) => [
    `Service Fee Invoice ${inv} ${vendor}`,
    `Bank Transfer - Svc Fee #${inv} (${vendor})`,
  ],
  (_m, vendor, inv) => [
    `${vendor} Q3 Settlement #${inv}`,
    `Quarterly Payout ${inv} - ${vendor}`,
  ],
];

for (let i = 0; i < FUZZY_COUNT; i++) {
  const txId = generateTxId(txIndex);
  const baseAmount = roundAmount(rng.int(1000, 500000) + rng.next());
  const date = generateDate(rng.int(0, 25));
  const vendor = rng.pick(vendors);
  const invNum = txIndex;
  txIndex++;

  const transform = rng.pick(fuzzyMemoTransforms);
  const [ledgerMemo, bankMemo] = transform("", vendor, invNum);

  // Apply a 1-3% fee deduction on the bank side
  const feePercent = 1 + rng.next() * 2; // 1% - 3%
  const bankAmount = roundAmount(baseAmount * (1 - feePercent / 100));

  ledger.push({
    txId,
    amount: baseAmount,
    timestamp: date,
    memo: ledgerMemo,
    source: "ledger",
  });
  bank.push({
    txId: txId, // same txId so AI can correlate
    amount: bankAmount,
    timestamp: date,
    memo: bankMemo,
    source: "bank",
  });
}

// ──── Category 3: Hard Exceptions (15%) ─────────────────────────────────────
for (let i = 0; i < EXCEPTION_COUNT; i++) {
  const txId = generateTxId(txIndex++);
  const amount = roundAmount(rng.int(2000, 300000) + rng.next());
  const date = generateDate(rng.int(0, 25));
  const vendor = rng.pick(vendors);

  const exceptionType = i % 3; // cycle through 3 exception types

  if (exceptionType === 0) {
    // Missing bank deposit — ledger entry with no bank counterpart
    ledger.push({
      txId,
      amount,
      timestamp: date,
      memo: `${rng.pick(invoicePrefixes)} #${txIndex - 1} - ${vendor} (Pending)`,
      source: "ledger",
    });
  } else if (exceptionType === 1) {
    // Unauthorized duplicate debit — same ledger entry appears twice in bank
    const memo = `${rng.pick(invoicePrefixes)} #${txIndex - 1} - ${vendor}`;
    ledger.push({
      txId,
      amount,
      timestamp: date,
      memo,
      source: "ledger",
    });
    bank.push({ txId, amount, timestamp: date, memo, source: "bank" });
    bank.push({
      txId: `${txId}-DUP`,
      amount,
      timestamp: date,
      memo: `DUPLICATE - ${memo}`,
      source: "bank",
    });
  } else {
    // Excessive variance — >5% mismatch
    const variance = 5 + rng.next() * 15; // 5-20% mismatch
    const bankAmount = roundAmount(amount * (1 - variance / 100));
    const memo = `${rng.pick(invoicePrefixes)} #${txIndex - 1} - ${vendor}`;
    ledger.push({
      txId,
      amount,
      timestamp: date,
      memo,
      source: "ledger",
    });
    bank.push({
      txId,
      amount: bankAmount,
      timestamp: date,
      memo,
      source: "bank",
    });
  }
}

// ──── Write output ──────────────────────────────────────────────────────────

const dataDir = path.resolve(__dirname, "..", "src", "data");
fs.mkdirSync(dataDir, { recursive: true });

fs.writeFileSync(
  path.join(dataDir, "ledger.json"),
  JSON.stringify(ledger, null, 2)
);
fs.writeFileSync(
  path.join(dataDir, "bank.json"),
  JSON.stringify(bank, null, 2)
);

console.log(`✅ Generated ${ledger.length} ledger records → src/data/ledger.json`);
console.log(`✅ Generated ${bank.length} bank records   → src/data/bank.json`);
console.log(`   Exact matches:   ${EXACT_COUNT}`);
console.log(`   Fuzzy matches:   ${FUZZY_COUNT}`);
console.log(`   Hard exceptions: ${EXCEPTION_COUNT}`);
