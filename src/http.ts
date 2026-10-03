import { createServer } from "node:http";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { GlymptApiClient } from "./api-client.js";
import { loadApiConfig, loadLocalHttpConfig } from "./config.js";
import { createLocalHttpHandler } from "./local-http.js";

try {
  const apiConfig = loadApiConfig();
  const local = loadLocalHttpConfig();
  if (local.token === apiConfig.apiKey)
    throw new Error("Local and API credentials must differ.");
  const handler = createLocalHttpHandler(
    new GlymptApiClient(apiConfig),
    local.token,
  );
  const nodeHandler = toNodeHandler(handler, {
    maxRequestBodySize: 1_048_576,
    onerror: () => console.error("Glympt MCP HTTP adapter error."),
  });
  const server = createServer((request, response) => {
    void nodeHandler(request, response);
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.on("error", () => {
    console.error("Unable to start Glympt MCP loopback HTTP server.");
    process.exitCode = 1;
  });
  server.listen(local.port, "127.0.0.1", () =>
    console.error(
      `Glympt MCP ready at http://127.0.0.1:${local.port}/mcp (local only).`,
    ),
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      server.close();
      server.closeIdleConnections();
      void handler.close();
    });
  }
} catch {
  console.error(
    "Invalid MCP configuration. HTTP mode requires a paid API key and a distinct GLYMPT_MCP_LOCAL_TOKEN of at least 32 characters.",
  );
  process.exitCode = 1;
}
