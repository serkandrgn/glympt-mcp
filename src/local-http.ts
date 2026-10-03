import { timingSafeEqual } from "node:crypto";
import type { GlymptApiClient } from "./api-client.js";
import { createGlymptHandler } from "./server.js";

export function createLocalHttpHandler(api: GlymptApiClient, token: string) {
  const handler = createGlymptHandler(api);
  const expected = Buffer.from(`Bearer ${token}`);
  return {
    close: () => handler.close(),
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const origin = request.headers.get("origin");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        (origin !== null && origin !== url.origin)
      ) {
        return Response.json(
          { error: "Forbidden host or origin." },
          { status: 403 },
        );
      }
      if (url.pathname === "/health" && request.method === "GET")
        return Response.json({ status: "ok", mode: "local" });
      if (url.pathname !== "/mcp")
        return Response.json({ error: "Not found." }, { status: 404 });
      const supplied = Buffer.from(request.headers.get("authorization") ?? "");
      if (
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      ) {
        return Response.json(
          { error: "Local bearer token required." },
          {
            status: 401,
            headers: {
              "WWW-Authenticate": 'Bearer realm="glympt-local"',
              "Cache-Control": "no-store",
            },
          },
        );
      }
      const response = await handler.fetch(request);
      response.headers.set("Cache-Control", "no-store");
      return response;
    },
  };
}
