# Client setup and verification

Updated 2026-10-04. These are setup instructions, not a claim that each application has passed testing against Glympt. Use the staging URL until the release checklist passes.

## Developer clients

Build `mcp/` with `pnpm install --frozen-lockfile && pnpm build`. Create a scoped API key for a paid Glympt workspace. Save it privately in an environment file outside the checkout:

```dotenv
GLYMPT_API_KEY=tk_live_replace_with_your_key
# Optional: use the staging API while testing.
GLYMPT_API_BASE_URL=https://api-staging.example.com
```

Use absolute paths. Node's `--env-file` avoids putting the actual credential in the client config or CLI history. The stdio server needs outbound HTTPS to the selected API origin.

### Codex

The installed Codex CLI supports the following stdio launch form; inspected with `codex mcp add --help`:

```sh
codex mcp add glympt -- node --env-file=/absolute/private/glympt.env /absolute/path/to/mcp/dist/stdio.js
```

Restart or reload the client and inspect the connected server's tools. Hosted OAuth can instead use `codex mcp add glympt-hosted --url https://mcp-staging.example.com/mcp`, then the client's login flow. Do not supply a dashboard API key as a hosted OAuth bearer token.

### Cursor

Add a stdio entry to `.cursor/mcp.json` or the global `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "glympt": {
      "type": "stdio",
      "command": "node",
      "args": [
        "--env-file=/absolute/private/glympt.env",
        "/absolute/path/to/mcp/dist/stdio.js"
      ]
    }
  }
}
```

Cursor also supports a remote URL entry with OAuth. Configure the hosted `/mcp` URL and connect through Glympt's consent screen. See [Cursor's MCP documentation](https://prod.cursor.com/docs/mcp).

### Claude Code

```sh
claude mcp add --transport stdio glympt -- node --env-file=/absolute/private/glympt.env /absolute/path/to/mcp/dist/stdio.js
```

For hosted OAuth, use `claude mcp add --transport http glympt-hosted https://mcp-staging.example.com/mcp`, then authenticate through `/mcp`. The `--` separates client flags from the server command. See [Claude Code's MCP documentation](https://code.claude.com/docs/en/mcp).

## Hosted clients

The hosted service must be reachable through public HTTPS. Each user signs into Glympt, selects an API-enabled paid workspace and explicitly grants scopes. The connector receives its own OAuth access; it does not use a shared Glympt API key. The MCP resource URL must exactly match the configured URL, including `/mcp`.

### ChatGPT

Enable Developer mode under Settings → Security and login, where account/workspace policy permits. Open ChatGPT Plugins, add a connection and enter the full hosted MCP URL. Complete Glympt sign-in, workspace selection and consent, then inspect the discovered tools and enable the connection in a new conversation. Refresh connection metadata after tool changes. These steps follow [OpenAI's connection and testing guide](https://developers.openai.com/plugins/deploy/connect-chatgpt).

The authorization server supports published client metadata (CIMD) and dynamic registration. Use the client identity and exact callback discovered by the host; do not guess callback URLs or broadly wildcard them. See [OpenAI's OAuth requirements](https://developers.openai.com/plugins/build/auth).

### Claude web / Desktop remote connector

Open Customize → Connectors → Add custom connector, enter the public `/mcp` URL, choose sign-in and the host's published OAuth identity or automatic registration, then finish Glympt consent. Team/Enterprise owners may need to add the connector before individual users connect. Remote connectors originate from Anthropic's cloud even in Claude Desktop. See [Claude's remote connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

## Compatibility matrix

| Client                               | Intended connection          | Current evidence                                                                |
| ------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------- |
| Official SDK v2, protocol 2026-07-28 | stdio and stateless HTTP     | Local discovery and calls pass for all 14 tools                                 |
| Official SDK, protocol 2025-11-25    | stdio and compatibility HTTP | Local discovery and calls pass for all 14 tools                                 |
| Codex                                | API-key stdio; hosted OAuth  | CLI syntax inspected; actual connection pending                                 |
| Cursor                               | API-key stdio; hosted OAuth  | Official configuration documented; actual connection pending                    |
| Claude Code                          | API-key stdio; hosted OAuth  | Official configuration documented; actual connection pending                    |
| ChatGPT                              | Hosted OAuth                 | Implementation and local identity tests exist; application verification pending |
| Claude web / Desktop remote          | Hosted OAuth                 | Implementation exists; application verification pending                         |

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
