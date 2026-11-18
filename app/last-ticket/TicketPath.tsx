import { MODEL_MARK, modelKey, modelName } from "@/lib/modelColors";
import type { LastTicket } from "@/lib/lastTicket";

interface Props {
  ticket: LastTicket;
  isClassifier: boolean;
  judgeModel?: string;    // model id of the judge
  answer?: string;        // the judge's answer, read back from the selected model
  models: string[];       // all model ids the routes can reach, in tier order
}

const Box = ({ active, accent, children, className = "" }: { active: boolean; accent?: string; children: React.ReactNode; className?: string }) => (
  <div
    className={`rounded-lg border px-4 py-3 transition-opacity ${active ? "bg-[#151515]" : "border-gray-800 bg-[#111] opacity-35"} ${className}`}
    style={active ? { borderColor: accent ?? "#9ca3af", boxShadow: accent ? `0 0 0 1px ${accent}` : undefined } : undefined}
  >
    {children}
  </div>
);

const Arrow = ({ label, active = true }: { label: string; active?: boolean }) => (
  <div className={`flex flex-col items-center justify-center px-1 shrink-0 ${active ? "text-gray-300" : "text-gray-700"}`}>
    <span className="text-[11px] mb-0.5 text-center max-w-[8rem] text-gray-400">{label}</span>
    <span className="text-xl leading-none">→</span>
  </div>
);

// The flow diagram from "How it works", with this ticket's path highlighted.
export default function TicketPath({ ticket, isClassifier, judgeModel, answer, models }: Props) {
  const chosen = ticket.modelUsed;
  const judgeKey = modelKey(judgeModel);
  return (
    <div className="rounded-xl border border-gray-800 bg-[#0d0d0d] p-6 overflow-x-auto">
      <div className="flex items-stretch gap-2 min-w-[920px]">
        <Box active className="w-48">
          <p className="text-[10px] uppercase tracking-wider text-gray-500">Your laptop</p>
          <p className="text-sm font-medium text-gray-100 mt-0.5">Demo app</p>
          <p className="text-xs text-gray-400 mt-1">&ldquo;{ticket.subject}&rdquo;</p>
          <p className="text-xs text-gray-500 mt-1">{ticket.customerTier} customer</p>
        </Box>

        <Arrow label={`model: "${ticket.route}"`} />

        <Box active className="w-64">
          <p className="text-[10px] uppercase tracking-wider text-gray-500">AWS Lambda</p>
          <p className="text-sm font-medium text-gray-100 mt-0.5">Switchyard</p>
          {isClassifier ? (
            <div
              className="mt-3 rounded border px-3 py-2 bg-[#111]"
              style={{ borderColor: judgeKey ? MODEL_MARK[judgeKey] : "#4b5563" }}
            >
              <p className="text-xs text-gray-200 flex items-center gap-1.5">
                {judgeKey && <span className="inline-block w-2 h-2 rounded-full" style={{ background: MODEL_MARK[judgeKey] }} />}
                Judge: {judgeModel ? modelName(judgeModel) : "judge"}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                answered <code className="text-gray-100">{answer ?? "?"}</code>
                {ticket.judge && <> · ~{ticket.judge.inputTokens} in / {ticket.judge.outputTokens} out tokens</>}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-xs text-gray-400">Passthrough: no judge, always the same model.</p>
          )}
        </Box>

        <Arrow label="forwards the ticket" />

        <div className="flex flex-col gap-2 w-60">
          {models.map((m) => {
            const k = modelKey(m);
            const active = m === chosen;
            return (
              <Box key={m} active={active} accent={k ? MODEL_MARK[k] : undefined} className="py-2">
                <p className="text-[10px] uppercase tracking-wider text-gray-500">Amazon Bedrock</p>
                <p className="text-sm text-gray-100 flex items-center gap-1.5">
                  {k && <span className="inline-block w-2 h-2 rounded-full" style={{ background: MODEL_MARK[k] }} />}
                  {modelName(m)}
                </p>
                {active && <p className="text-[11px] text-gray-400 mt-0.5">answered in {(ticket.latencyMs / 1000).toFixed(1)} s</p>}
              </Box>
            );
          })}
        </div>

        <Arrow label="answer + selected model" />

        <Box active className="w-48">
          <p className="text-[10px] uppercase tracking-wider text-gray-500">Your laptop</p>
          <p className="text-sm font-medium text-gray-100 mt-0.5">Triage result</p>
          <p className="text-xs text-gray-300 mt-1">{ticket.decision.category}, {ticket.decision.priority}</p>
          <p className="text-xs text-gray-500">{ticket.decision.needs_human ? "needs a human" : "no human needed"}</p>
        </Box>
      </div>
    </div>
  );
}
