/**
 * POST /api/reconcile
 *
 * Reconciles ledger + bank datasets using the 3-layer reconciliation engine.
 * Hardened with:
 * 1. Rate Limiting (OWASP API Security)
 * 2. Payload size & structure validation
 * 3. Immutable storage with fallback
 */

import { NextResponse } from "next/server";
import { runReconciliation } from "@/lib/reconciliation-service";
import type { Transaction } from "@/lib/types";
import { getMongoClient, inMemoryDB } from "@/lib/mongodb";
import { checkRateLimit } from "@/lib/security";
import ledgerData from "@/data/ledger.json";
import bankData from "@/data/bank.json";

export const maxDuration = 60;

export async function POST(req: Request) {
  // Rate Limiter: Max 20 batch runs / min per client
  const clientIp = req.headers.get("x-forwarded-for") || "client_reconcile";
  const rateCheck = checkRateLimit(`reconcile:${clientIp}`, 20, 60000);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        error: "Too Many Requests",
        details: `Batch reconciliation rate limit exceeded. Retry in ${Math.ceil(rateCheck.resetMs / 1000)}s.`,
      },
      { status: 429 }
    );
  }

  try {
    let ledger: Transaction[] = ledgerData as Transaction[];
    let bank: Transaction[] = bankData as Transaction[];

    try {
      const body = await req.json();
      if (body.ledger && Array.isArray(body.ledger)) {
        if (body.ledger.length > 5000) {
          return NextResponse.json(
            { error: "Payload exceeds maximum batch limit of 5,000 transactions." },
            { status: 413 }
          );
        }
        ledger = body.ledger;
      }
      if (body.bank && Array.isArray(body.bank)) {
        if (body.bank.length > 5000) {
          return NextResponse.json(
            { error: "Payload exceeds maximum batch limit of 5,000 transactions." },
            { status: 413 }
          );
        }
        bank = body.bank;
      }
    } catch {
      // Use standard default datasets if empty
    }

    const result = await runReconciliation(ledger, bank);

    // Save batch to MongoDB / In-memory fallback
    try {
      const client = await getMongoClient();
      const db = client.db();
      await db.collection("batches").insertOne({
        timestamp: result.timestamp,
        metrics: result.metrics,
        auditLog: result.auditLog,
        sha256AuditSeal: result.sha256AuditSeal,
      });
      console.log("💾 Saved reconciliation batch details to MongoDB.");
    } catch (e: any) {
      console.warn("⚠️ MongoDB offline. Stored batch in memory cache:", e.message);
      inMemoryDB.batches.push({
        timestamp: result.timestamp,
        metrics: result.metrics,
        auditLog: result.auditLog,
        sha256AuditSeal: result.sha256AuditSeal,
      });
    }

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
