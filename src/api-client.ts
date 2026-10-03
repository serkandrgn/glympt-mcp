import { randomUUID } from "node:crypto";
import type { ApiConfig } from "./config.js";

const messages: Record<string, string> = {
  UNAUTHENTICATED: "The Glympt API key is invalid or revoked.",
  FORBIDDEN:
    "The API key lacks the required scope, or the resource is not accessible.",
  PLAN_REQUIRED: "An active plan with API access is required.",
  INSUFFICIENT_CREDITS:
    "There are not enough query credits for this enrichment.",
  RATE_LIMITED:
    "The Glympt request allowance is exceeded or temporarily unavailable. Wait before trying again.",
  INVALID_DOMAIN: "Glympt rejected the domain. Check the input.",
  BULK_LIMIT_EXCEEDED: "The batch exceeds this plan's upload limit.",
  CONFLICT:
    "The idempotency key conflicts with an earlier request. Reuse identical input, or use a new key only for an intentional new operation.",
  SCAN_FAILED: "The scan failed. Check the existing job for its final outcome.",
  EXPORT_FAILED:
    "Export generation failed. Read its status or replay the same operation key before requesting an intentional new export.",
  NOT_FOUND: "The resource is unavailable, expired, or outside this workspace.",
  VALIDATION_ERROR: "Glympt rejected the request arguments.",
};

export class ApiFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: {
      httpStatus?: number;
      requestId?: string;
      retryAfterSeconds?: number;
      operationOutcome?: "unknown";
      authChallenge?: string;
    } = {},
  ) {
    super(message);
  }
}

export type ApiResponse = { data: Record<string, unknown>; requestId?: string };
export type RequestOptions = {
  query?: Record<string, string | number | undefined>;
  body?: Record<string, unknown>;
  signal?: AbortSignal;
};

function safeRequestId(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(value)
    ? value
    : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class GlymptApiClient {
  constructor(
    private readonly config: ApiConfig,
    private readonly fetcher: typeof fetch = fetch,
    private readonly gatewaySecret?: string,
  ) {}

  async request(
    path: string,
    options: RequestOptions = {},
  ): Promise<ApiResponse> {
    // This adapter can call only the enrichment API; no arbitrary fetch tool.
    if (!/^\/api\/v1\/enrich\/[a-zA-Z0-9/-]+$/.test(path)) {
      throw new ApiFailure(
        "MCP_INVALID_ENDPOINT",
        "The API endpoint is not supported.",
      );
    }
    const url = new URL(path, this.config.baseUrl);
    for (const [name, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout;
    const controller = new AbortController();
    const requestSignal = AbortSignal.any([signal, controller.signal]);
    let requestId: string | undefined;
    try {
      const response = await this.fetcher(url, {
        method: options.body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          Accept: "application/json",
          "User-Agent": "glympt-mcp/0.1.0",
          "x-request-id": randomUUID(),
          ...(this.gatewaySecret
            ? { "x-mcp-gateway-secret": this.gatewaySecret }
            : {}),
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        signal: requestSignal,
        redirect: "error",
        cache: "no-store",
      });
      requestId = safeRequestId(response.headers.get("x-request-id"));
      if (requestId?.includes(this.config.apiKey)) requestId = undefined;
      // Read with a bound rather than buffering an unbounded API response.
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > this.config.maxResponseBytes) {
              controller.abort();
              await reader.cancel();
              throw new ApiFailure(
                "MCP_RESPONSE_TOO_LARGE",
                "The result exceeds the MCP response limit. Request a smaller result page; for enrichment, recover using the same idempotency key.",
                { requestId, operationOutcome: "unknown" },
              );
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      let payload: unknown;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw new ApiFailure(
          "MCP_INVALID_RESPONSE",
          "Glympt returned an unreadable response. The operation may have been accepted; recover with the same idempotency key.",
          { requestId, operationOutcome: "unknown" },
        );
      }

      if (!response.ok) {
        const upstream =
          isObject(payload) && isObject(payload.error) ? payload.error : {};
        const code =
          typeof upstream.code === "string" &&
          Object.hasOwn(messages, upstream.code)
            ? upstream.code
            : "MCP_API_ERROR";
        const retryAfter = response.headers.get("retry-after");
        const retryAfterSeconds =
          retryAfter && /^\d{1,6}$/.test(retryAfter)
            ? Number(retryAfter)
            : undefined;
        throw new ApiFailure(
          code,
          messages[code] ??
            "Glympt could not complete the request. Use the request ID for support.",
          {
            httpStatus: response.status,
            requestId:
              requestId ??
              (typeof upstream.requestId === "string" &&
              !upstream.requestId.includes(this.config.apiKey)
                ? safeRequestId(upstream.requestId)
                : undefined),
            ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
            ...(response.status >= 500 ? { operationOutcome: "unknown" } : {}),
          },
        );
      }
      if (!isObject(payload)) {
        throw new ApiFailure(
          "MCP_INVALID_RESPONSE",
          "Glympt returned an unexpected result shape.",
          { requestId, operationOutcome: "unknown" },
        );
      }
      // A downstream response must never echo the configured secret into model context.
      let serialized = JSON.stringify(payload).replaceAll(
        this.config.apiKey,
        "[REDACTED]",
      );
      if (this.gatewaySecret)
        serialized = serialized.replaceAll(this.gatewaySecret, "[REDACTED]");
      const data = JSON.parse(serialized) as Record<string, unknown>;
      return { data, ...(requestId ? { requestId } : {}) };
    } catch (error) {
      if (error instanceof ApiFailure) throw error;
      const code = options.signal?.aborted
        ? "MCP_REQUEST_CANCELED"
        : timeout.aborted
          ? "MCP_API_TIMEOUT"
          : "MCP_API_UNAVAILABLE";
      throw new ApiFailure(
        code,
        "The API response was not received. Acceptance and billing are unknown; retry an enrichment only with the same idempotency key and identical input. Canceling this request does not cancel an accepted scan or guarantee a refund.",
        { requestId, operationOutcome: "unknown" },
      );
    }
  }
}
