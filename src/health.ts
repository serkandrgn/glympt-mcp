import { request } from "node:http";

try {
  const resource = new URL(process.env.GLYMPT_MCP_RESOURCE_URL ?? "");
  const port = Number(process.env.GLYMPT_MCP_PORT ?? 3100);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid port");
  // Keep the public Host header: the application rejects arbitrary hosts even
  // when the probe connects to loopback inside its container.
  const probe = request(
    {
      hostname: "127.0.0.1",
      port,
      path: "/health",
      headers: { host: resource.host },
      timeout: 3000,
    },
    (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        body += chunk;
        if (body.length > 1024)
          probe.destroy(new Error("Invalid health response"));
      });
      response.on("end", () => {
        try {
          const value = JSON.parse(body) as { status?: string; mode?: string };
          if (
            response.statusCode !== 200 ||
            value.status !== "ok" ||
            value.mode !== "hosted"
          )
            process.exitCode = 1;
        } catch {
          process.exitCode = 1;
        }
      });
      response.on("error", () => {
        process.exitCode = 1;
      });
    },
  );
  probe.on("timeout", () => probe.destroy(new Error("Health timeout")));
  probe.on("error", () => {
    process.exitCode = 1;
  });
  probe.end();
} catch {
  process.exitCode = 1;
}
