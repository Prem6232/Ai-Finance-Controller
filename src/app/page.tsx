"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import Papa from "papaparse";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from "recharts";
import {
  Activity, CheckCircle2, AlertTriangle, Search, Play, Zap, Brain,
  Shield, ShieldCheck, X, ArrowUpDown, Eye, Download, UserCheck,
  AlertCircle, BarChart3, Scale, Split, Clock, Lock, Printer,
  Layers, FileCheck, MessageCircle, Send, Loader2, Sparkles
} from "lucide-react";
import type {
  ReconciliationResponse, AuditEntry, Transaction, TabId,
  BatchLogEntry, DiffClassification, SSEPayload,
} from "@/lib/types";
import { COST_CENTERS } from "@/lib/types";

// ─── Filter & Sort Types ──────────────────────────────────────────────────────

type StatusFilter = "ALL" | "MATCHED" | "FUZZY_MATCH" | "EXCEPTION";
type SortField = "confidence" | "amount" | "status" | "date";
type SortDir = "asc" | "desc";

// ─── UI Badges & Formatting ───────────────────────────────────────────────────

function confidenceBadge(score: number, method: string) {
  if (method === "EXCEPTION") return <span className="badge badge-red font-mono">0% Flagged</span>;
  if (score >= 0.90) return <span className="badge badge-green font-mono">{(score * 100).toFixed(0)}% Match</span>;
  if (score >= 0.70) return <span className="badge badge-yellow font-mono">{(score * 100).toFixed(0)}% Fuzzy</span>;
  return <span className="badge badge-red font-mono">{(score * 100).toFixed(0)}% Low</span>;
}

function statusBadge(status: string) {
  switch (status) {
    case "MATCHED":
      return <span className="badge badge-green font-medium">Reconciled</span>;
    case "FUZZY_MATCH":
      return <span className="badge badge-yellow font-medium">Fuzzy Match</span>;
    case "EXCEPTION":
      return <span className="badge badge-red font-medium">Discrepancy</span>;
    default:
      return <span className="badge badge-neutral">{status}</span>;
  }
}

function methodBadge(method: string, matchType?: string) {
  if (matchType === "1-TO-N") {
    return (
      <span className="badge badge-blue">
        <Split className="w-3 h-3 mr-1 inline-block text-sky-400" />
        1-to-N Split
      </span>
    );
  }
  switch (method) {
    case "DETERMINISTIC":
      return (
        <span className="badge badge-neutral">
          <Zap className="w-3 h-3 text-amber-400 mr-1 inline-block" />
          Layer 1 Hash
        </span>
      );
    case "SPLIT_MATCH":
      return (
        <span className="badge badge-blue">
          <Split className="w-3 h-3 text-sky-400 mr-1 inline-block" />
          1-to-N Split
        </span>
      );
    case "FX_CONVERTED":
      return (
        <span className="badge badge-violet">
          Spot FX
        </span>
      );
    case "AI_VERIFIED":
      return (
        <span className="badge badge-neutral">
          <Brain className="w-3 h-3 text-zinc-400 mr-1 inline-block" />
          Gemini 2.0
        </span>
      );
    case "EXCEPTION":
      return (
        <span className="badge badge-neutral">
          <Shield className="w-3 h-3 text-rose-400 mr-1 inline-block" />
          Exception
        </span>
      );
    case "HITL_OVERRIDE":
      return (
        <span className="badge badge-blue">
          <UserCheck className="w-3 h-3 text-sky-400 mr-1 inline-block" />
          HITL Signed
        </span>
      );
    default:
      return <span className="badge badge-neutral">{method}</span>;
  }
}

function exceptionBadge(code: string | null) {
  if (!code) return null;
  const colors: Record<string, string> = {
    UNLINKED_DEBIT: "badge-violet",
    EXCESSIVE_VARIANCE: "badge-red",
    MEMO_MISMATCH: "badge-yellow",
    DUPLICATE_DEBIT: "badge-red",
    MISSING_BANK_ENTRY: "badge-blue",
    FX_RATE_UNRESOLVED: "badge-violet",
    TEMPORAL_DRIFT_EXCEEDED: "badge-yellow",
    LOW_CONFIDENCE: "badge-yellow",
  };
  return <span className={`badge ${colors[code] || "badge-neutral"} font-mono text-[10px]`}>{code}</span>;
}

function diffTypeBadge(diffType: DiffClassification) {
  switch (diffType) {
    case "FEE":
      return <span className="badge badge-green text-[10px]">Gateway Fee</span>;
    case "TAX":
      return <span className="badge badge-yellow text-[10px]">Sec 194-O TDS</span>;
    case "FX":
      return <span className="badge badge-violet text-[10px]">Spot FX Spread</span>;
    case "DRIFT":
      return <span className="badge badge-yellow text-[10px]">Temporal Drift</span>;
    case "CRITICAL":
      return <span className="badge badge-red text-[10px]">Critical Variance</span>;
    default:
      return <span className="badge badge-neutral text-[10px]">Reference Note</span>;
  }
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(amount);
}

// ─── Chat Message Markdown Renderer ──────────────────────────────────────────

function ChatBubbleContent({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div className="space-y-1.5 leading-relaxed">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={idx} className="h-1" />;

        // Heading 3 or 2
        if (trimmed.startsWith("### ") || trimmed.startsWith("## ")) {
          const headerText = trimmed.replace(/^#+\s*/, "");
          return (
            <h4 key={idx} className="font-bold text-white text-xs mt-2 mb-1">
              {formatInlineText(headerText)}
            </h4>
          );
        }

        // Bullet point
        if (trimmed.startsWith("* ") || trimmed.startsWith("- ")) {
          const itemText = trimmed.replace(/^[\*\-]\s*/, "");
          return (
            <div key={idx} className="flex items-start space-x-1.5 text-[11.5px]">
              <span className="text-zinc-500 mt-0.5 shrink-0">•</span>
              <span className="text-zinc-300">{formatInlineText(itemText)}</span>
            </div>
          );
        }

        // Numbered list
        if (/^\d+\.\s/.test(trimmed)) {
          const num = trimmed.match(/^\d+\./)?.[0] || "•";
          const itemText = trimmed.replace(/^\d+\.\s*/, "");
          return (
            <div key={idx} className="flex items-start space-x-1.5 text-[11.5px]">
              <span className="text-zinc-400 font-mono shrink-0">{num}</span>
              <span className="text-zinc-300">{formatInlineText(itemText)}</span>
            </div>
          );
        }

        // Table row
        if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
          if (trimmed.includes("---")) return null;
          const cells = trimmed.split("|").filter((c) => c !== "");
          return (
            <div key={idx} className="grid grid-cols-4 gap-1.5 bg-[#0e0e11] px-2 py-1 rounded text-[10.5px] font-mono border border-[#1c1c22]">
              {cells.map((cell, cIdx) => (
                <span key={cIdx} className="truncate text-zinc-300">
                  {formatInlineText(cell.trim())}
                </span>
              ))}
            </div>
          );
        }

        return (
          <p key={idx} className="text-[11.5px] text-zinc-300">
            {formatInlineText(trimmed)}
          </p>
        );
      })}
    </div>
  );
}

