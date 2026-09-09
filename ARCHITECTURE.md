# 🏗️ AI Finance Controller — Architecture & System Design Diagrams

This document contains end-to-end architectural blueprints, flowcharts, security layers, and data pipelines for the **AI Finance Controller Platform**.

---

## 1. High-Level Enterprise System Architecture

```mermaid
graph TB
    subgraph ClientLayer ["Client / Presentation Layer (Next.js 16 + React 19)"]
        UI["Dark UI Dashboard (Vanilla CSS + Lucide Icons)"]
        SSEHook["SSE Telemetry Stream Hook"]
        ChatUI["Settlement Q&A Drawer"]
        Workbench["Resolution Workbench (HITL)"]
        RoleSelector["RBAC Role Switcher (Analyst / Auditor / CFO)"]
    end

    subgraph SecurityGateway ["API Security & Perimeter Gateway (OWASP Top 10)"]
        Headers["Security Headers (HSTS, CSP, X-Frame-Options, nosniff)"]
        Limiter["Sliding-Window Rate Limiter (Memory Store)"]
        Guard["Payload Size & Schema Guards (Max 5K txs)"]
    end

    subgraph APILayer ["Next.js Server-Side Backend Routes"]
        R_Reconcile["POST /api/reconcile"]
        R_Stream["POST /api/reconcile/stream (SSE)"]
        R_Chat["POST /api/chat"]
        R_Override["POST /api/override (Dual-Control)"]
        R_Export["POST /api/export (SOX Reports)"]
    end

    subgraph CoreEngine ["Autonomous 4-Layer Reconciliation Engine"]
        Normalizer["Layer 0: FX Normalizer & Micro-Unit Math (Paise = INR x 100)"]
        L1["Layer 1: Deterministic O(1) Micro-Unit Hash Map Matcher"]
        L15["Layer 1.5: 48h-Pruned Split Solver (1-to-N Subset-Sum, N<=15)"]
        L2["Layer 2: AI Exception Agent + Heuristics"]
        L3["Layer 3: Exception Triage & Classifier"]
        Sealer["Cryptographic SHA-256 Audit Seal Generator"]
    end

    subgraph AISecurity ["AI Safety & Resilience Subsystem"]
        PII["PII Redaction Pipeline (PAN, Accounts, UPI, Mobiles)"]
        CB["Circuit Breaker (CLOSED / OPEN / HALF_OPEN)"]
        Gemini["Google Gemini 2.0 / 2.5 Flash API"]
        LocalHeuristic["Deterministic Heuristic Rule Fallback"]
        Decay["Temporal Decay Engine: C = C_base * e^(-0.035 * dt)"]
    end

    subgraph DataStorage ["Persistence & Audit Layer"]
        Mongo["MongoDB Atlas (Cloud Cluster)"]
        MemDB["In-Memory Cache Fallback (Zero Downtime)"]
    end

    %% Connections
    UI --> Headers
    Headers --> Limiter --> Guard
    Guard --> R_Reconcile & R_Stream & R_Chat & R_Override & R_Export

    R_Stream & R_Reconcile --> Normalizer
    Normalizer --> L1 --> L15 --> L2 --> L3 --> Sealer

    L2 --> PII --> CB
    CB -- "Healthy" --> Gemini
    CB -- "Trip / 429" --> LocalHeuristic
    Gemini & LocalHeuristic --> Decay

    Sealer --> Mongo
    Mongo -. "Offline Fallback" .-> MemDB
    R_Override --> Mongo
```

---

## 2. 3-Layer Reconciliation Engine Pipeline

```mermaid
flowchart TD
    Start([Raw Ingestion: Ledger JSON + Bank JSON]) --> Norm[FX Normalization: Convert USD/EUR/GBP to INR base]
    
    Norm --> L1_Start{Layer 1: Deterministic Lookup}
    L1_Start -->|Exact TxID + Exact INR Amount| L1_Match[✅ Layer 1 Match - Confidence: 1.00 - Method: DETERMINISTIC]
    L1_Start -->|Mismatch / Not Found| L15_Start{Layer 1.5: Split Solver}

    L15_Start -->|1 Bank Payout = 2-3 Ledger Invoices within 3% tolerance| L15_Match[✅ Layer 1.5 Split Match - Confidence: 0.96 - Method: SPLIT_MATCH]
    L15_Start -->|No Subset Combination| L2_Start[Layer 2: AI Candidate Pairing]

    subgraph Layer2_AI ["Layer 2: AI & Heuristic Evaluation"]
        L2_Start --> PII_Filter[Sanitize & Redact PII in Memos]
        PII_Filter --> Check_CB{Circuit Breaker Status?}
        Check_CB -->|CLOSED / HALF_OPEN| Call_Gemini[Call Gemini 2.0 Flash API]
        Check_CB -->|OPEN / Rate Limited| Call_Local[Invoke Local Deterministic Heuristics]
        Call_Gemini --> Apply_Decay[Apply Temporal Decay: C = C * e^-0.035*days]
        Call_Local --> Apply_Decay
    end

    Apply_Decay --> L2_Check{Confidence >= 0.70 & isMatch?}
    L2_Check -->|Yes - Score >= 0.85| L2_Match[✅ Layer 2 Matched - Method: AI_VERIFIED / FX_CONVERTED]
    L2_Check -->|Yes - Score 0.70-0.84| L2_Fuzzy[⚠️ Layer 2 Fuzzy Match]
    L2_Check -->|No / Low Score| L3_Start[Layer 3: Exception Logger]

    subgraph Layer3_Exceptions ["Layer 3: Exception Triage & Codes"]
        L3_Start --> C1[Code: EXCESSIVE_VARIANCE]
        L3_Start --> C2[Code: MISSING_BANK_ENTRY]
        L3_Start --> C3[Code: UNLINKED_DEBIT]
        L3_Start --> C4[Code: DUPLICATE_DEBIT]
        L3_Start --> C5[Code: TEMPORAL_DRIFT_EXCEEDED]
    end

    L1_Match & L15_Match & L2_Match & L2_Fuzzy & C1 & C2 & C3 & C4 & C5 --> Combine[Consolidate Audit Log]
    Combine --> Seal[Generate Deterministic SHA-256 Audit Seal]
    Seal --> Output([Deliver Final ReconciliationResponse & SSE Completion])
```

