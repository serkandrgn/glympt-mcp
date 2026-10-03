import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { GlymptApiClient } from "../src/api-client.js";
import { apiConfigSchema } from "../src/config.js";
import { createGlymptHandler } from "../src/server.js";
import { createLocalHttpHandler } from "../src/local-http.js";

const config = apiConfigSchema.parse({ apiKey: "tk_live_protocol_test" });
const jobId = "00000000-0000-4000-8000-000000000001";
const batchId = "00000000-0000-4000-8000-000000000002";

async function harness(mode: "modern" | "legacy", fetcher: typeof fetch) {
  const handler = createGlymptHandler(new GlymptApiClient(config, fetcher));
  const wireMethods: string[] = [];
  const transport = new StreamableHTTPClientTransport(
    new URL("http://test.local/mcp"),
    {
      fetch: async (url, init) => {
        const request = new Request(url, init);
        if (request.method === "POST") {
          const rpc = (await request.clone().json()) as { method: string };
          wireMethods.push(rpc.method);
        }
        return handler.fetch(request);
      },
    },
  );
  const client = new Client(
    { name: "glympt-tests", version: "0.1.0" },
    {
      versionNegotiation: {
        mode: mode === "modern" ? { pin: "2026-07-28" } : "legacy",
      },
    },
  );
  await client.connect(transport);
  return {
    client,
    wireMethods,
    close: async () => {
      await client.close();
      await handler.close();
    },
  };
}

