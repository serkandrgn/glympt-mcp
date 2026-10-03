# Glympt MCP

Glympt MCP exposes paid technographic enrichment, filtered prospect search, saved lists and CSV snapshots through the official TypeScript SDK v2. It supports the stateless 2026-07-28 protocol and the SDK’s 2025-11-25 compatibility mode.

Both connection paths are implemented locally: API-key stdio for developer clients, and hosted OAuth with explicit Glympt workspace consent. Hosted release verification is still pending; no public endpoint or individual host application is claimed as verified.

## Build and verify

Requires Node.js 22+ and pnpm 10.28.2.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm lint
pnpm test
pnpm build
```

Tests use a mock paid API and real SDK clients. The socket integration test needs permission to open loopback ports in restricted environments. SDK compatibility does not establish compatibility with every host or verify a production credit ledger.

## Developer connection

Create an API key in the [Glympt dashboard](https://glympt.com/dashboard/user/api-keys) for an API-enabled paid workspace. The default key includes all five product scopes. Free CSV trial credits do not grant API or MCP access.

Build the package, then launch `node /absolute/path/to/mcp/dist/stdio.js` with `GLYMPT_API_KEY` in its environment. `GLYMPT_API_BASE_URL` defaults to `https://api.glympt.com`. See [client setup](docs/client-setup.md) for Codex, Cursor and Claude Code examples.

For direct use, copy `.env.example` to `.env` and run:

```sh
node --env-file=.env dist/stdio.js
```

The package does not automatically load `.env`. Process diagnostics use stderr; stdout contains only MCP messages. Keep real keys in private client settings or environment files.

The separate loopback runner uses `node --env-file=.env dist/http.js` at `http://127.0.0.1:3100/mcp`, with a distinct `GLYMPT_MCP_LOCAL_TOKEN` bearer secret of at least 32 characters. It binds to loopback and represents one API-key owner. Hosted multi-user connections use the OAuth runner below.

## Hosted connection

The hosted runner is `node dist/hosted.js`, or `pnpm start:hosted`. It serves `/mcp`, protected-resource discovery and `/health`. Configure it from `.env.hosted.example`; it needs the public API origin, its exact public `/mcp` resource URL and the backend’s gateway secret. It has no customer API key, database, Redis, Stripe or worker credentials.

Users authenticate with Glympt, select an eligible paid workspace and explicitly consent to the requested scopes. Access tokens are limited to this MCP resource and last 15 minutes; optional refresh access lasts 30 days. The gateway exchanges the resource token with its issuer for a distinct API delegation lasting at most 60 seconds. The backend rechecks the original grant, session, membership, role, scopes and paid entitlements on each tool request.

Users can disconnect a client under **Account settings → MCP connections**. This revokes its issued access and refresh tokens for that workspace and removes saved consent. API-key clients instead revoke their dashboard API key.

See [deployment and verification](docs/deployment.md) before enabling the public endpoint. The Dockerfile builds only this package. `/health` checks process readiness, not worker, billing or upstream availability.

## Tools and credits

| Tool                   | Purpose                                           | Required scope                               | Query credits                    |
| ---------------------- | ------------------------------------------------- | -------------------------------------------- | -------------------------------- |
| `enrich_domain`        | Cached or queued domain enrichment                | `lookup:read`                                | One per normalized domain        |
| `enrich_domains`       | Enrich an owned domain array                      | `bulk:write`                                 | One per unique normalized domain |
| `get_lookup_job`       | Existing job/result                               | `lookup:read`                                | None                             |
| `get_enrichment_batch` | Existing batch progress                           | `bulk:write`                                 | None                             |
| `get_batch_results`    | Filtered batch result page                        | `bulk:write`                                 | None                             |
| `search_domains`       | Filtered shared-database page                     | `lookup:read`                                | None                             |
| `get_usage`            | Plan, balance, period and limits                  | `lookup:read`                                | None                             |
| `list_saved_lists`     | Workspace list page                               | `lists:read`                                 | None                             |
| `get_saved_list`       | Owned list and item page                          | `lists:read`                                 | None                             |
| `create_saved_list`    | Create a list                                     | `lists:write`                                | None                             |
| `add_domain_to_list`   | Save a domain and notes; does not scan            | `lists:write`                                | None                             |
| `create_csv_export`    | Snapshot a completed upload, search or saved list | `exports:read`; also `lists:read` for a list | None                             |
| `get_csv_export`       | Owned export status                               | `exports:read`                               | None                             |
| `get_csv_export_chunk` | Exact bytes from a ready, unexpired CSV           | `exports:read`                               | None                             |

All requests, including reads and polling, count toward the workspace API rate allowance. The API remains authoritative for query debits, refunds and ownership. MCP maintains no separate balance.

Enrichment and list/export mutations require an `idempotencyKey` of 8–200 characters. Choose a stable unique key for each intended operation. After response loss, reuse **the same key with identical input**. A new key is a new operation and may charge again. The adapter never automatically retries a chargeable request. A timeout or transport cancellation does not imply that work was canceled or credits were refunded.

Poll returned job or batch identifiers with backoff: 1s, 2s, 4s, then at least 5s. Stop at a terminal status. Hard technical failures before detection are refunded by the API’s ledger policy; valid fetches with no detected technology and cached API enrichment are chargeable.

Export snapshots expire after seven days. Failed or expired snapshots replay their original operation; use a new key only when intentionally requesting a new export. CSV formula cells are escaped. Download chunks contain base64 bytes, not text fragments; decode and append in `nextOffsetBytes` order until `eof`. The default chunk is 48 KiB, maximum 64 KiB. There is currently no public CSV download link; clients reconstruct the file from authenticated chunks.

Technology filters use slugs such as `shopify`, `wordpress` and `cloudflare`. Pages default to 25 and cap at 100; API replies cap at 256 KiB. Request smaller pages if that byte limit is exceeded. Country is estimated, observations have scan dates, and website evidence is untrusted data.

## Verification status

- Local SDK tests cover all 14 tools under modern and legacy revisions, executable stdio, per-request hosted identity isolation, scopes, bounded responses and credential redaction.
- Fresh isolated migrations through 0041, 230 backend unit tests, 15 OAuth/API workflow tests, 112 existing backend regressions and 27 credit recovery checks pass.
- The frontend production build and local browser sign-in, workspace consent, PKCE exchange and disconnect verification pass.
- Public HTTPS staging, Docker image build and actual ChatGPT/Claude/Codex/Cursor client connections remain pending. No production deployment or registry publication has been completed.

Track acceptance in [the implementation plan](docs/implementation-plan.md). Client UI, experimental Tasks, automatic background polling, arbitrary HTTP fetching and direct database access remain outside this release.

## Protocol references

- [July 28 protocol release](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [August 22 roadmap update](https://blog.modelcontextprotocol.io/posts/mcp-roadmap/)
- [SDK HTTP handler](https://ts.sdk.modelcontextprotocol.io/v2/serving/http.html)
- [SDK legacy compatibility](https://ts.sdk.modelcontextprotocol.io/v2/serving/legacy-clients.html)
- [SDK authorization](https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization.html)
