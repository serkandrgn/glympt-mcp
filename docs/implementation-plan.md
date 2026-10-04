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

The earlier production API billing checks passed. Production MCP API-key acceptance also passed on 2026-10-04: a real worker scan, duplicate batch, stable-key replays and conflicts, list/export replay, exact CSV chunks and a DNS-failure refund used two net query credits. Full isolated billing/tenancy coverage remains separate from this small production run.

## Milestone 4 — release

Prepare a separate Docker/Coolify service, HTTPS origin allowlist, OAuth configuration, health checks and credential-safe monitoring. Publish client setup docs with an accurate compatibility matrix and credit policy. Test in staging, then deploy the reviewed artifact. Only publish an MCP registry entry once remote auth and client verification pass. Do not claim directory listing or a protocol upgrade will fix search indexing on its own.

## Deferred deliberately

MCP Apps/UI, arbitrary code execution, generic HTTP-fetch tools, agent messaging, subscriptions and experimental Tasks are not required for the first workflows. Existing job IDs and explicit polling keep asynchronous work recoverable across both protocol eras. Revisit the Tasks extension after client support is demonstrated.

## Implementation status — 2026-10-04

| Milestone                         | Source status                                                        | Acceptance status                                                                                |
| --------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1. Developer connection           | Implemented                                                          | Local tests and production stdio workflows pass; actual Codex, ChatGPT and Claude web usage pass |
| 2. Hosted OAuth and API workflows | Implemented                                                          | Isolated migrations, OAuth/workflow tests and browser consent/disconnect pass                    |
| 3. Staging billing and clients    | Local billing/tenancy and small production API-key workflow verified | Hosted OAuth and actual Codex/ChatGPT/Claude web/Cursor usage pass                               |
| 4. Release                        | Docker/Coolify deployment is live                                    | Hosted authorization/refresh/disconnect pass; registry publication pending                       |

Fourteen tools cover enrichment, polling, filtered database search, usage, saved lists and CSV snapshots. Backend contracts enforce scopes and workspace ownership. List/export operations have durable replay; list quotas serialize concurrent writes; export completion and audit commit atomically. CSV downloads use bounded authenticated base64 chunks and formula protection.

Hosted authentication uses Better Auth OAuth/CIMD 1.7.7 with explicit verified-user/workspace consent, PKCE, opaque 15-minute access tokens and optional 30-day refresh. The gateway exchanges resource tokens for distinct API delegations lasting at most 60 seconds. Product requests check live grant/session/resource status, membership, role, scopes, entitlements and shared account rate allowance. Settings disconnect revokes access/refresh tokens and removes consent.

All 42 migrations through 0041 applied successfully to a fresh isolated database. The new migrations are 0039 OAuth/selection tables, 0040 API operation/export replay keys and 0041 text assertion replay identifiers. Real database testing found that Better Auth's global UUID generator mode also rejected assertion digests before reaching the adapter. A UUID-returning generator now preserves normal UUID rows while permitting the provider's forced text identifiers. Normal signup and session sign-in were verified afterward.

Verification evidence:

- 24 MCP tests pass across modern/legacy protocols, executable stdio, HTTP host/origin authentication, per-request hosted identity isolation, scopes, bounded output and credential redaction.
- 230 backend unit tests pass, including configuration canonicalization, parallel authorization flow binding, OpenAPI and exact CSV byte reconstruction.
- 15 database OAuth/API workflow tests pass: workspace selection, PKCE, signed client assertions/replay, refresh rotation, code reuse, audience/expiry, client disable, cached/final-credit replay across credentials, worker-failure refunds, list concurrency, exports, quotas and revocation.
- 112 existing backend regression cases passed across the HTTP and database runs. Another 26 durable credit recovery cases and the real BullMQ timeout/retry/exhaustion recovery case pass.
- The frontend production build passes. Browser sign-in, explicit paid workspace selection, scope review, consent callback/PKCE exchange and account-settings disconnect passed against disposable local fixtures. Authorization left all 500 credits untouched; disconnected access returns 401 and refresh returns invalid_grant.

Local acceptance used an isolated API, frontend, test database and Redis namespace. Detailed test artifacts remain in the private application workspace.

Since those local checks, the user deployed the services to production. Coolify MCP routing was corrected to preserve the whole hostname and use internal port 3100. Misnamed backend environment entries were corrected while preserving their existing values. Public MCP health, protected-resource metadata and backend authorization-server discovery now pass.

Production API-key acceptance used the official SDK client and the real production API/worker. All 14 tools were invoked under the modern protocol. Legacy discovery and usage also passed. The run spent two net query credits; reads, list/export operations and retries added no query charges, and a deliberate DNS failure was refunded. Detailed results and the export remain private. A runner response-wrapper assumption was corrected without product changes and without new operation keys.

Production hosted acceptance now passes modern/legacy discovery (14 tools), usage, refresh rotation and Codex settings disconnect. Codex CLI 0.160.0, ChatGPT Plus web and Claude Free web completed actual get_usage calls. A CIMD extension initialization bug was fixed and its regression proved against the old code. Cursor desktop 3.23.12 also passed OAuth, 14-tool discovery and an actual usage call after the loopback registration fix was deployed. Claude Code remains unverified. Actual application checks cover OAuth/usage, not every workflow. Registry publication follows successful hosted acceptance. Full adversarial billing and tenancy cases are verified in isolated tests; this small production run does not repeat the entire matrix.

See [deployment](deployment.md) and [client setup](client-setup.md) for configuration and the compatibility matrix.

The public promotion page `/mcp` and setup guide `/docs/mcp` are deployed, have canonical metadata, appear in the sitemap and are allowed by robots. Internal consent pages remain excluded. Detailed hosted acceptance artifacts remain private.
