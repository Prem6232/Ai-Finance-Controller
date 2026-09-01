/**
 * Gemini AI Client — Production-Grade Wrapper around @google/genai SDK
 * Features:
 * 1. Circuit Breaker pattern with state transitions (CLOSED, OPEN, HALF_OPEN)
 * 2. Multi-currency spot FX conversion & tolerance heuristics
 * 3. Temporal exponential decay scoring: C = C_base * exp(-lambda * delta_days)
 * 4. Deterministic local safety net to handle 429s without blocking batch pipelines
 */

import { GoogleGenAI, Type } from "@google/genai";
import type { GeminiMatchResponse, Transaction } from "./types";
import { sanitizeAndRedactPII } from "./security";

const GEMINI_MODEL = "gemini-3.6-flash";

// ─── Spot FX Reference Table (Configurable) ──────────────────────────────────
export const SPOT_FX_RATES: Record<string, number> = {
  USD: 83.50,
  EUR: 91.20,
  GBP: 106.80,
  INR: 1.0,
};

// ─── Circuit Breaker Implementation ──────────────────────────────────────────

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private consecutiveSuccesses = 0;
  private readonly failureThreshold = 3;
  private readonly successThreshold = 2;
  private readonly resetTimeoutMs = 15000; // 15 seconds cooloff
  private nextAttemptTimestamp = 0;

  public canExecute(): boolean {
    if (this.state === "CLOSED") return true;

    if (this.state === "OPEN") {
      if (Date.now() >= this.nextAttemptTimestamp) {
        console.info("⚡ Circuit breaker moving to HALF_OPEN to probe Gemini API availability.");
        this.state = "HALF_OPEN";
        return true;
      }
      return false;
    }

    // In HALF_OPEN state, allow execution for probe
    return true;
  }

  public recordSuccess(): void {
    if (this.state === "HALF_OPEN") {
      this.consecutiveSuccesses++;
      if (this.consecutiveSuccesses >= this.successThreshold) {
        console.info("✅ Circuit breaker RESET to CLOSED — Gemini API is healthy.");
        this.state = "CLOSED";
        this.failureCount = 0;
        this.consecutiveSuccesses = 0;
      }
    } else {
      this.failureCount = 0;
    }
  }

  public recordFailure(err: any): void {
    this.failureCount++;
    console.warn(`⚠️ Gemini API Failure #${this.failureCount}: ${err?.message || err}`);

    if (this.failureCount >= this.failureThreshold || this.state === "HALF_OPEN") {
      this.state = "OPEN";
      this.nextAttemptTimestamp = Date.now() + this.resetTimeoutMs;
      this.consecutiveSuccesses = 0;
      console.warn(`🚨 Circuit breaker TRIPPED to OPEN. Falling back to local deterministic rule engine for ${this.resetTimeoutMs / 1000}s.`);
    }
  }

  public getState(): CircuitState {
    return this.state;
  }
}

const circuitBreaker = new CircuitBreaker();

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set. Add it to .env.local");
  }
  return new GoogleGenAI({ apiKey });
}

// ─── Temporal Decay Helper ───────────────────────────────────────────────────

export function calculateTemporalDecay(
  date1: string,
  date2: string,
  lambda = 0.035
): { daysDiff: number; decayFactor: number } {
  const t1 = new Date(date1).getTime();
  const t2 = new Date(date2).getTime();
  if (isNaN(t1) || isNaN(t2)) return { daysDiff: 0, decayFactor: 1.0 };

  const diffMs = Math.abs(t1 - t2);
  const daysDiff = Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10;
  // Exponential decay: e^(-lambda * delta_days)
  const decayFactor = Math.exp(-lambda * daysDiff);

  return { daysDiff, decayFactor: Math.min(1.0, Math.max(0.2, decayFactor)) };
}

// ─── Primary Gemini Evaluator ────────────────────────────────────────────────

