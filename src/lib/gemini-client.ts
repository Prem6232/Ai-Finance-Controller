/**
 * Gemini AI Client — thin wrapper around @google/genai SDK
 * Enforces structured JSON output via responseSchema for reconciliation.
 */

import { GoogleGenAI, Type } from "@google/genai";
import type { GeminiMatchResponse, Transaction } from "./types";

const GEMINI_MODEL = "gemini-2.0-flash";

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env.local"
    );
  }
  return new GoogleGenAI({ apiKey });
}

/**
 * Ask Gemini to evaluate whether two transactions match,
 * accounting for possible fee deductions and memo differences.
 */
export async function evaluateTransactionPair(
  ledgerTx: Transaction,
  bankTx: Transaction
): Promise<GeminiMatchResponse> {
  const ai = getClient();

  const prompt = `You are a financial reconciliation auditor. Compare these two transaction records and determine if they represent the same underlying transaction.

LEDGER TRANSACTION:
- Transaction ID: ${ledgerTx.txId}
- Amount: ₹${ledgerTx.amount.toFixed(2)}
- Date: ${ledgerTx.timestamp}
- Memo: "${ledgerTx.memo}"

BANK TRANSACTION:
- Transaction ID: ${bankTx.txId}
- Amount: ₹${bankTx.amount.toFixed(2)}
- Date: ${bankTx.timestamp}
- Memo: "${bankTx.memo}"

AMOUNT DIFFERENCE: ₹${Math.abs(ledgerTx.amount - bankTx.amount).toFixed(2)} (${((Math.abs(ledgerTx.amount - bankTx.amount) / ledgerTx.amount) * 100).toFixed(2)}%)

Consider:
1. Payment gateway fees (Razorpay, Stripe) typically deduct 1-3% from settlements
2. TDS deductions are common in Indian financial transactions
3. Memo wording may differ between ledger entries and bank statements
4. Transaction IDs should match or be closely related

Provide your assessment as structured JSON.`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          isMatch: {
            type: Type.BOOLEAN,
            description:
              "Whether these two transactions represent the same underlying financial event",
          },
          confidenceScore: {
            type: Type.NUMBER,
            description:
              "Confidence score from 0.0 to 1.0 indicating how certain you are about the match",
          },
          feeDeduction: {
            type: Type.NUMBER,
            description:
              "Estimated fee or deduction amount (0 if amounts match exactly)",
          },
          matchReason: {
            type: Type.STRING,
            description:
              "Brief explanation of why these transactions do or do not match, mentioning specific evidence",
          },
        },
        required: [
          "isMatch",
          "confidenceScore",
          "feeDeduction",
          "matchReason",
        ],
      },
    },
  });

  const text = response.text ?? "{}";
  const parsed: GeminiMatchResponse = JSON.parse(text);

  // Clamp confidence score
  parsed.confidenceScore = Math.max(
    0,
    Math.min(1, parsed.confidenceScore)
  );

  return parsed;
}

/**
 * Batch evaluate multiple transaction pairs with rate limiting.
 * Processes up to 5 pairs concurrently.
 */
export async function batchEvaluate(
  pairs: Array<{ ledger: Transaction; bank: Transaction }>
): Promise<GeminiMatchResponse[]> {
  const CONCURRENCY = 5;
  const results: GeminiMatchResponse[] = [];

  for (let i = 0; i < pairs.length; i += CONCURRENCY) {
    const batch = pairs.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((pair) =>
        evaluateTransactionPair(pair.ledger, pair.bank).catch(
          (err): GeminiMatchResponse => {
            console.error(
              `Gemini API error for ${pair.ledger.txId}:`,
              err
            );
            return {
              isMatch: false,
              confidenceScore: 0,
              feeDeduction: 0,
              matchReason: `AI evaluation failed: ${err instanceof Error ? err.message : "Unknown error"}`,
            };
          }
        )
      )
    );
    results.push(...batchResults);

    // Brief delay between batches to respect rate limits
    if (i + CONCURRENCY < pairs.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return results;
}
