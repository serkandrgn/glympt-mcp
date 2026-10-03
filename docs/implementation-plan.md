# Glympt MCP implementation plan

Created 2026-10-03. Developer clients and hosted clients are equally important, as confirmed by the user. The shared tools are the first dependency; hosted OAuth follows as the next release milestone, not an optional stretch goal.

## Protocol decision

Use the official TypeScript SDK v2, pinned to published packages, with the 2026-07-28 stateless protocol and the SDK's built-in compatibility for 2025-era clients. The August 22 announcement was a roadmap update; the protocol changes it describes already shipped on July 28.

Sources:

- https://blog.modelcontextprotocol.io/posts/2026-07-28/
- https://blog.modelcontextprotocol.io/posts/mcp-roadmap/
- https://ts.sdk.modelcontextprotocol.io/v2/serving/http.html
- https://ts.sdk.modelcontextprotocol.io/v2/serving/legacy-clients.html
- https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization.html

## Architecture and billing

`mcp/` is an independent TypeScript package. It calls the public paid API over HTTP; it imports no backend source and has no database, Redis, Stripe or worker credentials. The API remains the authority for workspace ownership, API-key scopes, entitlements, account-wide rate limits, debit idempotency and refunds.

Paid API access remains required. The Free CSV trial does not grant API/MCP access. There is no separate MCP credit pool or plan pricing in this milestone.

Each chargeable tool requires a caller-chosen `idempotencyKey`. Reuse it with identical input after transport loss; never silently generate a replacement or automatically retry a chargeable request. A timeout means the result is unknown, not that credits were refunded. Polling and result reads do not submit another enrichment. Tool annotations must identify credit-consuming tools as mutations even though the underlying single-domain API uses GET.

Responses contain bounded JSON and structured errors. Treat detected page content, technology evidence and domain metadata as untrusted data, not agent instructions. Country is estimated; retain confidence and scan freshness.

## Milestone 1 — developer connection

Implement and test:

| Tool                   | API                                   | Scope       | Effect                                         |
| ---------------------- | ------------------------------------- | ----------- | ---------------------------------------------- |
| `enrich_domain`        | `GET /api/v1/enrich/domain`           | lookup:read | Reserves one query credit; may queue work      |
| `enrich_domains`       | `POST /api/v1/enrich/bulk`            | bulk:write  | Reserves credits for unique normalized domains |
| `get_lookup_job`       | `GET /api/v1/enrich/jobs/:id`         | lookup:read | Reads existing job/result                      |
| `get_enrichment_batch` | `GET /api/v1/enrich/bulk/:id`         | bulk:write  | Reads existing progress                        |
| `get_batch_results`    | `GET /api/v1/enrich/bulk/:id/results` | bulk:write  | Reads a filtered page                          |
| `search_domains`       | `GET /api/v1/enrich/search`           | lookup:read | Reads a filtered page of the shared database   |

Run through stdio for developer clients with an API key held in the process environment. Also provide a stateless HTTP handler and a loopback-only HTTP runner protected by a distinct local bearer secret. Do not accept arbitrary inbound API keys for forwarding, use a shared production account, or present this local runner as a public OAuth MCP server.

Acceptance: actual SDK client discovers and invokes tools under modern and legacy revisions; malformed arguments never reach the API; retries preserve idempotency keys; upstream auth/plan/credit/rate/conflict failures remain identifiable; cancellation and timeouts never claim a refund; pagination and response sizes are bounded; credentials never appear in tool results or logs. Test with a mock paid API without consuming production credits.

## Milestone 2 — hosted authorization and API completeness

Use a dedicated OAuth authorization server integrated with Glympt accounts and explicit workspace consent. Issue short-lived audience-bound MCP access tokens; validate issuer, audience, expiry and scopes. Implement Protected Resource Metadata, authorization-server discovery, PKCE and the client's required registration mechanism (prefer CIMD where supported). Do not forward an MCP access token to the API as an API key. Add a backend authentication adapter that maps verified delegated identity to the existing services, preserving the same entitlement and credit checks. Avoid a permanent shared service account.

Add scoped API endpoints for usage/credit status, saved lists and exports before exposing corresponding tools. Existing session-only routes are not suitable for API-key clients. Export generation needs durable request replay and ownership checks, bounded downloads, expiry and CSV formula protection. Update OpenAPI and tenancy/scope tests alongside those changes.

Apply the account-wide request allowance to polling/read routes too, and confirm the proxy's trusted client-IP configuration before hosted release; a separate service must not collapse all customers into an accidental upstream IP ceiling. Add safe metadata-only request logging.

## Milestone 3 — staging billing and client verification

