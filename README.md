# Switchyard on Amazon Bedrock: Support Triage Demo

A customer support helpdesk demo that shows how [NVIDIA Switchyard](https://github.com/NVIDIA-NeMo/Switchyard) routes LLM requests across model tiers, all on Amazon Bedrock.

## Architecture

```
Browser
  │
  ▼
Next.js app  (runs locally: npm run dev)
  │  AWS SDK: Lambda Invoke, using your AWS SSO login
  ▼
AWS Lambda  (switchyard-demo-proxy, us-east-1)
  └─ Switchyard + Lambda Web Adapter, config from switchyard.toml
       │  Bedrock Mantle (OpenAI-compatible), Bedrock API key from Secrets Manager
       ├─ Nano ──► nvidia.nemotron-nano-3-30b    $0.06/$0.24 /1M
       ├─ Super ► nvidia.nemotron-super-3-120b   $0.15/$0.65 /1M
       └─ Sol ──► openai.gpt-5.6-sol             $4.40/$22.00 /1M
```

Two credentials are involved, and they do different jobs:

- **Your AWS login** lets the app on your laptop invoke the Lambda. The app calls the Lambda with the AWS SDK rather than a Function URL. This keeps the function private and works in AWS organizations whose service control policies (SCPs) block Function URLs.
- **The Bedrock API key** lets Switchyard, inside the Lambda, call the models. It lives in Secrets Manager and is copied into the Lambda at deploy time. The app never sees it, and nothing reads the `AWS_BEARER_TOKEN_BEDROCK` environment variable.

## Before you start

You need:

- An AWS account with Bedrock Mantle access and model access for Nemotron Nano 30B, Nemotron Super 120B and GPT-5.6 Sol.
- AWS CLI, Docker Desktop (running), and Node.js 20+.
- An AWS SSO profile for that account, with permission to use Lambda, ECR, IAM and Secrets Manager. See [Choosing an AWS profile](#choosing-an-aws-profile).
- A **long-term** Bedrock API key. In the AWS console, go to Amazon Bedrock > API keys > Long-term API keys. Long-term keys start with `ABSK`. Short-term keys start with `bedrock-api-key-`, expire within 12 hours, and work only in the region the console was set to when they were created, so they need replacing often. The demo uses us-east-1.

### Choosing an AWS profile

The app finds AWS credentials differently from the AWS CLI. If `~/.aws/credentials` holds static keys for a profile, the app uses those keys first, even after they expire and even when the CLI still works through SSO. Pick an SSO profile that has no entry in `~/.aws/credentials`. To list the profiles that do have static keys:

```bash
grep '^\[' ~/.aws/credentials
```

Use a profile that is not in that list. `default` often is.

## Setup (once)

```bash
aws sso login --profile <your-profile>
export AWS_PROFILE=<your-profile>
./scripts/setup.sh
```

The script:

1. Checks that the AWS CLI, Docker and Node.js 20+ are installed and that you are logged in to AWS.
2. Runs `npm install`.
3. Asks for your Bedrock API key. Paste it and press Enter. Each character shows as `*`. The script prints the key's length, sends one test request to Bedrock, and stores the key in Secrets Manager only if Bedrock accepts it.
4. Builds Switchyard and deploys it to Lambda. The first build takes several minutes.
5. Writes `.env.local` with your profile.
6. Runs `npm run doctor`, which sends a test ticket.

It is safe to re-run. Then start the app and open http://localhost:3000:

```bash
npm run dev
```

### .env.local

| Variable | Default | Purpose |
|---|---|---|
| `AWS_PROFILE` | none | SSO profile the app uses to invoke the Lambda |
| `SWITCHYARD_LAMBDA_FN` | `switchyard-demo-proxy` | Lambda function name |
| `SWITCHYARD_LAMBDA_REGION` | `us-east-1` | Lambda region |
| `SWITCHYARD_ROUTE` | `support-triage-classifier` | Route used when a request does not name one |

Restart `npm run dev` after editing `.env.local`.

## Each time you demo

```bash
aws sso login --profile <your-profile>
npm run doctor
npm run dev
```

## Replacing the Bedrock API key

```bash
./scripts/setup.sh --new-key
```

This tests the new key, stores it, and redeploys the Lambda so it uses the key. If Bedrock rejects the key, nothing is stored and the current key stays in place.

## Routing strategies

Pick a strategy in the UI. No code or config change is needed.

| Route | How it works |
|---|---|
| `support-triage-classifier` (LLM Classifier) | Super reads the ticket and answers `nano` or `sol`. Routine tickets go to Nano. Fraud, security problems, data loss, outages, legal threats, chargebacks, urgent money-at-risk tickets, and enterprise customers who are blocked go to Sol. |
| `support-triage-3tier` (3-Tier Custom) | Super reads the ticket and applies numbered rules: the same Sol triggers, then Super for customers who are blocked or have something broken, then Nano for everything else. |
| `baseline` (Sol Only) | Every ticket goes to Sol. Use it to compare costs against the other strategies. |

Both classifiers use Switchyard's custom classifier mode. The judge prompt and the allowed answers are in [`switchyard.toml`](./switchyard.toml). If the judge's answer cannot be parsed, the ticket goes to Sol.

This demo uses custom mode rather than Switchyard's capability mode (`mode = "capability"`). Capability mode's built-in rubric estimates whether an efficient agent can complete a task, and is designed for agentic workloads. For these support tickets, a custom prompt that describes ticket risk gave more consistent routing in testing. The stage router is not included because it routes on tool-call activity in agent sessions, and single support tickets do not involve tool calls.

### What to expect from the sample tickets

These are the results from the sample tickets on the main page, each run at least 3 times:

| Sample ticket | LLM Classifier | 3-Tier Custom | Baseline |
|---|---|---|---|
| Order tracking | Nano | Nano | Sol |
| Payment methods | Nano | Nano | Sol |
| Double charge | Nano | Super | Sol |
| Can't log in, as Standard | Nano | Super | Sol |
| Can't log in, as Enterprise | Sol | Sol | Sol |
| Account locked (urgent deadline) | usually Sol | Super | Sol |
| Security breach | Sol | Sol | Sol |

### Customer tier

The customer tier is sent to the judge as one line of the ticket (`Customer Tier: enterprise`). Both judge prompts contain one rule that uses it: an **enterprise customer who is blocked** (cannot log in, cannot work or cannot use the product) goes to Sol. The tier alone never escalates a ticket: an enterprise customer asking about payment methods stays on Nano. The triage prompt also makes these tickets at least P1.

To show it live, run the "Can't log in" sample as Standard, then switch the tier to Enterprise and run it again. In testing this flipped 4 out of 4 times on both classifier routes (Nano → Sol, and Super → Sol).

The judge makes each routing decision fresh, so a borderline ticket can occasionally route differently between runs.

The bulk view's 20 tickets are 16 routine Bitext tickets, dealt in turn from its simple, medium and complex intents, plus 4 hand-written high-risk tickets at positions 3, 8, 13 and 18: an account takeover, data loss after an update, a chargeback and legal threat, and a payroll deadline with money at risk ([`data/escalation-tickets.json`](./data/escalation-tickets.json)). Bitext has almost no tickets like these, so without them every route looks the same. A 5-ticket run includes 1 of them, a 10-ticket run 2.

In a 20-ticket bulk run:

| Route | Nano | Super | Sol | Total cost | vs Sol only |
|---|---|---|---|---|---|
| LLM Classifier | 16 | – | 4 | $0.0153 | 79% cheaper |
| 3-Tier Custom | 14 | 2 | 4 | $0.0147 | 79% cheaper |
| Baseline (Sol Only) | – | – | 20 | $0.0674 | – |

Both classifier routes sent exactly the 4 high-risk tickets to Sol.

The **How it works** tab (`/how-it-works`) explains the flow and the three strategies for an audience. It shows the judge prompts and route config read live from the local `switchyard.toml`, and traces the last ticket triaged on the Demo tab step by step. The traced cost covers the answering model only: Switchyard's reported token usage does not include the judge call.

## Changing the routing config

The Lambda uses the copy of [`switchyard.toml`](./switchyard.toml) from its last deploy, not your local file. After any edit, redeploy:

```bash
./scripts/lambda-deploy.sh
npm run doctor
```

To tune a classifier, edit its `prompt` under `[routes.<route>]`, then redeploy and run the sample tickets again, several times each. Rules that worked well in testing:

- Make Nano the default, and give Sol a short, specific list of triggers.
- Write the triggers as numbered rules, and put conditional rules first. For 3-Tier, "use the first rule that applies" keeps a ticket that matches a Sol rule from being caught by a broader Super rule.
- Use Super as the judge (`judge = ["super"]` under `[routes.<route>.models]`) when a rule combines conditions, such as "enterprise AND blocked". With Nano as the judge, that rule was ignored or applied to every tier, and 3-Tier sent routine tickets to Super and Sol. A judge call is a few output tokens, so Super adds a fraction of a cent per ticket.
- Check that sample tickets do not accidentally match another rule. "I can't use the product at all" read as an outage and went to Sol for every tier.
- Spell out close calls. For example, a double charge on the customer's own order is routine billing for Nano, while charges the customer never made are fraud for Sol.
- Keep it short. A 215-word version that also listed routine topics and told Nano to ignore typos and swearing routed about the same as the current 77-word prompt.

The Switchyard version is pinned in [`Dockerfile.lambda`](./Dockerfile.lambda) (`SWITCHYARD_REV`) because the config format changes between upstream versions. For example, custom classifier routes now take a `[routes.<name>.models]` table with `judge`, `any` and one entry per answer, and they reject the older `classifier_target` and `targets` keys. If you bump the version, redeploy and run `npm run doctor` to check the config still loads.

## When something goes wrong

Run:

```bash
npm run doctor
```

It checks your AWS credentials the same way the app does, confirms the Lambda is running, and sends a test ticket. Each failure prints the fix.

| Symptom | Cause | Fix |
|---|---|---|
| Browser shows "Connection error" and `npm run doctor` passes | The dev server is not running, for example after Ctrl+C in its terminal | `npm run dev` and reload the page. Run deploys in a second terminal. |
| "AWS credentials are missing or expired" | SSO login expired | `aws sso login --profile <your-profile>`, then restart `npm run dev` |
| AWS CLI works but the app gets "security token is invalid" | Expired static keys in `~/.aws/credentials` take priority over SSO in the app | Set `AWS_PROFILE` in `.env.local` to an SSO profile with no static keys. See [Choosing an AWS profile](#choosing-an-aws-profile). |
| "Lambda does not exist in this profile's AWS account" | `AWS_PROFILE` points at a different account from the one you deployed to | Fix `AWS_PROFILE` in `.env.local`, or run `./scripts/setup.sh` |
| "Lambda is still applying a deploy" | A deploy finished moments ago | Wait a minute and run `npm run doctor` again |
| "Switchyard Lambda failed" or "crashed on startup" | `switchyard.toml` does not load | `aws logs tail /aws/lambda/switchyard-demo-proxy --since 10m` shows the config error |
| "Bedrock rejected the API key" | Key expired or revoked, or a short-term key from another region | `./scripts/setup.sh --new-key` with a long-term key |
| `setup.sh` says "Bedrock rejected the key (HTTP 401)" | The key is incomplete, from another AWS account, or a short-term key from another region | Create a long-term key in this account and try again |
| Routing ignores your `switchyard.toml` changes | The Lambda still runs the last deployed config | `./scripts/lambda-deploy.sh` |

## Tearing down

```bash
aws lambda delete-function --function-name switchyard-demo-proxy --region us-east-1
aws ecr delete-repository --repository-name switchyard-demo/switchyard --force --region us-east-1
aws secretsmanager delete-secret --secret-id switchyard-demo/bedrock-api-key --region us-east-1
aws iam detach-role-policy --role-name switchyard-demo-lambda-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam delete-role --role-name switchyard-demo-lambda-role
```

Earlier versions of the deploy script also created a Function URL, which the app does not use. If you deployed with an older version and want to keep the Lambda, remove it with:

```bash
aws lambda delete-function-url-config --function-name switchyard-demo-proxy --region us-east-1
```

## Key files

| File | Purpose |
|---|---|
| [`scripts/setup.sh`](./scripts/setup.sh) | One-time setup and deploy. `--new-key` replaces the Bedrock API key. |
| [`scripts/doctor.mjs`](./scripts/doctor.mjs) | Diagnoses credential, Lambda and API key problems (`npm run doctor`) |
| [`scripts/lambda-deploy.sh`](./scripts/lambda-deploy.sh) | Build, push to ECR, deploy to Lambda |
| [`switchyard.toml`](./switchyard.toml) | Routing config: LLM clients, targets, routes and judge prompts |
| [`Dockerfile.lambda`](./Dockerfile.lambda) | Switchyard (pinned version) + Lambda Web Adapter image |
| [`lib/switchyard/client.ts`](./lib/switchyard/client.ts) | Invokes the Lambda through the OpenAI SDK and turns failures into readable errors |
| [`app/page.tsx`](./app/page.tsx) | Single-ticket demo UI with sample tickets |
| [`app/bulk/page.tsx`](./app/bulk/page.tsx) | Bulk triage UI with cost comparison |
| [`app/how-it-works/page.tsx`](./app/how-it-works/page.tsx) | "How it works" tab: flow diagram, strategies from `switchyard.toml`, last-ticket trace, routing modes |
| [`app/api/tickets/route.ts`](./app/api/tickets/route.ts) | Picks the bulk view's 20 tickets: a mix of Bitext buckets plus the high-risk tickets |
| [`data/escalation-tickets.json`](./data/escalation-tickets.json) | Four hand-written high-risk tickets for the bulk view (not from Bitext) |
| [`data/tickets.json`](./data/tickets.json) | Tickets for the bulk view: the customer messages from the Bitext customer support dataset, with a subject per intent and sample values for its `{{placeholders}}` (CDLA-Sharing-1.0, see [`NOTICE`](./NOTICE)) |

## Bedrock Mantle notes

- **Base URL**: `https://bedrock-mantle.us-east-1.api.aws/v1` for most models
- **Sol uses a different path**: `https://bedrock-mantle.us-east-1.api.aws/openai/v1`
- **Auth**: a Bedrock API key as a bearer token. No SigV4 signing on the Mantle side.
- **Sol limitations**: does not accept `temperature` or `max_tokens`
- **Sol pricing**: short context (<272k tokens) $4.40/$22.00, long context (1M) $8.80/$33.00 per 1M tokens
- **Judge temperature**: with Nano as the judge, setting `temperature = 0` did not make routing more consistent, and one response was not valid JSON. Use the default temperature.
- **Judge cost**: Switchyard's reported token usage covers the answering model only, so the app's cost figures do not include the judge call.

## License

The code in this repository is licensed under the [Apache License 2.0](./LICENSE). The ticket data in `data/tickets.json` is from the Bitext customer support dataset and is licensed under CDLA-Sharing-1.0; see [`NOTICE`](./NOTICE). The hand-written tickets in `data/escalation-tickets.json` are part of this repository and covered by the Apache License 2.0.
