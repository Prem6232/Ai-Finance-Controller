// ─── Transaction Schema ───────────────────────────────────────────────────────

export interface Transaction {
  txId: string;
  amount: number;
  timestamp: string; // ISO-8601
  memo: string;
  source: "ledger" | "bank";
}

// ─── Reconciliation Outcome ──────────────────────────────────────────────────

export type MatchMethod = "DETERMINISTIC" | "AI_VERIFIED" | "EXCEPTION";

export type ExceptionCode =
  | "UNLINKED_DEBIT"
  | "EXCESSIVE_VARIANCE"
  | "MEMO_MISMATCH"
  | "DUPLICATE_DEBIT"
  | "MISSING_BANK_ENTRY"
  | "LOW_CONFIDENCE";

export interface GeminiMatchResponse {
  isMatch: boolean;
  confidenceScore: number;
  feeDeduction: number;
  matchReason: string;
}

export interface AuditEntry {
  id: string;
  ledgerTx: Transaction | null;
  bankTx: Transaction | null;
  matchMethod: MatchMethod;
  confidenceScore: number;
  amountDifference: number;
  feeDeduction: number;
  aiReasoning: string;
  status: "MATCHED" | "FUZZY_MATCH" | "EXCEPTION";
  exceptionCode: ExceptionCode | null;
  rawTrace: Record<string, unknown>;
}

export interface ReconciliationMetrics {
  totalRecords: number;
  throughputMs: number;
  overallMatchRate: number;
  deterministicCount: number;
  aiVerifiedCount: number;
  exceptionCount: number;
}

export interface ReconciliationResponse {
  metrics: ReconciliationMetrics;
  auditLog: AuditEntry[];
  timestamp: string;
}
