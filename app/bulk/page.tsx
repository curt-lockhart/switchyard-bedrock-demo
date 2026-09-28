"use client";

import { useState, useCallback } from "react";
import Link from "next/link";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Ticket { id: string; subject: string; body: string; customerTier: string; }

interface BulkResult {
  ok: boolean;
  index: number;
  ticketId?: string;
  modelUsed?: string;
  routeUsed?: string;
  latencyMs?: number;
  estimatedCostUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  decision?: {
    category: string;
    priority: string;
    confidence: number;
    needs_human: boolean;
  };
  error?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ROUTES = [
  { id: "support-triage-classifier", label: "LLM Classifier" },
  { id: "support-triage-3tier",      label: "3-Tier Custom" },
  { id: "baseline",                  label: "Baseline (Sol Only)" },
];

const PRIORITY_COLORS: Record<string, string> = {
  P0: "text-red-400",
  P1: "text-orange-400",
  P2: "text-yellow-400",
  P3: "text-gray-400",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function modelTier(modelId: string | undefined): 1 | 2 | 3 {
  if (!modelId) return 3;
  if (modelId.includes("nano"))  return 1;
  if (modelId.includes("super")) return 2;
  return 3;
}

function modelShort(modelId: string | undefined): string {
  if (!modelId) return "Unknown";
  if (modelId.includes("nano"))     return "Nano";
  if (modelId.includes("super"))    return "Super";
  if (modelId.includes("gpt-5.6-sol")) return "Sol";
  if (modelId.includes("sol"))         return "Sol";
  if (modelId.includes("gpt"))         return "GPT";
  return modelId;
}

const TIER_COLORS = ["", "text-[#76b900]", "text-blue-400", "text-purple-400"] as const;
const TIER_BG     = ["", "bg-[#76b900]/10", "bg-blue-500/10", "bg-purple-500/10"] as const;

// ── Component ─────────────────────────────────────────────────────────────────

export default function BulkPage() {
  const [route,    setRoute]    = useState(ROUTES[0].id);
  const [limit,    setLimit]    = useState(20);
  const [running,  setRunning]  = useState(false);
  const [results,  setResults]  = useState<BulkResult[]>([]);
  const [total,    setTotal]    = useState(0);

  const runBatch = useCallback(async () => {
    setRunning(true);
    setResults([]);

    // Load tickets
    const ticketsRes = await fetch("/api/tickets");
    const allTickets: Ticket[] = await ticketsRes.json();
    const tickets = allTickets.slice(0, limit);
    setTotal(tickets.length);

    const res = await fetch("/api/triage/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickets, route }),
    });

    if (!res.body) { setRunning(false); return; }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const row: BulkResult = JSON.parse(line);
          setResults((prev) => {
            const next = [...prev];
            next[row.index] = row;
            return next;
          });
        } catch { /* skip malformed line */ }
      }
    }

