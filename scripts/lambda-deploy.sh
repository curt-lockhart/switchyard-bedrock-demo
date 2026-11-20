#!/usr/bin/env bash
# Build Switchyard and deploy it to AWS Lambda. The Next.js app runs locally and
# invokes the function directly with the AWS SDK (no Function URL, which some organization SCPs block).
#   ./scripts/lambda-deploy.sh               build and deploy; re-run after any change to switchyard.toml
#   ./scripts/lambda-deploy.sh --token-only  only put a fresh Bedrock token on the existing Lambda (seconds)
# The image is built for the build machine's architecture (Apple Silicon/Graviton: arm64,
# Intel/AMD: x86_64) so it compiles natively, and the Lambda runs on the same architecture.
# Override with LAMBDA_ARCH=arm64 or LAMBDA_ARCH=x86_64.
# Every run generates a short-term Bedrock token from your AWS credentials (scripts/bedrock-token.mjs).
# First-time setup: ./scripts/setup.sh
set -euo pipefail

# Deliberately not AWS_REGION: a shell-wide AWS_REGION (e.g. us-west-2) would deploy the
# Lambda where the app does not look. Same variable and default as the app (.env.local).
REGION="${SWITCHYARD_LAMBDA_REGION:-us-east-1}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SWITCHYARD_REPO="switchyard-demo/switchyard"
SWITCHYARD_FN="switchyard-demo-proxy"
ROLE_NAME="switchyard-demo-lambda-role"
TOKEN_ONLY=false
[[ "${1:-}" == "--token-only" ]] && TOKEN_ONLY=true

log() { echo "▶ $*"; }

# ── Bedrock token ─────────────────────────────────────────────────────────────
# Generated first so a credentials problem fails before the slow build.

log "Generating a short-term Bedrock token from your AWS credentials..."
LAMBDA_ENV=$(node "$ROOT/scripts/bedrock-token.mjs")

if $TOKEN_ONLY; then
  aws lambda get-function --function-name "$SWITCHYARD_FN" --region "$REGION" > /dev/null 2>&1 \
    || { echo "✗ Lambda $SWITCHYARD_FN not found in $REGION. Run ./scripts/setup.sh first." >&2; exit 1; }
  log "Updating the token on Lambda $SWITCHYARD_FN..."
  aws lambda update-function-configuration \
    --function-name "$SWITCHYARD_FN" \
    --environment "$LAMBDA_ENV" \
    --region "$REGION" > /dev/null
  aws lambda wait function-updated --function-name "$SWITCHYARD_FN" --region "$REGION"
  echo ""
  echo "✅ Token updated on Lambda $SWITCHYARD_FN ($REGION)."
  exit 0
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_BASE="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

# ── Architecture ─────────────────────────────────────────────────────────────
# Ask Docker rather than uname: the Docker engine does the build, and uname reports
# x86_64 in a shell running under Rosetta on Apple Silicon.

if [[ -z "${LAMBDA_ARCH:-}" ]]; then
  case "$(docker info --format '{{.Architecture}}' 2>/dev/null || uname -m)" in
    aarch64|arm64) LAMBDA_ARCH=arm64 ;;
    x86_64|amd64)  LAMBDA_ARCH=x86_64 ;;
    *) echo "✗ Could not detect the build architecture. Set LAMBDA_ARCH=arm64 or LAMBDA_ARCH=x86_64." >&2; exit 1 ;;
  esac
fi
case "$LAMBDA_ARCH" in
  arm64)  DOCKER_PLATFORM=linux/arm64 ;;
  x86_64) DOCKER_PLATFORM=linux/amd64 ;;
  *) echo "✗ LAMBDA_ARCH must be arm64 or x86_64 (got $LAMBDA_ARCH)." >&2; exit 1 ;;
esac
log "Building for $LAMBDA_ARCH ($DOCKER_PLATFORM)"

# ── ECR auth ─────────────────────────────────────────────────────────────────

log "Authenticating with ECR ($REGION)..."
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$ECR_BASE"

aws ecr describe-repositories --repository-names "$SWITCHYARD_REPO" --region "$REGION" \
  > /dev/null 2>&1 \
  || aws ecr create-repository --repository-name "$SWITCHYARD_REPO" --region "$REGION" > /dev/null

# ── Build & push ──────────────────────────────────────────────────────────────

log "Building Switchyard Lambda image (cached after first run)..."
docker buildx build --platform "$DOCKER_PLATFORM" --provenance=false \
  -t "$ECR_BASE/$SWITCHYARD_REPO:lambda" \
  -f "$ROOT/Dockerfile.lambda" "$ROOT" --push

# ── IAM role ─────────────────────────────────────────────────────────────────

if ! aws iam get-role --role-name "$ROLE_NAME" > /dev/null 2>&1; then
  log "Creating Lambda execution role..."
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
    > /dev/null
  aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  log "Waiting for role to propagate..."
  sleep 10
fi

ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query Role.Arn --output text)

# ── Switchyard Lambda ─────────────────────────────────────────────────────────

SWITCHYARD_IMAGE="$ECR_BASE/$SWITCHYARD_REPO:lambda"

if aws lambda get-function --function-name "$SWITCHYARD_FN" --region "$REGION" > /dev/null 2>&1; then
  log "Updating Switchyard Lambda..."
  aws lambda update-function-code \
    --function-name "$SWITCHYARD_FN" \
    --image-uri "$SWITCHYARD_IMAGE" \
    --architectures "$LAMBDA_ARCH" \
    --region "$REGION" > /dev/null
  aws lambda wait function-updated --function-name "$SWITCHYARD_FN" --region "$REGION"
  aws lambda update-function-configuration \
    --function-name "$SWITCHYARD_FN" \
    --timeout 60 \
    --environment "$LAMBDA_ENV" \
    --region "$REGION" > /dev/null
else
  log "Creating Switchyard Lambda..."
  aws lambda create-function \
    --function-name "$SWITCHYARD_FN" \
    --package-type Image \
    --code "ImageUri=$SWITCHYARD_IMAGE" \
    --role "$ROLE_ARN" \
    --architectures "$LAMBDA_ARCH" \
    --timeout 60 \
    --memory-size 512 \
    --environment "$LAMBDA_ENV" \
    --region "$REGION" > /dev/null
  aws lambda wait function-active --function-name "$SWITCHYARD_FN" --region "$REGION"
fi

aws lambda wait function-updated --function-name "$SWITCHYARD_FN" --region "$REGION"

echo ""
echo "✅ Switchyard deployed to Lambda $SWITCHYARD_FN ($REGION)."
echo "   Verify with: npm run doctor"
