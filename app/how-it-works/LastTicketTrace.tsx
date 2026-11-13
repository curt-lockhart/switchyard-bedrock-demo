"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadLastTicket, LAST_TICKET_KEY, type LastTicket } from "@/lib/lastTicket";

interface RouteInfo {
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

const TIER_TEXT: Record<string, string> = {
  nano: "text-[#76b900]",
  super: "text-blue-400",
  sol: "text-purple-400",
};

function modelLabel(id: string) {
  if (id.includes("nemotron-nano")) return "Nemotron Nano 30B";
  if (id.includes("nemotron-super")) return "Nemotron Super 120B";
  if (id.includes("gpt-5.6-sol")) return "GPT-5.6 Sol";
  return id;
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="relative pl-10">
      <span className="absolute left-0 top-0 w-7 h-7 rounded-full bg-gray-800 text-gray-300 text-xs flex items-center justify-center font-medium">
        {n}
      </span>
      <p className="text-sm font-medium text-gray-200">{title}</p>
      <div className="mt-1 text-sm text-gray-400 space-y-1">{children}</div>
    </li>
  );
}

export default function LastTicketTrace({ routes, targets }: Props) {
  const [ticket, setTicket] = useState<LastTicket | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setTicket(loadLastTicket());
    setLoaded(true);
    // Update if a ticket is triaged in another tab while this one is open.
    const onStorage = (e: StorageEvent) => { if (e.key === LAST_TICKET_KEY) setTicket(loadLastTicket()); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (!loaded) return null;

  if (!ticket) {
    return (
      <p className="text-sm text-gray-500">
        No ticket yet. Triage one on the <Link href="/" className="text-[#76b900] hover:underline">Demo</Link> tab,
        then come back to see each step it went through.
      </p>
    );
  }

  const route = routes.find((r) => r.id === ticket.route);
  const targetName = Object.entries(targets).find(([, id]) => id === ticket.modelUsed)?.[0] ?? "";
  // Switchyard reports the selected model, not the judge's raw answer. Each answer
  // maps to one target in this config, so the answer can be read back from the model.
  const answer = route
    ? Object.entries(route.models).find(([k, t]) => k !== "judge" && k !== "any" && t[0] === targetName)?.[0]
    : undefined;
  const judgeModel = route?.models.judge?.[0] ? targets[route.models.judge[0]] : undefined;
  const isClassifier = route?.type === "llm_classifier";

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-500">
        Last ticket from the Demo tab, {new Date(ticket.at).toLocaleTimeString()}
      </p>
      <ol className="space-y-5">
        <Step n={1} title="Your app sends one request">
          <p>
            Ticket <span className="text-gray-200">&ldquo;{ticket.subject}&rdquo;</span> ({ticket.customerTier} customer),
            sent with <code className="text-gray-300">model: &quot;{ticket.route}&quot;</code>. The route name is the only
            routing input the app provides.
          </p>
        </Step>

        {isClassifier ? (
          <Step n={2} title={`Switchyard asks the judge (${judgeModel ? modelLabel(judgeModel) : "judge"})`}>
            <p>
              The judge reads the ticket with the route&apos;s prompt and may only answer{" "}
              {route!.answers.map((a, i) => (
                <span key={a}>
                  {i > 0 && (i === route!.answers.length - 1 ? " or " : ", ")}
                  <code className={TIER_TEXT[a] ?? "text-gray-300"}>{a}</code>
                </span>
              ))}.
            </p>
            {answer && (
              <p>
                It answered <code className={TIER_TEXT[answer] ?? "text-gray-300"}>{answer}</code>
                <span className="text-gray-600"> (read back from the selected model; Switchyard does not return the raw verdict)</span>.
              </p>
            )}
          </Step>
        ) : (
          <Step n={2} title="No judge: passthrough">
            <p>
              The <code className="text-gray-300">{ticket.route}</code> route always sends the request to{" "}
              <code className="text-purple-400">{route?.passthroughTarget ?? "its target"}</code>.
            </p>
          </Step>
        )}

        <Step n={3} title={`${modelLabel(ticket.modelUsed)} answers`}>
          <p>
            <span className={TIER_TEXT[targetName] ?? "text-gray-200"}>{modelLabel(ticket.modelUsed)}</span>{" "}
            <span className="text-gray-600">({ticket.modelUsed})</span> triaged the ticket in{" "}
            {(ticket.latencyMs / 1000).toFixed(1)} s, end to end.
          </p>
          <p>
            {ticket.inputTokens != null && ticket.outputTokens != null && (
              <>{ticket.inputTokens} input + {ticket.outputTokens} output tokens, </>
            )}
            estimated <span className="text-gray-200">${ticket.estimatedCostUsd.toFixed(5)}</span>
            {isClassifier && <span className="text-gray-600"> (answering model only; the judge call is not included)</span>}.
          </p>
        </Step>

        <Step n={4} title="Your app gets the triage result">
          <p>
            <span className="text-gray-200">{ticket.decision.category}</span>, priority{" "}
            <span className="text-gray-200">{ticket.decision.priority}</span>, confidence{" "}
            {Math.round(ticket.decision.confidence * 100)}%, {ticket.decision.needs_human ? "needs a human" : "no human needed"}.
          </p>
          {ticket.decision.reasoning && <p className="text-gray-500 italic">&ldquo;{ticket.decision.reasoning}&rdquo;</p>}
        </Step>
      </ol>
    </div>
  );
}
