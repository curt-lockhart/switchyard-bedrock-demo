#!/usr/bin/env bash
# One-time setup: checks prerequisites, deploys Switchyard to Lambda with a
# short-term Bedrock token generated from your AWS credentials, writes .env.local,
# and runs a test request.
#   ./scripts/setup.sh                  first run, or re-run safely at any time
#   ./scripts/setup.sh --refresh-token  put a fresh token on the Lambda (run before each demo day)
set -euo pipefail
cd "$(dirname "$0")/.."

REFRESH_TOKEN=false
[[ "${1:-}" == "--refresh-token" ]] && REFRESH_TOKEN=true

step() { echo; echo "▶ $*"; }
pass() { echo "  ✓ $*"; }
fail() { echo "  ✗ $*" >&2; exit 1; }

step "Checking prerequisites"
for cmd in aws node npm; do
  command -v "$cmd" > /dev/null || fail "$cmd is not installed"
done
node_major=$(node -p 'process.versions.node.split(".")[0]')
(( node_major >= 20 )) || fail "Node.js 20+ required (found $(node -v))"
if ! $REFRESH_TOKEN; then
  command -v docker > /dev/null || fail "docker is not installed"
  docker info > /dev/null 2>&1 || fail "Docker is not running. Start Docker Desktop and re-run."
fi
pass "aws, node $(node -v), npm$($REFRESH_TOKEN || echo ", docker")"

step "Checking AWS login${AWS_PROFILE:+ (profile $AWS_PROFILE)}"
identity=$(aws sts get-caller-identity --query Arn --output text 2>/dev/null) \
  || fail "Not logged in. Run: aws sso login --profile <your-profile> && export AWS_PROFILE=<your-profile>, then re-run."
pass "$identity"

step "Installing npm dependencies"
npm install --no-audit --no-fund --loglevel=error
pass "done"

if $REFRESH_TOKEN; then
  step "Refreshing the Bedrock token on the Lambda"
  ./scripts/lambda-deploy.sh --token-only
  step "Testing the deployment"
  node scripts/doctor.mjs
  exit 0
fi

step "Deploying Switchyard to Lambda (first build takes several minutes)"
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
