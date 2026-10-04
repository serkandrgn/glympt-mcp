# Glympt MCP

Glympt MCP exposes paid technographic enrichment, filtered prospect search, saved lists and CSV snapshots through the official TypeScript SDK v2. It supports the stateless 2026-07-28 protocol and the SDK’s 2025-11-25 compatibility mode.

Both connection paths are implemented: API-key stdio for developer clients, and hosted OAuth with explicit Glympt workspace consent. Production API-key workflows, hosted OAuth discovery/refresh/disconnect, and actual ChatGPT, Claude web and Codex usage calls have been verified. Cursor desktop 3.23.12 also passed OAuth, 14-tool discovery and an actual usage call after the loopback registration fix was deployed. Claude Code remains unverified.

## Hosted OAuth

Add this Streamable HTTP URL to a client that supports OAuth:

```text
https://mcp.glympt.com/mcp
```

Sign into Glympt, choose an API-enabled paid workspace and consent to the requested scopes. Each client receives its own workspace authorization. Disconnect it under **Account settings → MCP connections** to revoke its access and refresh tokens.

Hosted OAuth requires no local installation or customer API key. Start with “Show my Glympt query balance and workspace limits.” See the [public setup guide](https://glympt.com/docs/mcp) for client-specific steps and current verification limits.

## Local stdio adapter

Requires Node.js 22 or newer. Create a scoped API key in [Glympt API key settings](https://glympt.com/dashboard/user/api-keys) for an API-enabled paid workspace. Pro, Business and eligible custom plans support API access. Free CSV trial credits do not grant API or MCP access.

Put `GLYMPT_API_KEY` in the server process environment using your client's private credential settings, then run:

```sh
npx --yes @glympt/mcp@0.1.0
```

The executable is `glympt-mcp`. For an explicit persistent installation:

```sh
npm install --global @glympt/mcp@0.1.0
glympt-mcp
```

A typical stdio client configuration is:

```json
{
  "mcpServers": {
    "glympt": {
      "command": "npx",
      "args": ["--yes", "@glympt/mcp@0.1.0"],
      "env": {
        "GLYMPT_API_KEY": "tk_live_replace_with_your_key"
      }
    }
  }
}
```

The placeholder is not a working credential. Store real keys only in private local configuration, never in shared repositories or chat prompts. The package does not automatically read `.env` files. Revoke the dashboard key to disconnect this adapter.

| Variable              | Required | Default                  | Purpose                                                    |
| --------------------- | -------- | ------------------------ | ---------------------------------------------------------- |
| `GLYMPT_API_KEY`      | Yes      | None                     | Scoped paid-workspace API key                              |
| `GLYMPT_API_BASE_URL` | No       | `https://api.glympt.com` | HTTPS API origin; HTTP loopback is allowed for development |

Missing configuration exits with a useful error on stderr. Runtime diagnostics use stderr; stdout carries MCP protocol messages only. No `tsx`, source checkout or development dependencies are required to run the npm package. [Detailed stdio setup](https://github.com/serkandrgn/glympt-mcp/blob/main/docs/client-setup.md).

## Build and verify from source

Requires Node.js 22+ and pnpm 10.28.2.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm lint
pnpm test
pnpm build
pnpm test:package
```

Tests use a mock paid API and real SDK clients. Socket tests need loopback access in restricted environments. Package verification inspects the actual tarball, installs only production dependencies into a clean temporary directory, and checks the installed executable and npx command under modern and legacy protocols. These tests spend no production credits.

The npm file allowlist includes the compiled stdio adapter, public setup docs, license and Registry metadata. Hosted gateway runners and deployment configuration are available only in this source repository. The Dockerfile still builds the hosted service with `node dist/hosted.js`; see [deployment](https://github.com/serkandrgn/glympt-mcp/blob/main/docs/deployment.md).

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
- Production API-key stdio verification passes: all 14 tools invoked with SDK protocol 2026-07-28, a legacy 2025-11-25 connection, a real worker scan, duplicate/replay billing, saved lists, CSV chunk reconstruction and a DNS-failure refund. The test used two net query credits.
- The Docker/Coolify deployment is live. Hosted OAuth discovers 14 tools under both protocol revisions, refresh rotation passes, and disconnected Codex access/refresh tokens are rejected. Actual ChatGPT, Claude web and Codex clients completed read-only usage checks on 2026-10-04 without query charges. Cursor desktop 3.23.12 also passed OAuth, 14-tool discovery and an actual usage call after the loopback registration fix was deployed. Claude Code remains unverified.

Track acceptance in [the implementation plan](https://github.com/serkandrgn/glympt-mcp/blob/main/docs/implementation-plan.md). Client UI, experimental Tasks, automatic background polling, arbitrary HTTP fetching and direct database access remain outside this release.

## Protocol references

- [July 28 protocol release](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [August 22 roadmap update](https://blog.modelcontextprotocol.io/posts/mcp-roadmap/)
- [SDK HTTP handler](https://ts.sdk.modelcontextprotocol.io/v2/serving/http.html)
- [SDK legacy compatibility](https://ts.sdk.modelcontextprotocol.io/v2/serving/legacy-clients.html)
- [SDK authorization](https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization.html)

## Distribution

Version 0.1.0 is live on [npm](https://www.npmjs.com/package/@glympt/mcp) and in the [official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.serkandrgn%2Fglympt/versions/0.1.0). Registry metadata is in `server.json`. See the [distribution status](https://github.com/serkandrgn/glympt-mcp/blob/main/docs/distribution.md) for verified public entries and directory submissions.

## License

The MCP adapter is MIT licensed; see [LICENSE](https://github.com/serkandrgn/glympt-mcp/blob/main/LICENSE). Access to the Glympt service remains subject to your workspace subscription, scopes and the service terms.
