import Link from "next/link";
import { loadSwitchyardConfig, type RouteConfig } from "@/lib/switchyard/config";
import { COST_PER_1M } from "@/lib/switchyard/client";
import SiteHeader from "@/app/components/SiteHeader";

// Read switchyard.toml on every request so the page reflects local edits.
export const dynamic = "force-dynamic";

const TIER = {
  nano:  { label: "Nano",  model: "Nemotron Nano 30B",   text: "text-[#76b900]",  chip: "bg-[#76b900]/20 text-[#76b900]",   border: "border-[#76b900]/40" },
  super: { label: "Super", model: "Nemotron Super 120B", text: "text-blue-400",   chip: "bg-blue-500/20 text-blue-400",     border: "border-blue-500/40" },
  sol:   { label: "Sol",   model: "GPT-5.6 Sol",         text: "text-purple-400", chip: "bg-purple-500/20 text-purple-400", border: "border-purple-500/40" },
} as const;
type TierName = keyof typeof TIER;
const tier = (name: string) => TIER[name as TierName];

// Plain-language framing per route. The prompt, answers and TOML come from switchyard.toml.
const STORY: Record<string, { label: string; idea: string; why: string }> = {
  "support-triage-classifier": {
    label: "LLM Classifier",
    idea: "Cheap by default, escalate on risk.",
    why: "Nano answers every ticket unless the judge spots a specific red flag: fraud, a security problem, data loss, an outage, a legal threat, a chargeback, an urgent deadline with money at risk, or an enterprise customer who can't work. Those go to Sol.",
  },
  "support-triage-3tier": {
    label: "3-Tier Custom",
    idea: "Three tiers, picked by rules.",
    why: "The same mechanism with three answers instead of two. The judge applies the first rule that fits: risky tickets and blocked enterprise customers to Sol, blocked or broken to Super, questions and simple changes to Nano.",
  },
  baseline: {
    label: "Baseline (Sol Only)",
    idea: "No routing, for comparison.",
    why: "Every ticket goes straight to the most capable model. This is what you would pay without Switchyard.",
  },
};

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

