/**
 * Enterprise Security & Compliance Module
 * Standards: SOC 2 Type II, ISO 27001, OWASP Top 10
 *
 * Capabilities:
 * 1. PII / Financial Data Redaction Pipeline for AI Prompt Safety
 * 2. AES-256-GCM Field-Level Encryption & Decryption
 * 3. Cryptographic HMAC / SHA-256 Audit Trail Signer
 * 4. In-Memory Sliding-Window Rate Limiter
 */

import * as crypto from "crypto";

const DEFAULT_ENCRYPTION_SECRET =
  process.env.ENCRYPTION_SECRET || "c9f8a4e1b7d3f2a8e5c1b9a7d3e2f1c8b7a6d5c4e3f2a1b9c8d7e6f5a4b3c2d1";

// ─── 1. PII & Financial Sanitization Pipeline for AI Prompts ─────────────────

/**
 * Redacts and masks PII / sensitive financial data before passing to LLM prompts:
 * - Bank Account numbers (e.g., A/C 928392819283 -> A/C [REDACTED_ACCT])
 * - Indian PAN Numbers (e.g., ABCDE1234F -> [REDACTED_PAN])
 * - UPI IDs (e.g., user@okhdfcbank -> [MASKED_UPI])
 * - Phone numbers (e.g., +91 9876543210 -> [REDACTED_PHONE])
 * - Credit/Debit Card PANs (16-digit sequences)
 */
export function sanitizeAndRedactPII(memo: string): string {
  if (!memo) return "";

  let sanitized = memo;

  // 1. Redact 10-18 digit Bank Account numbers
  sanitized = sanitized.replace(/\b(?:\d[ -]*?){10,18}\b/g, (match) => {
    // Keep last 4 digits for forensic reconciliation
    const clean = match.replace(/[\s-]/g, "");
    return `[ACCT_XXXX${clean.slice(-4)}]`;
  });

  // 2. Redact Indian PAN Card Numbers (5 letters, 4 digits, 1 letter)
  sanitized = sanitized.replace(/\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/gi, "[REDACTED_PAN]");

  // 3. Mask UPI Handles while retaining bank routing context
  sanitized = sanitized.replace(/\b[a-zA-Z0-9.\-_]{2,256}@(icici|hdfcbank|axisbank|ybl|paytm|sbi|apl|citi|hsbc|okhdfcbank)\b/gi, (match, bank) => {
    return `[UPI_MASKED@${bank}]`;
  });

  // 4. Redact Phone Numbers (+91 or 10-digit Indian mobiles)
  sanitized = sanitized.replace(/(?:\+91[\s-]?)?[6-9]\d{9}\b/g, "[REDACTED_PHONE]");

  // 5. Redact 12-digit Aadhaar sequences
  sanitized = sanitized.replace(/\b\d{4}\s\d{4}\s\d{4}\b/g, "[REDACTED_AADHAAR]");

  return sanitized;
}

// ─── 2. AES-256-GCM Field-Level Encryption & Decryption ──────────────────────

/**
 * Encrypts sensitive financial fields at rest using AES-256-GCM with authentication tag.
 * Output format: `iv:authTag:encryptedHex`
 */
export function encryptField(plainText: string, secretKeyHex = DEFAULT_ENCRYPTION_SECRET): string {
  try {
    const key = crypto.createHash("sha256").update(secretKeyHex).digest();
    const iv = crypto.randomBytes(12); // 96-bit IV for GCM
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

    let encrypted = cipher.update(plainText, "utf8", "hex");
    encrypted += cipher.final("hex");

    const authTag = cipher.getAuthTag().toString("hex");

    return `${iv.toString("hex")}:${authTag}:${encrypted}`;
  } catch (error) {
    console.error("AES-256-GCM Encryption Error:", error);
    throw new Error("Failed to encrypt sensitive field.");
  }
}

/**
 * Decrypts an AES-256-GCM encrypted payload.
 */
export function decryptField(encryptedPayload: string, secretKeyHex = DEFAULT_ENCRYPTION_SECRET): string {
  try {
    const [ivHex, authTagHex, encryptedHex] = encryptedPayload.split(":");
    if (!ivHex || !authTagHex || !encryptedHex) {
      throw new Error("Invalid encrypted payload format.");
    }

    const key = crypto.createHash("sha256").update(secretKeyHex).digest();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (error) {
    console.error("AES-256-GCM Decryption Error:", error);
    throw new Error("Failed to decrypt payload. Cipher integrity check failed.");
  }
}

// ─── 3. Cryptographic HMAC / SHA-256 Audit Seal Generator ────────────────────

export function generateHmacSignature(payload: string, secretKey = DEFAULT_ENCRYPTION_SECRET): string {
  return crypto.createHmac("sha256", secretKey).update(payload).digest("hex").toUpperCase();
}

// ─── 4. In-Memory Sliding-Window Rate Limiter ────────────────────────────────

interface RateLimitRecord {
  timestamps: number[];
}

const rateLimitStore = new Map<string, RateLimitRecord>();

/**
 * Sliding-window rate limiter per client IP or API route.
 * @param identifier Unique client ID (IP or Route)
 * @param limit Max requests allowed in window
 * @param windowMs Window duration in milliseconds
 */
export function checkRateLimit(
  identifier: string,
  limit = 60,
  windowMs = 60000
): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  const windowStart = now - windowMs;

  let record = rateLimitStore.get(identifier);
  if (!record) {
    record = { timestamps: [] };
    rateLimitStore.set(identifier, record);
  }

  // Prune timestamps older than window
  record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

  if (record.timestamps.length >= limit) {
    const oldestTimestamp = record.timestamps[0] || now;
    const resetMs = Math.max(0, oldestTimestamp + windowMs - now);
    return { allowed: false, remaining: 0, resetMs };
  }

  record.timestamps.push(now);
  return {
    allowed: true,
    remaining: limit - record.timestamps.length,
    resetMs: windowMs,
  };
}
