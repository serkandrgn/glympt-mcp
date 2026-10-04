# Client setup and verification

Updated 2026-10-04. These are setup instructions, not a claim that each application has passed testing against Glympt. The public beta endpoint is https://mcp.glympt.com/mcp. Use a staging workspace for chargeable evaluation.

## Developer clients: npm stdio

Requires Node.js 22 or newer and a scoped API key for an API-enabled paid Glympt workspace. No source checkout is needed. In the stdio server's private process environment set `GLYMPT_API_KEY`, then use:

```sh
npx --yes @glympt/mcp@0.1.0
```

`GLYMPT_API_BASE_URL` defaults to `https://api.glympt.com`. The server does not automatically load `.env`. Never put a real API key in source control, shared configuration or chat prompts. Free CSV trial credits do not grant MCP/API access.

### Codex

To use npx, merge this table into your private `~/.codex/config.toml` and start Codex with `GLYMPT_API_KEY` in its environment. `env_vars` explicitly forwards the key to the adapter:

```toml
[mcp_servers.glympt]
command = "npx"
args = ["--yes", "@glympt/mcp@0.1.0"]
env_vars = ["GLYMPT_API_KEY"]
```

See [Codex's official MCP configuration guide](https://learn.chatgpt.com/docs/extend/mcp).

Alternatively, install once in a private directory and keep the credential in a private environment file:

```sh
npm install --prefix /absolute/private/glympt-adapter @glympt/mcp@0.1.0
codex mcp add glympt -- node --env-file=/absolute/private/glympt.env /absolute/private/glympt-adapter/node_modules/@glympt/mcp/dist/stdio.js
```

The environment-file template is:

```dotenv
GLYMPT_API_KEY=tk_live_replace_with_your_key
GLYMPT_API_BASE_URL=https://api.glympt.com
```

Use absolute paths and restrict the file to your user. Hosted OAuth can instead use `codex mcp add glympt-hosted --url https://mcp.glympt.com/mcp`, then the client's login flow. A dashboard API key cannot be used as a hosted OAuth bearer token.

### Cursor and other JSON-configured stdio clients

Merge this entry into your **private** global MCP configuration, such as `~/.cursor/mcp.json`. Do not commit the real key in a project's `.cursor/mcp.json`.

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

If the client inherits the key from its private process environment, omit the `env` block. Restart or reload the client and inspect its tools. Cursor also supports the hosted URL with OAuth; see [Cursor's MCP documentation](https://cursor.com/docs/mcp).

### Claude Code

With `GLYMPT_API_KEY` available in the client process's private environment:

```sh
claude mcp add --transport stdio glympt -- npx --yes @glympt/mcp@0.1.0
```

For hosted OAuth use `claude mcp add --transport http glympt-hosted https://mcp.glympt.com/mcp`, then authenticate through `/mcp`. The `--` separates client flags from the server command. Actual Claude Code CLI verification remains pending; see [Claude Code's MCP documentation](https://code.claude.com/docs/en/mcp).

### Source development

The repository still supports `pnpm install --frozen-lockfile`, `pnpm build`, and `node --env-file=/absolute/private/glympt.env /absolute/path/to/mcp/dist/stdio.js` for development. The hosted service continues to use its separate Docker build and OAuth configuration.

## Hosted clients

The hosted service must be reachable through public HTTPS. Each user signs into Glympt, selects an API-enabled paid workspace and explicitly grants scopes. The connector receives its own OAuth access; it does not use a shared Glympt API key. The MCP resource URL must exactly match the configured URL, including `/mcp`.

### ChatGPT

Enable Developer mode under Settings → Security and login, where account/workspace policy permits. Open ChatGPT Plugins → Add → Create custom MCP server, enter the full hosted MCP URL and choose OAuth. Automatic discovery selects CIMD; no manual client ID or secret is needed. Complete Glympt sign-in, workspace selection and consent, then inspect the discovered tools and enable the connection in a new conversation. Refresh connection metadata after tool changes. These steps follow [OpenAI's connection and testing guide](https://developers.openai.com/plugins/deploy/connect-chatgpt).

The authorization server supports published client metadata (CIMD) and dynamic registration. Use the client identity and exact callback discovered by the host; do not guess callback URLs or broadly wildcard them. See [OpenAI's OAuth requirements](https://developers.openai.com/plugins/build/auth).

### Claude web / Desktop remote connector

Open Customize → Connectors → Add custom connector, enter the public `/mcp` URL, choose sign-in and the host's published OAuth identity or automatic registration, then finish Glympt consent. Team/Enterprise owners may need to add the connector before individual users connect. Remote connectors originate from Anthropic's cloud even in Claude Desktop. See [Claude's remote connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

## Compatibility matrix

| Client                               | Intended connection          | Current evidence                                                                                         |
| ------------------------------------ | ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| Official SDK v2, protocol 2026-07-28 | stdio and stateless HTTP     | Local checks pass; production stdio invokes 14 tools; hosted discovery/usage/refresh pass                |
| Official SDK, protocol 2025-11-25    | stdio and compatibility HTTP | Local checks pass; production stdio and hosted discovery/usage pass                                      |
| Codex                                | API-key stdio; hosted OAuth  | codex-cli 0.160.0: production browser OAuth and actual get_usage pass; disconnect rejects access/refresh |
| Cursor                               | API-key stdio; hosted OAuth  | Cursor desktop 3.23.12: DCR OAuth, 14 tools and actual get_usage pass                                    |
| Claude Code                          | API-key stdio; hosted OAuth  | Official configuration documented; actual connection pending                                             |
| ChatGPT                              | Hosted OAuth                 | ChatGPT Plus web: CIMD OAuth and actual get_usage pass on 2026-10-04                                     |
| Claude web / Desktop remote          | Hosted OAuth                 | Claude Free web: CIMD OAuth, 14 tools and actual get_usage pass on 2026-10-04                            |

Record the host version, protocol, test date, selected workspace and outcome when verifying a row. Do not change a pending row based solely on a successful SDK test.

## Evaluation prompts

Use controlled staging domains and record returned IDs, operation keys and ledger outcomes. Representative prompts:

- “Show my query balance and current workspace limits.” Expect `get_usage` without a debit.
- “Find Shopify sites likely in Germany, excluding Cloudflare. Keep the geography caveat.” Expect bounded `search_domains` pages.
- “Enrich these three domains, including this duplicate.” Expect one `enrich_domains` operation and unique-domain billing.
- “Check that existing batch.” Expect polling/results tools using the returned ID, without resubmission.
- “Save these domains as a prospect list, then export that list.” Expect explicit list mutations and one CSV snapshot; no enrichment debit for saving/exporting.
- “Recover the CSV as a file.” Expect base64 chunks decoded in byte-offset order; there is no public download link in this release.
- “Find decision-makers' email addresses.” The product has no such tool and should explain the limitation.

Disconnect the authorized client in Glympt account settings and verify its next call fails. Reconnecting should require new authorization. Do not place access tokens, API keys or raw authorization codes in evaluation reports.

Actual application checks cover OAuth connection and read-only usage. All 14 enrichment/list/export workflows were exercised separately through the production API-key SDK runner; the full workflow matrix was not run inside every application.

Cursor desktop 3.23.12 passed OAuth, 14-tool discovery and get_usage in Agent mode. Claude Code remains separately unverified. Temporary acceptance grants were revoked after testing.
