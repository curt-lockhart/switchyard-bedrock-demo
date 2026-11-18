import { modelName, usd } from "@/lib/modelColors";
import type { LastTicket } from "@/lib/lastTicket";

interface Props {
  ticket: LastTicket;
  isClassifier: boolean;
  answers: string[];         // the judge's allowed answers
  answer?: string;           // its answer, read back from the selected model
  judgeModel?: string;
  passthroughTarget?: string;
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

const Code = ({ children }: { children: React.ReactNode }) => <code className="text-gray-200">{children}</code>;

// Step-by-step prose for the last ticket. Text uses text colors only; the path
// diagram and charts carry the model colors.
export default function TraceSteps({ ticket, isClassifier, answers, answer, judgeModel, passthroughTarget }: Props) {
  const answerCost = ticket.answerCostUsd ?? ticket.estimatedCostUsd;
  return (
    <ol className="space-y-5">
      <Step n={1} title="Your app sends one request">
        <p>
          Ticket <span className="text-gray-200">&ldquo;{ticket.subject}&rdquo;</span> ({ticket.customerTier} customer),
          sent with <Code>model: &quot;{ticket.route}&quot;</Code>. The route name is the only routing input the app provides.
        </p>
      </Step>

      {isClassifier ? (
        <Step n={2} title={`Switchyard asks the judge (${judgeModel ? modelName(judgeModel) : "judge"})`}>
          <p>
            The judge reads the ticket with the route&apos;s prompt and may only answer{" "}
            {answers.map((a, i) => (
              <span key={a}>{i > 0 && (i === answers.length - 1 ? " or " : ", ")}<Code>{a}</Code></span>
            ))}.
          </p>
          {answer && (
            <p>
              It answered <Code>{answer}</Code>
              <span className="text-gray-600"> (read back from the selected model; Switchyard does not return the raw verdict)</span>.
            </p>
          )}
          {ticket.judge && (
            <p>
              Estimated cost of this call: <span className="text-gray-200">{usd(ticket.judge.costUsd)}</span>
              <span className="text-gray-600"> (~{ticket.judge.inputTokens} input + {ticket.judge.outputTokens} output tokens; Switchyard does not report the judge&apos;s usage, so it is estimated from the ticket and prompt size)</span>.
            </p>
          )}
        </Step>
      ) : (
        <Step n={2} title="No judge: passthrough">
          <p>
            The <Code>{ticket.route}</Code> route always sends the request to <Code>{passthroughTarget ?? "its target"}</Code>, so there is no judge call to pay for.
          </p>
        </Step>
      )}

      <Step n={3} title={`${modelName(ticket.modelUsed)} answers`}>
        <p>
          <span className="text-gray-200">{modelName(ticket.modelUsed)}</span>{" "}
          <span className="text-gray-600">({ticket.modelUsed})</span> triaged the ticket; {(ticket.latencyMs / 1000).toFixed(1)} s end to end.
        </p>
        <p>
          {ticket.inputTokens != null && ticket.outputTokens != null && <>{ticket.inputTokens} input + {ticket.outputTokens} output tokens, </>}
          <span className="text-gray-200">{usd(answerCost)}</span>.
          {ticket.judge && <> With the judge: <span className="text-gray-200">{usd(ticket.estimatedCostUsd)}</span> in total.</>}
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
  );
}