Run against an isolated staging paid workspace: cached lookup, fresh scan, duplicate batch, lost response/replay, concurrent replay, changed-payload conflict, last-credit replay, technical failure/refund, insufficient credits, downgraded plan, revoked key/token and foreign-workspace identifiers. Compare ledger totals to backend outcomes. Exercise initial supported client applications directly rather than assuming SDK compatibility implies host compatibility.

The earlier production API billing checks passed. The frontend terminal-progress/results polling patch is now committed as `493ecd6`; this MCP milestone has not checked its deployment. It does not affect this adapter. No production MCP billing test has yet been performed.

## Milestone 4 — release

Prepare a separate Docker/Coolify service, HTTPS origin allowlist, OAuth configuration, health checks and credential-safe monitoring. Publish client setup docs with an accurate compatibility matrix and credit policy. Test in staging, then deploy the reviewed artifact. Only publish an MCP registry entry once remote auth and client verification pass. Do not claim directory listing or a protocol upgrade will fix search indexing on its own.

## Deferred deliberately

MCP Apps/UI, arbitrary code execution, generic HTTP-fetch tools, agent messaging, subscriptions and experimental Tasks are not required for the first workflows. Existing job IDs and explicit polling keep asynchronous work recoverable across both protocol eras. Revisit the Tasks extension after client support is demonstrated.

## Implementation status — 2026-10-04

| Milestone                         | Source status                                                          | Acceptance status                                                             |
| --------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1. Developer connection           | Implemented                                                            | All 24 local transport/SDK tests pass; actual host applications pending       |
| 2. Hosted OAuth and API workflows | Implemented                                                            | Isolated migrations, OAuth/workflow tests and browser consent/disconnect pass |
| 3. Staging billing and clients    | Local billing and tenancy verified                                     | Public HTTPS staging and actual host connections pending                      |
| 4. Release                        | Dockerfile, environment examples, health probe and setup docs prepared | Docker image build, reviewed production configuration and deployment pending  |

Fourteen tools cover enrichment, polling, filtered database search, usage, saved lists and CSV snapshots. Backend contracts enforce scopes and workspace ownership. List/export operations have durable replay; list quotas serialize concurrent writes; export completion and audit commit atomically. CSV downloads use bounded authenticated base64 chunks and formula protection.

Hosted authentication uses Better Auth OAuth/CIMD 1.7.7 with explicit verified-user/workspace consent, PKCE, opaque 15-minute access tokens and optional 30-day refresh. The gateway exchanges resource tokens for distinct API delegations lasting at most 60 seconds. Product requests check live grant/session/resource status, membership, role, scopes, entitlements and shared account rate allowance. Settings disconnect revokes access/refresh tokens and removes consent.

All 42 migrations through 0041 applied successfully to a fresh isolated database. The new migrations are 0039 OAuth/selection tables, 0040 API operation/export replay keys and 0041 text assertion replay identifiers. Real database testing found that Better Auth's global UUID generator mode also rejected assertion digests before reaching the adapter. A UUID-returning generator now preserves normal UUID rows while permitting the provider's forced text identifiers. Normal signup and session sign-in were verified afterward.

Verification evidence:

- 24 MCP tests pass across modern/legacy protocols, executable stdio, HTTP host/origin authentication, per-request hosted identity isolation, scopes, bounded output and credential redaction.
- 230 backend unit tests pass, including configuration canonicalization, parallel authorization flow binding, OpenAPI and exact CSV byte reconstruction.
- 15 database OAuth/API workflow tests pass: workspace selection, PKCE, signed client assertions/replay, refresh rotation, code reuse, audience/expiry, client disable, cached/final-credit replay across credentials, worker-failure refunds, list concurrency, exports, quotas and revocation.
- 112 existing backend regression cases passed across the HTTP and database runs. Another 26 durable credit recovery cases and the real BullMQ timeout/retry/exhaustion recovery case pass.
- The frontend production build passes. Browser sign-in, explicit paid workspace selection, scope review, consent callback/PKCE exchange and account-settings disconnect passed against disposable local fixtures. Authorization left all 500 credits untouched; disconnected access returns 401 and refresh returns invalid_grant.

The earlier socket approval problem is resolved. These checks used a separate localhost API, frontend, test database and Redis namespace. Production was not migrated or deployed. Test runner setup and the detailed evidence are recorded in the workspace audit `audits/2026-10-04-mcp-implementation-verification.md`.

Remaining acceptance requires a reachable HTTPS staging endpoint and a paid staging workspace, already requested from the user. Actual ChatGPT/Claude/Codex/Cursor applications remain unverified; SDK compatibility is not a substitute. Docker is unavailable on this host, so the image build remains an external verification step. Registry publication follows successful hosted acceptance.

The goal is blocked awaiting external staging setup. Next: verify the reviewed artifact on public staging in the first-release clients, build the image, review concrete production configuration and deploy the accepted release.

See [deployment](deployment.md) and [client setup](client-setup.md) for configuration and the compatibility matrix.
