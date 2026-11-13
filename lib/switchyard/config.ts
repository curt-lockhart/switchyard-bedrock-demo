// Reads switchyard.toml for the "How it works" page. Server-only (uses fs).
// This is a small extractor for the parts the page shows, not a full TOML parser.
import { readFileSync, statSync } from "fs";
import { join } from "path";

export interface RouteConfig {
  id: string;
  type: string;                 // llm_classifier | passthrough | ...
  mode?: string;                // custom | capability
  defaultTarget?: string;
  classifyTrigger?: string;
  prompt?: string;              // judge instructions
  answers: string[];            // allowed judge answers (response_schema enum)
  models: Record<string, string[]>; // [routes.<id>.models]: answer -> targets
  passthroughTarget?: string;
  toml: string;                 // the route's raw TOML, including sub-tables
}

export interface SwitchyardConfig {
  path: string;
  modifiedAt: string;
  targets: Record<string, string>; // target name -> model id
  routes: RouteConfig[];
}

const str = (block: string, key: string) =>
  block.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m"))?.[1];

export function loadSwitchyardConfig(): SwitchyardConfig {
  const path = join(process.cwd(), "switchyard.toml");
  const text = readFileSync(path, "utf-8");

  // Split into [table] sections, keeping each section's raw text.
  const sections: { name: string; body: string }[] = [];
  const headerRe = /^\[([^\]\n]+)\]\s*$/gm;
  const headers = [...text.matchAll(headerRe)];
  headers.forEach((m, i) => {
    const end = i + 1 < headers.length ? headers[i + 1].index! : text.length;
    sections.push({ name: m[1].trim(), body: text.slice(m.index!, end) });
  });

  const targets: Record<string, string> = {};
  for (const s of sections) {
    const t = s.name.match(/^targets\.(.+)$/);
    if (t) targets[t[1]] = str(s.body, "id") ?? t[1];
  }

  const routeIds = sections
    .map((s) => s.name.match(/^routes\.([^.]+)$/)?.[1])
    .filter((id): id is string => Boolean(id));

  const routes = routeIds.map((id): RouteConfig => {
    const own = sections.filter((s) => s.name === `routes.${id}` || s.name.startsWith(`routes.${id}.`));
    // Drop trailing comment lines that introduce the next route.
    const toml = own.map((s) => s.body).join("").replace(/(\n#[^\n]*)+\s*$/, "").trimEnd();
    const main = own[0].body;

    const models: Record<string, string[]> = {};
    const modelsSection = own.find((s) => s.name === `routes.${id}.models`);
    for (const line of modelsSection?.body.split("\n").slice(1) ?? []) {
      const m = line.match(/^\s*([\w-]+)\s*=\s*\[([^\]]*)\]/);
      if (m) models[m[1]] = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    }
    const enumMatch = main.match(/"enum"\s*:\s*\[([^\]]*)\]/);

    return {
      id,
      type: str(main, "type") ?? "unknown",
      mode: str(main, "mode"),
      defaultTarget: str(main, "default_target"),
      classifyTrigger: str(main, "classify_trigger"),
      prompt: main.match(/^prompt\s*=\s*"""\n?([\s\S]*?)"""/m)?.[1].trim(),
      answers: enumMatch ? [...enumMatch[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [],
      models,
      passthroughTarget: str(main, "target"),
      toml,
    };
  });

  return { path: "switchyard.toml", modifiedAt: statSync(path).mtime.toISOString(), targets, routes };
}
