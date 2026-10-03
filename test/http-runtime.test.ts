import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { GlymptApiClient } from "../src/api-client.js";
import { apiConfigSchema } from "../src/config.js";
import { createLocalHttpHandler } from "../src/local-http.js";

test("Node HTTP bridge reaches an isolated paid API with the original idempotency key", async (t) => {
  const apiKey = "tk_live_http_runtime_test";
  const token = "local_secret_for_runtime_test_123456789";
  const upstreamRequests: string[] = [];
  const backend = createServer((request, response) => {
    upstreamRequests.push(request.url ?? "");
    assert.equal(request.headers.authorization, `Bearer ${apiKey}`);
    response.setHeader("Content-Type", "application/json");
    response.setHeader("x-request-id", "req-http-runtime");
    response.end(
      JSON.stringify({
        status: "complete",
        domain: "example.com",
        technologies: [],
        creditsRemainingAfterRequest: 499,
      }),
    );
  });
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  t.after(() => {
    backend.closeAllConnections();
    backend.close();
  });
  const backendPort = (backend.address() as AddressInfo).port;
  const handler = createLocalHttpHandler(
    new GlymptApiClient(
      apiConfigSchema.parse({
        apiKey,
        baseUrl: `http://127.0.0.1:${backendPort}`,
      }),
    ),
    token,
  );
  const nodeHandler = toNodeHandler(handler, { maxRequestBodySize: 1_048_576 });
  const bridge = createServer((request, response) => {
    void nodeHandler(request, response);
  });
  bridge.listen(0, "127.0.0.1");
  await once(bridge, "listening");
  t.after(async () => {
    bridge.closeAllConnections();
    bridge.close();
    await handler.close();
  });
  const port = (bridge.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${origin}/health`)).status, 200);
  assert.equal((await fetch(`${origin}/mcp`)).status, 401);
  // Use raw HTTP: fetch implementations may overwrite the forbidden Host header.
  const foreignHostStatus = await new Promise<number | undefined>(
    (resolve, reject) => {
      const request = httpRequest(
        `${origin}/mcp`,
        { headers: { host: "evil.test", authorization: `Bearer ${token}` } },
        (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode));
        },
      );
      request.on("error", reject);
      request.end();
    },
  );
  assert.equal(foreignHostStatus, 403);

  const client = new Client(
    { name: "http-runtime-test", version: "0.1.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  const transport = new StreamableHTTPClientTransport(
    new URL(`${origin}/mcp`),
    { requestInit: { headers: { authorization: `Bearer ${token}` } } },
  );
  t.after(() => client.close());
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 14);
  const response = await client.callTool({
    name: "enrich_domain",
    arguments: {
      domain: "example.com",
      idempotencyKey: "runtime-operation-001",
    },
  });
  assert.equal(response.isError, undefined);
  assert.equal(
    (response.structuredContent as Record<string, unknown>).requestId,
    "req-http-runtime",
  );
  assert.equal(upstreamRequests.length, 1);
  const url = new URL(upstreamRequests[0]!, "http://test.local");
  assert.equal(url.pathname, "/api/v1/enrich/domain");
  assert.equal(url.searchParams.get("idempotencyKey"), "runtime-operation-001");
});
