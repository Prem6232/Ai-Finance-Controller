/**
 * POST /api/export
 *
 * Generates downloadable audit and compliance packages (CSV, JSON, Unreconciled Exceptions).
 * Accepts the full audit log + metrics with SHA-256 seal from the client.
 */

import { NextResponse } from "next/server";
import type { AuditEntry, ReconciliationMetrics } from "@/lib/types";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { format = "json", auditLog, metrics, sha256AuditSeal } = body as {
      format: "csv" | "json" | "unreconciled-csv" | "compliance-summary";
      auditLog: AuditEntry[];
      metrics: ReconciliationMetrics;
      sha256AuditSeal?: string;
    };

    if (!auditLog || !metrics) {
      return NextResponse.json(
        { error: "auditLog and metrics are required" },
        { status: 400 }
      );
    }

    const exportTimestamp = new Date().toISOString();

    // 1. Download Unreconciled CSV (Exception items only)
    if (format === "unreconciled-csv") {
      const exceptionsOnly = auditLog.filter((e) => e.status === "EXCEPTION");
      const csvRows = [
        "Audit ID,Ledger TxID,Ledger Amount (INR),Bank TxID,Bank Amount (INR),Net Variance,Exception Code,Date Drift Days,Reasoning,Suggested Action",
      ];

      for (const entry of exceptionsOnly) {
        const lAmount = entry.ledgerTx ? (entry.ledgerTx.baseAmountINR || entry.ledgerTx.amount) : "0.00";
        const bAmount = entry.bankTx ? (entry.bankTx.baseAmountINR || entry.bankTx.amount) : "0.00";
        const row = [
          entry.id,
          entry.ledgerTx?.txId ?? "—",
          lAmount,
          entry.bankTx?.txId ?? "—",
          bAmount,
          entry.amountDifference,
          entry.exceptionCode ?? "UNCLASSIFIED",
          entry.dateDriftDays ?? 0,
          `"${(entry.aiReasoning || "").replace(/"/g, '""')}"`,
          `"Review in Resolution Workbench"`,
        ].join(",");
        csvRows.push(row);
      }

      return new NextResponse(csvRows.join("\n"), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="unreconciled-exceptions-${exportTimestamp.slice(0, 10)}.csv"`,
        },
      });
    }

    // 2. Full Audit Package CSV
    if (format === "csv") {
      const csvRows = [
        "Audit ID,Ledger TxID,Currency,Bank TxID,Match Method,Status,Confidence,Amount Diff (INR),Fee Deduction,TDS Deduction,FX Variance,Exception Code,Reasoning,SHA-256 Seal",
      ];

      for (const entry of auditLog) {
        const row = [
          entry.id,
          entry.ledgerTx?.txId ?? "—",
          entry.ledgerTx?.currency ?? "INR",
          entry.bankTx?.txId ?? "—",
          entry.matchMethod,
          entry.status,
          entry.confidenceScore,
          entry.amountDifference,
          entry.feeDeduction,
          entry.taxDeduction || 0,
          entry.fxVariance || 0,
          entry.exceptionCode ?? "—",
          `"${(entry.aiReasoning || "").replace(/"/g, '""')}"`,
          sha256AuditSeal || "—",
        ].join(",");
        csvRows.push(row);
      }

      return new NextResponse(csvRows.join("\n"), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="audit-package-${exportTimestamp.slice(0, 10)}.csv"`,
        },
      });
    }

    // 3. Default: Full JSON Package
    const jsonPackage = {
      exportMetadata: {
        exportedAt: exportTimestamp,
        format: "JSON-GOVERNANCE-AUDIT",
        recordCount: auditLog.length,
        sha256AuditSeal: sha256AuditSeal || "N/A",
        platform: "AI Finance Controller Enterprise v2.0",
        complianceStandard: "SOX 404 / RBI Payment Intermediary Audit Compliant",
      },
      metrics,
      auditLog,
    };

    return new NextResponse(JSON.stringify(jsonPackage, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="audit-package-${exportTimestamp.slice(0, 10)}.json"`,
      },
    });
  } catch (error) {
    console.error("Export API error:", error);
    return NextResponse.json(
      {
        error: "Export failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
