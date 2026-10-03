import { z } from "zod";

export const apiConfigSchema = z.object({
  baseUrl: z
    .string()
    .url()
    .default("https://api.glympt.com")
    .transform((value, ctx) => {
      const url = new URL(value);
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if (
        (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== "/"
      ) {
        ctx.addIssue({
          code: "custom",
          message:
            "API base URL must be an HTTPS origin, or HTTP loopback for development.",
        });
        return z.NEVER;
      }
      return url.origin;
    }),
  apiKey: z
    .string()
    .regex(/^tk_live_[A-Za-z0-9_-]+$/, "A Glympt API key is required."),
  timeoutMs: z.number().int().min(1).max(30_000).default(15_000),
  maxResponseBytes: z.number().int().min(1).max(1_048_576).default(262_144),
});

export type ApiConfig = z.output<typeof apiConfigSchema>;

export function loadApiConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ApiConfig {
  // Keep validation diagnostics free of the supplied credential value.
  return apiConfigSchema.parse({
    baseUrl: environment.GLYMPT_API_BASE_URL,
    apiKey: environment.GLYMPT_API_KEY,
  });
}

export function loadLocalHttpConfig(
  environment: NodeJS.ProcessEnv = process.env,
) {
  return z
    .object({
      token: z
        .string()
        .min(32)
        .max(256)
        .regex(/^[A-Za-z0-9_-]+$/),
      port: z.coerce.number().int().min(1).max(65535).default(3100),
    })
    .parse({
      token: environment.GLYMPT_MCP_LOCAL_TOKEN,
      port: environment.GLYMPT_MCP_PORT,
    });
}
