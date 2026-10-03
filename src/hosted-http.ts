import { createMcpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { ApiFailure, GlymptApiClient } from "./api-client.js";
import { apiConfigSchema } from "./config.js";
import { createGlymptServer } from "./server.js";

export const hostedConfigSchema = apiConfigSchema
  .omit({ apiKey: true })
  .extend({
    resourceUrl: z
      .string()
      .url()
      .transform((value, ctx) => {
        const url = new URL(value);
        const local = ["localhost", "127.0.0.1", "[::1]"].includes(
          url.hostname,
        );
        if (
          url.username ||
          url.password ||
          url.hash ||
          url.search ||
          url.pathname !== "/mcp" ||
          (url.protocol !== "https:" && !(local && url.protocol === "http:"))
        ) {
          ctx.addIssue({
            code: "custom",
            message:
              "Use an HTTPS MCP resource ending in /mcp (loopback HTTP is allowed for tests).",
          });
          return z.NEVER;
        }
        return url.href;
      }),
    gatewaySecret: z
      .string()
      .min(32)
      .max(256)
      .regex(/^[A-Za-z0-9_-]+$/),
    allowedOrigins: z
      .array(
        z
          .string()
          .url()
          .transform((value, ctx) => {
            const url = new URL(value);
            if (
              url.username ||
              url.password ||
              url.search ||
              url.hash ||
              url.pathname !== "/" ||
              !["https:", "http:"].includes(url.protocol)
            ) {
              ctx.addIssue({
                code: "custom",
                message:
                  "Allowed origins must contain only a scheme, host and optional port.",
              });
              return z.NEVER;
            }
            return url.origin;
          }),
      )
      .default([]),
  });
export type HostedConfig = z.output<typeof hostedConfigSchema>;
const scopes = [
  "lookup:read",
  "bulk:write",
  "lists:read",
  "lists:write",
  "exports:read",
  "offline_access",
];

export function loadHostedConfig(environment: NodeJS.ProcessEnv = process.env) {
  return hostedConfigSchema.parse({
    baseUrl: environment.GLYMPT_API_BASE_URL,
    resourceUrl: environment.GLYMPT_MCP_RESOURCE_URL,
    gatewaySecret: environment.GLYMPT_MCP_GATEWAY_SECRET,
    allowedOrigins:
      environment.GLYMPT_MCP_ALLOWED_ORIGINS?.split(",").filter(Boolean),
  });
}

async function boundedJson(response: Response) {
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16384) {
          await reader.cancel();
          throw new Error("Authorization response too large");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
    string,
    unknown
  >;
}

export function createHostedHttpHandler(
  config: HostedConfig,
  fetcher: typeof fetch = fetch,
) {
  const resource = new URL(config.resourceUrl);
  const metadataUrl = `${resource.origin}/.well-known/oauth-protected-resource/mcp`;
  const challenge = `Bearer resource_metadata="${metadataUrl}"`;
  const allowedOrigins = new Set([resource.origin, ...config.allowedOrigins]);
  const handler = createMcpHandler(
    (context) => {
      const identity = context.authInfo;
      if (!identity) throw new Error("Authenticated MCP context required");
      const api = new GlymptApiClient(
        { ...config, apiKey: identity.token },
        fetcher,
        config.gatewaySecret,
      );
      return createGlymptServer(
        {
          async request(path, options) {
            const scope = path.startsWith("/api/v1/enrich/bulk")
              ? "bulk:write"
              : path.startsWith("/api/v1/enrich/lists")
                ? options?.body
                  ? "lists:write"
                  : "lists:read"
                : path.startsWith("/api/v1/enrich/exports")
                  ? "exports:read"
                  : "lookup:read";
            if (!identity.scopes.includes(scope))
              throw new ApiFailure(
                "MCP_INSUFFICIENT_SCOPE",
                "Authorize the scope required by this tool.",
                {
                  httpStatus: 403,
                  authChallenge: `${challenge}, error="insufficient_scope", scope="${scope}"`,
                },
              );
            try {
              return await api.request(path, options);
            } catch (error) {
              if (
                error instanceof ApiFailure &&
                error.details.httpStatus === 401
              )
                throw new ApiFailure(
                  error.code,
                  "The MCP authorization is invalid or revoked. Reconnect Glympt.",
                  {
                    ...error.details,
                    authChallenge: `${challenge}, error="invalid_token"`,
                  },
                );
              throw error;
            }
          },
        },
        true,
      );
    },
    { legacy: "stateless", maxRequestBodySize: 1_048_576 },
  );

  return {
    close: () => handler.close(),
    async fetch(request: Request) {
      const url = new URL(request.url);
      const origin = request.headers.get("origin");
      // Compare Host with the configured public origin. TLS terminates at the
      // reverse proxy; forwarded headers cannot choose our OAuth resource URI.
      if (url.host !== resource.host || (origin && !allowedOrigins.has(origin)))
        return Response.json(
          { error: "Forbidden host or origin." },
          { status: 403 },
        );
      const response = await (async () => {
        if (url.pathname === "/health" && request.method === "GET")
          return Response.json({ status: "ok", mode: "hosted" });
        if (
          [
            "/.well-known/oauth-protected-resource",
            "/.well-known/oauth-protected-resource/mcp",
          ].includes(url.pathname) &&
          request.method === "GET"
        ) {
          return Response.json({
            resource: config.resourceUrl,
            authorization_servers: [`${config.baseUrl}/api/auth`],
            scopes_supported: scopes,
            bearer_methods_supported: ["header"],
            resource_name: "Glympt",
          });
        }
        if (url.pathname !== "/mcp")
          return Response.json({ error: "Not found." }, { status: 404 });
        if (request.method === "OPTIONS")
          return new Response(null, { status: 204 });
        const authorization = request.headers.get("authorization");
        if (
          !authorization?.startsWith("Bearer ") ||
          authorization.length > 4103
        )
          return Response.json(
            { error: "MCP OAuth authorization required." },
            { status: 401, headers: { "WWW-Authenticate": challenge } },
          );
        let identity: Record<string, unknown>;
        try {
          // Send the resource token only to its issuing authorization server.
          // API tools receive a distinct audience-bound delegation credential.
          const authResponse = await fetcher(
            new URL("/api/auth/mcp/exchange", config.baseUrl),
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-mcp-gateway-secret": config.gatewaySecret,
              },
              body: JSON.stringify({ accessToken: authorization.slice(7) }),
              signal: AbortSignal.any([
                request.signal,
                AbortSignal.timeout(5000),
              ]),
              redirect: "error",
              cache: "no-store",
            },
          );
          identity = await boundedJson(authResponse);
          if (!authResponse.ok) {
            if ([400, 401].includes(authResponse.status))
              return Response.json(
                { error: "MCP OAuth authorization is invalid or expired." },
                {
                  status: 401,
                  headers: {
                    "WWW-Authenticate": `${challenge}, error="invalid_token"`,
                  },
                },
              );
            if ([402, 403].includes(authResponse.status))
              return Response.json(
                {
                  error:
                    "Workspace access or a paid API-enabled plan is required.",
                },
                { status: authResponse.status },
              );
            throw new Error("Authorization unavailable");
          }
          if (
            typeof identity.token !== "string" ||
            !identity.token.startsWith("gmcp_api_") ||
            typeof identity.expiresAt !== "number" ||
            identity.expiresAt <= Date.now() / 1000 ||
            !Array.isArray(identity.scopes) ||
            !identity.scopes.every(
              (scope) => typeof scope === "string" && scopes.includes(scope),
            )
          )
            throw new Error("Invalid authorization response");
        } catch {
          return Response.json(
            { error: "Glympt authorization is temporarily unavailable." },
            { status: 503 },
          );
        }
        return handler.fetch(request, {
          authInfo: {
            token: identity.token as string,
            clientId: "glympt-delegated",
            scopes: identity.scopes as string[],
            expiresAt: identity.expiresAt as number,
          },
        });
      })();
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("x-request-id", randomUUID());
      response.headers.set("Vary", "Origin");
      response.headers.set("X-Content-Type-Options", "nosniff");
      if (origin) {
        response.headers.set("Access-Control-Allow-Origin", origin);
        response.headers.set(
          "Access-Control-Allow-Methods",
          "GET, POST, DELETE, OPTIONS",
        );
        response.headers.set(
          "Access-Control-Allow-Headers",
          "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID",
        );
        response.headers.set(
          "Access-Control-Expose-Headers",
          "WWW-Authenticate, MCP-Session-Id, X-Request-Id",
        );
      }
      return response;
    },
  };
}
