import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiFailure, GlymptApiClient } from "../src/api-client.js";
import { apiConfigSchema } from "../src/config.js";

const apiKey = "tk_live_mcp_test_secret";
const config = apiConfigSchema.parse({ apiKey });

test("configuration rejects credential-bearing origins and unsafe remote HTTP", () => {
  for (const baseUrl of [
    "http://api.glympt.com",
    "https://key:secret@api.glympt.com",
    "https://api.glympt.com/internal",
    "https://api.glympt.com?key=secret",
    "ftp://localhost",
    "http://192.168.1.1",
  ]) {
    assert.equal(
      apiConfigSchema.safeParse({ apiKey, baseUrl }).success,
      false,
      baseUrl,
    );
  }
  assert.equal(
    apiConfigSchema.parse({ apiKey, baseUrl: "http://127.0.0.1:4000" }).baseUrl,
    "http://127.0.0.1:4000",
  );
});

test("API key is sent only in headers; requests forbid redirects and cache reuse", async () => {
  let calls = 0;
  const api = new GlymptApiClient(config, async (url, options) => {
    calls++;
    assert.equal(
      new Headers(options?.headers).get("authorization"),
      `Bearer ${apiKey}`,
    );
    assert.equal(String(url).includes(apiKey), false);
    assert.equal(options?.redirect, "error");
    assert.equal(options?.cache, "no-store");
    return Response.json(
      { status: "queued" },
      { headers: { "x-request-id": "req-123" } },
    );
  });
  assert.deepEqual(
    await api.request("/api/v1/enrich/domain", {
      query: { domain: "example.com", idempotencyKey: "operation-123" },
    }),
    { data: { status: "queued" }, requestId: "req-123" },
  );
  assert.equal(calls, 1);
  await assert.rejects(
    api.request("/internal/worker/v1/jobs"),
    (error: unknown) =>
      error instanceof ApiFailure && error.code === "MCP_INVALID_ENDPOINT",
  );
  assert.equal(calls, 1);
});

test("lost responses are never retried or reported as refunds", async () => {
  let calls = 0;
  const api = new GlymptApiClient(config, async () => {
    calls++;
    throw new Error(`secret ${apiKey}`);
  });
  await assert.rejects(
    api.request("/api/v1/enrich/bulk", {
      body: { domains: ["example.com"], idempotencyKey: "operation-123" },
    }),
    (error: unknown) => {
      assert.ok(error instanceof ApiFailure);
      assert.equal(error.code, "MCP_API_UNAVAILABLE");
      assert.equal(error.details.operationOutcome, "unknown");
      assert.equal(error.message.includes(apiKey), false);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("upstream billing/auth/scope errors remain identifiable without echoing raw messages", async () => {
  for (const [code, status] of [
    ["UNAUTHENTICATED", 401],
    ["FORBIDDEN", 403],
    ["PLAN_REQUIRED", 402],
    ["INSUFFICIENT_CREDITS", 402],
    ["CONFLICT", 409],
    ["RATE_LIMITED", 429],
  ] as const) {
    const api = new GlymptApiClient(config, async () =>
      Response.json(
        { error: { code, message: apiKey, requestId: "req-safe" } },
        { status, headers: { "retry-after": "60" } },
      ),
    );
    await assert.rejects(
      api.request("/api/v1/enrich/domain"),
      (error: unknown) => {
        assert.ok(error instanceof ApiFailure);
        assert.equal(error.code, code);
        assert.equal(error.details.httpStatus, status);
        assert.equal(error.details.requestId, "req-safe");
        assert.equal(error.details.retryAfterSeconds, 60);
        assert.equal(error.message.includes(apiKey), false);
        return true;
      },
    );
  }
});

test("unknown errors and malformed or oversized replies expose no raw upstream data", async () => {
  const cases = [
    {
      response: Response.json(
        { error: { code: "toString", message: apiKey } },
        { status: 500 },
      ),
      code: "MCP_API_ERROR",
    },
    {
      response: new Response(`Bad gateway ${apiKey}`, { status: 502 }),
      code: "MCP_INVALID_RESPONSE",
    },
    {
      response: Response.json({ rows: "x".repeat(1000) }),
      code: "MCP_RESPONSE_TOO_LARGE",
    },
    { response: Response.json([]), code: "MCP_INVALID_RESPONSE" },
  ];
  for (const entry of cases) {
    const api = new GlymptApiClient(
      { ...config, maxResponseBytes: 100 },
      async () => entry.response,
    );
    await assert.rejects(
      api.request("/api/v1/enrich/search"),
      (error: unknown) => {
        assert.ok(error instanceof ApiFailure);
        assert.equal(error.code, entry.code);
        assert.equal(error.details.operationOutcome, "unknown");
        assert.equal(error.message.includes(apiKey), false);
        return true;
      },
    );
  }
});

test("configured key is redacted even when upstream echoes it in a successful result", async () => {
  const api = new GlymptApiClient(config, async () =>
    Response.json(
      { nested: { evidence: `echo ${apiKey}` } },
      { headers: { "x-request-id": apiKey } },
    ),
  );
  const output = await api.request("/api/v1/enrich/search");
  assert.equal(JSON.stringify(output).includes(apiKey), false);
  assert.equal(output.requestId, undefined);
});

test("cancellation leaves acceptance unknown and does not request backend cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const api = new GlymptApiClient(config, async (_url, options) => {
    calls++;
    options?.signal?.throwIfAborted();
    throw new Error("unreachable");
  });
  await assert.rejects(
    api.request("/api/v1/enrich/domain", { signal: controller.signal }),
    (error: unknown) =>
      error instanceof ApiFailure &&
      error.code === "MCP_REQUEST_CANCELED" &&
      error.details.operationOutcome === "unknown",
  );
  assert.equal(calls, 1);
});

test("API timeout has a distinct recoverable error", async () => {
  const api = new GlymptApiClient(
    { ...config, timeoutMs: 5 },
    async (_url, options) => {
      return new Promise<Response>((_resolve, reject) => {
        // Keep the event loop alive: AbortSignal.timeout's timer is unreferenced.
        const keepAlive = setTimeout(
          () => reject(new Error("test timeout")),
          1000,
        );
        options?.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(keepAlive);
            reject(options.signal?.reason);
          },
          { once: true },
        );
      });
    },
  );
  await assert.rejects(
    api.request("/api/v1/enrich/domain"),
    (error: unknown) =>
      error instanceof ApiFailure &&
      error.code === "MCP_API_TIMEOUT" &&
      error.details.operationOutcome === "unknown",
  );
});
