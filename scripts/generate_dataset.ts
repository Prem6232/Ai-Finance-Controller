/**
 * Realistic Enterprise Financial Dataset Generator
 * Generates production-grade Indian & Cross-Border merchant settlement data
 * with proper multi-currency, 1-to-N split payouts, temporal drift, GST, TDS, and UPI/NEFT references.
 */

import * as fs from "fs";
import * as path from "path";

type CurrencyCode = "INR" | "USD" | "EUR" | "GBP";

interface Transaction {
  txId: string;
  amount: number;
  currency?: CurrencyCode;
  timestamp: string;
  memo: string;
}

const MERCHANTS = [
  { name: "Swiggy", category: "Food Delivery", upi: "swiggy@icici" },
  { name: "Zomato", category: "Food Delivery", upi: "zomato@hdfcbank" },
  { name: "Flipkart", category: "E-Commerce", upi: "flipkart@axisbank" },
  { name: "Amazon India", category: "E-Commerce", upi: "amazonpay@apl" },
  { name: "Myntra", category: "Fashion Retail", upi: "myntra@icici" },
  { name: "PhonePe Merchant", category: "Digital Payments", upi: "phonepe@ybl" },
  { name: "BigBasket", category: "Grocery", upi: "bigbasket@icici" },
  { name: "Urban Company", category: "Home Services", upi: "urbancompany@hdfcbank" },
  { name: "MakeMyTrip", category: "Travel", upi: "makemytrip@icici" },
  { name: "Nykaa", category: "Beauty & Personal Care", upi: "nykaa@icici" },
  { name: "Lenskart", category: "Eyewear Retail", upi: "lenskart@hdfcbank" },
  { name: "Cred", category: "Fintech", upi: "cred@axisbank" },
  { name: "Zepto", category: "Quick Commerce", upi: "zepto@hdfcbank" },
  { name: "Razorpay Merchant", category: "Payment Gateway", upi: "rzp@hdfcbank" },
  { name: "Stripe International", category: "Global Payments", upi: "stripe@citi" },
  { name: "Shopify Global", category: "SaaS & E-Commerce", upi: "shopify@hsbc" },
];

const SPOT_FX_RATES: Record<string, number> = {
  USD: 83.50,
  EUR: 91.20,
  GBP: 106.80,
  INR: 1.0,
};

