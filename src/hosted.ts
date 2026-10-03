import { createServer } from "node:http";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createHostedHttpHandler, loadHostedConfig } from "./hosted-http.js";

try {
  const config = loadHostedConfig();
  const port = Number(process.env.GLYMPT_MCP_PORT ?? 3100);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid port");
  const handler = createHostedHttpHandler(config);
  const nodeHandler = toNodeHandler(handler, {
    maxRequestBodySize: 1_048_576,
    onerror: () => console.error("Glympt MCP adapter error."),
  });
  const server = createServer((request, response) => {
    const startedAt = Date.now();
    response.once("finish", () =>
      console.error(
        JSON.stringify({
          requestId: response.getHeader("x-request-id"),
          method: request.method,
          path: request.url?.split("?", 1)[0],
          status: response.statusCode,
          durationMs: Date.now() - startedAt,
        }),
      ),
    );
    void nodeHandler(request, response);
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.on("error", () => {
    console.error("Unable to start hosted MCP server.");
    process.exitCode = 1;
  });
  server.listen(port, "0.0.0.0", () =>
    console.error("Glympt hosted MCP ready."),
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      server.close();
      server.closeIdleConnections();
      void handler.close();
    });
} catch {
  console.error(
    "Invalid hosted MCP configuration. Set the API origin, MCP resource URL and gateway secret.",
  );
  process.exitCode = 1;
}
