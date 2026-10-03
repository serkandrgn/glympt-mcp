import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { GlymptApiClient } from "../src/api-client.js";
import { apiConfigSchema } from "../src/config.js";
import { createGlymptHandler } from "../src/server.js";

const id = "00000000-0000-4000-8000-000000000001";
for (const era of ["modern", "legacy"] as const)
  test(`${era}: usage, saved lists and CSV snapshots preserve operation keys and bounded reads`, async (t) => {
    const calls: Array<{
      url: URL;
      method: string;
      body?: Record<string, unknown>;
    }> = [];
    const handler = createGlymptHandler(
      new GlymptApiClient(
        apiConfigSchema.parse({ apiKey: "tk_live_workflow_tests" }),
        async (input, init) => {
          calls.push({
            url: new URL(String(input)),
            method: init?.method ?? "GET",
            body: init?.body
              ? (JSON.parse(String(init.body)) as Record<string, unknown>)
              : undefined,
          });
          return Response.json({
            id,
            remainingCredits: 499,
            status: "ready",
            content: Buffer.from("domain\nexample.com\n").toString("base64"),
            eof: true,
          });
        },
      ),
    );
    const transport = new StreamableHTTPClientTransport(
      new URL("http://mcp.test/mcp"),
      { fetch: (url, init) => handler.fetch(new Request(url, init)) },
    );
    const client = new Client(
      { name: "workflow-test", version: "1" },
      {
        versionNegotiation: {
          mode: era === "modern" ? { pin: "2026-07-28" } : "legacy",
        },
      },
    );
    await client.connect(transport);
    t.after(async () => {
      await client.close();
      await handler.close();
    });
    const catalog = await client.listTools();
    assert.equal(catalog.tools.length, 14);
    for (const tool of catalog.tools) {
      assert.equal(
        tool.inputSchema.type,
        "object",
        `${tool.name}: host tool schemas require an object root`,
      );
      for (const combinator of ["oneOf", "anyOf", "allOf"])
        assert.equal(
          tool.inputSchema[combinator],
          undefined,
          `${tool.name}: unsupported root combinator`,
        );
    }
    const invocations = [
      { name: "get_usage", arguments: {} },
      { name: "list_saved_lists", arguments: { page: 2, pageSize: 10 } },
      { name: "get_saved_list", arguments: { listId: id } },
      {
        name: "create_saved_list",
        arguments: { name: "Prospects", idempotencyKey: "list-operation-key" },
      },
      {
        name: "add_domain_to_list",
        arguments: {
          listId: id,
          domain: "example.com",
          notes: "User note",
          idempotencyKey: "item-operation-key",
        },
      },
      {
        name: "create_csv_export",
        arguments: {
          source: "bulk_upload",
          bulkUploadId: id,
          idempotencyKey: "export-batch-key",
        },
      },
      {
        name: "create_csv_export",
        arguments: {
          source: "saved_list",
          listId: id,
          idempotencyKey: "export-list-key",
        },
      },
      {
        name: "create_csv_export",
        arguments: {
          source: "domain_search",
          filters: { include: ["shopify"], country: "de" },
          idempotencyKey: "export-search-key",
        },
      },
      { name: "get_csv_export", arguments: { exportId: id } },
      {
        name: "get_csv_export_chunk",
        arguments: { exportId: id, offsetBytes: 65536, limitBytes: 4096 },
      },
    ];
    for (const invocation of invocations) {
      const result = await client.callTool(invocation);
      assert.equal(result.isError, undefined, JSON.stringify(result));
      const key =
        "idempotencyKey" in invocation.arguments
          ? invocation.arguments.idempotencyKey
          : undefined;
      if (key)
        assert.equal(
          (result.structuredContent as Record<string, unknown>).idempotencyKey,
          key,
        );
    }
    assert.deepEqual(
      calls.map((call) => call.url.pathname),
      [
        "/api/v1/enrich/usage",
        "/api/v1/enrich/lists",
        `/api/v1/enrich/lists/${id}`,
        "/api/v1/enrich/lists",
        `/api/v1/enrich/lists/${id}/items`,
        "/api/v1/enrich/exports",
        "/api/v1/enrich/exports",
        "/api/v1/enrich/exports",
        `/api/v1/enrich/exports/${id}`,
        `/api/v1/enrich/exports/${id}/content`,
      ],
    );
    assert.equal(calls[1]?.url.searchParams.get("page"), "2");
    assert.deepEqual(calls[3]?.body, invocations[3]?.arguments);
    assert.equal(
      (calls[7]?.body?.filters as Record<string, unknown>).country,
      "DE",
    );
    assert.equal(calls[9]?.url.searchParams.get("offsetBytes"), "65536");
    for (const name of [
      "create_saved_list",
      "add_domain_to_list",
      "create_csv_export",
    ])
      assert.equal(
        catalog.tools.find((tool) => tool.name === name)?.annotations
          ?.readOnlyHint,
        false,
      );
    const count = calls.length;
    const invalid = await client.callTool({
      name: "get_csv_export_chunk",
      arguments: { exportId: id, limitBytes: 65537 },
    });
    assert.equal(invalid.isError, true);
    const noKey = await client.callTool({
      name: "create_saved_list",
      arguments: { name: "No replay key" },
    });
    assert.equal(noKey.isError, true);
    for (const arguments_ of [
      { source: "saved_list", idempotencyKey: "missing-list-id" },
      {
        source: "domain_search",
        listId: id,
        idempotencyKey: "unexpected-list-id",
      },
      {
        source: "bulk_upload",
        bulkUploadId: id,
        filters: { category: "cms" },
        idempotencyKey: "invalid-batch-filter",
      },
    ]) {
      const invalidCombination = await client.callTool({
        name: "create_csv_export",
        arguments: arguments_,
      });
      assert.equal(invalidCombination.isError, true);
    }
    assert.equal(
      calls.length,
      count,
      "Invalid requests must never reach the API",
    );
  });
