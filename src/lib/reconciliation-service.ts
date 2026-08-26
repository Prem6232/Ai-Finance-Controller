/**
 * 3-Layer Reconciliation Engine
 *
 * Layer 1: Deterministic — O(1) Map lookup for exact txId + amount matches
 * Layer 2: AI Exception Agent — Gemini API for fuzzy memo/amount matching
 * Layer 3: Exception Logger — Flags unresolved items with explicit failure codes
 */

import type {
  Transaction,
  AuditEntry,
  MatchMethod,
  ExceptionCode,
  ReconciliationMetrics,
  ReconciliationResponse,
} from "./types";
import { batchEvaluate } from "./gemini-client";

function generateAuditId(): string {
  return `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function roundAmount(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Layer 1: Deterministic Engine ──────────────────────────────────────────

interface Layer1Result {
  matched: AuditEntry[];
  unmatchedLedger: Transaction[];
  unmatchedBank: Transaction[];
}

function runDeterministicLayer(
  ledgerTxs: Transaction[],
  bankTxs: Transaction[]
): Layer1Result {
  const bankMap = new Map<string, Transaction[]>();

  // Build bank lookup: key = txId
  for (const tx of bankTxs) {
    const key = tx.txId;
    if (!bankMap.has(key)) {
      bankMap.set(key, []);
    }
    bankMap.get(key)!.push(tx);
  }

  const matched: AuditEntry[] = [];
  const unmatchedLedger: Transaction[] = [];
  const matchedBankIds = new Set<string>();

  for (const ledgerTx of ledgerTxs) {
    const bankCandidates = bankMap.get(ledgerTx.txId);

    if (bankCandidates && bankCandidates.length > 0) {
      // Find exact amount match
      const exactMatch = bankCandidates.find(
        (b) =>
          b.amount === ledgerTx.amount &&
          !matchedBankIds.has(`${b.txId}-${b.amount}-${b.memo}`)
      );

      if (exactMatch) {
        const bankKey = `${exactMatch.txId}-${exactMatch.amount}-${exactMatch.memo}`;
        matchedBankIds.add(bankKey);

        matched.push({
          id: generateAuditId(),
          ledgerTx,
          bankTx: exactMatch,
          matchMethod: "DETERMINISTIC" as MatchMethod,
          confidenceScore: 1.0,
          amountDifference: 0,
          feeDeduction: 0,
          aiReasoning: "Exact match on Transaction ID and Amount — no AI needed.",
          status: "MATCHED",
          exceptionCode: null,
          rawTrace: {
            layer: 1,
            method: "DETERMINISTIC",
            lookupKey: ledgerTx.txId,
            matchedOn: ["txId", "amount"],
          },
        });
        continue;
      }
    }

    unmatchedLedger.push(ledgerTx);
  }

  // Collect unmatched bank entries
  const unmatchedBank: Transaction[] = [];
  for (const tx of bankTxs) {
    const key = `${tx.txId}-${tx.amount}-${tx.memo}`;
    if (!matchedBankIds.has(key)) {
      unmatchedBank.push(tx);
    }
  }

  return { matched, unmatchedLedger, unmatchedBank };
}

// ─── Layer 2: AI Exception Agent ────────────────────────────────────────────

interface Layer2Result {
  resolved: AuditEntry[];
  stillUnmatchedLedger: Transaction[];
  stillUnmatchedBank: Transaction[];
}

async function runAILayer(
  unmatchedLedger: Transaction[],
  unmatchedBank: Transaction[]
): Promise<Layer2Result> {
  const resolved: AuditEntry[] = [];
  const bankUsed = new Set<number>();

  // Build candidate pairs: match by txId (may have different amounts/memos)
  const pairs: Array<{
    ledger: Transaction;
    bank: Transaction;
    bankIdx: number;
  }> = [];

  for (const ledgerTx of unmatchedLedger) {
    for (let i = 0; i < unmatchedBank.length; i++) {
      if (bankUsed.has(i)) continue;
      const bankTx = unmatchedBank[i];

      // Only send to AI if txIds match or amounts are within 5%
      const txIdMatch = bankTx.txId === ledgerTx.txId || bankTx.txId.startsWith(ledgerTx.txId);
      const amountDiffPct =
        Math.abs(ledgerTx.amount - bankTx.amount) / ledgerTx.amount;

      if (txIdMatch || amountDiffPct < 0.05) {
        pairs.push({ ledger: ledgerTx, bank: bankTx, bankIdx: i });
      }
    }
  }

  if (pairs.length === 0) {
    return {
      resolved: [],
      stillUnmatchedLedger: [...unmatchedLedger],
      stillUnmatchedBank: [...unmatchedBank],
    };
  }

  // Send to Gemini
  const aiResults = await batchEvaluate(
    pairs.map((p) => ({ ledger: p.ledger, bank: p.bank }))
  );

  const ledgerResolved = new Set<string>();

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const result = aiResults[i];

    if (ledgerResolved.has(pair.ledger.txId) || bankUsed.has(pair.bankIdx)) {
      continue;
    }

    const amountDiff = roundAmount(
      Math.abs(pair.ledger.amount - pair.bank.amount)
    );

    if (result.isMatch && result.confidenceScore >= 0.7) {
      bankUsed.add(pair.bankIdx);
      ledgerResolved.add(pair.ledger.txId);

      resolved.push({
        id: generateAuditId(),
        ledgerTx: pair.ledger,
        bankTx: pair.bank,
        matchMethod: "AI_VERIFIED" as MatchMethod,
        confidenceScore: result.confidenceScore,
        amountDifference: amountDiff,
        feeDeduction: result.feeDeduction,
        aiReasoning: result.matchReason,
        status:
          result.confidenceScore >= 0.85 ? "MATCHED" : "FUZZY_MATCH",
        exceptionCode: null,
        rawTrace: {
          layer: 2,
          method: "AI_VERIFIED",
          geminiResponse: result,
          amountDiffPercent: `${((amountDiff / pair.ledger.amount) * 100).toFixed(2)}%`,
        },
      });
    }
  }

  const stillUnmatchedLedger = unmatchedLedger.filter(
    (tx) => !ledgerResolved.has(tx.txId)
  );
  const stillUnmatchedBank = unmatchedBank.filter(
    (_, idx) => !bankUsed.has(idx)
  );

  return { resolved, stillUnmatchedLedger, stillUnmatchedBank };
}

// ─── Layer 3: Exception Logger ──────────────────────────────────────────────

function runExceptionLayer(
  unmatchedLedger: Transaction[],
  unmatchedBank: Transaction[]
): AuditEntry[] {
  const exceptions: AuditEntry[] = [];

  // Flag unmatched ledger entries
  for (const ledgerTx of unmatchedLedger) {
    let exceptionCode: ExceptionCode = "MISSING_BANK_ENTRY";
    let reasoning = `No matching bank transaction found for ledger entry ${ledgerTx.txId}. This may indicate a pending deposit or missing bank record.`;

    // Check if there's a bank entry with same txId but excessive variance
    const possibleBank = unmatchedBank.find(
      (b) => b.txId === ledgerTx.txId || b.txId.startsWith(ledgerTx.txId)
    );

    if (possibleBank) {
      const diffPct =
        (Math.abs(ledgerTx.amount - possibleBank.amount) / ledgerTx.amount) *
        100;
      if (diffPct > 5) {
        exceptionCode = "EXCESSIVE_VARIANCE";
        reasoning = `Amount variance of ${diffPct.toFixed(2)}% exceeds 5% threshold. Ledger: ₹${ledgerTx.amount}, Bank: ₹${possibleBank.amount}. Requires manual review.`;
      }
    }

    exceptions.push({
      id: generateAuditId(),
      ledgerTx,
      bankTx: null,
      matchMethod: "EXCEPTION" as MatchMethod,
      confidenceScore: 0,
      amountDifference: ledgerTx.amount,
      feeDeduction: 0,
      aiReasoning: reasoning,
      status: "EXCEPTION",
      exceptionCode,
      rawTrace: {
        layer: 3,
        method: "EXCEPTION",
        code: exceptionCode,
        possibleBankMatch: possibleBank || null,
      },
    });
  }

  // Flag remaining unmatched bank entries (potential unauthorized debits)
  for (const bankTx of unmatchedBank) {
    // Check if it's a known duplicate
    const isDuplicate = bankTx.txId.includes("-DUP") || bankTx.memo.startsWith("DUPLICATE");
    const exceptionCode: ExceptionCode = isDuplicate
      ? "DUPLICATE_DEBIT"
      : "UNLINKED_DEBIT";
    const reasoning = isDuplicate
      ? `Duplicate bank debit detected: ${bankTx.txId}. Original transaction exists but this appears to be an unauthorized duplicate charge of ₹${bankTx.amount}.`
      : `Bank debit of ₹${bankTx.amount} (${bankTx.txId}) has no corresponding ledger entry. Potential unauthorized transaction.`;

    exceptions.push({
      id: generateAuditId(),
      ledgerTx: null,
      bankTx,
      matchMethod: "EXCEPTION" as MatchMethod,
      confidenceScore: 0,
      amountDifference: bankTx.amount,
      feeDeduction: 0,
      aiReasoning: reasoning,
      status: "EXCEPTION",
      exceptionCode,
      rawTrace: {
        layer: 3,
        method: "EXCEPTION",
        code: exceptionCode,
        bankOnly: true,
      },
    });
  }

  return exceptions;
}

// ─── Main Orchestrator ──────────────────────────────────────────────────────

export async function runReconciliation(
  ledgerTxs: Transaction[],
  bankTxs: Transaction[]
): Promise<ReconciliationResponse> {
  const startTime = performance.now();

  // Layer 1: Deterministic
  const layer1 = runDeterministicLayer(ledgerTxs, bankTxs);

  // Layer 2: AI
  const layer2 = await runAILayer(
    layer1.unmatchedLedger,
    layer1.unmatchedBank
  );

  // Layer 3: Exceptions
  const layer3 = runExceptionLayer(
    layer2.stillUnmatchedLedger,
    layer2.stillUnmatchedBank
  );

  const endTime = performance.now();

  // Combine all audit entries
  const auditLog: AuditEntry[] = [
    ...layer1.matched,
    ...layer2.resolved,
    ...layer3,
  ];

  const totalRecords = ledgerTxs.length + bankTxs.length;
  const matchedCount = layer1.matched.length + layer2.resolved.length;

  const metrics: ReconciliationMetrics = {
    totalRecords,
    throughputMs: Math.round(endTime - startTime),
    overallMatchRate: roundAmount((matchedCount / ledgerTxs.length) * 100),
    deterministicCount: layer1.matched.length,
    aiVerifiedCount: layer2.resolved.length,
    exceptionCount: layer3.length,
  };

  return {
    metrics,
    auditLog,
    timestamp: new Date().toISOString(),
  };
}
