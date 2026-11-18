// The most recent ticket triaged on the Demo tab, plus running totals for the Demo
// session, kept in the browser's localStorage for the "Last ticket" tab.
// Nothing leaves the browser.
export const LAST_TICKET_KEY = "switchyard-demo:last-ticket";
export const SESSION_KEY = "switchyard-demo:session";

export interface JudgeCost {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface LastTicket {
  at: string;              // ISO time
  subject: string;
  body: string;
  customerTier: string;
  route: string;           // Switchyard route id the app asked for
  modelUsed: string;       // model Switchyard selected (x-model-router-selected-model)
  latencyMs: number;
  estimatedCostUsd: number; // answer + judge
  answerCostUsd?: number;
  judge?: JudgeCost | null;
  solOnlyCostUsd?: number;
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

export interface SessionTotals {
  since: string;                            // ISO time of the first ticket
  tickets: number;
  answerUsdByModel: Record<string, number>; // model id -> answer cost
  ticketsByModel: Record<string, number>;   // model id -> ticket count
  judgeUsd: number;
  judgeCalls: number;
  solOnlyUsd: number;
}

const read = <T,>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};
const write = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
};

export const loadLastTicket = () => read<LastTicket>(LAST_TICKET_KEY);
export const loadSession = () => read<SessionTotals>(SESSION_KEY);

// Saves the ticket and adds it to the session totals.
export function saveLastTicket(t: LastTicket) {
  write(LAST_TICKET_KEY, t);
  const s: SessionTotals = loadSession() ?? {
    since: t.at, tickets: 0, answerUsdByModel: {}, ticketsByModel: {}, judgeUsd: 0, judgeCalls: 0, solOnlyUsd: 0,
  };
  const answer = t.answerCostUsd ?? t.estimatedCostUsd;
  s.tickets += 1;
  s.answerUsdByModel[t.modelUsed] = (s.answerUsdByModel[t.modelUsed] ?? 0) + answer;
  s.ticketsByModel[t.modelUsed] = (s.ticketsByModel[t.modelUsed] ?? 0) + 1;
  if (t.judge) { s.judgeUsd += t.judge.costUsd; s.judgeCalls += 1; }
  s.solOnlyUsd += t.solOnlyCostUsd ?? answer;
  write(SESSION_KEY, s);
}

export function resetSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* storage unavailable */ }
}
