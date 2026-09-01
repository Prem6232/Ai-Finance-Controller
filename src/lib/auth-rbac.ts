/**
 * Role-Based Access Control (RBAC) & High-Value Approval Authorization
 * Standards: SOC 2 Principle of Least Privilege, Segregation of Duties (SoD)
 */

export type UserRole = "FINANCE_ANALYST" | "AUDITOR" | "CHIEF_FINANCIAL_OFFICER";

export interface UserSession {
  userId: string;
  name: string;
  email: string;
  role: UserRole;
  orgId: string;
  issuedAt: string;
}

export const HIGH_VALUE_OVERRIDE_THRESHOLD_INR = 100000; // ₹1,00,000 threshold

export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  FINANCE_ANALYST: [
    "RECONCILE:RUN_SIMULATION",
    "TRANSACTION:VIEW",
    "EXCEPTION:TRIAGE",
    "OVERRIDE:STANDARD_AMOUNT",
    "CHAT:QUERY",
  ],
  AUDITOR: [
    "TRANSACTION:VIEW",
    "AUDIT_TRAIL:VIEW",
    "COMPLIANCE_REPORT:EXPORT",
    "SEAL:VERIFY",
  ],
  CHIEF_FINANCIAL_OFFICER: [
    "RECONCILE:RUN_SIMULATION",
    "TRANSACTION:VIEW",
    "EXCEPTION:TRIAGE",
    "OVERRIDE:STANDARD_AMOUNT",
    "OVERRIDE:HIGH_VALUE_THRESHOLD",
    "AUDIT_TRAIL:VIEW",
    "COMPLIANCE_REPORT:EXPORT",
    "SEAL:VERIFY",
  ],
};

/**
 * Checks if a given role has a specific permission.
 */
export function hasPermission(role: UserRole, permission: string): boolean {
  const permissions = ROLE_PERMISSIONS[role] || [];
  return permissions.includes(permission);
}

/**
 * Enforces Segregation of Duties and High-Value Approval thresholds.
 * Overriding exceptions with adjustments exceeding ₹1,00,000 strictly requires CFO authorization.
 */
export function validateOverrideAuthorization(
  role: UserRole,
  adjustmentAmount: number
): { authorized: boolean; reason?: string } {
  if (adjustmentAmount > HIGH_VALUE_OVERRIDE_THRESHOLD_INR) {
    if (role !== "CHIEF_FINANCIAL_OFFICER") {
      return {
        authorized: false,
        reason: `Dual-Control Policy: Adjustments exceeding ₹${HIGH_VALUE_OVERRIDE_THRESHOLD_INR.toLocaleString("en-IN")} require Chief Financial Officer (CFO) digital sign-off. Current role: ${role}.`,
      };
    }
  }

  if (!hasPermission(role, "OVERRIDE:STANDARD_AMOUNT")) {
    return {
      authorized: false,
      reason: `Access Denied: Role ${role} is not permitted to perform ledger write-offs or force-matches.`,
    };
  }

  return { authorized: true };
}
