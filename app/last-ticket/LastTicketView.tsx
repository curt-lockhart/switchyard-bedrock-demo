"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  loadLastTicket, loadSession, resetSession, LAST_TICKET_KEY, SESSION_KEY,
  type LastTicket, type SessionTotals,
} from "@/lib/lastTicket";
import { MODEL_MARK, modelKey, modelName } from "@/lib/modelColors";
import TicketPath from "./TicketPath";
import TraceSteps from "./TraceSteps";
import CostBars, { type Segment } from "./CostBars";

export interface RouteInfo {
  id: string;
  type: string;
  answers: string[];
  models: Record<string, string[]>;
  passthroughTarget?: string;
}

interface Props {
  routes: RouteInfo[];
  targets: Record<string, string>; // target name -> model id
}

const SOL_ID = "openai.gpt-5.6-sol";
const color = (modelId: string) => MODEL_MARK[modelKey(modelId) ?? ""] ?? "#6b7280";

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-100">{title}</h2>
        {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

export default function LastTicketView({ routes, targets }: Props) {
  const [ticket, setTicket] = useState<LastTicket | null>(null);
  const [session, setSession] = useState<SessionTotals | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = () => { setTicket(loadLastTicket()); setSession(loadSession()); };
    load();
    setLoaded(true);
    // Update when a ticket is triaged in another browser tab.
    const onStorage = (e: StorageEvent) => { if (e.key === LAST_TICKET_KEY || e.key === SESSION_KEY) load(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (!loaded) return null;

  if (!ticket) {
    return (
      <p className="rounded-xl border border-gray-800 bg-[#111] p-5 text-sm text-gray-400">
        No ticket yet. Triage one on the <Link href="/" className="text-[#76b900] hover:underline">Demo</Link> tab,
        then come back to see the path it took and what it cost.
      </p>
    );
  }

  const route = routes.find((r) => r.id === ticket.route);
  const isClassifier = route?.type === "llm_classifier";
  const targetName = Object.entries(targets).find(([, id]) => id === ticket.modelUsed)?.[0] ?? "";
  // Switchyard reports the selected model, not the judge's raw answer. Each answer
  // maps to one target in this config, so the answer can be read back from the model.
  const answer = route
    ? Object.entries(route.models).find(([k, t]) => k !== "judge" && k !== "any" && t[0] === targetName)?.[0]
    : undefined;
  const judgeModel = ticket.judge?.model ?? (route?.models.judge?.[0] ? targets[route.models.judge[0]] : undefined);
  const models = ["nano", "super", "sol"].map((t) => targets[t]).filter(Boolean);

  // This ticket: answer + judge vs. Sol only.
  const answerCost = ticket.answerCostUsd ?? ticket.estimatedCostUsd;
  const ticketSegments: Segment[] = [
    {
      key: "answer", label: `Answer: ${modelName(ticket.modelUsed)}`, usd: answerCost, color: color(ticket.modelUsed),
      detail: ticket.inputTokens != null ? `${ticket.inputTokens} in + ${ticket.outputTokens} out tokens` : undefined,
    },
    ...(ticket.judge ? [{
      key: "judge", label: `Judge: ${modelName(ticket.judge.model)} (est.)`, usd: ticket.judge.costUsd, color: color(ticket.judge.model),
      detail: `~${ticket.judge.inputTokens} in + ${ticket.judge.outputTokens} out tokens`,
    }] : []),
  ];
  const ticketSolOnly: Segment = {
    key: "sol-only", label: "Sol only (same tokens at Sol prices)", usd: ticket.solOnlyCostUsd ?? answerCost, color: color(SOL_ID),
  };

  // Demo session: answers by model + judge calls vs. Sol only.
  const sessionSegments: Segment[] = session ? [
    ...models
      .filter((m) => (session.answerUsdByModel[m] ?? 0) > 0)
      .map((m) => ({
        key: `answer-${m}`, label: `Answers: ${modelName(m)}`, usd: session.answerUsdByModel[m], color: color(m),
        detail: `${session.ticketsByModel[m] ?? 0} tickets`,
      })),
    ...(session.judgeUsd > 0 ? [{
      key: "judge", label: "Judge calls (est.)", usd: session.judgeUsd, color: color(judgeModel ?? targets.super ?? ""),
      detail: `${session.judgeCalls} calls`,
    }] : []),
  ] : [];

  return (
    <div className="space-y-12">
      <Section title="The path it took" subtitle="The same flow as on How it works, with this ticket's route highlighted.">
        <TicketPath ticket={ticket} isClassifier={isClassifier} judgeModel={judgeModel} answer={answer} models={models} />
      </Section>

      <Section title="Step by step" subtitle={`Triaged on the Demo tab at ${new Date(ticket.at).toLocaleTimeString()}.`}>
        <div className="rounded-xl border border-gray-800 bg-[#111] p-5">
          <TraceSteps
            ticket={ticket} isClassifier={isClassifier} answers={route?.answers ?? []} answer={answer}
            judgeModel={judgeModel} passthroughTarget={route?.passthroughTarget}
          />
        </div>
      </Section>

      <Section
        title="What it cost"
        subtitle="Estimated from token usage and on-demand prices. Sol only prices the same answer tokens at Sol rates; it has no judge call."
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <CostBars title="This ticket" subtitle={`“${ticket.subject}”`} routed={ticketSegments} solOnly={ticketSolOnly} />
          {session && session.tickets > 0 && (
            <div className="space-y-2">
              <CostBars
                title="Demo session"
                subtitle={`${session.tickets} tickets since ${new Date(session.since).toLocaleTimeString()}`}
                routed={sessionSegments}
                solOnly={{ key: "sol-only", label: "Sol only", usd: session.solOnlyUsd, color: color(SOL_ID) }}
              />
              <button
                onClick={() => { resetSession(); setSession(null); }}
                className="text-xs text-gray-500 hover:text-gray-300"
              >
                Reset session totals
              </button>
            </div>
          )}
        </div>
        {ticket.modelUsed === SOL_ID && ticket.judge && (
          <p className="text-xs text-gray-500">
            A ticket that goes to Sol costs slightly more than Sol only: that is the judge call, the price of sending the
            routine tickets to cheaper models.
          </p>
        )}
      </Section>
    </div>
  );
}
