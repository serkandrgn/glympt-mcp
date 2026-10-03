import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { GlymptApiClient } from "./api-client.js";
import { loadApiConfig } from "./config.js";
import { createGlymptServer } from "./server.js";

try {
  const api = new GlymptApiClient(loadApiConfig());
  const handle = serveStdio(() => createGlymptServer(api), {
    onerror: () => console.error("Glympt MCP protocol error."),
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void handle.close();
    });
  }
  console.error("Glympt MCP ready on stdio.");
} catch {
  console.error(
    "Invalid MCP configuration. Set GLYMPT_API_KEY and an HTTPS GLYMPT_API_BASE_URL (HTTP loopback is allowed for development).",
  );
  process.exitCode = 1;
}