export async function evaluateTransactionPair(
  ledgerTx: Transaction,
  bankTx: Transaction
): Promise<GeminiMatchResponse> {
  if (!circuitBreaker.canExecute()) {
    console.info(`⚡ Circuit breaker is ${circuitBreaker.getState()} — invoking zero-API heuristic.`);
    return evaluateTransactionPairLocal(ledgerTx, bankTx);
  }

  try {
    const ai = getClient();

    // Normalize amounts with FX if applicable
    const ledgerCurrency = ledgerTx.currency || "INR";
    const bankCurrency = bankTx.currency || "INR";
    const fxRateLedger = SPOT_FX_RATES[ledgerCurrency] || 1.0;
    const fxRateBank = SPOT_FX_RATES[bankCurrency] || 1.0;

    const ledgerINR = ledgerTx.baseAmountINR || ledgerTx.amount * fxRateLedger;
    const bankINR = bankTx.baseAmountINR || bankTx.amount * fxRateBank;

    const amountDiffINR = Math.abs(ledgerINR - bankINR);
    const variancePct = ((amountDiffINR / ledgerINR) * 100).toFixed(2);

    const { daysDiff, decayFactor } = calculateTemporalDecay(ledgerTx.timestamp, bankTx.timestamp);

    // SOC 2 / GDPR: Redact PII & sensitive account details before LLM ingestion
    const sanitizedLedgerMemo = sanitizeAndRedactPII(ledgerTx.memo);
    const sanitizedBankMemo = sanitizeAndRedactPII(bankTx.memo);

    const prompt = `You are a Senior Financial Controller and AI Reconciliation Auditor.
Compare these two financial transaction records and determine if they represent the same underlying economic event.

LEDGER TRANSACTION:
- TxID: ${ledgerTx.txId}
- Original Amount: ${ledgerCurrency} ${ledgerTx.amount.toFixed(2)} (INR Equivalent: ₹${ledgerINR.toFixed(2)})
- Timestamp: ${ledgerTx.timestamp}
- Memo: "${sanitizedLedgerMemo}"

BANK TRANSACTION:
- TxID: ${bankTx.txId}
- Original Amount: ${bankCurrency} ${bankTx.amount.toFixed(2)} (INR Equivalent: ₹${bankINR.toFixed(2)})
- Timestamp: ${bankTx.timestamp}
- Memo: "${sanitizedBankMemo}"

FINANCIAL METRICS:
- INR Amount Variance: ₹${amountDiffINR.toFixed(2)} (${variancePct}%)
- Date Drift: ${daysDiff} days (Temporal Decay Factor: ${(decayFactor * 100).toFixed(1)}%)
- Cross-Border Currencies: Ledger=${ledgerCurrency}, Bank=${bankCurrency}

RECONCILIATION RULES:
1. Gateway Settlement Fees: Razorpay/Stripe typically deduct 1.5% to 3.0% + 18% GST (effective 1.77% - 3.54%).
2. TDS Withholding: Section 194-O deducts exactly 1.0% from gross e-commerce settlements.
3. Multi-Currency Spot FX: Cross-border remittances may experience 0.5% - 2.0% FX spread variance.
4. Temporal Drift: Payouts between T+1 and T+4 days are normal for batch ACH/NEFT/RTGS.
5. Memo Correlation: Check for merchant abbreviations, invoice references, UTR tokens.

Provide assessment in structured JSON.`;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isMatch: { type: Type.BOOLEAN, description: "True if records represent the same transaction." },
            confidenceScore: { type: Type.NUMBER, description: "Confidence score between 0.0 and 1.0." },
            feeDeduction: { type: Type.NUMBER, description: "Estimated gateway fee or bank surcharge in INR." },
            taxDeduction: { type: Type.NUMBER, description: "Estimated TDS withholding under Sec 194-O in INR." },
            fxVariance: { type: Type.NUMBER, description: "Variance due to FX spread in INR." },
            matchReason: { type: Type.STRING, description: "Detailed accounting rationale for reconciliation." },
            suggestedAction: { type: Type.STRING, description: "Suggested accounting journal entry or resolution action." },
          },
          required: ["isMatch", "confidenceScore", "feeDeduction", "matchReason"],
        },
      },
    });

    const text = response.text ?? "{}";
    const parsed: GeminiMatchResponse = JSON.parse(text);

    // Apply temporal decay to confidence score
    const adjustedConfidence = Math.max(0, Math.min(1.0, (parsed.confidenceScore || 0.8) * decayFactor));
    parsed.confidenceScore = Math.round(adjustedConfidence * 100) / 100;

    circuitBreaker.recordSuccess();
    return parsed;
  } catch (err: any) {
    circuitBreaker.recordFailure(err);
    console.warn(`⚡ Invoking local deterministic fallback for ${ledgerTx.txId} vs ${bankTx.txId}`);
    return evaluateTransactionPairLocal(ledgerTx, bankTx);
  }
}

// ─── Robust Local Heuristic Rule Engine (Zero-API Safety Net) ────────────────

