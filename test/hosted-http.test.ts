import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import {
  createHostedHttpHandler,
  hostedConfigSchema,
} from "../src/hosted-http.js";

const config = hostedConfigSchema.parse({
  resourceUrl: "https://mcp.glympt.test/mcp",
  baseUrl: "https://api.glympt.test",
  gatewaySecret: "test_gateway_secret_12345678901234567890",
  allowedOrigins: ["https://chatgpt.com"],
});

test("hosted metadata and exact Host/Origin checks precede authorization", async (t) => {
  let calls = 0;
  const handler = createHostedHttpHandler(config, async () => {
    calls++;
    throw new Error("unexpected");
  });
  t.after(handler.close);
  const resource = await handler.fetch(
    new Request(
      "https://mcp.glympt.test/.well-known/oauth-protected-resource/mcp",
    ),
  );
  assert.deepEqual((await resource.json()).authorization_servers, [
    "https://api.glympt.test/api/auth",
  ]);
  const missing = await handler.fetch(new Request(config.resourceUrl));
  assert.equal(missing.status, 401);
  assert.match(
    missing.headers.get("www-authenticate")!,
    /oauth-protected-resource\/mcp/,
  );
  assert.equal(
    (await handler.fetch(new Request("https://evil.example/mcp"))).status,
    403,
  );
  assert.equal(
    (
      await handler.fetch(
        new Request(config.resourceUrl, {
          headers: { origin: "https://evil.example" },
        }),
      )
    ).status,
    403,
  );
  const options = await handler.fetch(
    new Request(config.resourceUrl, {
      method: "OPTIONS",
      headers: { origin: "https://chatgpt.com" },
    }),
  );
  assert.equal(options.status, 204);
  assert.equal(
    options.headers.get("access-control-allow-origin"),
    "https://chatgpt.com",
  );
  assert.equal(calls, 0);
});

for (const mode of ["modern", "legacy"] as const)
  test(`${mode}: hosted identities remain isolated and MCP tokens never reach product API`, async (t) => {
    const calls: Array<{
      authorization: string | null;
      path: string;
      key?: string | null;
    }> = [];
    const handler = createHostedHttpHandler(config, async (url, init) => {
      const path = new URL(String(url)).pathname;
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-mcp-gateway-secret"), config.gatewaySecret);
      if (path === "/api/auth/mcp/exchange") {
        assert.equal(headers.has("authorization"), false);
        const body = JSON.parse(String(init?.body)) as { accessToken: string };
        assert.ok(["oauth_user_a", "oauth_user_b"].includes(body.accessToken));
        return Response.json({
          token: `gmcp_api_${body.accessToken}`,
          expiresAt: Math.floor(Date.now() / 1000) + 60,
          scopes: body.accessToken.endsWith("a")
            ? ["lookup:read"]
            : ["bulk:write"],
        });
      }
      const parsed = new URL(String(url));
      calls.push({
        authorization: headers.get("authorization"),
        path,
        key: parsed.searchParams.get("idempotencyKey"),
      });
      return Response.json({
        technologies: [],
        source: "cache",
        credentialEcho: headers.get("authorization"),
        gatewayEcho: config.gatewaySecret,
      });
    });
    t.after(handler.close);
    async function connect(token: string) {
      const transport = new StreamableHTTPClientTransport(
        new URL(config.resourceUrl),
        {
          requestInit: { headers: { authorization: `Bearer ${token}` } },
          fetch: (url, init) => handler.fetch(new Request(url, init)),
        },
      );
      const client = new Client(
        { name: "hosted-test", version: "1" },
        {
          versionNegotiation: {
            mode: mode === "modern" ? { pin: "2026-07-28" } : "legacy",
          },
        },
      );
      await client.connect(transport);
      t.after(() => client.close());
      return client;
    }
    const [a, b] = await Promise.all([
      connect("oauth_user_a"),
      connect("oauth_user_b"),
    ]);
    const catalog = await a.listTools();
    assert.deepEqual(
      catalog.tools.find((tool) => tool.name === "enrich_domain")?._meta
        ?.securitySchemes,
      [{ type: "oauth2", scopes: ["lookup:read"] }],
    );
    const first = await a.callTool({
      name: "enrich_domain",
      arguments: { domain: "example.com", idempotencyKey: "stable-user-a-key" },
    });
    assert.equal(first.isError, undefined);
    assert.equal(calls[0]?.authorization, "Bearer gmcp_api_oauth_user_a");
    assert.equal(calls[0]?.key, "stable-user-a-key");
    assert.ok(!JSON.stringify(first).includes("gmcp_api_"));
    assert.ok(!JSON.stringify(first).includes(config.gatewaySecret));
    const denied = await b.callTool({
      name: "enrich_domain",
      arguments: { domain: "example.com", idempotencyKey: "stable-user-b-key" },
    });
    assert.equal(denied.isError, true);
    assert.match(JSON.stringify(denied._meta), /insufficient_scope/);
    assert.equal(
      calls.length,
      1,
      "Missing scopes must never reach the paid API",
    );
  });

test("hosted auth failures have safe statuses and never expose issuer responses", async (t) => {
  for (const [upstream, expected] of [
    [401, 401],
    [403, 403],
    [402, 402],
    [500, 503],
  ]) {
    const handler = createHostedHttpHandler(config, async () =>
      Response.json(
        { message: config.gatewaySecret, token: "private" },
        { status: upstream },
      ),
    );
    t.after(handler.close);
    const response = await handler.fetch(
      new Request(config.resourceUrl, {
        headers: { authorization: "Bearer oauth_test" },
      }),
    );
    assert.equal(response.status, expected);
    assert.ok(!(await response.text()).includes(config.gatewaySecret));
    assert.equal(response.headers.has("www-authenticate"), expected === 401);
  }
});
