#!/usr/bin/env bash
# Build Switchyard and deploy it to AWS Lambda. The Next.js app runs locally and
# invokes the function directly with the AWS SDK (no Function URL, which some organization SCPs block).
# Re-run after any change to switchyard.toml. First-time setup: ./scripts/setup.sh
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_BASE="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
SWITCHYARD_REPO="switchyard-demo/switchyard"
SWITCHYARD_FN="switchyard-demo-proxy"
ROLE_NAME="switchyard-demo-lambda-role"

log() { echo "▶ $*"; }

# ── ECR auth ─────────────────────────────────────────────────────────────────

log "Authenticating with ECR ($REGION)..."
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$ECR_BASE"

aws ecr describe-repositories --repository-names "$SWITCHYARD_REPO" --region "$REGION" \
  > /dev/null 2>&1 \
  || aws ecr create-repository --repository-name "$SWITCHYARD_REPO" --region "$REGION" > /dev/null

# ── Build & push ──────────────────────────────────────────────────────────────

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

log "Building Switchyard Lambda image (cached after first run)..."
docker buildx build --platform linux/amd64 --provenance=false \
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

# ── Bedrock API key ───────────────────────────────────────────────────────────

if [[ -z "${BEDROCK_API_KEY:-}" ]]; then
  BEDROCK_API_KEY=$(aws secretsmanager get-secret-value \
    --secret-id "switchyard-demo/bedrock-api-key" \
    --region "$REGION" \
    --query SecretString --output text 2>/dev/null) || true
fi

if [[ -z "${BEDROCK_API_KEY:-}" ]]; then
  echo "BEDROCK_API_KEY not set. Enter your Bedrock Mantle API key:"
  read -rs BEDROCK_API_KEY
fi

# ── Switchyard Lambda ─────────────────────────────────────────────────────────

SWITCHYARD_IMAGE="$ECR_BASE/$SWITCHYARD_REPO:lambda"

if aws lambda get-function --function-name "$SWITCHYARD_FN" --region "$REGION" > /dev/null 2>&1; then
  log "Updating Switchyard Lambda..."
  aws lambda update-function-code \
    --function-name "$SWITCHYARD_FN" \
    --image-uri "$SWITCHYARD_IMAGE" \
    --region "$REGION" > /dev/null
  aws lambda wait function-updated --function-name "$SWITCHYARD_FN" --region "$REGION"
  aws lambda update-function-configuration \
    --function-name "$SWITCHYARD_FN" \
    --environment "Variables={BEDROCK_API_KEY=$BEDROCK_API_KEY}" \
    --region "$REGION" > /dev/null
else
  log "Creating Switchyard Lambda..."
  aws lambda create-function \
    --function-name "$SWITCHYARD_FN" \
    --package-type Image \
    --code "ImageUri=$SWITCHYARD_IMAGE" \
    --role "$ROLE_ARN" \
    --timeout 30 \
    --memory-size 512 \
    --environment "Variables={BEDROCK_API_KEY=$BEDROCK_API_KEY}" \
    --region "$REGION" > /dev/null
  aws lambda wait function-active --function-name "$SWITCHYARD_FN" --region "$REGION"
fi

aws lambda wait function-updated --function-name "$SWITCHYARD_FN" --region "$REGION"

echo ""
echo "✅ Switchyard deployed to Lambda $SWITCHYARD_FN ($REGION)."
echo "   Verify with: npm run doctor"
