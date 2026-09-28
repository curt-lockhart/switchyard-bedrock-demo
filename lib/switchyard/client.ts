import OpenAI from "openai";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const LAMBDA_FN = process.env.SWITCHYARD_LAMBDA_FN ?? "switchyard-demo-proxy";
const LAMBDA_REGION = process.env.SWITCHYARD_LAMBDA_REGION ?? "us-east-1";

// Invokes the Switchyard Lambda directly via AWS SDK (bypasses Function URL).
// The Lambda Web Adapter expects an API Gateway v2 event format.
async function lambdaFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url);
  const method = (init?.method ?? "GET").toUpperCase();
  const body = init?.body != null ? String(init.body) : undefined;

  const event = {
    version: "2.0",
    routeKey: `${method} ${url.pathname}`,
    rawPath: url.pathname,
    rawQueryString: url.search.slice(1),
    headers: { "content-type": "application/json" },
    requestContext: { http: { method, path: url.pathname } },
    body,
    isBase64Encoded: false,
  };

  const client = new LambdaClient({ region: LAMBDA_REGION });
  const result = await client.send(new InvokeCommand({
    FunctionName: LAMBDA_FN,
    Payload: Buffer.from(JSON.stringify(event)),
  }));

  const responseText = new TextDecoder().decode(result.Payload);
  if (result.FunctionError) {
    const detail = JSON.parse(responseText) as { errorMessage?: string };
    throw new Error(
      `Switchyard Lambda failed (${detail.errorMessage ?? result.FunctionError}). ` +
      `Run "npm run doctor", or check logs: aws logs tail /aws/lambda/${LAMBDA_FN} --since 10m`
    );
  }
  const lambdaResponse = JSON.parse(responseText) as {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
  };

  // Switchyard reports the routed model in this header — inject it into the body
  // so the OpenAI SDK surfaces it as response.model.
  const routedModel = lambdaResponse.headers?.["x-model-router-selected-model"];
  let responseBody = lambdaResponse.body;
  if (routedModel && responseBody) {
    try {
      const parsed = JSON.parse(responseBody);
      if (parsed && !parsed.model) parsed.model = routedModel;
      responseBody = JSON.stringify(parsed);
    } catch { /* leave body as-is */ }
  }

  // Drop content-length — we may have grown the body by injecting model field.
  const headers = { ...(lambdaResponse.headers ?? {}) };
  delete headers["content-length"];

  return new Response(responseBody, {
    status: lambdaResponse.statusCode,
    headers,
  });
}

// Switchyard exposes an OpenAI-compatible /v1/chat/completions endpoint.
// We invoke the Lambda directly (not via Function URL), which some organization SCPs block.
let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      baseURL: "http://lambda/v1", // placeholder — lambdaFetch ignores the host
      apiKey: "switchyard",
      fetch: lambdaFetch,
      maxRetries: 0,
    });
  }
  return _client;
}

// The OpenAI SDK reports every lambdaFetch failure as a bare "Connection error.",
// so unwrap the cause and say how to fix it.
function explainError(err: unknown): Error {
  const cause = err instanceof OpenAI.APIConnectionError && err.cause ? err.cause : err;
  const name = (cause as { name?: string })?.name ?? "";
  const message = cause instanceof Error ? cause.message : String(cause);
  const profile = process.env.AWS_PROFILE ? ` --profile ${process.env.AWS_PROFILE}` : "";
  if (/Credential|security token|ExpiredToken|UnrecognizedClient|Token is expired/i.test(`${name} ${message}`)) {
    return new Error(
      `AWS credentials are missing or expired (${message}). ` +
      `Run "aws sso login${profile}", then restart "npm run dev". Run "npm run doctor" for details.`
    );
  }
  if (name === "ResourceNotFoundException") {
    return new Error(`Lambda "${LAMBDA_FN}" not found in ${LAMBDA_REGION}. Run "npm run setup" to deploy it.`);
  }
  if (name === "AccessDeniedException") {
    return new Error(`Your AWS identity cannot invoke "${LAMBDA_FN}" (${message}). Check AWS_PROFILE in .env.local.`);
  }
  return cause instanceof Error ? cause : new Error(message);
}

