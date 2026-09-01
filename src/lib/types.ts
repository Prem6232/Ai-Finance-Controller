// ─── Transaction Schema ───────────────────────────────────────────────────────

export type CurrencyCode = "INR" | "USD" | "EUR" | "GBP";

export interface Transaction {
  txId: string;
  amount: number;
  currency?: CurrencyCode;
  timestamp: string; // ISO-8601
  memo: string;
  source?: "ledger" | "bank";
  // FX Metadata
  fxRate?: number; // e.g. USD/INR = 83.50
  baseAmountINR?: number; // Converted normalized amount
  metadata?: Record<string, unknown>;
}

// ─── Visual Field Difference for Audit Governance ────────────────────────────

export type DiffClassification = "CRITICAL" | "FEE" | "TAX" | "FX" | "DRIFT" | "INFO";

export interface FieldDifference {
  field: string;
  ledgerValue: string;
  bankValue: string;
  diffType: DiffClassification;
  description: string;
}

// ─── Execution Traceability ──────────────────────────────────────────────────

export interface ExecutionStep {
  layer: 1 | 1.5 | 2 | 3;
  layerName: "DETERMINISTIC" | "SPLIT_SETTLEMENT" | "AI_EXCEPTION_AGENT" | "EXCEPTION_LOGGER";
  action: string;
  result: "PASS" | "FAIL" | "SKIP";
  detail: string;
  durationMs: number;
}

// ─── HITL Override & Resolution Workbench ────────────────────────────────────

export interface HITLOverride {
  operator: string;
  action: "FORCE_MATCH" | "CONFIRM_EXCEPTION" | "MANUAL_ADJUSTMENT" | "SPLIT_ALLOCATION";
  reason: string;
  costCenter?: string;
  adjustmentAmount?: number;
  adjustmentAccount?: string;
  notes?: string;
  previousStatus: "MATCHED" | "FUZZY_MATCH" | "EXCEPTION";
  newStatus: "MATCHED" | "FUZZY_MATCH" | "EXCEPTION";
  previousConfidence: number;
  newConfidence: number;
  overriddenAt: string; // ISO-8601
  signatureHash?: string;
  sha256Seal?: string;
}

// ─── Cost Centers for Financial Governance ───────────────────────────────────

export const COST_CENTERS = [
  "Payment Gateway Surcharges (Razorpay/Stripe)",
  "TDS Receivable — Sec 194-O",
  "Foreign Exchange Realized Loss/Gain",
  "Merchant Chargeback Reserves",
  "Bank Interchange & Settlement Fees",
  "Escrow Reconciliation Clearing",
  "Unclaimed Settlement Suspense",
] as const;

export type CostCenter = (typeof COST_CENTERS)[number];

// ─── Reconciliation Outcome ──────────────────────────────────────────────────

export type MatchMethod =
  | "DETERMINISTIC"
  | "SPLIT_MATCH"
  | "FX_CONVERTED"
  | "AI_VERIFIED"
  | "EXCEPTION"
  | "HITL_OVERRIDE";

export type ExceptionCode =
  | "UNLINKED_DEBIT"
  | "EXCESSIVE_VARIANCE"
  | "MEMO_MISMATCH"
  | "DUPLICATE_DEBIT"
  | "MISSING_BANK_ENTRY"
  | "FX_RATE_UNRESOLVED"
  | "TEMPORAL_DRIFT_EXCEEDED"
  | "LOW_CONFIDENCE";

export interface GeminiMatchResponse {
  isMatch: boolean;
  confidenceScore: number;
  feeDeduction: number;
  taxDeduction?: number;
  fxVariance?: number;
  matchReason: string;
  suggestedAction?: string;
}

export interface AuditEntry {
  id: string;
  ledgerTx: Transaction | null;
  bankTx: Transaction | null;
  splitLedgerTxs?: Transaction[]; // 1-to-N: Multiple ledger items matching 1 bank entry
  splitBankTxs?: Transaction[];   // N-to-1: Multiple bank entries matching 1 ledger item
  matchType?: "1-TO-1" | "1-TO-N" | "N-TO-1";
  matchMethod: MatchMethod;
  confidenceScore: number;
  amountDifference: number;
  feeDeduction: number;
  taxDeduction?: number;
  fxRateUsed?: number;
  fxVariance?: number;
  dateDriftDays?: number;
  temporalDecayFactor?: number;
  fieldDifferences?: FieldDifference[];
  aiReasoning: string;
  status: "MATCHED" | "FUZZY_MATCH" | "EXCEPTION";
  exceptionCode: ExceptionCode | null;
  rawTrace: Record<string, unknown>;
  executionSteps: ExecutionStep[];
  hitlOverride?: HITLOverride;
}

export interface ReconciliationMetrics {
  totalRecords: number;
  throughputMs: number;
  overallMatchRate: number;
  deterministicCount: number;
  splitMatchCount: number;
  aiVerifiedCount: number;
  exceptionCount: number;
  totalVolume: number;
  matchedVolume: number;
  exceptionVolume: number;
  fxAdjustedVolume: number;
  gatewayFeesTotal: number;
  tdsTotal: number;
}

export interface ReconciliationResponse {
  metrics: ReconciliationMetrics;
  auditLog: AuditEntry[];
  timestamp: string;
  sha256AuditSeal?: string;
}

// ─── Real-Time Telemetry & SSE Streaming ─────────────────────────────────────

export type SSEEventType =
  | "INIT"
  | "LAYER_START"
  | "ITEM_PROCESSED"
  | "METRICS_UPDATE"
  | "LOG_EMITTED"
  | "COMPLETE"
  | "ERROR";

export interface SSEPayload {
  type: SSEEventType;
  layer?: 1 | 1.5 | 2 | 3;
  progressPercent: number;
  currentRecord?: {
    txId: string;
    amount: number;
    source: "ledger" | "bank";
  };
  log?: BatchLogEntry;
  metrics?: Partial<ReconciliationMetrics>;
  completedResult?: ReconciliationResponse;
}

// ─── Batch Processing Console ────────────────────────────────────────────────

export interface BatchLogEntry {
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR" | "SUCCESS";
  message: string;
  layer?: 1 | 1.5 | 2 | 3;
}

// ─── UI Navigation ───────────────────────────────────────────────────────────

export type TabId =
  | "overview"
  | "transactions"
  | "exceptions"
  | "ai-investigation"
  | "approvals"
  | "compliance-report"
  | "audit-log";
