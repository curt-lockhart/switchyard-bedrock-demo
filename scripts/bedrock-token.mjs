// Generates a short-term Bedrock API key from your current AWS credentials (STS),
// tests it against Bedrock Mantle, and prints the Lambda environment JSON on stdout:
//   {"Variables":{"BEDROCK_API_KEY":"bedrock-api-key-...","BEDROCK_TOKEN_EXPIRES_AT":"<ISO time>"}}
// Status messages go to stderr so the token is never shown in the terminal.
// Used by scripts/lambda-deploy.sh. The token is valid for 12 hours, or until your
// AWS credentials expire if that is sooner.
import { getToken } from "@aws/bedrock-token-generator";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";

// Tokens only work in the region they are signed for. This must match the
// bedrock-mantle.<region> base URLs in switchyard.toml, not your shell's AWS_REGION.
const REGION = "us-east-1";
const MAX_SECONDS = 12 * 60 * 60;
const log = (msg) => console.error(`  ${msg}`);
const fail = (msg) => { console.error(`  ✗ ${msg}`); process.exit(1); };

let credentials;
try {
  credentials = await fromNodeProviderChain()();
} catch (err) {
  fail(`Could not load AWS credentials: ${err.message}. Log in and set AWS_PROFILE, then re-run.`);
}

const token = await getToken({ credentials, region: REGION, expiresInSeconds: MAX_SECONDS });

const maxExpiry = new Date(Date.now() + MAX_SECONDS * 1000);
const expiresAt = credentials.expiration && credentials.expiration < maxExpiry ? credentials.expiration : maxExpiry;

const res = await fetch(`https://bedrock-mantle.${REGION}.api.aws/v1/chat/completions`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "nvidia.nemotron-nano-3-30b",
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 1,
  }),
});
if (res.status === 401) fail("Bedrock rejected the generated token (HTTP 401). Check your AWS credentials are for the right account.");
if (res.status === 403) fail("The token is valid but your AWS identity may not call Nemotron Nano (HTTP 403). Check your IAM permissions and Bedrock model access.");
if (res.status !== 200) fail(`Test request with the generated token returned HTTP ${res.status}.`);

const hours = ((expiresAt.getTime() - Date.now()) / 3_600_000).toFixed(1);
log(`✓ Generated a Bedrock token from your AWS credentials and Bedrock accepted it`);
log(`  Valid until ${expiresAt.toISOString()} (${hours} h). Refresh with: ./scripts/setup.sh --refresh-token`);

process.stdout.write(JSON.stringify({
  Variables: { BEDROCK_API_KEY: token, BEDROCK_TOKEN_EXPIRES_AT: expiresAt.toISOString() },
}));