---

## 3. Security, RBAC & Dual-Control Governance Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as Operator / Analyst / CFO
    participant UI as Workbench UI
    participant API as POST /api/override
    participant RBAC as auth-rbac.ts
    participant Sec as security.ts (HMAC-SHA256)
    participant DB as MongoDB / Memory Cache

    User->>UI: Select Exception -> Click "Resolve"
    UI->>UI: Input Action, Cost Center & Adjustment Amount (₹)
    
    alt Adjustment Amount > ₹1,00,000
        UI->>UI: Display Dual-Control Amber Warning Banner
    end

    User->>UI: Submit Sign-Off
    UI->>API: POST /api/override { auditId, action, amount, role, costCenter }
    
    API->>API: Rate Limiter Check (30 req/min)
    API->>RBAC: validateOverrideAuthorization(role, amount)
    
    alt Amount > ₹1,00,000 AND Role != CFO
        RBAC-->>API: 403 Forbidden ("Dual-Control: Requires CFO Sign-off")
        API-->>UI: 403 Security Error Notification
    else Authorized (CFO or Amount <= ₹1,00,000)
        RBAC-->>API: Authorized = TRUE
        API->>Sec: generateHmacSignature(auditId + role + amount + timestamp)
        Sec-->>API: Returns Cryptographic Seal (SEAL-XXXX, SIG-XXXX)
        API->>DB: Save immutable override record
        API-->>UI: 200 OK + Cryptographic Header Seal
        UI->>UI: Update local state & re-render Audit Trail
    end
```

---

## 4. Real-Time Telemetry & SSE Streaming Architecture

```mermaid
sequenceDiagram
    autonumber
    participant Browser as Client Browser (page.tsx)
    participant StreamAPI as POST /api/reconcile/stream
    participant Engine as reconciliation-service.ts
    participant DB as MongoDB

    Browser->>StreamAPI: Initiate Batch Execution (POST body: custom files)
    StreamAPI-->>Browser: HTTP 200 OK (Content-Type: text/event-stream)
    
    StreamAPI->>Engine: runReconciliation(ledger, bank, onProgress)
    
    Engine-->>StreamAPI: Event: INIT (0%)
    StreamAPI-->>Browser: data: {"type":"INIT", "progressPercent":0}
    
    Engine->>Engine: Run Layer 1 (Deterministic)
    Engine-->>StreamAPI: Event: LAYER_START L1 (15%)
    StreamAPI-->>Browser: data: {"type":"LAYER_START", "layer":1, "progressPercent":15}
    
    Engine->>Engine: Run Layer 1.5 (Split Solver)
    Engine-->>StreamAPI: Event: LAYER_START L1.5 (40%)
    StreamAPI-->>Browser: data: {"type":"LAYER_START", "layer":1.5, "progressPercent":40}
    
    Engine->>Engine: Run Layer 2 (Gemini AI Fuzzy)
    Engine-->>StreamAPI: Event: LAYER_START L2 (65%)
    StreamAPI-->>Browser: data: {"type":"LAYER_START", "layer":2, "progressPercent":65}
    
    Engine->>Engine: Run Layer 3 (Exception Triage)
    Engine-->>StreamAPI: Event: LAYER_START L3 (85%)
    StreamAPI-->>Browser: data: {"type":"LAYER_START", "layer":3, "progressPercent":85}
    
    Engine->>Engine: Compute Metrics + Generate SHA-256 Seal
    Engine->>DB: Save batch snapshot
    Engine-->>StreamAPI: Event: COMPLETE (100%) + Full Result
    StreamAPI-->>Browser: data: {"type":"COMPLETE", "progressPercent":100, "completedResult":{...}}
    
    Browser->>Browser: Update Dashboard KPIs, Audit Table, Charts
```

---

## 5. Architectural Component Matrix

| Component | Layer | Technology | Key Responsibility |
|---|---|---|---|
| **Presentation** | Frontend | Next.js 16 + React 19 | Pure black UI, SSE streaming, workbench modal, visual diff cards |
| **API Gateway** | Perimeter | Next.js Edge & Node | OWASP Security Headers (CSP, HSTS), Rate Limiter, Request Guards |
| **Layer 1** | Engine | In-Memory Map | O(1) exact TxID & normalized amount deterministic matching |
| **Layer 1.5** | Engine | Subset-Sum Solver | 1-to-N split payout resolution within 3% gateway MDR tolerance |
| **Layer 2** | AI Matching | Gemini 2.0 Flash + Heuristic | Semantic memo evaluation, TDS/Fee deduction, temporal decay |
| **Layer 3** | Governance | Classifier | Exception codification (`EXCESSIVE_VARIANCE`, `UNLINKED_DEBIT`, etc.) |
| **Circuit Breaker**| Resilience | State Machine | Zero-downtime automatic fallback on Gemini rate limits (429) |
| **Security & RBAC**| Auth / Compliance | Node Crypto + RBAC | PII Redaction, AES-256-GCM, >₹1L CFO Dual-Control signature gate |
| **Storage** | Persistence | MongoDB + Memory Fallback | Immutable audit trail storage with offline memory failover |