export function evaluateTransactionPairLocal(
  ledgerTx: Transaction,
  bankTx: Transaction
): GeminiMatchResponse {
  const ledgerCurrency = ledgerTx.currency || "INR";
  const bankCurrency = bankTx.currency || "INR";
  const fxRateLedger = SPOT_FX_RATES[ledgerCurrency] || 1.0;
  const fxRateBank = SPOT_FX_RATES[bankCurrency] || 1.0;

  const ledgerINR = ledgerTx.baseAmountINR || ledgerTx.amount * fxRateLedger;
  const bankINR = bankTx.baseAmountINR || bankTx.amount * fxRateBank;

  const amountDiff = Math.abs(ledgerINR - bankINR);
  const diffPct = amountDiff / ledgerINR;

  const { daysDiff, decayFactor } = calculateTemporalDecay(ledgerTx.timestamp, bankTx.timestamp);

  const merchants = [
    "Swiggy", "Zomato", "Flipkart", "Amazon", "Myntra", "Uber", "Ola",
    "Netflix", "Spotify", "Razorpay", "PhonePe", "Paytm", "BigBasket",
    "Zepto", "Dunzo", "Cred", "Lenskart", "Nykaa", "MakeMyTrip"
  ];

  let matchedMerchant = "";
  for (const m of merchants) {
    if (
      ledgerTx.memo.toLowerCase().includes(m.toLowerCase()) &&
      bankTx.memo.toLowerCase().includes(m.toLowerCase())
    ) {
      matchedMerchant = m;
      break;
    }
  }

  const isIdMatch =
    bankTx.txId === ledgerTx.txId ||
    bankTx.txId.startsWith(ledgerTx.txId) ||
    ledgerTx.txId.startsWith(bankTx.txId);

  // Scenario A: Standard Gateway Fee (1.5% - 3.5% + GST)
  const isFeeMatch = diffPct >= 0.015 && diffPct <= 0.038;
  if ((isIdMatch || matchedMerchant) && isFeeMatch && daysDiff <= 5) {
    const rawConf = 0.94;
    return {
      isMatch: true,
      confidenceScore: Math.round(rawConf * decayFactor * 100) / 100,
      feeDeduction: Math.round(amountDiff * 100) / 100,
      matchReason: `Deterministic Heuristic: Gateway settlement fee of ${(diffPct * 100).toFixed(2)}% detected for ${matchedMerchant || "merchant"}. Date drift: ${daysDiff}d. (Zero-API Safety Net)`,
      suggestedAction: "Post Gateway Fee to 6010-Payment-Processing-Expense",
    };
  }

  // Scenario B: TDS Deduction (1% Sec 194-O + optional fee)
  const isTdsMatch = Math.abs(diffPct - 0.01) < 0.003 || Math.abs(diffPct - 0.0336) < 0.005;
  if ((isIdMatch || matchedMerchant) && isTdsMatch && daysDiff <= 5) {
    const tdsAmount = Math.round(ledgerINR * 0.01 * 100) / 100;
    const feeAmount = Math.round((amountDiff - tdsAmount) * 100) / 100;
    return {
      isMatch: true,
      confidenceScore: Math.round(0.92 * decayFactor * 100) / 100,
      feeDeduction: Math.max(0, feeAmount),
      taxDeduction: tdsAmount,
      matchReason: `Deterministic Heuristic: Sec 194-O 1% TDS (₹${tdsAmount}) + Gateway Fee (₹${feeAmount}) confirmed. Date drift: ${daysDiff}d.`,
      suggestedAction: "Credit TDS Receivable A/C (Sec 194-O)",
    };
  }

  // Scenario C: Multi-Currency Spot FX Variance (USD/EUR conversion)
  if (ledgerCurrency !== bankCurrency && diffPct <= 0.04) {
    return {
      isMatch: true,
      confidenceScore: Math.round(0.89 * decayFactor * 100) / 100,
      feeDeduction: 0,
      fxVariance: Math.round(amountDiff * 100) / 100,
      matchReason: `Cross-Currency Heuristic: Converted ${ledgerCurrency} ${ledgerTx.amount} to INR at spot FX ${SPOT_FX_RATES[ledgerCurrency]}. Variance of ${(diffPct * 100).toFixed(2)}% within FX spread tolerance.`,
      suggestedAction: "Book FX Fluctuation Loss/Gain",
    };
  }

  // Scenario D: Standard Near Match (<4% variance, matching ID/Memo)
  if ((isIdMatch || matchedMerchant) && diffPct <= 0.04 && daysDiff <= 5) {
    return {
      isMatch: true,
      confidenceScore: Math.round(0.85 * decayFactor * 100) / 100,
      feeDeduction: Math.round(amountDiff * 100) / 100,
      matchReason: `Deterministic Heuristic: TxID/Memo correlation verified with ${(diffPct * 100).toFixed(2)}% net variance.`,
      suggestedAction: "Auto-Reconcile Variance to Clearing Suspense",
    };
  }

  return {
    isMatch: false,
    confidenceScore: 0.15,
    feeDeduction: 0,
    matchReason: `Verification Failed: Excessive variance (${(diffPct * 100).toFixed(1)}%) or temporal drift (${daysDiff} days) exceeded tolerance.`,
    suggestedAction: "Escalate to Human-in-the-Loop Exception Queue",
  };
}

// ─── Batch Concurrent Evaluator ──────────────────────────────────────────────

export async function batchEvaluate(
  pairs: Array<{ ledger: Transaction; bank: Transaction }>
): Promise<GeminiMatchResponse[]> {
  const CONCURRENCY = 4;
  const results: GeminiMatchResponse[] = [];

  for (let i = 0; i < pairs.length; i += CONCURRENCY) {
    const batch = pairs.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((pair) =>
        evaluateTransactionPair(pair.ledger, pair.bank).catch((err) => {
          console.warn(`Pair evaluation fallback for ${pair.ledger.txId}:`, err?.message || err);
          return evaluateTransactionPairLocal(pair.ledger, pair.bank);
        })
      )
    );
    results.push(...batchResults);

    if (i + CONCURRENCY < pairs.length) {
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  return results;
}