    setRunning(false);
  }, [route, limit]);

  // ── Stats ────────────────────────────────────────────────────────────────────

  const done    = results.filter(Boolean).length;
  const success = results.filter((r) => r?.ok);

  const byModel = success.reduce<Record<string, number>>((acc, r) => {
    const m = r.modelUsed ?? "unknown";
    acc[m] = (acc[m] ?? 0) + 1;
    return acc;
  }, {});

  const totalCost    = success.reduce((s, r) => s + (r.estimatedCostUsd ?? 0), 0);
  const avgLatency   = success.length
    ? success.reduce((s, r) => s + (r.latencyMs ?? 0), 0) / success.length
    : 0;

  // What this batch would have cost if every ticket went to Sol
  const solCost = success.reduce((s, r) => {
    const input  = (r.inputTokens  ?? 0) * 4.40  / 1_000_000;
    const output = (r.outputTokens ?? 0) * 22.00 / 1_000_000;
    return s + input + output;
  }, 0);
  const savings = solCost > 0 ? ((solCost - totalCost) / solCost) * 100 : 0;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 bg-[#0f0f0f]">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#76b900]" />
            <span className="font-semibold text-sm tracking-wide text-gray-200">
              NVIDIA Switchyard
            </span>
          </div>
          <span className="text-gray-600 text-sm">×</span>
          <span className="text-gray-400 text-sm">Amazon Bedrock</span>
          <nav className="ml-8 flex gap-1">
            <Link href="/"
              className="px-3 py-1.5 text-sm rounded text-gray-500 hover:text-gray-300 transition-colors">
              Demo
            </Link>
            <Link href="/bulk"
              className="px-3 py-1.5 text-sm rounded bg-gray-800 text-gray-200">
              Bulk
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-8 space-y-6">
        {/* Controls */}
        <div className="flex items-end gap-4">
          <div>
            <p className="text-xs text-gray-500 mb-1.5">Routing Strategy</p>
            <select
              value={route}
              onChange={(e) => setRoute(e.target.value)}
              disabled={running}
              className="bg-[#111] border border-gray-800 rounded-lg px-4 py-2.5 text-sm text-gray-100 focus:outline-none focus:border-gray-600 disabled:opacity-50"
            >
              {ROUTES.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </div>

          <div>
            <p className="text-xs text-gray-500 mb-1.5">Ticket count</p>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              disabled={running}
              className="bg-[#111] border border-gray-800 rounded-lg px-4 py-2.5 text-sm text-gray-100 focus:outline-none focus:border-gray-600 disabled:opacity-50"
            >
              {[5, 10, 20].map((n) => (
                <option key={n} value={n}>{n} tickets</option>
              ))}
            </select>
          </div>

          <button
            onClick={runBatch}
            disabled={running}
            className="px-6 py-2.5 rounded-lg font-medium text-sm bg-[#76b900] hover:bg-[#8ad400] text-black disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {running ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                Running… {done}/{total}
              </span>
            ) : "Run Batch"}
          </button>
        </div>

        {/* Summary cards */}
        {done > 0 && (
          <div className="grid grid-cols-5 gap-4">
            <div className="bg-[#111] border border-gray-800 rounded-lg p-4">
              <p className="text-xs text-gray-500 mb-1">Completed</p>
              <p className="text-2xl font-semibold text-gray-100">{done}<span className="text-sm text-gray-500">/{total}</span></p>
            </div>

            {Object.entries(byModel).map(([model, count]) => {
              const t = modelTier(model);
              return (
                <div key={model} className={`${TIER_BG[t]} border border-gray-800 rounded-lg p-4`}>
                  <p className="text-xs text-gray-500 mb-1">{modelShort(model)}</p>
                  <p className={`text-2xl font-semibold ${TIER_COLORS[t]}`}>
                    {count}
                    <span className="text-sm text-gray-500 ml-1">
                      ({Math.round((count / success.length) * 100)}%)
                    </span>
                  </p>
                </div>
              );
            })}

            <div className="bg-[#111] border border-gray-800 rounded-lg p-4">
              <p className="text-xs text-gray-500 mb-1">Avg latency</p>
              <p className="text-2xl font-semibold text-gray-100">
                {(avgLatency / 1000).toFixed(1)}<span className="text-sm text-gray-500">s</span>
              </p>
            </div>

            <div className="bg-[#111] border border-gray-800 rounded-lg p-4">
              <p className="text-xs text-gray-500 mb-1">Total cost</p>
              <p className="text-2xl font-semibold text-gray-100">
                ${totalCost.toFixed(4)}
              </p>
            </div>

            {solCost > 0 && (
              <div className="bg-[#111] border border-gray-800 rounded-lg p-4">
                <p className="text-xs text-gray-500 mb-1">Sol-only cost</p>
                <p className="text-2xl font-semibold text-gray-400">
                  ${solCost.toFixed(4)}
                </p>
              </div>
            )}

            {savings > 0 && (
              <div className="bg-[#76b900]/10 border border-[#76b900]/30 rounded-lg p-4">
                <p className="text-xs text-gray-500 mb-1">vs Sol-only</p>
                <p className="text-2xl font-semibold text-[#76b900]">
                  {savings.toFixed(0)}%<span className="text-sm text-gray-500 ml-1">cheaper</span>
                </p>
              </div>
            )}
          </div>
        )}

        {/* Results table */}
        {done > 0 && (
          <div className="border border-gray-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-[#0f0f0f]">
                  <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">#</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">Subject</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">Model</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">Category</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">Priority</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">Confidence</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">Human?</th>
                  <th className="text-right px-4 py-3 text-xs text-gray-500 font-medium">Latency</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: total }).map((_, i) => {
                  const r = results[i];
                  if (!r) {
                    return (
                      <tr key={i} className="border-b border-gray-900">
                        <td className="px-4 py-3 text-gray-600">{i + 1}</td>
                        <td colSpan={7} className="px-4 py-3">
                          <div className="h-4 bg-gray-800 rounded animate-pulse w-48" />
                        </td>
                      </tr>
                    );
                  }

                  if (!r.ok) {
                    return (
                      <tr key={i} className="border-b border-gray-900">
                        <td className="px-4 py-3 text-gray-500">{i + 1}</td>
                        <td colSpan={7} className="px-4 py-3 text-red-400 text-xs">{r.error}</td>
                      </tr>
                    );
                  }

                  const tier = modelTier(r.modelUsed);
                  return (
                    <tr key={i} className="border-b border-gray-900 hover:bg-gray-900/40 transition-colors">
                      <td className="px-4 py-3 text-gray-600 tabular-nums">{i + 1}</td>
                      <td className="px-4 py-3 text-gray-300 max-w-xs truncate" title={r.decision?.category}>
                        —
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium ${TIER_COLORS[tier]}`}>
                          {modelShort(r.modelUsed)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400 capitalize text-xs">
                        {r.decision?.category?.replace(/_/g, " ")}
                      </td>
                      <td className={`px-4 py-3 text-xs font-semibold ${PRIORITY_COLORS[r.decision?.priority ?? "P3"]}`}>
                        {r.decision?.priority}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 bg-gray-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${TIER_COLORS[tier]} bg-current`}
                              style={{ width: `${(r.decision?.confidence ?? 0) * 100}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-500 tabular-nums">
                            {Math.round((r.decision?.confidence ?? 0) * 100)}%
                          </span>
                        </div>
                      </td>
                      <td className={`px-4 py-3 text-xs ${r.decision?.needs_human ? "text-red-400" : "text-gray-600"}`}>
                        {r.decision?.needs_human ? "Yes" : "No"}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-gray-500 tabular-nums">
                        {r.latencyMs ? `${(r.latencyMs / 1000).toFixed(1)}s` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!running && done === 0 && (
          <div className="flex items-center justify-center h-48 border border-dashed border-gray-800 rounded-lg text-gray-600 text-sm">
            Select a strategy and click Run Batch
          </div>
        )}
      </main>
    </div>
  );
}
