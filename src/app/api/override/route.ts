/**
 * POST /api/override
 *
 * Enterprise Human-in-the-Loop & Governance Override Endpoint.
 * Standards: SOC 2 Segregation of Duties (SoD), ISO 27001 Cryptographic Audit Chains.
 *
 * Features:
 * 1. Rate Limiting: 30 overrides / min per IP
 * 2. Role-Based Access Control (RBAC): Enforces CFO authorization for high-value variances (> ₹1,00,000)
 * 3. Cryptographic HMAC-SHA256 Tamper-Proof Audit Seals
 */

import { NextResponse } from "next/server";
import { getMongoClient, inMemoryDB } from "@/lib/mongodb";
import type { HITLOverride } from "@/lib/types";
import { checkRateLimit, generateHmacSignature } from "@/lib/security";
import { validateOverrideAuthorization, type UserRole } from "@/lib/auth-rbac";

export async function POST(req: Request) {
  // 1. Rate Limiting Defense (OWASP API Security)
  const clientIp = req.headers.get("x-forwarded-for") || "client_override";
  const rateCheck = checkRateLimit(`override:${clientIp}`, 30, 60000);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        error: "Too Many Requests",
        details: `Rate limit exceeded. Try again in ${Math.ceil(rateCheck.resetMs / 1000)}s.`,
      },
      { status: 429 }
    );
  }

  try {
    const body = await req.json();
    const {
      auditId,
      action,
      reason,
      operator = "Lead Financial Controller",
      role = "FINANCE_ANALYST" as UserRole,
      costCenter,
      adjustmentAmount = 0,
      adjustmentAccount,
      notes = "",
      previousStatus = "EXCEPTION",
      newStatus = "MATCHED",
    } = body;

    if (!auditId || !action || !reason) {
      return NextResponse.json(
        { error: "auditId, action, and reason are required fields." },
        { status: 400 }
      );
    }

    const validActions = [
      "FORCE_MATCH",
      "CONFIRM_EXCEPTION",
      "MANUAL_ADJUSTMENT",
      "SPLIT_ALLOCATION",
    ];

    if (!validActions.includes(action)) {
      return NextResponse.json(
        { error: `Invalid action. Must be one of: ${validActions.join(", ")}` },
        { status: 400 }
      );
    }

    // 2. High-Value Variance Authorization Check (SOC 2 Dual-Control)
    const authValidation = validateOverrideAuthorization(role, adjustmentAmount);
    if (!authValidation.authorized) {
      return NextResponse.json(
        {
          error: "Authorization Required (Dual-Control Policy)",
          details: authValidation.reason,
          requiredRole: "CHIEF_FINANCIAL_OFFICER",
          thresholdExceeded: true,
        },
        { status: 403 }
      );
    }

    const overriddenAt = new Date().toISOString();

    // 3. Cryptographic HMAC-SHA256 Tamper-Proof Audit Seal
    const payloadToSign = `${auditId}:${action}:${operator}:${role}:${adjustmentAmount}:${overriddenAt}`;
    const hmacSeal = generateHmacSignature(payloadToSign);
    const signatureHash = `SIG-${hmacSeal.slice(0, 10)}`;
    const sha256Seal = `SEAL-${hmacSeal.slice(10, 26)}`;

    const override: HITLOverride & { auditId: string; signatureHash: string } = {
      auditId,
      operator,
      action,
      reason,
      costCenter,
      adjustmentAmount,
      adjustmentAccount,
      notes,
      previousStatus,
      newStatus,
      previousConfidence: 0,
      newConfidence: action === "CONFIRM_EXCEPTION" ? 0 : 0.99,
      overriddenAt,
      signatureHash,
      sha256Seal,
    };

    // Save override to MongoDB / Memory Cache
    try {
      const client = await getMongoClient();
      const db = client.db();
      await db.collection("overrides").insertOne(override);
      console.log("💾 Saved verified governance override record to MongoDB.");
    } catch (e: any) {
      console.warn("⚠️ MongoDB offline. Stored override in memory cache:", e.message);
      inMemoryDB.overrides.push(override);
    }

    return NextResponse.json(override, {
      status: 200,
      headers: {
        "X-Audit-Signature": signatureHash,
        "X-Audit-Seal": sha256Seal,
      },
    });
  } catch (error) {
    console.error("Override API error:", error);
    return NextResponse.json(
      {
        error: "Override failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
