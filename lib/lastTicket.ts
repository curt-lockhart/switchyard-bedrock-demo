// The most recent ticket triaged on the Demo tab, kept in the browser's
// localStorage so the "How it works" tab can trace it. Nothing leaves the browser.
export const LAST_TICKET_KEY = "switchyard-demo:last-ticket";

export interface LastTicket {
  at: string;              // ISO time
  subject: string;
  body: string;
  customerTier: string;
  route: string;           // Switchyard route id the app asked for
  modelUsed: string;       // model Switchyard selected (x-model-router-selected-model)
  latencyMs: number;
  estimatedCostUsd: number;
  inputTokens?: number;
  outputTokens?: number;
  decision: {
    category: string;
    priority: string;
    confidence: number;
    reasoning: string;
    needs_human: boolean;
  };
}

export function saveLastTicket(t: LastTicket) {
  try { localStorage.setItem(LAST_TICKET_KEY, JSON.stringify(t)); } catch { /* storage unavailable */ }
}

export function loadLastTicket(): LastTicket | null {
  try {
    const raw = localStorage.getItem(LAST_TICKET_KEY);
    return raw ? (JSON.parse(raw) as LastTicket) : null;
  } catch {
    return null;
  }
}
