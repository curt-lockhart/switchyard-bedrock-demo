"use client";

import { useState, useCallback } from "react";
import Link from "next/link";

// ── Types ──────────────────────────────────────────────────────────────────────

interface TriageDecision {
  ticketId?: string;
  category: string;
  priority: "P0" | "P1" | "P2" | "P3";
  confidence: number;
  reasoning: string;
  needs_human: boolean;
}

interface TriageResult {
  decision: TriageDecision;
  modelUsed: string;
  routeUsed: string;
  latencyMs: number;
  estimatedCostUsd: number;
}

interface SessionStats {
  total: number;
  byModel: Record<string, number>;
  totalCostUsd: number;
  totalLatencyMs: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ROUTES = [
  {
    id: "support-triage-classifier",
    label: "LLM Classifier",
    description: "Switchyard uses Nano to score the ticket, then routes to Nano (simple) or Sol (complex) — one call from your app",
  },
  {
    id: "support-triage-3tier",
    label: "3-Tier Custom",
    description: "Nano judges the ticket and picks Nano / Super / Sol based on complexity — three models, one call from your app",
  },
  {
    id: "baseline",
    label: "Baseline (Sol Only)",
    description: "No routing — every ticket goes straight to Sol. Use this to measure cost savings from the other strategies",
  },
];

const SAMPLE_TICKETS = [
  {
    id: "s1",
    label: "Order tracking",
    subject: "Where is my order?",
    body: "Hi, I placed an order 3 days ago and I'd like to know the current status. Can you help me track it?",
    customerTier: "standard",
  },
  {
    id: "s2",
    label: "Payment methods",
    subject: "What payment methods do you accept?",
    body: "I'm trying to checkout but want to confirm which payment options are available — do you accept PayPal or Apple Pay?",
    customerTier: "standard",
  },
  {
    id: "s3",
    label: "Double charge",
    subject: "Charged twice this month",
    body: "I noticed two charges for my subscription this month — one on the 1st and another on the 5th. Invoice number INV-8832. I need the duplicate refunded as soon as possible.",
    customerTier: "pro",
  },
  {
    id: "s4",
    label: "Account locked",
    subject: "Can't access my account after password reset",
    body: "I attempted a password reset three times and now my account appears to be locked. I have a critical presentation tomorrow using your platform and need access restored urgently.",
    customerTier: "pro",
  },
  {
    id: "s5",
    label: "Security breach",
    subject: "URGENT: Unauthorized charges and suspected account breach",
    body: "I've detected $847 in unauthorized transactions on my account. Someone appears to have accessed it without my permission. I've already contacted my bank and may need to involve legal counsel. This requires an immediate security audit and escalation to your fraud team.",
    customerTier: "enterprise",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function modelTier(modelId: string | undefined): 1 | 2 | 3 {
  if (!modelId) return 3;
  if (modelId.includes("nano")) return 1;
  if (modelId.includes("super")) return 2;
  return 3;
}

function modelLabel(modelId: string | undefined): string {
  if (!modelId) return "Unknown";
  if (modelId.includes("nemotron-nano"))  return "Nemotron Nano 30B";
  if (modelId.includes("nemotron-super")) return "Nemotron Super 120B";
  if (modelId.includes("gpt-5.6-sol"))   return "GPT-5.6 Sol";
  return modelId;
}

const TIER_STYLES = {
  1: { bg: "bg-[#76b900]/10",  border: "border-[#76b900]/40",  text: "text-[#76b900]", badge: "bg-[#76b900]/20 text-[#76b900]" },
  2: { bg: "bg-blue-500/10",   border: "border-blue-500/40",   text: "text-blue-400",  badge: "bg-blue-500/20 text-blue-400" },
  3: { bg: "bg-purple-500/10", border: "border-purple-500/40", text: "text-purple-400", badge: "bg-purple-500/20 text-purple-400" },
};

const PRIORITY_STYLES: Record<string, string> = {
  P0: "bg-red-500/20 text-red-400 border-red-500/40",
  P1: "bg-orange-500/20 text-orange-400 border-orange-500/40",
  P2: "bg-yellow-500/20 text-yellow-400 border-yellow-500/40",
  P3: "bg-gray-500/20 text-gray-400 border-gray-500/40",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function DemoPage() {
  const [selectedRoute, setSelectedRoute] = useState(ROUTES[0].id);
  const [selectedSample, setSelectedSample] = useState(SAMPLE_TICKETS[0].id);
  const [subject, setSubject] = useState(SAMPLE_TICKETS[0].subject);
  const [body, setBody] = useState(SAMPLE_TICKETS[0].body);
  const [customerTier, setCustomerTier] = useState(SAMPLE_TICKETS[0].customerTier);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TriageResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<SessionStats>({
    total: 0,
    byModel: {},
    totalCostUsd: 0,
    totalLatencyMs: 0,
  });

  const pickSample = useCallback((id: string) => {
    const t = SAMPLE_TICKETS.find((s) => s.id === id);
    if (!t) return;
    setSelectedSample(id);
    setSubject(t.subject);
    setBody(t.body);
    setCustomerTier(t.customerTier);
    setResult(null);
    setError(null);
  }, []);

  const triage = useCallback(async () => {
    if (!subject.trim() || !body.trim()) return;
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const res = await fetch("/api/triage/cascade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body, customerTier, route: selectedRoute }),
      });

      if (!res.ok || !res.body) {
        setError(`HTTP ${res.status}`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const eventLine = part.split("\n").find((l) => l.startsWith("event:"));
          const dataLine  = part.split("\n").find((l) => l.startsWith("data:"));
          if (!eventLine || !dataLine) continue;

          const event = eventLine.slice(7).trim();
          const data  = JSON.parse(dataLine.slice(5).trim());

          if (event === "result") {
            const r = data as TriageResult;
            setResult(r);
            setStats((prev) => ({
              total: prev.total + 1,
              byModel: {
                ...prev.byModel,
                [r.modelUsed]: (prev.byModel[r.modelUsed] ?? 0) + 1,
              },
              totalCostUsd: prev.totalCostUsd + r.estimatedCostUsd,
              totalLatencyMs: prev.totalLatencyMs + r.latencyMs,
            }));
          }

          if (event === "error") {
            setError(data.message ?? "Unknown error");
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [subject, body, customerTier, selectedRoute]);

  const activeRoute = ROUTES.find((r) => r.id === selectedRoute)!;
  const tier = result ? modelTier(result.modelUsed) : null;
  const tierStyle = tier ? TIER_STYLES[tier as 1 | 2 | 3] : null;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 bg-[#0f0f0f]">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#76b900]" />
            <span className="font-semibold text-sm tracking-wide text-gray-200">
              NVIDIA Switchyard
            </span>
          </div>
          <span className="text-gray-600 text-sm">×</span>
          <span className="text-gray-400 text-sm">Amazon Bedrock</span>
          <nav className="ml-6 flex gap-1">
            <Link href="/" className="px-3 py-1.5 text-sm rounded bg-gray-800 text-gray-200">Demo</Link>
            <Link href="/bulk" className="px-3 py-1.5 text-sm rounded text-gray-500 hover:text-gray-300 transition-colors">Bulk</Link>
          </nav>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <span className="text-gray-600">Your app sends one request →</span>
            <span className="px-2 py-1 rounded bg-gray-800 text-[#76b900] font-medium">
              Switchyard
            </span>
            <span className="text-gray-600">routes to</span>
            <span className="px-2 py-1 rounded bg-[#76b900]/20 text-[#76b900]">Nano</span>
            <span className="text-gray-600">/</span>
            <span className="px-2 py-1 rounded bg-blue-500/20 text-blue-400">Super</span>
            <span className="text-gray-600">/</span>
            <span className="px-2 py-1 rounded bg-purple-500/20 text-purple-400">Sol</span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-8">
        {/* Route selector */}
        <div className="mb-8">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">
            Routing Strategy
          </p>
          <div className="grid grid-cols-3 gap-3">
            {ROUTES.map((r) => (
              <button
                key={r.id}
                onClick={() => { setSelectedRoute(r.id); setResult(null); setError(null); }}
                className={`text-left p-4 rounded-lg border transition-all ${
                  selectedRoute === r.id
                    ? "border-[#76b900]/60 bg-[#76b900]/10 text-white"
                    : "border-gray-800 bg-[#111] text-gray-400 hover:border-gray-700"
                }`}
              >
                <p className={`text-sm font-medium mb-1 ${selectedRoute === r.id ? "text-[#76b900]" : ""}`}>
                  {r.label}
                </p>
                <p className="text-xs text-gray-500 leading-snug">{r.description}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Left: Ticket Input */}
          <div className="space-y-5">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">
                Sample Tickets
              </p>
              <div className="flex flex-wrap gap-2">
                {SAMPLE_TICKETS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => pickSample(t.id)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                      selectedSample === t.id
                        ? "border-gray-400 bg-gray-700 text-white"
                        : "border-gray-700 bg-transparent text-gray-400 hover:border-gray-600"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Subject</label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full bg-[#111] border border-gray-800 rounded-lg px-4 py-3 text-sm text-gray-100 focus:outline-none focus:border-gray-600 placeholder-gray-600"
                  placeholder="Ticket subject..."
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Body</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={6}
                  className="w-full bg-[#111] border border-gray-800 rounded-lg px-4 py-3 text-sm text-gray-100 focus:outline-none focus:border-gray-600 placeholder-gray-600 resize-none"
                  placeholder="Customer message..."
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Customer Tier</label>
                <select
                  value={customerTier}
                  onChange={(e) => setCustomerTier(e.target.value)}
                  className="w-full bg-[#111] border border-gray-800 rounded-lg px-4 py-3 text-sm text-gray-100 focus:outline-none focus:border-gray-600"
                >
                  <option value="standard">Standard</option>
                  <option value="pro">Pro</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>

              <button
                onClick={triage}
                disabled={loading || !subject.trim() || !body.trim()}
                className="w-full py-3 rounded-lg font-medium text-sm transition-all bg-[#76b900] hover:bg-[#8ad400] text-black disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                    Routing…
                  </span>
                ) : (
                  "Triage Ticket"
                )}
              </button>
            </div>
          </div>

          {/* Right: Result */}
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">
              Triage Result
            </p>

            {!result && !error && !loading && (
              <div className="h-full min-h-64 flex items-center justify-center rounded-lg border border-dashed border-gray-800 text-gray-600 text-sm">
                Select a ticket and click Triage
              </div>
            )}

            {loading && !result && (
              <div className="h-full min-h-64 flex items-center justify-center rounded-lg border border-gray-800 bg-[#111]">
                <div className="text-center space-y-3">
                  <div className="w-8 h-8 border-2 border-gray-700 border-t-[#76b900] rounded-full animate-spin mx-auto" />
                  <p className="text-sm text-gray-500">
                    Routing via <span className="text-gray-300">{activeRoute.label}</span>…
                  </p>
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-5 text-sm text-red-400">
                {error}
              </div>
            )}

            {result && tierStyle && (
              <div className={`rounded-lg border ${tierStyle.border} ${tierStyle.bg} p-5 space-y-4`}>
                {/* Model badge */}
                <div className="flex items-center justify-between">
                  <div className={`flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-full ${tierStyle.badge}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${tierStyle.text} bg-current`} />
                    Tier {tier} — {modelLabel(result.modelUsed)}
                  </div>
                  <span className="text-xs text-gray-500">{result.routeUsed}</span>
                </div>

                {/* Decision grid */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-black/30 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">Category</p>
                    <p className="text-sm font-medium text-gray-100 capitalize">
                      {result.decision.category?.replace(/_/g, " ") ?? "—"}
                    </p>
                  </div>
                  <div className="bg-black/30 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">Priority</p>
                    <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded border ${PRIORITY_STYLES[result.decision.priority ?? ""] ?? ""}`}>
                      {result.decision.priority ?? "—"}
                    </span>
                  </div>
                  <div className="bg-black/30 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">Human needed</p>
                    <p className={`text-sm font-medium ${result.decision.needs_human ? "text-red-400" : "text-green-400"}`}>
                      {result.decision.needs_human ? "Yes" : "No"}
                    </p>
                  </div>
                </div>

                {/* Confidence */}
                <div>
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                    <span>Confidence</span>
                    <span className={tierStyle.text}>{Math.round((result.decision.confidence ?? 0) * 100)}%</span>
                  </div>
                  <div className="h-1.5 bg-black/30 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${tierStyle.text} bg-current transition-all`}
                      style={{ width: `${(result.decision.confidence ?? 0) * 100}%` }}
                    />
                  </div>
                </div>

                {/* Reasoning */}
                {result.decision.reasoning && (
                  <div className="bg-black/30 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1.5">Reasoning</p>
                    <p className="text-sm text-gray-300 leading-relaxed">
                      {result.decision.reasoning}
                    </p>
                  </div>
                )}

                {/* Cost / latency */}
                <div className="flex items-center gap-4 text-xs text-gray-500 pt-1">
                  <span>⏱ {(result.latencyMs / 1000).toFixed(2)}s</span>
                  <span>💰 ${result.estimatedCostUsd.toFixed(7)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Session Stats Bar */}
      {stats.total > 0 && (
        <footer className="border-t border-gray-800 bg-[#0f0f0f] py-3 px-6">
          <div className="max-w-7xl mx-auto flex items-center gap-6 text-xs text-gray-500">
            <span className="text-gray-300 font-medium">{stats.total} tickets</span>
            {Object.entries(stats.byModel).map(([model, count]) => {
              const t = modelTier(model);
              const s = TIER_STYLES[t];
              return (
                <span key={model} className={s.text}>
                  {modelLabel(model)}: {count} ({Math.round((count / stats.total) * 100)}%)
                </span>
              );
            })}
            <span className="ml-auto">
              avg latency {(stats.totalLatencyMs / stats.total / 1000).toFixed(2)}s
            </span>
            <span>total cost ${stats.totalCostUsd.toFixed(6)}</span>
            {stats.byModel["nvidia.nemotron-nano-3-30b"] && (
              <span className="text-[#76b900]">
                ~{(
                  (1 - stats.totalCostUsd /
                    (stats.total * 0.003)) * 100
                ).toFixed(0)}% cheaper than GPT-only baseline
              </span>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}