function Box({ title, sub, where, className = "" }: { title: string; sub?: string; where: string; className?: string }) {
  return (
    <div className={`rounded-lg border border-gray-800 bg-[#111] px-4 py-3 ${className}`}>
      <p className="text-[10px] uppercase tracking-wider text-gray-600">{where}</p>
      <p className="text-sm font-medium text-gray-200 mt-0.5">{title}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

const Arrow = ({ label }: { label?: string }) => (
  <div className="flex flex-col items-center justify-center px-1 text-gray-600 shrink-0">
    {label && <span className="text-[10px] text-gray-500 mb-0.5 text-center max-w-[7rem]">{label}</span>}
    <span className="text-lg leading-none">→</span>
  </div>
);

function FlowDiagram({ judge }: { judge: string }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-[#0d0d0d] p-6 overflow-x-auto">
      <div className="flex items-stretch gap-2 min-w-[880px]">
        <Box where="Your laptop" title="Demo app" sub="Next.js, sends the ticket (with customer tier) and model = route name" className="w-44" />
        <Arrow label="Lambda Invoke, your AWS login" />
        <div className="rounded-lg border border-[#76b900]/40 bg-[#76b900]/5 px-4 py-3 w-64">
          <p className="text-[10px] uppercase tracking-wider text-gray-600">AWS Lambda</p>
          <p className="text-sm font-medium text-[#76b900] mt-0.5">Switchyard</p>
          <p className="text-xs text-gray-500 mt-0.5">Looks up the route in switchyard.toml</p>
          <div className="mt-3 rounded border border-gray-800 bg-[#111] px-3 py-2">
            <p className="text-xs text-gray-300">Judge call to <span className={tier(judge)?.text ?? "text-gray-200"}>{tier(judge)?.model ?? judge}</span></p>
            <p className="text-[11px] text-gray-500">&ldquo;Which tier should handle this ticket?&rdquo; Answer must match a JSON schema.</p>
          </div>
        </div>
        <Arrow label="forwards the ticket, Bedrock token" />
        <div className="flex flex-col gap-2 w-56">
          {(["nano", "super", "sol"] as const).map((t) => (
            <div key={t} className={`rounded-lg border ${TIER[t].border} bg-[#111] px-3 py-2`}>
              <p className="text-[10px] uppercase tracking-wider text-gray-600">Amazon Bedrock</p>
              <p className={`text-sm font-medium ${TIER[t].text}`}>{TIER[t].model}</p>
            </div>
          ))}
        </div>
        <Arrow label="answer + selected model header" />
        <Box where="Your laptop" title="Triage result" sub="Category, priority, confidence; the UI shows which model answered" className="w-44" />
      </div>
      <p className="text-xs text-gray-600 mt-4">
        Two credentials, two jobs: your AWS login lets the app invoke the Lambda; a short-term Bedrock token on the Lambda
        lets Switchyard call the models. The app never sees the token.
      </p>
    </div>
  );
}

function CostTiles({ judge }: { judge: string }) {
  const nano = COST_PER_1M["nvidia.nemotron-nano-3-30b"];
  const sup = COST_PER_1M["nvidia.nemotron-super-3-120b"];
  const sol = COST_PER_1M["openai.gpt-5.6-sol"];
  const tiles = [
    { label: "Nano, per 1M tokens", value: `$${nano.input} / $${nano.output}`, sub: "input / output · routine tickets", cls: "text-[#76b900]" },
    { label: "Super, per 1M tokens", value: `$${sup.input} / $${sup.output}`, sub: `input / output · mid tier${judge === "super" ? " and the judge" : ""}`, cls: "text-blue-400" },
    { label: "Sol, per 1M tokens", value: `$${sol.input} / $${sol.output}`, sub: "input / output · high-stakes tickets", cls: "text-purple-400" },
    { label: "Sol costs", value: `${Math.round(sol.output / nano.output)}×`, sub: "Nano's price per output token", cls: "text-gray-100" },
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-gray-800 bg-[#111] p-4">
            <p className="text-xs text-gray-500">{t.label}</p>
            <p className={`text-2xl font-semibold mt-1 ${t.cls}`}>{t.value}</p>
            <p className="text-xs text-gray-600 mt-0.5">{t.sub}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-500">
        Every routed ticket also makes one small judge call to {tier(judge)?.model ?? judge}: about 400 input and 20 output
        tokens, roughly $0.00008. Switchyard doesn&apos;t report that call&apos;s usage, so the app estimates it and includes
        it in every cost on the Demo, Bulk and Last ticket tabs.
      </p>
    </div>
  );
}

function StrategyCard({ route, targets }: { route: RouteConfig; targets: Record<string, string> }) {
  const story = STORY[route.id] ?? { label: route.id, idea: "", why: "" };
  const destinations = route.type === "passthrough"
    ? [route.passthroughTarget ?? ""]
    : route.answers;
  return (
    <div className="rounded-xl border border-gray-800 bg-[#111] p-5 flex flex-col gap-4">
      <div>
        <p className="text-xs text-gray-500"><code>{route.id}</code></p>
        <h3 className="text-base font-semibold text-gray-100 mt-1">{story.label}</h3>
        <p className="text-sm text-[#76b900] mt-1">{story.idea}</p>
        <p className="text-sm text-gray-400 mt-2">{story.why}</p>
      </div>

      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-gray-500">Type</dt>
        <dd className="text-gray-300"><code>{route.type}</code>{route.mode && <> · mode <code>{route.mode}</code></>}</dd>
        {route.models.judge && (
          <>
            <dt className="text-gray-500">Judge</dt>
            <dd className="text-gray-300">{route.models.judge.map((t) => tier(t)?.model ?? targets[t] ?? t).join(", ")}</dd>
          </>
        )}
        <dt className="text-gray-500">{route.type === "passthrough" ? "Always" : "Answers"}</dt>
        <dd className="flex flex-wrap gap-1.5">
          {destinations.map((d) => (
            <span key={d} className={`px-2 py-0.5 rounded ${tier(d)?.chip ?? "bg-gray-800 text-gray-300"}`}>{tier(d)?.label ?? d}</span>
          ))}
        </dd>
        {route.defaultTarget && (
          <>
            <dt className="text-gray-500">If unsure</dt>
            <dd className="text-gray-300">
              Unusable judge answer → <span className={tier(route.defaultTarget)?.text}>{tier(route.defaultTarget)?.label ?? route.defaultTarget}</span>
            </dd>
          </>
        )}
        <dt className="text-gray-500">Model calls</dt>
        <dd className="text-gray-300">{route.type === "llm_classifier" ? "2 (judge + answer)" : "1"}</dd>
      </dl>

      {route.prompt && (
        <details className="group">
          <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-200">Judge prompt</summary>
          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-[#0a0a0a] border border-gray-800 p-3 text-xs text-gray-300 leading-relaxed">{route.prompt}</pre>
        </details>
      )}
      <details>
        <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-200">Full route config (TOML)</summary>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-[#0a0a0a] border border-gray-800 p-3 text-[11px] text-gray-300 leading-relaxed">{route.toml}</pre>
      </details>
    </div>
  );
}

const ROUTING_DOCS =
  "https://github.com/NVIDIA-NeMo/Switchyard/blob/21075c6652152dac88a5fbc6b878ca37d7617c1c/docs/routing_algorithms/overview.md";

// The main routing choices in Switchyard, simplified for a demo audience.
// Source: docs/routing_algorithms/overview.md at the commit linked above.
const STRATEGY_GROUPS = [
  {
    title: "Ask a judge first",
    blurb: "A small model reads the request and picks who answers. Works for chat and support traffic.",
    items: [
      { name: "Task", config: 'llm_classifier · mode "capability"', what: "Built-in question: can the cheaper model do this whole task? If not, the stronger one answers.", used: false },
      { name: "Custom", config: 'llm_classifier · mode "custom"', what: "You write the judge's question and the allowed answers, with as many tiers as you like.", used: true },
      { name: "Escalation", config: 'llm_classifier · mode "escalation"', what: "The cheaper model answers first; a judge reviews its turns and switches up after repeated failures.", used: false },
    ],
  },
  {
    title: "Watch the agent work",
    blurb: "No judge call. Routes on how a coding agent's tool calls are going, turn by turn.",
    items: [
      { name: "Auto", config: 'type "auto"', what: "The recommended preset: start cheap, switch to the stronger model when errors pile up. No settings to tune.", used: false },
      { name: "Execution", config: 'type "stage_router"', what: "The same idea as Auto with the knobs exposed, such as how confident it must be before switching.", used: false },
    ],
  },
  {
    title: "Simple rules",
    blurb: "No decision per request. Useful as a baseline or for A/B tests.",
    items: [
      { name: "Fixed", config: 'type "passthrough"', what: "Always the same model.", used: true },
      { name: "Random", config: 'type "random"', what: "A weighted split, for example 30% to one model and 70% to the other.", used: false },
    ],
  },
];

function AvailableStrategies() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {STRATEGY_GROUPS.map((g) => (
          <div key={g.title} className="rounded-xl border border-gray-800 bg-[#111] p-5 space-y-4">
            <div>
              <p className="text-sm font-semibold text-gray-100">{g.title}</p>
              <p className="text-xs text-gray-500 mt-1">{g.blurb}</p>
            </div>
            <ul className="space-y-3">
              {g.items.map((s) => (
                <li key={s.name} className={`rounded-lg border px-3 py-2.5 ${s.used ? "border-[#76b900]/40 bg-[#76b900]/5" : "border-gray-800"}`}>
                  <p className="flex items-center gap-2 text-sm text-gray-200">
                    {s.name}
                    {s.used && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#76b900]/20 text-[#76b900]">used in this demo</span>}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">{s.what}</p>
                  <p className="text-[11px] text-gray-600 mt-1 font-mono">{s.config}</p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-500">
        Switchyard has more strategies for agent workflows, such as plan-then-execute and a reviewer that checks an
        agent&apos;s work. The docs also cover which one to start with:{" "}
        <a href={ROUTING_DOCS} target="_blank" rel="noreferrer" className="text-gray-300 hover:underline">
          Switchyard routing strategies overview ↗
        </a>
      </p>
    </div>
  );
}

function ModesTable() {
  const rows = [
    {
      name: "Custom",
      used: true,
      config: 'type = "llm_classifier"\nmode = "custom"',
      judges: "Whatever your prompt asks; you also define the allowed answers (JSON schema) and which answer maps to which model.",
      fit: "Used here. The question for support tickets is “is this risky, or is this customer blocked?”, which is a business rule you want to write yourself.",
    },
    {
      name: "Task",
      used: false,
      config: 'type = "llm_classifier"\nmode = "capability"',
      judges: "“Can the weaker model complete this whole task?” The judge returns a fixed verdict that Switchyard compares with thresholds.",
      fit: "Answers a different question, and has only two destinations. A security breach is easy to answer but high-stakes; capability mode does not ask about stakes.",
    },
    {
      name: "Auto / Execution",
      used: false,
      config: 'type = "auto"\ntype = "stage_router"',
      judges: "Doesn’t read the message. Scores the agent’s recent tool calls: errors and spinning push to the stronger model, steady progress to the cheaper one.",
      fit: "A support ticket is one message with no tool calls, so there is nothing to score and every ticket lands on the cheaper model.",
    },
  ];
  return (
    <div className="rounded-xl border border-gray-800 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[#111] text-xs text-gray-500">
          <tr>
            <th className="text-left font-medium px-4 py-3 w-56">Algorithm</th>
            <th className="text-left font-medium px-4 py-3">What it decides on</th>
            <th className="text-left font-medium px-4 py-3">Fit for support tickets</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className={`border-t border-gray-800 align-top ${r.used ? "bg-[#76b900]/5" : ""}`}>
              <td className="px-4 py-3">
                <p className={`font-medium ${r.used ? "text-[#76b900]" : "text-gray-200"}`}>{r.name}</p>
                <pre className="mt-1 text-[11px] text-gray-500">{r.config}</pre>
              </td>
              <td className="px-4 py-3 text-gray-400">{r.judges}</td>
              <td className="px-4 py-3 text-gray-400">{r.fit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function HowItWorksPage() {
  const config = loadSwitchyardConfig();
  // The judge shown in the flow diagram and pricing note: the first classifier route's judge.
  const judge = config.routes.find((r) => r.models.judge)?.models.judge?.[0] ?? "judge";

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader active="/how-it-works" />
      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-10 space-y-12">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold text-gray-100">One request in, the right model out</h1>
          <p className="text-gray-400 mt-3">
            Most support tickets are routine and a small model handles them well. A few are high-stakes and deserve the most
            capable model. Switchyard sits between your app and the models and decides per ticket, so your app makes one call
            and you only pay for the big model when it matters.
          </p>
        </div>

        <CostTiles judge={judge} />

        <Section title="How a ticket flows" subtitle="The app never picks a model. It names a route, and Switchyard does the rest.">
          <FlowDiagram judge={judge} />
          <p className="text-xs text-gray-500">
            To see this path for a real ticket, triage one on the Demo tab and open{" "}
            <Link href="/last-ticket" className="text-gray-300 hover:underline">Last ticket</Link>.
          </p>
        </Section>

        <Section
          title="Routing strategies in Switchyard"
          subtitle="The main choices, grouped by what they look at to pick a model. Each is one route block in switchyard.toml."
        >
          <AvailableStrategies />
        </Section>

        <Section
          title="What we implemented for this demo"
          subtitle="Two custom classifiers and a fixed baseline. Switching strategy in the UI only changes the route name the app sends."
        >
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {config.routes.map((r) => <StrategyCard key={r.id} route={r} targets={config.targets} />)}
          </div>
          <p className="text-xs text-gray-600">
            Shown from the local <code>{config.path}</code> (last changed {new Date(config.modifiedAt).toLocaleString()}). The
            Lambda runs the copy from its last deploy; after editing, run <code>./scripts/lambda-deploy.sh</code>.
          </p>
        </Section>

        <Section
          title="Why a custom classifier?"
          subtitle="Support tickets are single messages where the stakes matter more than the difficulty, so the demo uses the strategy that lets you write that rule."
        >
          <ModesTable />
        </Section>

        <Section
          title="Customer tier is part of the rule, not a shortcut"
          subtitle="The tier is sent to the judge as one line of the ticket. The prompts say exactly when it matters."
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            {[
              { t: "Same problem, enterprise", d: "An enterprise customer who can't log in is escalated to Sol: they are blocked, and they are the account you can least afford to keep waiting." },
              { t: "Same problem, standard", d: "A standard customer with the same login problem stays on Nano with the LLM Classifier, or goes to Super with 3-Tier." },
              { t: "Routine question, enterprise", d: "An enterprise customer asking about payment methods stays on Nano. The tier alone never escalates a ticket." },
            ].map((c) => (
              <div key={c.t} className="rounded-xl border border-gray-800 bg-[#111] p-4">
                <p className="font-medium text-gray-200">{c.t}</p>
                <p className="text-gray-400 mt-1">{c.d}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-600">
            Try it on the Demo tab with the &ldquo;Can&apos;t log in&rdquo; sample: run it as Standard, then switch the tier to
            Enterprise, and look at each on the{" "}
            <Link href="/last-ticket" className="text-gray-400 hover:underline">Last ticket</Link> tab.
          </p>
        </Section>
      </main>
    </div>
  );
}