function randomId(prefix = "pay_"): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = prefix;
  for (let i = 0; i < 12; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function randomInvoice(): string {
  const prefix = ["INV", "RZP", "TXN", "SET", "PMT"][Math.floor(Math.random() * 5)];
  return `${prefix}-${Date.now().toString(36).toUpperCase().slice(-4)}${Math.floor(Math.random() * 9000 + 1000)}`;
}

function randomUTR(): string {
  return `UTR${Math.floor(Math.random() * 9000000000 + 1000000000)}`;
}

function randomDate(baseOffsetDays = 0): string {
  const base = new Date("2026-08-15T10:00:00Z");
  const target = new Date(base.getTime() + baseOffsetDays * 86400000 + (Math.random() * 36000000));
  return target.toISOString();
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function roundAmount(n: number): number {
  return Math.round(n * 100) / 100;
}

function generate() {
  const ledger: Transaction[] = [];
  const bank: Transaction[] = [];

  // 1. EXACT MATCHES (25 pairs) — Instant Layer 1 O(1) Hash Clearing
  for (let i = 0; i < 25; i++) {
    const txId = randomId();
    const merchant = pick(MERCHANTS);
    const inv = randomInvoice();
    const amount = roundAmount(1000 + Math.random() * 25000);
    const ts = randomDate(Math.floor(Math.random() * 10));

    ledger.push({
      txId,
      amount,
      currency: "INR",
      timestamp: ts,
      memo: `INV/${inv} — ${merchant.name} settlement payout (Razorpay)`,
    });

    bank.push({
      txId,
      amount,
      currency: "INR",
      timestamp: ts,
      memo: `NEFT-HDFC-${randomUTR()}-${merchant.name.toUpperCase().replace(/ /g, "")}-SETTLEMENT`,
    });
  }

  // 2. MULTI-CURRENCY & FX RATE ADJUSTMENTS (6 pairs) — Cross-border USD/EUR
  for (let i = 0; i < 6; i++) {
    const txId = randomId("fx_");
    const currency: CurrencyCode = i % 2 === 0 ? "USD" : "EUR";
    const fxRate = SPOT_FX_RATES[currency];
    const originalAmount = roundAmount(currency === "USD" ? 200 + Math.random() * 800 : 150 + Math.random() * 600);
    
    // Ledger records in foreign currency
    const tsLedger = randomDate(Math.floor(Math.random() * 5));
    ledger.push({
      txId,
      amount: originalAmount,
      currency,
      timestamp: tsLedger,
      memo: `Cross-border export invoice #${randomInvoice()} — Shopify Global USD Settlement`,
    });

    // Bank receives in INR after spot conversion minus 1.2% FX spread
    const grossINR = originalAmount * fxRate;
    const fxSpread = grossINR * 0.012;
    const bankINR = roundAmount(grossINR - fxSpread);
    const tsBank = randomDate(Math.floor(Math.random() * 5) + 2); // T+2 days

    bank.push({
      txId,
      amount: bankINR,
      currency: "INR",
      timestamp: tsBank,
      memo: `INWARD REMITTANCE / TT / CITI / ${currency} ${originalAmount} @ ${fxRate.toFixed(2)} / UTR:${randomUTR()}`,
    });
  }

  // 3. SPLIT SETTLEMENTS (1-to-N Matching: 4 bulk payout groups resolving 10 invoices)
  for (let group = 0; group < 4; group++) {
    const merchant = pick(MERCHANTS);
    const count = group % 2 === 0 ? 2 : 3;
    const groupInvoices: Transaction[] = [];
    let groupSum = 0;
    const baseDay = Math.floor(Math.random() * 8);

    for (let j = 0; j < count; j++) {
      const invId = randomId("sub_");
      const invAmt = roundAmount(3000 + Math.random() * 8000);
      groupSum += invAmt;
      const invTx: Transaction = {
        txId: invId,
        amount: invAmt,
        currency: "INR",
        timestamp: randomDate(baseDay),
        memo: `${merchant.name} — Order tranche ${randomInvoice()}, Batch #${group + 1}`,
      };
      groupInvoices.push(invTx);
      ledger.push(invTx);
    }

    // 1 single bulk Bank Payout for these invoices minus gateway fee (1.8%)
    const bulkFee = roundAmount(groupSum * 0.018);
    const netBankPayout = roundAmount(groupSum - bulkFee);
    bank.push({
      txId: randomId("bulk_"),
      amount: netBankPayout,
      currency: "INR",
      timestamp: randomDate(baseDay + 1), // T+1 settlement sweep
      memo: `RZP BATCH SETTLEMENT ${randomUTR()} — ${merchant.name} (Bulk Sweep ${count} Invoices)`,
    });
  }

  // 4. TEMPORAL DELAYED SETTLEMENTS (T+2 to T+4 Days) (8 pairs)
  for (let i = 0; i < 8; i++) {
    const txId = randomId("drf_");
    const merchant = pick(MERCHANTS);
    const inv = randomInvoice();
    const baseAmount = roundAmount(4000 + Math.random() * 18000);
    const fee = roundAmount(baseAmount * 0.022); // 2.2% MDR
    const bankAmount = roundAmount(baseAmount - fee);
    const ledgerDate = randomDate(2);
    const driftDays = 2 + (i % 3); // 2 to 4 days delay
    const bankDate = randomDate(2 + driftDays);

    ledger.push({
      txId,
      amount: baseAmount,
      currency: "INR",
      timestamp: ledgerDate,
      memo: `RZP/Auto-Settle/${inv} — ${merchant.name} weekend payout tranche`,
    });

    bank.push({
      txId,
      amount: bankAmount,
      currency: "INR",
      timestamp: bankDate,
      memo: `RTGS-${randomUTR()}-${merchant.name.toUpperCase()}-T+${driftDays} DELAYED SETTLE`,
    });
  }

  // 5. TDS SECTION 194-O DEDUCTIONS (5 pairs)
  for (let i = 0; i < 5; i++) {
    const txId = randomId("tds_");
    const merchant = pick(MERCHANTS);
    const inv = randomInvoice();
    const baseAmount = roundAmount(10000 + Math.random() * 30000);
    const tds = roundAmount(baseAmount * 0.01); // 1% Sec 194-O
    const fee = roundAmount(baseAmount * 0.02); // 2% gateway fee
    const gst = roundAmount(fee * 0.18);
    const bankAmount = roundAmount(baseAmount - tds - fee - gst);
    const ts = randomDate(6);

    ledger.push({
      txId,
      amount: baseAmount,
      currency: "INR",
      timestamp: ts,
      memo: `${merchant.name} — ${inv}, Gross E-Commerce Settle under Sec 194-O TDS`,
    });

    bank.push({
      txId,
      amount: bankAmount,
      currency: "INR",
      timestamp: ts,
      memo: `NEFT CR — ${merchant.name} Net of Sec 194-O TDS & MDR | Ref: ${randomUTR()}`,
    });
  }

  // 6. HARD EXCEPTIONS — Unlinked Debits (3)
  for (let i = 0; i < 3; i++) {
    const txId = randomId("exc_");
    const inv = randomInvoice();
    ledger.push({
      txId,
      amount: roundAmount(5000 + Math.random() * 12000),
      currency: "INR",
      timestamp: randomDate(8),
      memo: `DISPUTED: Chargeback reversal pending — Ref ${inv}`,
    });
  }

  // 7. HARD EXCEPTIONS — Excessive Variance (3)
  for (let i = 0; i < 3; i++) {
    const txId = randomId("var_");
    const merchant = pick(MERCHANTS);
    const inv = randomInvoice();
    const lAmount = roundAmount(8000 + Math.random() * 20000);
    const bAmount = roundAmount(lAmount * 0.55); // 45% variance
    const ts = randomDate(9);

    ledger.push({
      txId,
      amount: lAmount,
      currency: "INR",
      timestamp: ts,
      memo: `${merchant.name} — Flagged invoice ${inv}, suspected partial chargeback`,
    });

    bank.push({
      txId,
      amount: bAmount,
      currency: "INR",
      timestamp: ts,
      memo: `PARTIAL CR — ${merchant.name} | UTR: ${randomUTR()} (Incomplete Credit)`,
    });
  }

  // 8. HARD EXCEPTIONS — Duplicate Bank Debits (2)
  for (let i = 0; i < 2; i++) {
    const txId = randomId("dup_");
    const dupTxId = randomId("dup_err_");
    const merchant = pick(MERCHANTS);
    const amount = roundAmount(4500 + Math.random() * 9000);
    const ts = randomDate(10);

    ledger.push({
      txId,
      amount,
      currency: "INR",
      timestamp: ts,
      memo: `${merchant.name} — Regular merchant settlement batch`,
    });

    bank.push({
      txId,
      amount,
      currency: "INR",
      timestamp: ts,
      memo: `NEFT CR — ${merchant.name} daily payout | UTR: ${randomUTR()}`,
    });

    // Anomaly: Duplicate bank entry
    bank.push({
      txId: dupTxId,
      amount,
      currency: "INR",
      timestamp: ts,
      memo: `DUPLICATE CR — ${merchant.name} re-credit ERROR | UTR: ${randomUTR()}`,
    });
  }

  // 9. Orphan Bank Entries (2)
  for (let i = 0; i < 2; i++) {
    const merchant = pick(MERCHANTS);
    bank.push({
      txId: randomId("orp_"),
      amount: roundAmount(2000 + Math.random() * 7000),
      currency: "INR",
      timestamp: randomDate(11),
      memo: `UNEXPECTED CR — ${merchant.name} suspense reversal | UTR: ${randomUTR()}`,
    });
  }

  // Write datasets to data directory
  const dataDir = path.join(__dirname, "..", "src", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "ledger.json"), JSON.stringify(ledger, null, 2));
  fs.writeFileSync(path.join(dataDir, "bank.json"), JSON.stringify(bank, null, 2));

  console.log(`✅ Generated Enterprise Financial Dataset:`);
  console.log(`   Ledger: ${ledger.length} records`);
  console.log(`   Bank:   ${bank.length} records`);
  console.log(`   → 25 Exact matches (Layer 1)`);
  console.log(`   → 6 Cross-Border Spot FX (USD & EUR exports)`);
  console.log(`   → 4 Split Bulk Settlement Groups (10 invoices into 4 bank payouts)`);
  console.log(`   → 8 Temporal Delayed Settlements (T+2 to T+4 drift)`);
  console.log(`   → 5 TDS Sec 194-O Withholding matches`);
  console.log(`   → 10 Hard Exceptions (Unlinked, Excessive Variance, Duplicates, Orphans)`);
}

generate();