function formatInlineText(text: string) {
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="text-white font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="bg-[#18181b] text-zinc-200 px-1 py-0.2 rounded font-mono text-[10px] border border-[#27272a]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [loading, setLoading] = useState<boolean>(false);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [currentLayer, setCurrentLayer] = useState<number>(1);
  const [data, setData] = useState<ReconciliationResponse | null>(null);
  const [logs, setLogs] = useState<BatchLogEntry[]>([]);

  // Filters & State
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [sortField, setSortField] = useState<SortField>("confidence");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedAuditEntry, setSelectedAuditEntry] = useState<AuditEntry | null>(null);

  // RBAC Role State
  const [currentRole, setCurrentRole] = useState<"FINANCE_ANALYST" | "AUDITOR" | "CHIEF_FINANCIAL_OFFICER">("CHIEF_FINANCIAL_OFFICER");

  // Workbench Modal
  const [workbenchEntry, setWorkbenchEntry] = useState<AuditEntry | null>(null);
  const [workbenchAction, setWorkbenchAction] = useState<
    "FORCE_MATCH" | "CONFIRM_EXCEPTION" | "MANUAL_ADJUSTMENT" | "SPLIT_ALLOCATION"
  >("FORCE_MATCH");
  const [selectedCostCenter, setSelectedCostCenter] = useState<string>(COST_CENTERS[0]);
  const [adjustmentAmount, setAdjustmentAmount] = useState<number>(0);
  const [adjustmentAccount, setAdjustmentAccount] = useState<string>("6010-Payment-Processing-MDR");
  const [controllerNotes, setControllerNotes] = useState<string>("");
  const [overrideSubmitting, setOverrideSubmitting] = useState<boolean>(false);

  // Chatbot State
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "ai"; text: string }>>([
    {
      role: "ai",
      text: "👋 Welcome to **AI Finance Controller**. Run a live batch simulation to query settlements, split payouts, FX rates, and exception governance.",
    },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Custom File State
  const [customLedger, setCustomLedger] = useState<Transaction[] | null>(null);
  const [customBank, setCustomBank] = useState<Transaction[] | null>(null);
  const [customFileName, setCustomFileName] = useState<{ ledger?: string; bank?: string }>({});

  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // ─── Real-Time SSE Telemetry Stream ─────────────────────────────────────────

  const runSimulationStreaming = async () => {
    setLoading(true);
    setProgressPercent(5);
    setCurrentLayer(1);
    setLogs([
      {
        timestamp: new Date().toISOString(),
        level: "INFO",
        message: "Initiating Autonomous 3-Layer Financial Reconciliation Telemetry Stream...",
      },
    ]);

    try {
      const response = await fetch("/api/reconcile/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ledger: customLedger || undefined,
          bank: customBank || undefined,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Failed to connect to SSE stream.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const payload: SSEPayload = JSON.parse(line.slice(6));
              if (payload.progressPercent) setProgressPercent(payload.progressPercent);
              if (payload.layer) setCurrentLayer(payload.layer);
              if (payload.log) {
                setLogs((prev) => [...prev, payload.log!]);
              }
              if (payload.type === "COMPLETE" && payload.completedResult) {
                setData(payload.completedResult);
                setProgressPercent(100);
              }
            } catch (e) {
              console.error("SSE parse error:", e);
            }
          }
        }
      }
    } catch (err: any) {
      console.warn("SSE stream interrupted. Triggering fallback API handler...", err.message);
      try {
        const res = await fetch("/api/reconcile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ledger: customLedger || undefined,
            bank: customBank || undefined,
          }),
        });
        const fallbackData = await res.json();
        setData(fallbackData);
        setProgressPercent(100);
        setLogs((prev) => [
          ...prev,
          {
            timestamp: new Date().toISOString(),
            level: "SUCCESS",
            message: "Reconciliation completed via fallback executor.",
          },
        ]);
      } catch (e: any) {
        setLogs((prev) => [
          ...prev,
          {
            timestamp: new Date().toISOString(),
            level: "ERROR",
            message: `Execution failed: ${e.message}`,
          },
        ]);
      }
    } finally {
      setLoading(false);
    }
  };

  // ─── Interactive Resolution Workbench Submit Handler ────────────────────────

  const handleWorkbenchSubmit = async () => {
    if (!workbenchEntry) return;
    setOverrideSubmitting(true);

    try {
      const res = await fetch("/api/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auditId: workbenchEntry.id,
          action: workbenchAction,
          reason: controllerNotes || `Resolved via Workbench: ${workbenchAction} assigned to ${selectedCostCenter}`,
          operator: currentRole === "CHIEF_FINANCIAL_OFFICER" ? "Chief Financial Officer (CFO)" : "Finance Analyst",
          role: currentRole,
          costCenter: selectedCostCenter,
          adjustmentAmount,
          adjustmentAccount,
          notes: controllerNotes,
          previousStatus: workbenchEntry.status,
          newStatus: workbenchAction === "CONFIRM_EXCEPTION" ? "EXCEPTION" : "MATCHED",
        }),
      });

      const overrideData = await res.json();

      if (!res.ok) {
        alert(`🔒 Security Authorization Error (${res.status}):\n${overrideData.details || overrideData.error}`);
        return;
      }

      if (data) {
        const updatedAuditLog = data.auditLog.map((entry) => {
          if (entry.id === workbenchEntry.id) {
            return {
              ...entry,
              status: overrideData.newStatus,
              matchMethod: "HITL_OVERRIDE" as const,
              confidenceScore: overrideData.newConfidence,
              hitlOverride: overrideData,
              aiReasoning: `[HITL Sign-Off]: ${overrideData.reason} (Cost Center: ${overrideData.costCenter}, Seal: ${overrideData.sha256Seal})`,
            };
          }
          return entry;
        });

        const matched = updatedAuditLog.filter((e) => e.status !== "EXCEPTION").length;
        const exceptions = updatedAuditLog.filter((e) => e.status === "EXCEPTION").length;

        setData({
          ...data,
          metrics: {
            ...data.metrics,
            overallMatchRate: Math.round((matched / (data.auditLog.length || 1)) * 100),
            exceptionCount: exceptions,
          },
          auditLog: updatedAuditLog,
        });

        setLogs((prev) => [
          ...prev,
          {
            timestamp: new Date().toISOString(),
            level: "SUCCESS",
            message: `Workbench Seal: ${overrideData.action} applied to TxID ${workbenchEntry.ledgerTx?.txId || workbenchEntry.bankTx?.txId} [${overrideData.signatureHash}]`,
          },
        ]);
      }

      setWorkbenchEntry(null);
    } catch (err: any) {
      alert("Failed to submit resolution: " + err.message);
    } finally {
      setOverrideSubmitting(false);
    }
  };

  // ─── Export Handler ─────────────────────────────────────────────────────────

  const handleExport = async (format: "csv" | "json" | "unreconciled-csv") => {
    if (!data) return;
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          auditLog: data.auditLog,
          metrics: data.metrics,
          sha256AuditSeal: data.sha256AuditSeal,
        }),
      });

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-${format}-${new Date().toISOString().slice(0, 10)}.${format === "json" ? "json" : "csv"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err: any) {
      alert("Export failed: " + err.message);
    }
  };

  // ─── Filtered & Sorted Audit Entries ────────────────────────────────────────

  const filteredEntries = useMemo(() => {
    if (!data) return [];
    return data.auditLog.filter((entry) => {
      if (statusFilter !== "ALL" && entry.status !== statusFilter) return false;
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      const lTx = entry.ledgerTx?.txId.toLowerCase() || "";
      const bTx = entry.bankTx?.txId.toLowerCase() || "";
      const lMemo = entry.ledgerTx?.memo.toLowerCase() || "";
      const bMemo = entry.bankTx?.memo.toLowerCase() || "";
      const reason = entry.aiReasoning.toLowerCase();
      const code = entry.exceptionCode?.toLowerCase() || "";
      return (
        lTx.includes(term) ||
        bTx.includes(term) ||
        lMemo.includes(term) ||
        bMemo.includes(term) ||
        reason.includes(term) ||
        code.includes(term)
      );
    });
  }, [data, statusFilter, searchTerm]);

  const sortedEntries = useMemo(() => {
    return [...filteredEntries].sort((a, b) => {
      let comparison = 0;
      if (sortField === "confidence") {
        comparison = a.confidenceScore - b.confidenceScore;
      } else if (sortField === "amount") {
        const amtA = a.ledgerTx?.baseAmountINR || a.ledgerTx?.amount || a.bankTx?.amount || 0;
        const amtB = b.ledgerTx?.baseAmountINR || b.ledgerTx?.amount || b.bankTx?.amount || 0;
        comparison = amtA - amtB;
      } else if (sortField === "status") {
        comparison = a.status.localeCompare(b.status);
      }
      return sortDir === "asc" ? comparison : -comparison;
    });
  }, [filteredEntries, sortField, sortDir]);

  // ─── Chatbot Handler with Rich Context & Instant Chip Execution ────────────

  const handleSendMessage = async (overrideText?: string) => {
    const userMsg = (overrideText || inputMessage).trim();
    if (!userMsg) return;
    if (!overrideText) setInputMessage("");

    setChatMessages((prev) => [...prev, { role: "user", text: userMsg }]);
    setChatLoading(true);

    // Build rich context payload
    const splits = data?.auditLog
      .filter((e) => e.matchMethod === "SPLIT_MATCH" || e.matchType === "1-TO-N")
      .map((e) => ({
        bankTxId: e.bankTx?.txId,
        bankAmount: e.bankTx?.baseAmountINR || e.bankTx?.amount,
        invoiceIds: e.splitLedgerTxs?.map((t) => t.txId),
        count: e.splitLedgerTxs?.length || 2,
        grossSum: (e.splitLedgerTxs || []).reduce((acc, curr) => acc + (curr.baseAmountINR || curr.amount), 0),
        fee: e.feeDeduction,
      }));

    const fxMatches = data?.auditLog
      .filter((e) => e.matchMethod === "FX_CONVERTED" || (e.ledgerTx?.currency && e.ledgerTx.currency !== "INR"))
      .map((e) => ({
        ledgerId: e.ledgerTx?.txId,
        currency: e.ledgerTx?.currency,
        originalAmount: e.ledgerTx?.amount,
        inrAmount: e.ledgerTx?.baseAmountINR || e.ledgerTx?.amount,
        bankAmount: e.bankTx?.baseAmountINR || e.bankTx?.amount,
        fxVariance: e.fxVariance,
      }));

    const exceptions = data?.auditLog
      .filter((e) => e.status === "EXCEPTION")
      .map((e) => ({
        id: e.id,
        ledgerId: e.ledgerTx?.txId,
        bankId: e.bankTx?.txId,
        code: e.exceptionCode,
        ledgerAmount: e.ledgerTx?.baseAmountINR || e.ledgerTx?.amount,
        bankAmount: e.bankTx?.baseAmountINR || e.bankTx?.amount,
        reason: e.aiReasoning,
      }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg,
          context: {
            metrics: data?.metrics,
            sha256Seal: data?.sha256AuditSeal,
            exceptions,
            splits,
            fxMatches,
          },
        }),
      });

      const result = await res.json();
      setChatMessages((prev) => [...prev, { role: "ai", text: result.reply || "No response received." }]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { role: "ai", text: "⚠️ Unable to query AI Agent. Please verify connection." },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  // ─── Custom CSV/JSON Upload Helpers ─────────────────────────────────────────

  const handleFileUpload = (file: File, type: "ledger" | "bank") => {
    if (file.name.endsWith(".json")) {
      file.text().then((text) => {
        const parsed = JSON.parse(text);
        if (type === "ledger") setCustomLedger(parsed);
        else setCustomBank(parsed);
        setCustomFileName((prev) => ({ ...prev, [type]: file.name }));
      });
    } else if (file.name.endsWith(".csv")) {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const mapped = (results.data as any[]).map((row: any) => ({
            txId: row.txId || row.TransactionID || row.ID || "TXN-CSV",
            amount: parseFloat(row.amount || row.Amount || row.Value || "0"),
            currency: (row.currency || row.Currency || "INR") as any,
            timestamp: row.timestamp || row.Date || new Date().toISOString(),
            memo: row.memo || row.Description || row.Memo || "",
          }));
          if (type === "ledger") setCustomLedger(mapped);
          else setCustomBank(mapped);
          setCustomFileName((prev) => ({ ...prev, [type]: file.name }));
        },
      });
    }
  };

  return (
    <div className="min-h-screen bg-black text-[#EDEDED] font-sans antialiased flex flex-col">
      {/* Top Navbar */}
      <header className="sticky top-0 z-30 border-b border-[#18181b] bg-[#050505]/90 backdrop-blur-md px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-[#121215] border border-[#27272a] flex items-center justify-center">
            <Scale className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-sm font-semibold tracking-tight text-white">AI Finance Controller</h1>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#18181b] text-zinc-300 border border-[#27272a]">
                v2.0
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">Autonomous 3-Layer Settlement & Governance Engine</p>
          </div>
        </div>

        {/* Global Action Bar & RBAC Switcher */}
        <div className="flex items-center space-x-2.5">
          {/* RBAC Role Switcher */}
          <div className="flex items-center space-x-1 bg-[#121215] border border-[#27272a] rounded-lg px-2 py-1">
            <UserCheck className="w-3 h-3 text-emerald-400" />
            <select
              value={currentRole}
              onChange={(e) => setCurrentRole(e.target.value as any)}
              className="bg-transparent text-[11px] font-mono font-medium text-zinc-300 focus:outline-none cursor-pointer"
              title="Switch RBAC Security Role"
            >
              <option value="CHIEF_FINANCIAL_OFFICER" className="bg-[#09090b] text-white">Role: CFO (Full Access)</option>
              <option value="FINANCE_ANALYST" className="bg-[#09090b] text-white">Role: Analyst (Standard)</option>
              <option value="AUDITOR" className="bg-[#09090b] text-white">Role: Auditor (Read-Only)</option>
            </select>
          </div>

          <button
            onClick={runSimulationStreaming}
            disabled={loading}
            className="flex items-center space-x-2 bg-white hover:bg-zinc-200 text-black text-xs font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50 shadow-sm"
          >
            {loading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-black" />
                <span>Running L{currentLayer}... ({progressPercent}%)</span>
              </>
            ) : (
              <>
                <Play className="w-3 h-3 fill-current" />
                <span>Run 60-Record Simulation</span>
              </>
            )}
          </button>

          {data && (
            <button
              onClick={() => handleExport("unreconciled-csv")}
              className="flex items-center space-x-1.5 bg-[#121215] hover:bg-[#1c1c22] text-zinc-300 text-xs font-medium px-3 py-2 rounded-lg border border-[#27272a] transition"
            >
              <Download className="w-3.5 h-3.5 text-rose-400" />
              <span>Unreconciled CSV</span>
            </button>
          )}

          {data && (
            <button
              onClick={() => setActiveTab("compliance-report")}
              className="flex items-center space-x-1.5 bg-[#121215] hover:bg-[#1c1c22] text-zinc-300 text-xs font-medium px-3 py-2 rounded-lg border border-[#27272a] transition"
            >
              <FileCheck className="w-3.5 h-3.5 text-zinc-300" />
              <span>Audit Certificate</span>
            </button>
          )}

          <button
            onClick={() => setIsChatOpen(!isChatOpen)}
            className="relative p-2 rounded-lg bg-[#121215] hover:bg-[#1c1c22] text-zinc-300 border border-[#27272a] transition"
            title="Open Settlement Q&A Agent"
          >
            <MessageCircle className="w-4 h-4 text-zinc-300" />
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-black" />
          </button>
        </div>
      </header>

      {/* Progress Telemetry Bar */}
      {loading && (
        <div className="w-full bg-[#08080a] border-b border-[#18181b] px-6 py-2">
          <div className="flex items-center justify-between text-xs text-zinc-400 mb-1 font-mono">
            <span className="flex items-center space-x-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>
                Layer {currentLayer}: {currentLayer === 1 ? "O(1) Hash Map" : currentLayer === 1.5 ? "1-to-N Split Solver" : currentLayer === 2 ? "Gemini 2.0 Agent" : "Exception Triage"}
              </span>
            </span>
            <span className="text-white font-semibold">{progressPercent}%</span>
          </div>
          <div className="w-full bg-[#18181b] rounded-full h-1 overflow-hidden">
            <div
              className="bg-white h-full rounded-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Main Navigation Tabs */}
      <div className="border-b border-[#18181b] bg-[#050505]/80 px-6 flex items-center justify-between">
        <nav className="flex space-x-1">
          {[
            { id: "overview", label: "Executive Overview", icon: BarChart3 },
            { id: "transactions", label: "Transactions", icon: Layers, count: data?.auditLog.length },
            { id: "exceptions", label: "Exceptions Queue", icon: AlertTriangle, count: data?.metrics.exceptionCount, alert: true },
            { id: "ai-investigation", label: "AI Forensic Trace", icon: Brain },
            { id: "approvals", label: "HITL Approvals", icon: UserCheck },
            { id: "compliance-report", label: "SOX Audit Report", icon: ShieldCheck },
            { id: "audit-log", label: "Telemetry Stream", icon: Activity },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabId)}
                className={`flex items-center space-x-2 px-3.5 py-3 text-xs font-medium border-b-2 transition ${
                  isActive
                    ? "border-white text-white font-semibold"
                    : "border-transparent text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? "text-white" : "text-zinc-500"}`} />
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                      tab.alert && tab.count > 0
                        ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                        : "bg-[#18181b] text-zinc-400"
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {data?.sha256AuditSeal && (
          <div className="hidden lg:flex items-center space-x-2 text-[11px] font-mono text-zinc-300 bg-[#0e0e11] border border-[#222228] px-2.5 py-1 rounded">
            <Lock className="w-3 h-3 text-emerald-400" />
            <span>Seal: {data.sha256AuditSeal.slice(0, 18)}...</span>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6">
        {/* Zero State */}
        {!data && !loading && (
          <div className="card p-10 text-center space-y-4">
            <div className="w-12 h-12 rounded-xl bg-[#121215] border border-[#27272a] mx-auto flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div className="max-w-md mx-auto space-y-1.5">
              <h2 className="text-base font-bold text-white tracking-tight">Financial Reconciliation Engine</h2>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Deterministic $O(1)$ lookup, 1-to-N bulk split knapsack solver, cross-border spot FX normalization, and Gemini 2.0 governance.
              </p>
            </div>

            <div className="pt-2">
              <button
                onClick={runSimulationStreaming}
                className="bg-white hover:bg-zinc-200 text-black text-xs font-semibold px-5 py-2.5 rounded-lg shadow transition"
              >
                Run 60-Record Simulation
              </button>
            </div>

            {/* Custom file upload strip */}
            <div className="pt-6 border-t border-[#18181b] max-w-2xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
              <div className="p-3 rounded-lg bg-[#0a0a0d] border border-[#1c1c22]">
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Custom Ledger File (CSV / JSON)
                </label>
                <input
                  type="file"
                  accept=".csv,.json"
                  onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], "ledger")}
                  className="text-xs text-zinc-400 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-[#1a1a20] file:text-zinc-200"
                />
                {customFileName.ledger && (
                  <span className="text-[10px] text-emerald-400 mt-1 block">Loaded: {customFileName.ledger}</span>
                )}
              </div>
              <div className="p-3 rounded-lg bg-[#0a0a0d] border border-[#1c1c22]">
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Custom Bank Statement (CSV / JSON)
                </label>
                <input
                  type="file"
                  accept=".csv,.json"
                  onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], "bank")}
                  className="text-xs text-zinc-400 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-[#1a1a20] file:text-zinc-200"
                />
                {customFileName.bank && (
                  <span className="text-[10px] text-emerald-400 mt-1 block">Loaded: {customFileName.bank}</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ─── TAB 1: EXECUTIVE OVERVIEW ──────────────────────────────────────── */}
        {activeTab === "overview" && data && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="card p-4 space-y-1">
                <div className="flex items-center justify-between text-zinc-400 text-xs font-medium">
                  <span>Auto-Match Rate</span>
                  <Activity className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-2xl font-bold text-white font-mono">{data.metrics.overallMatchRate}%</div>
                <div className="text-[11px] text-zinc-400 flex items-center space-x-1">
                  <span className="text-emerald-400 font-semibold">{data.metrics.deterministicCount + data.metrics.splitMatchCount + data.metrics.aiVerifiedCount}</span>
                  <span>of {data.metrics.totalRecords} cleared</span>
                </div>
              </div>

              <div className="card p-4 space-y-1">
                <div className="flex items-center justify-between text-zinc-400 text-xs font-medium">
                  <span>Reconciled Volume</span>
                  <CheckCircle2 className="w-4 h-4 text-zinc-300" />
                </div>
                <div className="text-2xl font-bold text-white font-mono">{formatCurrency(data.metrics.matchedVolume)}</div>
                <div className="text-[11px] text-zinc-400">
                  Total: {formatCurrency(data.metrics.totalVolume)}
                </div>
              </div>

              <div className="card p-4 space-y-1">
                <div className="flex items-center justify-between text-zinc-400 text-xs font-medium">
                  <span>Cash At Risk</span>
                  <AlertTriangle className="w-4 h-4 text-rose-400" />
                </div>
                <div className="text-2xl font-bold text-rose-400 font-mono">{formatCurrency(data.metrics.exceptionVolume)}</div>
                <div className="text-[11px] text-rose-300/80">
                  {data.metrics.exceptionCount} exceptions flagged
                </div>
              </div>

              <div className="card p-4 space-y-1">
                <div className="flex items-center justify-between text-zinc-400 text-xs font-medium">
                  <span>Throughput</span>
                  <Zap className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-2xl font-bold text-white font-mono">{data.metrics.throughputMs} ms</div>
                <div className="text-[11px] text-zinc-400">
                  Fees: {formatCurrency(data.metrics.gatewayFeesTotal)}
                </div>
              </div>
            </div>

            {/* Charts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">Match Breakdown</h3>
                  <span className="text-[10px] text-zinc-400 font-mono">By Layer</span>
                </div>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[
                          { name: "Layer 1 (Deterministic)", value: data.metrics.deterministicCount, color: "#34d399" },
                          { name: "Layer 1.5 (Split 1-to-N)", value: data.metrics.splitMatchCount, color: "#38bdf8" },
                          { name: "Layer 2 (Gemini AI / FX)", value: data.metrics.aiVerifiedCount, color: "#a1a1aa" },
                          { name: "Layer 3 (Exceptions)", value: data.metrics.exceptionCount, color: "#fb7185" },
                        ]}
                        innerRadius={50}
                        outerRadius={75}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {[
                          { color: "#34d399" },
                          { color: "#38bdf8" },
                          { color: "#a1a1aa" },
                          { color: "#fb7185" },
                        ].map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ backgroundColor: "#09090b", borderColor: "#27272a", borderRadius: "8px", fontSize: "12px", color: "#fff" }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                  <div className="flex items-center space-x-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span className="text-zinc-300">L1 ({data.metrics.deterministicCount})</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="w-2 h-2 rounded-full bg-sky-400" />
                    <span className="text-zinc-300">L1.5 ({data.metrics.splitMatchCount})</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="w-2 h-2 rounded-full bg-zinc-400" />
                    <span className="text-zinc-300">L2 ({data.metrics.aiVerifiedCount})</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="w-2 h-2 rounded-full bg-rose-400" />
                    <span className="text-zinc-300">L3 ({data.metrics.exceptionCount})</span>
                  </div>
                </div>
              </div>

              <div className="card p-5 space-y-4 lg:col-span-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">Volume Allocation</h3>
                  <span className="text-[10px] font-mono text-zinc-400">Values in INR</span>
                </div>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={[
                        { name: "Total Gross", amount: data.metrics.totalVolume, fill: "#e4e4e7" },
                        { name: "Reconciled", amount: data.metrics.matchedVolume, fill: "#34d399" },
                        { name: "Cash At Risk", amount: data.metrics.exceptionVolume, fill: "#fb7185" },
                        { name: "Gateway Fees", amount: data.metrics.gatewayFeesTotal, fill: "#fbbf24" },
                        { name: "Sec 194-O TDS", amount: data.metrics.tdsTotal, fill: "#c084fc" },
                      ]}
                      margin={{ top: 10, right: 10, left: 10, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#18181b" vertical={false} />
                      <XAxis dataKey="name" stroke="#71717a" fontSize={11} tickLine={false} />
                      <YAxis stroke="#71717a" fontSize={11} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#09090b", borderColor: "#27272a", borderRadius: "8px", fontSize: "12px", color: "#fff" }}
                        formatter={(val: any) => [formatCurrency(Number(val)), "Amount"]}
                      />
                      <Bar dataKey="amount" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── TAB 2: TRANSACTIONS TABLE ─────────────────────────────────────── */}
        {activeTab === "transactions" && data && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#08080a] p-3 rounded-xl border border-[#18181b]">
              <div className="relative w-full sm:w-72">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Search TxID, memo, reason..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-[#000000] border border-[#27272a] rounded-lg text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-400"
                />
              </div>

              <div className="flex items-center space-x-2 w-full sm:w-auto justify-between sm:justify-end">
                <div className="flex items-center space-x-1 bg-[#000000] p-1 rounded-lg border border-[#18181b]">
                  {(["ALL", "MATCHED", "FUZZY_MATCH", "EXCEPTION"] as StatusFilter[]).map((st) => (
                    <button
                      key={st}
                      onClick={() => setStatusFilter(st)}
                      className={`text-[11px] px-2.5 py-1 rounded transition font-medium ${
                        statusFilter === st
                          ? "bg-white text-black font-semibold"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {st === "ALL" ? "All Records" : st === "FUZZY_MATCH" ? "Fuzzy Match" : st}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => handleExport("csv")}
                  className="flex items-center space-x-1.5 text-xs bg-[#121215] hover:bg-[#1c1c22] text-zinc-300 px-3 py-1.5 rounded-lg border border-[#27272a] transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>CSV</span>
                </button>
              </div>
            </div>

            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#18181b] bg-[#050505] text-zinc-400 uppercase tracking-wider font-semibold text-[10px]">
                      <th className="py-3 px-4">Audit ID</th>
                      <th className="py-3 px-4">Ledger Tx</th>
                      <th className="py-3 px-4">Bank Payout</th>
                      <th className="py-3 px-4">Amount / Fee</th>
                      <th className="py-3 px-4">Layer Method</th>
                      <th className="py-3 px-4">Confidence</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#18181b] font-mono text-[11px]">
                    {sortedEntries.map((entry) => {
                      const lINR = entry.ledgerTx ? (entry.ledgerTx.baseAmountINR || entry.ledgerTx.amount) : 0;
                      return (
                        <tr key={entry.id} className="hover:bg-[#0e0e11] transition">
                          <td className="py-3 px-4 font-semibold text-zinc-300">
                            {entry.id.slice(0, 14)}
                          </td>
                          <td className="py-3 px-4">
                            {entry.splitLedgerTxs && entry.splitLedgerTxs.length > 1 ? (
                              <div>
                                <span className="text-sky-400 font-semibold">{entry.splitLedgerTxs.length} Invoices Bundled</span>
                                <div className="text-[10px] text-zinc-400 font-sans truncate max-w-xs">
                                  {entry.splitLedgerTxs.map((t) => t.txId).join(", ")}
                                </div>
                              </div>
                            ) : entry.ledgerTx ? (
                              <div>
                                <div className="flex items-center space-x-1.5">
                                  <span className="text-zinc-200 font-semibold">{entry.ledgerTx.txId}</span>
                                  {entry.ledgerTx.currency && entry.ledgerTx.currency !== "INR" && (
                                    <span className="badge badge-violet text-[9px]">
                                      {entry.ledgerTx.currency} ${entry.ledgerTx.amount}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-zinc-400 font-sans truncate max-w-xs">{entry.ledgerTx.memo}</div>
                              </div>
                            ) : (
                              <span className="text-zinc-500 italic">None (Bank Only)</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            {entry.bankTx ? (
                              <div>
                                <span className="text-zinc-200 font-semibold">{entry.bankTx.txId}</span>
                                <div className="text-[10px] text-zinc-400 font-sans truncate max-w-xs">{entry.bankTx.memo}</div>
                              </div>
                            ) : (
                              <span className="text-zinc-500 italic">None (Ledger Only)</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div>
                              <span className="font-semibold text-zinc-200">
                                {entry.ledgerTx ? formatCurrency(lINR) : "—"}
                              </span>
                              {entry.feeDeduction > 0 && (
                                <div className="text-[10px] text-emerald-400 font-sans">
                                  Fee: -{formatCurrency(entry.feeDeduction)}
                                </div>
                              )}
                              {entry.dateDriftDays && entry.dateDriftDays > 0 ? (
                                <div className="text-[10px] text-amber-400 font-sans flex items-center space-x-1">
                                  <Clock className="w-2.5 h-2.5" />
                                  <span>T+{entry.dateDriftDays}d delay</span>
                                </div>
                              ) : null}
                            </div>
                          </td>
                          <td className="py-3 px-4">{methodBadge(entry.matchMethod, entry.matchType)}</td>
                          <td className="py-3 px-4">{confidenceBadge(entry.confidenceScore, entry.matchMethod)}</td>
                          <td className="py-3 px-4">{statusBadge(entry.status)}</td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => setSelectedAuditEntry(entry)}
                              className="text-xs bg-[#121215] hover:bg-[#1a1a20] text-zinc-300 px-2.5 py-1 rounded border border-[#27272a] transition"
                            >
                              Trace
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ─── TAB 3: EXCEPTION WORKBENCH ────────────────────────────────────── */}
        {activeTab === "exceptions" && data && (
          <div className="space-y-4">
            <div className="card p-4 flex items-center justify-between border-l-4 border-l-rose-500">
              <div className="flex items-center space-x-3">
                <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
                <div>
                  <h3 className="text-xs font-semibold text-white uppercase tracking-wider">
                    Discrepancy Triage & Resolution Queue
                  </h3>
                  <p className="text-xs text-zinc-400">
                    {data.metrics.exceptionCount} unresolved items requiring forensic adjustment or cost center allocation.
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleExport("unreconciled-csv")}
                className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold px-3.5 py-2 rounded-lg transition flex items-center space-x-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Unreconciled CSV</span>
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {data.auditLog
                .filter((e) => e.status === "EXCEPTION")
                .map((entry) => {
                  const lINR = entry.ledgerTx ? (entry.ledgerTx.baseAmountINR || entry.ledgerTx.amount) : 0;
                  const bINR = entry.bankTx ? (entry.bankTx.baseAmountINR || entry.bankTx.amount) : 0;
                  return (
                    <div
                      key={entry.id}
                      className="card p-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      <div className="space-y-2 flex-1">
                        <div className="flex items-center space-x-2">
                          <span className="font-mono font-bold text-zinc-200 text-xs">{entry.id}</span>
                          {exceptionBadge(entry.exceptionCode)}
                          {entry.dateDriftDays && entry.dateDriftDays > 0 ? (
                            <span className="badge badge-yellow text-[10px]">T+{entry.dateDriftDays}d drift</span>
                          ) : null}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                          <div className="bg-[#050505] p-2.5 rounded-lg border border-[#18181b]">
                            <span className="text-[10px] text-zinc-500 uppercase font-semibold">Ledger</span>
                            <div className="font-mono text-zinc-200 font-semibold mt-0.5">
                              {entry.ledgerTx ? `${entry.ledgerTx.txId} · ${formatCurrency(lINR)}` : "None"}
                            </div>
                            <div className="text-[11px] text-zinc-400 truncate">{entry.ledgerTx?.memo || "No internal invoice"}</div>
                          </div>
                          <div className="bg-[#050505] p-2.5 rounded-lg border border-[#18181b]">
                            <span className="text-[10px] text-zinc-500 uppercase font-semibold">Bank</span>
                            <div className="font-mono text-zinc-200 font-semibold mt-0.5">
                              {entry.bankTx ? `${entry.bankTx.txId} · ${formatCurrency(bINR)}` : "None"}
                            </div>
                            <div className="text-[11px] text-zinc-400 truncate">{entry.bankTx?.memo || "No bank statement match"}</div>
                          </div>
                        </div>

                        <p className="text-xs text-zinc-300 italic bg-[#050505] p-2 rounded border border-[#18181b]">
                          {entry.aiReasoning}
                        </p>
                      </div>

                      <div className="flex md:flex-col items-center gap-2 shrink-0">
                        <button
                          onClick={() => {
                            setWorkbenchEntry(entry);
                            setAdjustmentAmount(entry.amountDifference);
                            setControllerNotes("");
                          }}
                          className="w-full bg-white hover:bg-zinc-200 text-black text-xs font-semibold px-4 py-2 rounded-lg transition flex items-center justify-center space-x-1.5"
                        >
                          <Scale className="w-3.5 h-3.5" />
                          <span>Workbench Resolve</span>
                        </button>
                        <button
                          onClick={() => setSelectedAuditEntry(entry)}
                          className="w-full bg-[#121215] hover:bg-[#1a1a20] text-zinc-300 text-xs font-medium px-4 py-2 rounded-lg border border-[#27272a] transition flex items-center justify-center space-x-1"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>View Diff</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* ─── TAB 4: AI FORENSIC TRACE ───────────────────────────────────────── */}
        {activeTab === "ai-investigation" && data && (
          <div className="space-y-4">
            <div className="card p-5 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
                  <Brain className="w-4 h-4 text-zinc-400" />
                  <span>Gemini 2.0 Flash AI Forensic Evaluation</span>
                </h3>
                <span className="badge badge-green text-xs font-mono">Circuit Breaker: CLOSED (Active)</span>
              </div>
              <p className="text-xs text-zinc-400">
                Layer 2 structured evaluation handles fuzzy discrepancies, gateway surcharges (MDR + GST), Section 194-O TDS withholding, and spot FX conversions.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.auditLog
                .filter((e) => e.matchMethod === "AI_VERIFIED" || e.matchMethod === "FX_CONVERTED" || e.matchMethod === "SPLIT_MATCH")
                .map((entry) => (
                  <div key={entry.id} className="card p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-semibold text-zinc-200">{entry.id}</span>
                      {methodBadge(entry.matchMethod, entry.matchType)}
                    </div>

                    <div className="text-xs space-y-1">
                      <div className="flex justify-between text-zinc-400">
                        <span>Ledger: <strong className="text-zinc-200 font-mono">{entry.ledgerTx?.txId}</strong></span>
                        <span>Bank: <strong className="text-zinc-200 font-mono">{entry.bankTx?.txId}</strong></span>
                      </div>
                      <div className="flex justify-between text-zinc-400">
                        <span>Gross: <strong className="text-zinc-200 font-mono">{formatCurrency(entry.ledgerTx?.baseAmountINR || entry.ledgerTx?.amount || 0)}</strong></span>
                        <span>Net: <strong className="text-zinc-200 font-mono">{formatCurrency(entry.bankTx?.baseAmountINR || entry.bankTx?.amount || 0)}</strong></span>
                      </div>
                    </div>

                    {entry.fieldDifferences && entry.fieldDifferences.length > 0 && (
                      <div className="space-y-1 pt-1 border-t border-[#18181b]">
                        {entry.fieldDifferences.map((diff, idx) => (
                          <div key={idx} className="flex items-center justify-between text-[11px] bg-[#050505] px-2 py-1 rounded">
                            <span className="text-zinc-400">{diff.field}</span>
                            {diffTypeBadge(diff.diffType)}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="text-xs text-zinc-300 bg-[#050505] p-2 rounded border border-[#18181b]">
                      {entry.aiReasoning}
                    </div>

                    <div className="flex items-center justify-between pt-1 text-[11px] text-zinc-400">
                      <span>Confidence: <strong className="text-emerald-400 font-mono">{(entry.confidenceScore * 100).toFixed(0)}%</strong></span>
                      <button
                        onClick={() => setSelectedAuditEntry(entry)}
                        className="text-zinc-300 hover:text-white underline"
                      >
                        Inspect Steps
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* ─── TAB 5: HITL APPROVALS ─────────────────────────────────────────── */}
        {activeTab === "approvals" && data && (
          <div className="space-y-4">
            <div className="card p-5 space-y-1">
              <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
                <UserCheck className="w-4 h-4 text-zinc-300" />
                <span>Human-In-The-Loop (HITL) Sign-Off Ledger</span>
              </h3>
              <p className="text-xs text-zinc-400">
                Manual ledger adjustments, force matches, and write-offs stamped with cryptographic SHA-256 seal.
              </p>
            </div>

            <div className="card overflow-hidden">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[#18181b] bg-[#050505] text-zinc-400 uppercase tracking-wider font-semibold text-[10px]">
                    <th className="py-3 px-4">Audit ID</th>
                    <th className="py-3 px-4">Operator</th>
                    <th className="py-3 px-4">Action</th>
                    <th className="py-3 px-4">Cost Center</th>
                    <th className="py-3 px-4">Adjustment</th>
                    <th className="py-3 px-4">Signature Seal</th>
                    <th className="py-3 px-4">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#18181b] font-mono text-[11px]">
                  {data.auditLog
                    .filter((e) => e.hitlOverride)
                    .map((entry) => {
                      const h = entry.hitlOverride!;
                      return (
                        <tr key={entry.id} className="hover:bg-[#0e0e11]">
                          <td className="py-3 px-4 font-semibold text-zinc-300">{entry.id}</td>
                          <td className="py-3 px-4 text-zinc-200">{h.operator}</td>
                          <td className="py-3 px-4">
                            <span className="badge badge-blue">{h.action}</span>
                          </td>
                          <td className="py-3 px-4 text-zinc-300 font-sans">{h.costCenter || "Unassigned"}</td>
                          <td className="py-3 px-4 text-emerald-400 font-semibold">{formatCurrency(h.adjustmentAmount || 0)}</td>
                          <td className="py-3 px-4">
                            <span className="text-[10px] text-amber-400">{h.signatureHash || h.sha256Seal}</span>
                          </td>
                          <td className="py-3 px-4 text-zinc-400">{new Date(h.overriddenAt).toLocaleString("en-IN")}</td>
                        </tr>
                      );
                    })}
                  {data.auditLog.filter((e) => e.hitlOverride).length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-zinc-500 italic">
                        No manual overrides applied yet. Resolve discrepancies in the <strong>Exceptions Queue</strong>.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ─── TAB 6: SOX COMPLIANCE REPORT ──────────────────────────────────── */}
        {activeTab === "compliance-report" && data && (
          <div className="space-y-6">
            <div className="card p-8 space-y-6 bg-[#08080a] border border-[#27272a] rounded-2xl print:bg-white print:text-black">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-[#18181b] gap-4">
                <div>
                  <div className="flex items-center space-x-2">
                    <ShieldCheck className="w-5 h-5 text-white" />
                    <h2 className="text-base font-bold text-white tracking-tight">
                      FINANCIAL RECONCILIATION & GOVERNANCE CERTIFICATE
                    </h2>
                  </div>
                  <p className="text-xs text-zinc-400 font-mono mt-1">
                    Framework: SOX 404 / RBI Payment Intermediary Norms · Ref: {data.timestamp.slice(0, 10)}
                  </p>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => window.print()}
                    className="flex items-center space-x-1.5 bg-white hover:bg-zinc-200 text-black text-xs font-semibold px-4 py-2 rounded-lg transition print:hidden"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Print / Save PDF</span>
                  </button>
                  <button
                    onClick={() => handleExport("csv")}
                    className="flex items-center space-x-1.5 bg-[#121215] hover:bg-[#1a1a20] text-zinc-200 text-xs font-medium px-3 py-2 rounded-lg border border-[#27272a] transition print:hidden"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download CSV</span>
                  </button>
                </div>
              </div>

              {/* SHA-256 Seal Banner */}
              <div className="bg-[#050505] border border-[#222228] p-4 rounded-xl space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase text-zinc-300 flex items-center space-x-1.5">
                    <Lock className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Cryptographic Audit Seal</span>
                  </span>
                  <span className="text-[10px] text-emerald-400 font-mono">STATUS: TAMPER-PROOF VERIFIED</span>
                </div>
                <div className="font-mono text-sm text-zinc-200 font-bold break-all">
                  {data.sha256AuditSeal}
                </div>
              </div>

              {/* KPI Summary Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                <div className="p-3 rounded-lg bg-[#050505] border border-[#18181b]">
                  <span className="text-[10px] text-zinc-400 uppercase font-semibold">Total Volume</span>
                  <div className="text-base font-bold text-white font-mono">{formatCurrency(data.metrics.totalVolume)}</div>
                  <span className="text-[10px] text-zinc-500">{data.metrics.totalRecords} Records</span>
                </div>

                <div className="p-3 rounded-lg bg-[#050505] border border-[#18181b]">
                  <span className="text-[10px] text-zinc-400 uppercase font-semibold">Reconciled</span>
                  <div className="text-base font-bold text-emerald-400 font-mono">{formatCurrency(data.metrics.matchedVolume)}</div>
                  <span className="text-[10px] text-emerald-400 font-semibold">{data.metrics.overallMatchRate}% Match</span>
                </div>

                <div className="p-3 rounded-lg bg-[#050505] border border-[#18181b]">
                  <span className="text-[10px] text-zinc-400 uppercase font-semibold">Gateway Fees</span>
                  <div className="text-base font-bold text-amber-400 font-mono">{formatCurrency(data.metrics.gatewayFeesTotal)}</div>
                  <span className="text-[10px] text-zinc-500">MDR + GST</span>
                </div>

                <div className="p-3 rounded-lg bg-[#050505] border border-[#18181b]">
                  <span className="text-[10px] text-zinc-400 uppercase font-semibold">Sec 194-O TDS</span>
                  <div className="text-base font-bold text-purple-400 font-mono">{formatCurrency(data.metrics.tdsTotal)}</div>
                  <span className="text-[10px] text-zinc-500">1.0% Withheld</span>
                </div>
              </div>

              {/* Execution Layers Table */}
              <div className="space-y-2 pt-2">
                <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                  Engine Execution Layer Summary
                </h4>
                <table className="w-full text-left text-xs border-collapse font-sans">
                  <thead>
                    <tr className="border-b border-[#18181b] bg-[#050505] text-zinc-400 text-[10px] uppercase font-semibold">
                      <th className="py-2.5 px-3">Execution Layer</th>
                      <th className="py-2.5 px-3">Resolution Mechanism</th>
                      <th className="py-2.5 px-3">Count</th>
                      <th className="py-2.5 px-3">Volume</th>
                      <th className="py-2.5 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#18181b] text-[11px] font-mono">
                    <tr>
                      <td className="py-2.5 px-3 font-semibold text-zinc-200">Layer 1: Deterministic</td>
                      <td className="py-2.5 px-3 font-sans text-zinc-400">Exact TxID & Amount Hash Map</td>
                      <td className="py-2.5 px-3 text-zinc-200">{data.metrics.deterministicCount}</td>
                      <td className="py-2.5 px-3 text-zinc-200">Cleared</td>
                      <td className="py-2.5 px-3"><span className="badge badge-green">Passed</span></td>
                    </tr>
                    <tr>
                      <td className="py-2.5 px-3 font-semibold text-zinc-200">Layer 1.5: Split Solver</td>
                      <td className="py-2.5 px-3 font-sans text-zinc-400">1-to-N Bulk Payout Subset Solver</td>
                      <td className="py-2.5 px-3 text-zinc-200">{data.metrics.splitMatchCount}</td>
                      <td className="py-2.5 px-3 text-zinc-200">Cleared</td>
                      <td className="py-2.5 px-3"><span className="badge badge-blue">Passed</span></td>
                    </tr>
                    <tr>
                      <td className="py-2.5 px-3 font-semibold text-zinc-200">Layer 2: Gemini Agent</td>
                      <td className="py-2.5 px-3 font-sans text-zinc-400">Gemini 2.0 / MDR / TDS / FX</td>
                      <td className="py-2.5 px-3 text-zinc-200">{data.metrics.aiVerifiedCount}</td>
                      <td className="py-2.5 px-3 text-zinc-200">AI-Verified</td>
                      <td className="py-2.5 px-3"><span className="badge badge-neutral">Passed</span></td>
                    </tr>
                    <tr>
                      <td className="py-2.5 px-3 font-semibold text-zinc-200">Layer 3: Exceptions</td>
                      <td className="py-2.5 px-3 font-sans text-zinc-400">Unlinked / Duplicate / Variance</td>
                      <td className="py-2.5 px-3 text-rose-400 font-bold">{data.metrics.exceptionCount}</td>
                      <td className="py-2.5 px-3 text-rose-400 font-bold">{formatCurrency(data.metrics.exceptionVolume)}</td>
                      <td className="py-2.5 px-3"><span className="badge badge-red">Requires HITL</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ─── TAB 7: TELEMETRY CONSOLE ──────────────────────────────────────── */}
        {activeTab === "audit-log" && (
          <div className="space-y-4">
            <div className="card p-4 bg-[#050505] border border-[#18181b] rounded-xl space-y-3 font-mono text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-[#18181b] text-zinc-400">
                <span className="flex items-center space-x-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-white font-semibold">Live Telemetry & SSE Event Stream</span>
                </span>
                <span className="text-[10px] text-zinc-500">{logs.length} events</span>
              </div>

              <div className="h-96 overflow-y-auto space-y-1.5 pr-2">
                {logs.map((log, idx) => (
                  <div key={idx} className="flex items-start space-x-2 text-[11px] leading-relaxed">
                    <span className="text-zinc-500 shrink-0">[{log.timestamp.slice(11, 19)}]</span>
                    <span
                      className={`font-semibold shrink-0 ${
                        log.level === "SUCCESS"
                          ? "text-emerald-400"
                          : log.level === "WARN"
                          ? "text-amber-400"
                          : log.level === "ERROR"
                          ? "text-rose-400"
                          : "text-zinc-300"
                      }`}
                    >
                      [{log.level}]
                    </span>
                    <span className="text-zinc-300">{log.message}</span>
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ─── MODAL 1: INTERACTIVE WORKBENCH ─────────────────────────────────── */}
      {workbenchEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="card max-w-xl w-full p-6 space-y-4 bg-[#09090b] border border-[#27272a] shadow-2xl rounded-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#18181b]">
              <div className="flex items-center space-x-2">
                <Scale className="w-4 h-4 text-white" />
                <h3 className="text-sm font-bold text-white">Exception Resolution Workbench</h3>
              </div>
              <button
                onClick={() => setWorkbenchEntry(null)}
                className="p-1 rounded hover:bg-[#18181b] text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-[#000000] border border-[#18181b] space-y-1">
                <span className="text-[10px] text-zinc-500 uppercase font-semibold">Ledger Entry</span>
                <div className="font-mono font-bold text-zinc-200">
                  {workbenchEntry.ledgerTx?.txId || "N/A"} · {formatCurrency(workbenchEntry.ledgerTx?.baseAmountINR || workbenchEntry.ledgerTx?.amount || 0)}
                </div>
                <div className="text-[11px] text-zinc-400 truncate">{workbenchEntry.ledgerTx?.memo || "No ledger record"}</div>
              </div>

              <div className="p-3 rounded-lg bg-[#000000] border border-[#18181b] space-y-1">
                <span className="text-[10px] text-zinc-500 uppercase font-semibold">Bank Payout</span>
                <div className="font-mono font-bold text-zinc-200">
                  {workbenchEntry.bankTx?.txId || "N/A"} · {formatCurrency(workbenchEntry.bankTx?.baseAmountINR || workbenchEntry.bankTx?.amount || 0)}
                </div>
                <div className="text-[11px] text-zinc-400 truncate">{workbenchEntry.bankTx?.memo || "No bank record"}</div>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-zinc-300 font-semibold mb-1">1. Action</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(
                    [
                      { id: "FORCE_MATCH", label: "Force Match" },
                      { id: "MANUAL_ADJUSTMENT", label: "Write-off" },
                      { id: "SPLIT_ALLOCATION", label: "Split Batch" },
                      { id: "CONFIRM_EXCEPTION", label: "Reject" },
                    ] as const
                  ).map((act) => (
                    <button
                      key={act.id}
                      onClick={() => setWorkbenchAction(act.id)}
                      className={`px-2.5 py-1.5 rounded font-medium border text-center transition ${
                        workbenchAction === act.id
                          ? "bg-white text-black border-white font-semibold"
                          : "bg-[#000000] text-zinc-400 border-[#27272a] hover:text-white"
                      }`}
                    >
                      {act.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-300 font-semibold mb-1">2. Cost Center</label>
                  <select
                    value={selectedCostCenter}
                    onChange={(e) => setSelectedCostCenter(e.target.value)}
                    className="w-full bg-[#000000] border border-[#27272a] rounded-lg p-2 text-zinc-200 focus:outline-none focus:border-zinc-400"
                  >
                    {COST_CENTERS.map((cc) => (
                      <option key={cc} value={cc}>
                        {cc}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-zinc-300 font-semibold mb-1">3. Amount (₹)</label>
                  <input
                    type="number"
                    value={adjustmentAmount}
                    onChange={(e) => setAdjustmentAmount(parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#000000] border border-[#27272a] rounded-lg p-2 font-mono text-zinc-200 focus:outline-none focus:border-zinc-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-zinc-300 font-semibold mb-1">4. Controller Notes</label>
                <textarea
                  rows={2}
                  value={controllerNotes}
                  onChange={(e) => setControllerNotes(e.target.value)}
                  placeholder="Explain why this resolution is authorized..."
                  className="w-full bg-[#000000] border border-[#27272a] rounded-lg p-2 text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-400"
                />
              </div>

              {/* Dual-Control High-Value Notice */}
              {adjustmentAmount > 100000 && (
                <div className={`p-2.5 rounded-lg border text-[11px] flex items-center space-x-2 ${
                  currentRole === "CHIEF_FINANCIAL_OFFICER"
                    ? "bg-emerald-950/30 border-emerald-800/40 text-emerald-300"
                    : "bg-amber-950/40 border-amber-800/50 text-amber-300"
                }`}>
                  <Lock className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    <strong>SOC 2 Dual-Control Policy:</strong> Adjustments &gt; ₹1,00,000 strictly require CFO digital signature.
                    {currentRole === "CHIEF_FINANCIAL_OFFICER" ? " (Authorized as CFO ✓)" : " (Current role lacks permission — switch to CFO in top bar)"}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#18181b]">
              <button
                onClick={() => setWorkbenchEntry(null)}
                className="px-3.5 py-1.5 rounded-lg bg-[#121215] hover:bg-[#1a1a20] text-zinc-300 font-medium text-xs border border-[#27272a]"
              >
                Cancel
              </button>
              <button
                onClick={handleWorkbenchSubmit}
                disabled={overrideSubmitting}
                className="px-4 py-1.5 rounded-lg bg-white hover:bg-zinc-200 text-black font-semibold text-xs transition flex items-center space-x-1.5"
              >
                {overrideSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Signing...</span>
                  </>
                ) : (
                  <>
                    <Lock className="w-3.5 h-3.5" />
                    <span>Sign & Seal</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL 2: AUDIT TRACE & VISUAL DIFF ─────────────────────────────── */}
      {selectedAuditEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="card max-w-2xl w-full p-6 space-y-4 bg-[#09090b] border border-[#27272a] shadow-2xl rounded-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-[#18181b]">
              <div className="flex items-center space-x-2">
                <Brain className="w-4 h-4 text-white" />
                <h3 className="text-sm font-bold text-white">Forensic Audit & Diff Trace</h3>
              </div>
              <button
                onClick={() => setSelectedAuditEntry(null)}
                className="p-1 rounded hover:bg-[#18181b] text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Field Difference Highlighting */}
            {selectedAuditEntry.fieldDifferences && selectedAuditEntry.fieldDifferences.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                  Field Discrepancy & Diff
                </h4>
                <div className="space-y-1.5">
                  {selectedAuditEntry.fieldDifferences.map((diff, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-lg border border-[#222228] bg-[#000000] text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center space-x-2">
                          <span className="font-semibold text-white">{diff.field}</span>
                          {diffTypeBadge(diff.diffType)}
                        </div>
                        <p className="text-[11px] text-zinc-400">{diff.description}</p>
                      </div>
                      <div className="text-right font-mono text-[11px] shrink-0 text-zinc-300">
                        <div>L: <span className="font-bold text-white">{diff.ledgerValue}</span></div>
                        <div>B: <span className="font-bold text-white">{diff.bankValue}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step Trace */}
            <div className="space-y-2 pt-2 border-t border-[#18181b]">
              <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                Execution Steps
              </h4>
              <div className="space-y-1.5">
                {selectedAuditEntry.executionSteps.map((step, idx) => (
                  <div key={idx} className="p-2.5 rounded-lg bg-[#000000] border border-[#1c1c22] text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-zinc-200">
                        Layer {step.layer}: {step.layerName}
                      </span>
                      <span
                        className={`badge font-mono text-[10px] ${
                          step.result === "PASS"
                            ? "badge-green"
                            : step.result === "SKIP"
                            ? "badge-neutral"
                            : "badge-red"
                        }`}
                      >
                        {step.result} ({step.durationMs}ms)
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-400">{step.action}</div>
                    <div className="text-[11px] text-zinc-300 font-mono bg-[#09090b] p-1.5 rounded border border-[#222228]">
                      {step.detail}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-[#000000] border border-[#222228] text-xs text-zinc-300">
              <strong>Assessment:</strong> {selectedAuditEntry.aiReasoning}
            </div>

            <div className="flex justify-end pt-1">
              <button
                onClick={() => setSelectedAuditEntry(null)}
                className="px-4 py-1.5 rounded-lg bg-[#121215] hover:bg-[#1a1a20] text-zinc-300 font-medium text-xs border border-[#27272a]"
              >
                Close Trace
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── CHATBOT DRAWER ─────────────────────────────────────────────────── */}
      {isChatOpen && (
        <div className="fixed inset-y-0 right-0 z-40 w-full max-w-md bg-[#09090b] border-l border-[#27272a] shadow-2xl flex flex-col">
          <div className="p-4 border-b border-[#18181b] flex items-center justify-between bg-[#000000]">
            <div className="flex items-center space-x-2">
              <MessageCircle className="w-4 h-4 text-white" />
              <h3 className="text-xs font-bold text-white">Settlement Q&A Agent</h3>
            </div>
            <button
              onClick={() => setIsChatOpen(false)}
              className="p-1 rounded hover:bg-[#18181b] text-zinc-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Quick Query Chips */}
          <div className="p-2 border-b border-[#18181b] bg-[#050505] flex gap-1.5 overflow-x-auto text-[11px]">
            {["Summarize batch", "List exceptions", "Show 1-to-N splits", "Check FX conversions", "Gateway fees & TDS"].map((chip) => (
              <button
                key={chip}
                onClick={() => handleSendMessage(chip)}
                disabled={chatLoading}
                className="whitespace-nowrap px-2.5 py-1 rounded bg-[#121215] hover:bg-[#1c1c22] text-zinc-300 border border-[#27272a] transition disabled:opacity-50"
              >
                {chip}
              </button>
            ))}
          </div>

          {/* Messages Area */}
          <div className="flex-1 p-4 overflow-y-auto space-y-3 text-xs">
            {chatMessages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[90%] p-3 rounded-xl leading-relaxed ${
                    msg.role === "user"
                      ? "bg-white text-black font-medium rounded-br-none text-[11.5px]"
                      : "bg-[#050505] text-zinc-200 border border-[#1c1c22] rounded-bl-none shadow-sm"
                  }`}
                >
                  {msg.role === "user" ? msg.text : <ChatBubbleContent content={msg.text} />}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="p-3 rounded-xl bg-[#050505] border border-[#1c1c22] text-zinc-400 flex items-center space-x-2 text-xs">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                  <span>Agent analyzing batch data...</span>
                </div>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Input Footer */}
          <div className="p-3 border-t border-[#18181b] bg-[#000000] flex items-center space-x-2">
            <input
              type="text"
              placeholder="Ask about splits, FX rates, fees, or exceptions..."
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !chatLoading && handleSendMessage()}
              className="flex-1 bg-[#09090b] border border-[#27272a] rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-400"
            />
            <button
              onClick={() => handleSendMessage()}
              disabled={chatLoading || !inputMessage.trim()}
              className="p-2 rounded-lg bg-white hover:bg-zinc-200 text-black disabled:opacity-50 transition"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
