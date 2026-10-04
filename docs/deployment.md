# Hosted MCP deployment and acceptance

Updated 2026-10-04. Fresh isolated migrations, backend regressions and the local browser consent/disconnect flow have passed. Docker/Coolify production deployment, public health/discovery and the production API-key MCP workflow are verified. Public hosted OAuth discovery, refresh and Codex disconnect now pass, as do actual ChatGPT, Claude web and Codex usage calls. Cursor desktop 3.23.12 also passed OAuth, 14-tool discovery and an actual usage call after the loopback registration fix was deployed. Claude Code remains unverified.

## Services and configuration

Deploy three independently built services: Glympt backend, frontend and this MCP package. The backend owns PostgreSQL, Redis, billing and OAuth grant state. The MCP service calls its public HTTPS API and has no direct infrastructure access.

| Backend variable        | Purpose                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `MCP_ENABLED=true`      | Enable OAuth routes after migrations and consent UI are ready                              |
| `MCP_RESOURCE_URL`      | Exact public resource, e.g. `https://mcp-staging.example.com/mcp`                          |
| `MCP_GATEWAY_SECRET`    | Random 32–256 character alphanumeric/underscore/hyphen secret shared only with the gateway |
| `MCP_DELEGATION_SECRET` | Independent backend-only signing secret, at least 32 characters                            |
| `API_BASE_URL`          | Public backend origin; OAuth issuer is this origin plus `/api/auth`                        |
| `WEB_APP_URL`           | Frontend origin hosting login, workspace selection and consent                             |

Keep `BETTER_AUTH_URL`, trusted web origins, CORS and existing session-cookie configuration consistent with the staging origins. Generate each new secret independently with `openssl rand -hex 32`; do not put generated values into documentation or version control.

| MCP variable                 | Purpose                                                                |
| ---------------------------- | ---------------------------------------------------------------------- |
| `GLYMPT_API_BASE_URL`        | Same public API origin as backend `API_BASE_URL`                       |
| `GLYMPT_MCP_RESOURCE_URL`    | Exactly the backend's `MCP_RESOURCE_URL`                               |
| `GLYMPT_MCP_GATEWAY_SECRET`  | Same secret as backend `MCP_GATEWAY_SECRET`                            |
| `GLYMPT_MCP_PORT=3100`       | Internal listening port                                                |
| `GLYMPT_MCP_ALLOWED_ORIGINS` | Optional exact browser origins, comma-separated; no paths or wildcards |

No customer API key belongs in the hosted service environment. The consent frontend uses its existing API-origin configuration; it needs none of these secrets.

The backend uses `MCP_RESOURCE_URL` and `MCP_GATEWAY_SECRET`; only the MCP service uses the `GLYMPT_` prefix. Copying the MCP service's variable names into the backend leaves the required backend settings absent and causes startup validation to fail when `MCP_ENABLED=true`.

## Rollout order

1. Prepare an isolated staging database/Redis, a verified test user and an API-enabled paid workspace. Use the existing manual subscription mechanism for staging; do not change a production Free account.
2. Build and test the backend with its updated lockfile. Run the normal Drizzle migration process, including `0039`, `0040` and `0041`, against staging. `0041` changes the OAuth assertion replay identifier to text, matching the provider. Do not run tests against the application database.
3. Deploy the backend initially with `MCP_ENABLED=false`. Confirm normal login, API keys, billing and worker/result flows still work. New API workflow routes must pass ownership, replay, export and rate-limit checks.
4. Deploy the frontend's `/mcp/connect/{login,workspace,consent}` pages and the account-settings disconnect control. Check session sign-in and verified-email handling in a browser.
5. Configure the exact resource/issuer and secrets, enable OAuth in staging, and verify authorization-server discovery at `/.well-known/oauth-authorization-server/api/auth`.
6. Build the MCP image using this repository's Dockerfile. Route its public HTTPS hostname to port 3100, preserving the public Host header and the `/mcp` and well-known paths.
7. Verify protected-resource metadata at `/.well-known/oauth-protected-resource/mcp`, the unauthenticated `/mcp` challenge, and a full OAuth connection from each first-release host.
8. Execute the ledger acceptance cases below through both API-key and delegated OAuth clients. Prepare the final release evidence and review production configuration before deploying publicly.

For Coolify, use this separate MCP repository as the build context with the Dockerfile builder and port 3100. Supply runtime environment variables privately. Docker's health command connects internally but sends the configured public Host header; a generic localhost probe will otherwise receive a deliberate 403. Sticky sessions are unnecessary because the MCP handler is stateless.

Coolify's application domain and the OAuth resource are different settings. For `mcp.glympt.com`, set **Ports exposes** to `3100` and the Coolify **Domain** to `https://mcp.glympt.com:3100`, routing the whole hostname. Set `GLYMPT_MCP_RESOURCE_URL` and backend `MCP_RESOURCE_URL` to `https://mcp.glympt.com/mcp`, without the internal port. Putting `/mcp` in Coolify's Domain creates a path-prefix/strip-prefix route and leaves discovery and health paths inaccessible. Keep `/mcp`, `/health` and `/.well-known/*` intact through the proxy.

