/**
 * POST /api/reconcile
 *
 * Loads ledger + bank datasets and runs the 3-layer reconciliation engine.
 * Returns full audit log with metrics.
 */

import { NextResponse } from "next/server";
import { runReconciliation } from "@/lib/reconciliation-service";
import type { Transaction } from "@/lib/types";
import ledgerData from "@/data/ledger.json";
import bankData from "@/data/bank.json";

export const maxDuration = 60; // Allow up to 60s for AI calls

export async function POST() {
  try {
    const ledger = ledgerData as Transaction[];
    const bank = bankData as Transaction[];

    const result = await runReconciliation(ledger, bank);

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Reconciliation error:", error);
    return NextResponse.json(
      {
        error: "Reconciliation failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