export interface TriageResult {
  ticketId: string;
  category: string;
  priority: "P0" | "P1" | "P2" | "P3";
  confidence: number;
  reasoning: string;
  needs_human: boolean;
}

export interface TriageWithMeta {
  decision: TriageResult;
  modelUsed: string;   // actual model Switchyard selected
  routeUsed: string;   // Switchyard route ID
  latencyMs: number;
  estimatedCostUsd: number;
  inputTokens: number;
  outputTokens: number;
}

// Token cost table (USD per 1M tokens, Bedrock on-demand us-east-1)
const COST_PER_1M: Record<string, { input: number; output: number }> = {
  "nvidia.nemotron-nano-3-30b":   { input:  0.06, output:  0.24 },
  "nvidia.nemotron-super-3-120b": { input:  0.15, output:  0.65 },
  "openai.gpt-5.6-sol":           { input:  4.40, output: 22.00 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = COST_PER_1M[model] ?? { input: 0, output: 0 };
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

const SYSTEM_PROMPT = `You are a support ticket triage assistant. Classify the incoming ticket and respond with a JSON object matching this exact schema:

{
  "ticketId": string,
  "category": "billing" | "account" | "technical" | "shipping" | "returns" | "product" | "other",
  "priority": "P0" | "P1" | "P2" | "P3",
  "confidence": number (0.0–1.0),
  "reasoning": string,
  "needs_human": boolean
}

Priority guide: P0=critical outage/legal/security, P1=major issue blocking user, P2=standard support, P3=general inquiry.
Set needs_human=true for P0/P1 or confidence < 0.7.
Respond ONLY with the JSON object, no markdown.`;

export async function triageTicket(
  ticket: { id: string; subject: string; body: string; customerTier?: string },
  route = process.env.SWITCHYARD_ROUTE ?? "support-triage-classifier"
): Promise<TriageWithMeta> {
  const client = getClient();
  const t0 = performance.now();

  const userMessage = `Ticket ID: ${ticket.id}
Customer Tier: ${ticket.customerTier ?? "standard"}
Subject: ${ticket.subject}
Body: ${ticket.body}`;

  const response = await client.chat.completions
    .create({
      model: route,  // Switchyard routes by model name
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: userMessage },
      ],
    })
    .catch((err: unknown) => { throw explainError(err); });

  const latencyMs = performance.now() - t0;
  // Switchyard sets x-model-router-selected-model header; fall back to response.model
  const modelUsed = response.model || "unknown";
  const msg = response.choices?.[0]?.message as unknown as Record<string, unknown> | undefined;
  // Sol may put output in `reasoning` when content is empty
  const rawContent = (msg?.content as string | null) || (msg?.reasoning as string | null) || "{}";

  function parseModelJson(text: string): TriageResult {
    // Strip markdown fences
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = (fenced?.[1] ?? text).trim();
    // Extract the first {...} block (model may add trailing commentary)
    const block = candidate.match(/\{[\s\S]*\}/);
    const extracted = block?.[0] ?? candidate;
    try {
      return JSON.parse(extracted);
    } catch {
      // Sanitize raw control characters inside string values and retry
      const cleaned = extracted
        .replace(/\r\n/g, " ")
        .replace(/[\r\n]/g, " ")
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
      return JSON.parse(cleaned);
    }
  }

  let decision: TriageResult;
  try {
    decision = parseModelJson(rawContent);
  } catch {
    decision = { ticketId: "", category: "other", priority: "P3", confidence: 0, reasoning: rawContent, needs_human: false };
  }

  const usage = response.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  const inputTokens = usage.prompt_tokens;
  const outputTokens = usage.completion_tokens;
  const estimatedCostUsd = estimateCost(modelUsed, inputTokens, outputTokens);

  return {
    decision,
    modelUsed,
    routeUsed: route,
    latencyMs,
    estimatedCostUsd,
    inputTokens,
    outputTokens,
  };
}