The reverse proxy must preserve public Host and forward only trusted client-IP headers. Configure the backend's existing `TRUST_PROXY`/`TRUSTED_PROXY_IPS` narrowly for its actual proxy. Authenticated gateway traffic has a separate ceiling, while the paid account allowance is shared across keys and delegated tools, including polling. Do not solve a proxy problem by disabling paid rate limits.

## Local database verification

The integration target must be localhost and have `test` in its database name, and must differ from the application `DATABASE_URL`. Tests reject a missing explicit target before connecting. Migrations use `DATABASE_URL`; the test harness uses `GLYMPT_TEST_DATABASE_URL`.

After isolated migrations, set `NODE_ENV=test`, `GLYMPT_TEST_DATABASE_URL`, a dedicated test `REDIS_URL`, and the normal required nonproduction environment. For OAuth tests also enable MCP with loopback API/resource origins and separate test secrets. Export those variables into the shell used by the test commands. Set `TEST_API_URL` to a separately started API using the same isolated test database for HTTP tests. Do not rely on an environment file supplied only to a parent `node --run` invocation reaching every child process. Then run:

```sh
node --import tsx --test --test-concurrency=1 src/__tests__/mcp-oauth.e2e.test.ts src/__tests__/api-workflows.e2e.test.ts
pnpm test:e2e
pnpm test:billing-recovery
pnpm test:billing-recovery:queue
```

Use the backend directory. The tests create and remove their own fixtures. Unit tests use MCP disabled and their expected local SEO test token; OAuth tests enable MCP separately. The BullMQ test also requires `GLYMPT_TEST_REDIS_URL` to name a non-default local database different from application `REDIS_URL`, `QUEUE_REDIS_URL` matching that test URL, and matching `GLYMPT_TEST_REDIS_PREFIX`/`QUEUE_REDIS_PREFIX` values beginning `glympt:test:`. Inspect any `not ok` output, including failed suite teardown, as a failed run even if the runner reports zero failed individual cases. In a restricted sandbox, request the required database/socket access through the approval mechanism; do not bypass a rejected approval by changing the transport.

## Ledger acceptance

Record starting/ending balance and relevant ledger IDs for each case. Capture operation keys and job/batch IDs, without credentials. Use a real isolated worker or the existing worker ingestion fixture for deterministic outcomes.

| Case                                                   | Required result                                              |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| Cached lookup                                          | One API debit                                                |
| Fresh successful lookup                                | One debit, same accepted job on replay                       |
| Valid fetch with no technology                         | One debit                                                    |
| Duplicate batch domains                                | One debit per unique normalized credit unit                  |
| Response loss, serial/concurrent replay                | Original operation outcome; no extra debit                   |
| Same key with changed payload                          | Conflict; no new debit                                       |
| Replay after last credit                               | Original accepted outcome, not insufficient-credit rejection |
| Hard technical failure / worker failure                | Original debit refunded once by the ledger policy            |
| Insufficient credits                                   | No accepted chargeable work                                  |
| Read/poll/save/export                                  | No enrichment debit; reads consume rate allowance            |
| Downgrade, expired/revoked credential, membership loss | Request rejected before new chargeable work                  |
| Foreign workspace job/batch/list/export                | Access rejected without cross-workspace data                 |

Also verify refresh rotation, client-assertion replay protection, tampered authorization query, denied consent, parallel authorization tabs selecting different workspaces, token audience/expiry, logout/session loss and the user disconnect action. Test default CIMD identity and legacy registration where supported by actual hosts.

## Monitoring and rollback

MCP logs only request ID, method, path, status and duration. Backend request logs omit OAuth query parameters and redact authorization and gateway headers. Proxy access logs must also omit query strings on authorization/callback routes and redact credentials. Record rates of 401/403/402/429/503 and export/queue failures without logging token bodies.

`/health` confirms the MCP process is serving; it does not establish API, worker or credit recovery health. Separately monitor the existing backend/worker health and mandatory credit recovery.

To disable hosted access, stop the MCP service and set backend `MCP_ENABLED=false`; retain migrations and ledger/grant history. Do not reverse additive database migrations during rollback. Delegations are limited to 60 seconds and accepted work continues under the existing billing/refund rules. Rotate shared gateway and backend signing secrets together only when necessary, and verify how the new values affect existing clients.

Publish client compatibility claims or a registry listing only after actual host and paid-ledger verification. A registry entry is not a substitute for those checks.

## Production CIMD token validation fix — 2026-10-04

A production Codex login and refresh initially succeeded while MCP discovery returned 401. The gateway configuration matched. The backend token exchange used the original OAuth options instead of the provider’s initialized options, omitting the companion client-discovery extensions. The exchange now validates with `provider.options`. The extension-backed real-database regression fails with the old code and passes with the fix; all ten OAuth cases pass. The user deployed the fix. Modern/legacy hosted discovery and refresh rotation now pass, and Codex settings disconnect rejects access (401) and refresh (`invalid_grant`). Detailed acceptance artifacts remain in the private application workspace.
