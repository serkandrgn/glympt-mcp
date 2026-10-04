# MCP distribution

Release target: `@glympt/mcp@0.1.0`, executable `glympt-mcp`, Node.js 22+.
Registry identity: `io.github.serkandrgn/glympt`.

## Publication status

| Destination           | Status                            | Evidence / next step                                                                                                                                           |
| --------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm                   | Prepared; not published           | Packed adapter passes clean production install and SDK smoke tests. The publisher is signed in; the `@glympt` organization must be created before publication. |
| Official MCP Registry | Metadata validated; not published | One entry contains the npm stdio adapter and hosted OAuth remote. GitHub device authorization is pending.                                                      |
| Glama                 | Not submitted                     | Public-source directory supports GitHub MCP repositories. Publisher sign-in is required.                                                                       |
| Smithery              | Not submitted                     | Supports existing hosted Streamable HTTP servers with OAuth; publisher sign-in is required.                                                                    |
| PulseMCP              | Blocked by directory              | New submissions and listing changes are currently paused.                                                                                                      |

An accepted submission is not a live listing. Confirm each public entry before changing its status.

## Listing copy

**Name:** Glympt

**Short description:** Website technology enrichment and prospecting with bulk workflows, saved lists and CSV exports.

**Description:** Glympt connects MCP clients to a technographic data platform for developers, agencies and small sales teams. Detect technologies on domains, enrich domain arrays, follow batch progress, and search currently indexed websites by included/excluded technologies, confidence, scan freshness and estimated country. Build workspace prospect lists, export CSV snapshots, retrieve authenticated export chunks, and check usage and query credits.

Connect directly to `https://mcp.glympt.com/mcp` through hosted OAuth, or run the npm stdio adapter with your own scoped `GLYMPT_API_KEY`. Both require an API-enabled paid Glympt workspace (Pro, Business or an eligible custom plan); the Free dashboard CSV trial does not grant API/MCP access. Hosted authorization belongs to each user and selected workspace. No shared customer credential is used.

Enrichment spends one query credit per unique normalized domain, including API cache hits. Reads, saved-list actions and exports do not spend enrichment credits; all product requests count toward workspace rate limits. Mutations require stable idempotency keys. The Glympt API owns entitlements, scopes, ownership, credits and refunds.

Geography is estimated from website signals. Results include confidence and scan dates. Glympt does not provide contact enrichment or firmographic filters, and does not claim internet-wide real-time coverage or competitor-scale historical data.

**Verification:** Hosted OAuth connection and read-only usage have passed in ChatGPT web, Claude web, Codex and Cursor desktop (Agent mode). Broader 14-tool enrichment/list/export workflows were tested separately using the SDK. Claude Code CLI remains unverified. Local package tests use a mock API and cover modern and legacy stdio protocol discovery.

**Website:** https://glympt.com/mcp

**Documentation:** https://glympt.com/docs/mcp

**Source:** https://github.com/serkandrgn/glympt-mcp

**Hosted transport:** Streamable HTTP, OAuth. No static bearer header or dashboard API key.

**Local transport:** stdio, `npx --yes @glympt/mcp@0.1.0`, secret `GLYMPT_API_KEY`, optional `GLYMPT_API_BASE_URL` (default `https://api.glympt.com`).

## Target selection and requirements

- [Glama](https://glama.ai/mcp/faq): indexes public GitHub source with license/security checks; also supports remote OAuth connector listings. Submit the adapter repository without deploying a second service or supplying customer credentials.
- [Smithery](https://smithery.ai/docs/build/publish): accepts an existing HTTPS Streamable HTTP endpoint and supports CIMD OAuth. Its URL publication uses the Smithery Gateway to proxy the upstream service. Keep the direct Glympt endpoint prominent; do not weaken workspace authorization or provide a shared API key. If scanning requires paid authorization, complete that explicitly with a controlled workspace or leave the scan pending.
- [PulseMCP](https://www.pulsemcp.com/submit): useful directory, but the current public site announces that new submissions are paused. Recheck before attempting a submission.

Claude's directory is curated and requires a separate submission/review process. An existing custom connection is not a directory approval. This first release targets public distribution directories; no client marketplace approval is claimed.

## Release verification

Run `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm format:check`, and `pnpm test:package`. Inspect the actual `npm pack` tarball, then publish that exact reviewed artifact with public access. The tarball allowlist excludes hosted runners, deployment configuration, tests, environment files and operational audits.

After publication run `node scripts/verify-package.mjs @glympt/mcp@0.1.0` to install from npm into a fresh directory/cache and repeat executable, configuration, stdio discovery and mock usage checks. Verify npm's `mcpName`, bin, version, integrity and public metadata. Publish `server.json` with the official `mcp-publisher`, fetch its public entry and compare every transport and environment setting. Update the public frontend docs only after the npm release is verified.
