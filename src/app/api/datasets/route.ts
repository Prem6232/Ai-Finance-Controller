/**
 * GET /api/datasets
 *
 * Returns current ledger + bank datasets for preview.
 */

import { NextResponse } from "next/server";
import type { Transaction } from "@/lib/types";
import ledgerData from "@/data/ledger.json";
import bankData from "@/data/bank.json";

export async function GET() {
  return NextResponse.json({
    ledger: ledgerData as Transaction[],
    bank: bankData as Transaction[],
    counts: {
      ledger: (ledgerData as Transaction[]).length,
      bank: (bankData as Transaction[]).length,
    },
  });
}
