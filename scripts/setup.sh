#!/usr/bin/env bash
# One-time setup: checks prerequisites, stores the Bedrock API key, deploys
# Switchyard to Lambda, writes .env.local, and runs a test request.
#   ./scripts/setup.sh            first run, or re-run safely at any time
#   ./scripts/setup.sh --new-key  replace the stored Bedrock API key
set -euo pipefail
cd "$(dirname "$0")/.."

REGION="${AWS_REGION:-us-east-1}"
SECRET_ID="switchyard-demo/bedrock-api-key"
NEW_KEY=false
[[ "${1:-}" == "--new-key" ]] && NEW_KEY=true

step() { echo; echo "▶ $*"; }
pass() { echo "  ✓ $*"; }
fail() { echo "  ✗ $*" >&2; exit 1; }

# Reads a secret into $key, echoing * per character. Skips whitespace, control
# characters and terminal escape sequences (e.g. bracketed-paste markers).
read_masked() {
  local char seq
  key=""
  printf '%s' "$1"
  while IFS= read -rs -n1 char; do
    [[ -z "$char" ]] && break
    case "$char" in
      $'\x7f'|$'\b')
        if [[ -n "$key" ]]; then key="${key%?}"; printf '\b \b'; fi ;;
      $'\e')
        # Discard the rest of the escape sequence, e.g. "[200~".
        while IFS= read -rs -n1 seq && [[ "$seq" != [~A-Za-z] ]]; do :; done ;;
      [[:cntrl:]]|[[:space:]]) ;;
      *)
        key+="$char"
        printf '*' ;;
    esac
  done
  echo
}

# Sends a one-token request to Bedrock Mantle with $key. Prints the HTTP status.
test_bedrock_key() {
  printf 'Authorization: Bearer %s' "$key" | curl -s -o /dev/null -w '%{http_code}' -H @- \
    -H "Content-Type: application/json" \
    "https://bedrock-mantle.$REGION.api.aws/v1/chat/completions" \
    -d '{"model":"nvidia.nemotron-nano-3-30b","messages":[{"role":"user","content":"hi"}],"max_tokens":1}'
}

step "Checking prerequisites"
for cmd in aws node npm docker; do
  command -v "$cmd" > /dev/null || fail "$cmd is not installed"
done
node_major=$(node -p 'process.versions.node.split(".")[0]')
(( node_major >= 20 )) || fail "Node.js 20+ required (found $(node -v))"
docker info > /dev/null 2>&1 || fail "Docker is not running. Start Docker Desktop and re-run."
pass "aws, node $(node -v), npm, docker"

step "Checking AWS login${AWS_PROFILE:+ (profile $AWS_PROFILE)}"
identity=$(aws sts get-caller-identity --query Arn --output text 2>/dev/null) \
  || fail "Not logged in. Run: aws sso login --profile <your-profile> && export AWS_PROFILE=<your-profile>, then re-run."
pass "$identity"

step "Installing npm dependencies"
npm install --no-audit --no-fund --loglevel=error
pass "done"

step "Bedrock API key (Secrets Manager: $SECRET_ID)"
secret_exists=false
aws secretsmanager describe-secret --secret-id "$SECRET_ID" --region "$REGION" > /dev/null 2>&1 && secret_exists=true

if $secret_exists && ! $NEW_KEY; then
  pass "already stored (use --new-key to replace it)"
else
  echo "  Create a long-term key in the AWS console: Amazon Bedrock > API keys > Long-term API keys."
  read_masked "  Paste the key, then press Enter: "
  [[ -n "$key" ]] || fail "No key entered"
  if [[ "$key" == bedrock-api-key-* ]]; then
    echo "  ! This is a short-term key. It expires within 12 hours and the demo will stop working."
    read -rp "  Use it anyway? [y/N] " answer
    [[ "$answer" =~ ^[Yy]$ ]] || fail "Aborted. Create a long-term key and re-run."
  fi
  echo "  Key is ${#key} characters. Testing it against Bedrock..."
  status=$(test_bedrock_key)
  case "$status" in
    200) pass "Bedrock accepted the key" ;;
    401) fail "Bedrock rejected the key (HTTP 401). Check it was copied in full, and that it is for this AWS account. Nothing was stored." ;;
    403) fail "The key is valid but not allowed to call Nemotron Nano (HTTP 403). Check the key's IAM permissions and Bedrock model access. Nothing was stored." ;;
    *)   fail "Test request returned HTTP $status. Nothing was stored." ;;
  esac
  if $secret_exists; then
    aws secretsmanager put-secret-value --secret-id "$SECRET_ID" --secret-string "$key" --region "$REGION" > /dev/null
  else
    aws secretsmanager create-secret --name "$SECRET_ID" --secret-string "$key" --region "$REGION" > /dev/null
  fi
  unset key
  pass "stored"
fi

step "Deploying Switchyard to Lambda (first build takes several minutes)"
unset BEDROCK_API_KEY
./scripts/lambda-deploy.sh

step "Writing .env.local"
if [[ ! -f .env.local ]]; then
  cp .env.example .env.local
  pass "created from .env.example"
else
  pass "kept existing .env.local"
fi
if [[ -n "${AWS_PROFILE:-}" ]] && ! grep -q "^AWS_PROFILE=" .env.local; then
  echo "AWS_PROFILE=$AWS_PROFILE" >> .env.local
  pass "set AWS_PROFILE=$AWS_PROFILE"
fi

step "Testing the deployment"
node scripts/doctor.mjs
