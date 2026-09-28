// Checks everything the app needs to reach Switchyard, using the same AWS SDK
// credential chain as the app (the AWS CLI can succeed while the SDK fails).
import { existsSync, readFileSync } from "node:fs";
import { LambdaClient, GetFunctionCommand, InvokeCommand } from "@aws-sdk/client-lambda";

// Mirror Next.js: .env.local fills in variables the shell has not already set.
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && m[2] && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const FN = process.env.SWITCHYARD_LAMBDA_FN ?? "switchyard-demo-proxy";
const REGION = process.env.SWITCHYARD_LAMBDA_REGION ?? "us-east-1";
const PROFILE = process.env.AWS_PROFILE;
const loginCmd = `aws sso login${PROFILE ? ` --profile ${PROFILE}` : ""}`;

const pass = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg, fix) => {
  console.log(`  ✗ ${msg}`);
  if (fix) console.log(`    Fix: ${fix}`);
  process.exit(1);
};

console.log(`Checking Switchyard setup (profile: ${PROFILE ?? "default chain"}, Lambda: ${FN} in ${REGION})\n`);

if (!existsSync(".env.local")) fail(".env.local not found", "run npm run setup");
pass(".env.local found");

const client = new LambdaClient({ region: REGION });

try {
  await client.config.credentials();
} catch (err) {
  fail(`AWS credentials could not be loaded: ${err.message}`,
    `${loginCmd}, or set AWS_PROFILE in .env.local to a profile you are logged in to`);
}

let fn;
try {
  fn = await client.send(new GetFunctionCommand({ FunctionName: FN }));
} catch (err) {
  if (err.name === "ResourceNotFoundException") {
    fail(`Lambda ${FN} does not exist in ${REGION} in this profile's AWS account`,
      "check AWS_PROFILE in .env.local points at the account you deployed to, or run npm run setup");
  }
  if (/security token|ExpiredToken|UnrecognizedClient|Token is expired/i.test(`${err.name} ${err.message}`)) {
    fail(`AWS rejected your credentials: ${err.message}`,
      `run ${loginCmd}. If the AWS CLI already works, ~/.aws/credentials probably holds expired static keys ` +
      `for ${PROFILE ? `profile "${PROFILE}"` : "the default profile"}, which the app uses before SSO. ` +
      "Set AWS_PROFILE in .env.local to an SSO profile with no entry in ~/.aws/credentials");
  }
  fail(`Could not read Lambda ${FN}: ${err.name}: ${err.message}`);
}
pass("AWS credentials accepted");

const { State, LastUpdateStatus } = fn.Configuration;
if (LastUpdateStatus === "InProgress") {
  fail("Lambda is still applying a deploy, so it may be using the old config or key", "wait a minute and run npm run doctor again");
}
if (State !== "Active" || LastUpdateStatus === "Failed") {
  fail(`Lambda state is ${State}, last update ${LastUpdateStatus}`, "run ./scripts/lambda-deploy.sh");
}
pass(`Lambda is ${State}`);

const event = {
  version: "2.0",
  routeKey: "POST /v1/chat/completions",
  rawPath: "/v1/chat/completions",
  rawQueryString: "",
  headers: { "content-type": "application/json" },
  requestContext: { http: { method: "POST", path: "/v1/chat/completions" } },
  body: JSON.stringify({
    model: "support-triage-classifier",
    messages: [{ role: "user", content: "Subject: where is my order?\nBody: My tracking has not updated in two days." }],
  }),
  isBase64Encoded: false,
};

let result;
try {
  result = await client.send(new InvokeCommand({ FunctionName: FN, Payload: Buffer.from(JSON.stringify(event)) }));
} catch (err) {
  if (err.name === "AccessDeniedException") {
    fail(`Your AWS identity cannot invoke ${FN}: ${err.message}`, "use a profile with lambda:InvokeFunction permission");
  }
  fail(`Invoking ${FN} failed: ${err.name}: ${err.message}`);
}

const payload = JSON.parse(new TextDecoder().decode(result.Payload));
if (result.FunctionError) {
  fail(`Switchyard crashed on startup: ${payload.errorMessage}`,
    `check the config error in: aws logs tail /aws/lambda/${FN} --region ${REGION} --since 10m`);
}
if (payload.statusCode === 401 || payload.statusCode === 403) {
  fail(`Bedrock rejected the API key (HTTP ${payload.statusCode})`,
    "run ./scripts/setup.sh --new-key with a long-term Bedrock API key");
}
if (payload.statusCode !== 200) {
  fail(`Test request returned HTTP ${payload.statusCode}: ${String(payload.body).slice(0, 300)}`);
}
pass(`Test ticket routed to ${payload.headers?.["x-model-router-selected-model"] ?? "unknown model"}`);

console.log("\nAll checks passed. Start the app with: npm run dev");