for (const mode of ["modern", "legacy"] as const) {
  test(`${mode}: discovery describes credit consumption and tools route to the paid API`, async (t) => {
    const calls: { path: string; query: URLSearchParams; body: unknown }[] = [];
    const h = await harness(mode, async (url, init) => {
      const parsed = new URL(String(url));
      calls.push({
        path: parsed.pathname,
        query: parsed.searchParams,
        body: init?.body
          ? (JSON.parse(String(init.body)) as unknown)
          : undefined,
      });
      return Response.json(
        { status: "queued", jobId, batchId, creditsRemainingAfterRequest: 9 },
        { headers: { "x-request-id": "req-test" } },
      );
    });
    t.after(h.close);
    assert.equal(
      h.client.getNegotiatedProtocolVersion(),
      mode === "modern" ? "2026-07-28" : "2025-11-25",
    );
    assert.equal(h.wireMethods.includes("initialize"), mode === "legacy");
    assert.equal(h.wireMethods.includes("server/discover"), mode === "modern");
    const catalog = await h.client.listTools();
    assert.equal(catalog.tools.length, 14);
    assert.equal(
      catalog.tools.find((tool) => tool.name === "enrich_domain")?.annotations
        ?.readOnlyHint,
      false,
    );
    assert.equal(
      catalog.tools.find((tool) => tool.name === "search_domains")?.annotations
        ?.readOnlyHint,
      true,
    );
    assert.equal(calls.length, 0, "Discovery must not contact the paid API");

    const args = { domain: "example.com", idempotencyKey: "request-key-001" };
    const first = await h.client.callTool({
      name: "enrich_domain",
      arguments: args,
    });
    const replay = await h.client.callTool({
      name: "enrich_domain",
      arguments: args,
    });
    assert.deepEqual(first.structuredContent, replay.structuredContent);
    assert.equal(first.isError, undefined);
    assert.equal(
      (first.structuredContent as Record<string, unknown>).idempotencyKey,
      args.idempotencyKey,
    );
    assert.equal(calls[0]?.query.get("idempotencyKey"), args.idempotencyKey);
    assert.equal(calls[1]?.query.get("idempotencyKey"), args.idempotencyKey);

    await h.client.callTool({
      name: "enrich_domains",
      arguments: {
        domains: ["example.com", "www.example.com"],
        idempotencyKey: "batch-request-001",
      },
    });
    assert.deepEqual(
      calls[2]?.body,
      {
        domains: ["example.com", "www.example.com"],
        idempotencyKey: "batch-request-001",
      },
      "Normalization and duplicate charging stay owned by the API",
    );
    await h.client.callTool({ name: "get_lookup_job", arguments: { jobId } });
    await h.client.callTool({
      name: "get_enrichment_batch",
      arguments: { batchId },
    });
    await h.client.callTool({
      name: "get_batch_results",
      arguments: {
        batchId,
        include: ["shopify"],
        exclude: ["cloudflare"],
        country: "de",
        confidenceMin: 80,
        status: "scanned",
        page: 2,
        pageSize: 10,
      },
    });
    await h.client.callTool({
      name: "search_domains",
      arguments: { include: ["wordpress"], countryConfidenceMin: 70 },
    });
    assert.deepEqual(
      calls.slice(3).map((call) => call.path),
      [
        `/api/v1/enrich/jobs/${jobId}`,
        `/api/v1/enrich/bulk/${batchId}`,
        `/api/v1/enrich/bulk/${batchId}/results`,
        "/api/v1/enrich/search",
      ],
    );
    assert.equal(calls[5]?.query.get("country"), "DE");
    assert.equal(calls[5]?.query.get("exclude"), "cloudflare");
    assert.equal(calls[5]?.query.get("confidence_min"), "80");
    assert.equal(calls[5]?.query.get("page"), "2");
    assert.equal(calls[6]?.query.get("country_confidence_min"), "70");
    assert.equal(calls[6]?.query.get("pageSize"), "25");
  });

  test(`${mode}: invalid arguments cannot reach the API or consume credits`, async (t) => {
    let calls = 0;
    const h = await harness(mode, async () => {
      calls++;
      return Response.json({});
    });
    t.after(h.close);
    for (const [name, args] of [
      ["enrich_domain", { domain: "example.com" }],
      ["enrich_domain", { domain: "example.com", idempotencyKey: "short" }],
      ["enrich_domains", { domains: [], idempotencyKey: "valid-key-001" }],
      [
        "enrich_domains",
        {
          domains: Array.from({ length: 5001 }, () => "example.com"),
          idempotencyKey: "valid-key-001",
        },
      ],
      ["get_lookup_job", { jobId: "../other-workspace" }],
      ["search_domains", { pageSize: 101 }],
      ["search_domains", { include: ["shopify,cloudflare"] }],
      ["search_domains", { apiKey: "override" }],
      ["get_batch_results", { batchId, country: "Germany" }],
    ] as const) {
      const response = await h.client.callTool({ name, arguments: args });
      assert.equal(
        response.isError,
        true,
        `${name} ${JSON.stringify(args).slice(0, 100)}`,
      );
    }
    assert.equal(calls, 0);
  });

  test(`${mode}: failed paid API requests expose a tool error and preserve the recovery key`, async (t) => {
    let calls = 0;
    const h = await harness(mode, async () => {
      calls++;
      return Response.json(
        { error: { code: "INSUFFICIENT_CREDITS", message: "raw secret" } },
        { status: 402 },
      );
    });
    t.after(h.close);
    const response = await h.client.callTool({
      name: "enrich_domain",
      arguments: {
        domain: "example.com",
        idempotencyKey: "last-credit-operation",
      },
    });
    assert.equal(response.isError, true);
    const output = response.structuredContent as Record<string, unknown>;
    assert.equal(
      (output.error as Record<string, unknown>).code,
      "INSUFFICIENT_CREDITS",
    );
    assert.equal(output.idempotencyKey, "last-credit-operation");
    assert.equal(JSON.stringify(response).includes("raw secret"), false);
    assert.equal(calls, 1);
  });

  test(`${mode}: the executable stdio entrypoint discovers tools without stdout pollution`, async (t) => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/stdio.ts"],
      cwd: process.cwd(),
      env: { GLYMPT_API_KEY: config.apiKey },
      stderr: "pipe",
    });
    const client = new Client(
      { name: "stdio-test", version: "0.1.0" },
      {
        versionNegotiation: {
          mode: mode === "modern" ? { pin: "2026-07-28" } : "legacy",
        },
      },
    );
    t.after(async () => {
      await client.close();
    });
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 14);
    assert.equal(
      client.getNegotiatedProtocolVersion(),
      mode === "modern" ? "2026-07-28" : "2025-11-25",
    );
  });
}

test("local HTTP authenticates every request and blocks foreign hosts/origins", async (t) => {
  let calls = 0;
  const token = "a".repeat(40);
  const handler = createLocalHttpHandler(
    new GlymptApiClient(config, async () => {
      calls++;
      return Response.json({});
    }),
    token,
  );
  t.after(() => handler.close());
  const url = "http://127.0.0.1:3100/mcp";
  assert.equal((await handler.fetch(new Request(url))).status, 401);
  assert.equal(
    (
      await handler.fetch(
        new Request(url, {
          headers: { authorization: `Bearer ${config.apiKey}` },
        }),
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await handler.fetch(
        new Request(url, {
          headers: {
            authorization: `Bearer ${token}`,
            origin: "https://evil.test",
          },
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handler.fetch(
        new Request("http://evil.test/mcp", {
          headers: { authorization: `Bearer ${token}` },
        }),
      )
    ).status,
    403,
  );
  assert.equal(calls, 0);
  const client = new Client(
    { name: "local-http-test", version: "0.1.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: (input, init) => handler.fetch(new Request(input, init)),
  });
  t.after(() => client.close());
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 14);
  assert.equal(calls, 0);
  assert.equal(
    (await handler.fetch(new Request(url))).status,
    401,
    "No authentication session is retained after an earlier valid request",
  );
});
