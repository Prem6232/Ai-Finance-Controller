/**
 * GET /api/reconcile/stream or POST /api/reconcile/stream
 *
 * Real-Time Telemetry via Server-Sent Events (SSE).
 * Streams step-by-step batch reconciliation progress, layer transitions,
 * throughput metrics, and final audit results directly to the browser.
 */

import { runReconciliation } from "@/lib/reconciliation-service";
import type { Transaction, SSEPayload } from "@/lib/types";
import { getMongoClient, inMemoryDB } from "@/lib/mongodb";
import { checkRateLimit } from "@/lib/security";
import ledgerData from "@/data/ledger.json";
import bankData from "@/data/bank.json";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const clientIp = req.headers.get("x-forwarded-for") || "client_stream";
  const rateCheck = checkRateLimit(`stream:${clientIp}`, 20, 60000);
  if (!rateCheck.allowed) {
    return new Response(
      `data: ${JSON.stringify({
        type: "ERROR",
        log: {
          timestamp: new Date().toISOString(),
          level: "ERROR",
          message: `Stream Rate Limit Exceeded. Retry in ${Math.ceil(rateCheck.resetMs / 1000)}s.`,
        },
      })}\n\n`,
      {
        headers: { "Content-Type": "text/event-stream" },
      }
    );
  }
  let ledger: Transaction[] = ledgerData as Transaction[];
  let bank: Transaction[] = bankData as Transaction[];

  try {
    const body = await req.json();
    if (body.ledger && Array.isArray(body.ledger)) ledger = body.ledger;
    if (body.bank && Array.isArray(body.bank)) bank = body.bank;
  } catch {
    // Fall back to default datasets
  }

  const responseStream = new TransformStream();
  const writer = responseStream.writable.getWriter();
  const encoder = new TextEncoder();

  const sendEvent = async (data: SSEPayload) => {
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    } catch {
      // Client disconnected
    }
  };

  // Run asynchronously without blocking initial response headers
  (async () => {
    try {
      await sendEvent({
        type: "INIT",
        progressPercent: 5,
        log: {
          timestamp: new Date().toISOString(),
          level: "INFO",
          message: "Connecting to SSE telemetry engine. Validating payload structures...",
        },
      });

      const result = await runReconciliation(ledger, bank, async (payload) => {
        await sendEvent(payload);
      });

      // Save to MongoDB / Memory Cache
      try {
        const client = await getMongoClient();
        const db = client.db();
        await db.collection("batches").insertOne({
          timestamp: result.timestamp,
          metrics: result.metrics,
          auditLog: result.auditLog,
          sha256AuditSeal: result.sha256AuditSeal,
        });
      } catch (e: any) {
        inMemoryDB.batches.push({
          timestamp: result.timestamp,
          metrics: result.metrics,
          auditLog: result.auditLog,
          sha256AuditSeal: result.sha256AuditSeal,
        });
      }

      await sendEvent({
        type: "COMPLETE",
        progressPercent: 100,
        completedResult: result,
      });
    } catch (err: any) {
      await sendEvent({
        type: "ERROR",
        progressPercent: 100,
        log: {
          timestamp: new Date().toISOString(),
          level: "ERROR",
          message: `Reconciliation Stream Error: ${err.message || "Unknown error"}`,
        },
      });
    } finally {
      await writer.close();
    }
  })();

  return new Response(responseStream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
