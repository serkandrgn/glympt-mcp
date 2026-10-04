import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const metadata = JSON.parse(
  await readFile(join(repository, "package.json"), "utf8"),
);
const temporary = await mkdtemp(join(tmpdir(), "glympt-mcp-package-"));
const environment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !/^(GLYMPT_|NODE_OPTIONS$|NODE_PATH$|NPM_TOKEN$|NODE_AUTH_TOKEN$|npm_config_)/i.test(
        key,
      ),
  ),
);
const emptyConfig = join(temporary, "empty.npmrc");
const emptyGlobalConfig = join(temporary, "empty-global.npmrc");
await writeFile(emptyConfig, "");
await writeFile(emptyGlobalConfig, "");
const npmFlags = [
  "--userconfig",
  emptyConfig,
  "--globalconfig",
  emptyGlobalConfig,
  "--cache",
  join(temporary, "cache"),
  "--registry",
  "https://registry.npmjs.org",
];

function run(command, args, cwd = temporary, env = environment) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.equal(result.error, undefined, "Package command could not run");
  assert.equal(result.status, 0, `Package command failed: ${result.stderr}`);
  return result.stdout;
}

let requests = 0;
const apiKey = "tk_live_package_mock_only";
const api = createServer((request, response) => {
  requests++;
  assert.equal(request.url, "/api/v1/enrich/usage");
  assert.equal(request.headers.authorization, `Bearer ${apiKey}`);
  response.writeHead(200, {
    "content-type": "application/json",
    "x-request-id": "req-package-mock",
  });
  response.end(JSON.stringify({ plan: "pro", remainingCredits: 500 }));
});

try {
  const specification = process.argv[2];
  if (!specification) {
    const output = run(
      "npm",
      ["pack", "--json", "--pack-destination", temporary, ...npmFlags],
      repository,
    );
    const packed = JSON.parse(output.slice(output.indexOf("[")))[0];
    const expected = [
      "README.md",
      "package.json",
      "server.json",
      "docs/client-setup.md",
      "dist/stdio.js",
      "dist/config.js",
      "dist/api-client.js",
      "dist/server.js",
    ];
    if (packed.files.some((file) => file.path === "LICENSE"))
      expected.push("LICENSE");
    assert.deepEqual(
      packed.files.map((file) => file.path).sort(),
      expected.sort(),
    );
    console.log(
      `Tarball allowlist verified: ${packed.files.length} files, ${packed.size} bytes.`,
    );
  }
  const installTarget =
    specification ??
    join(
      temporary,
      `${metadata.name.replace("@", "").replace("/", "-")}-${metadata.version}.tgz`,
    );
  await writeFile(
    join(temporary, "package.json"),
    '{"private":true,"type":"module"}\n',
  );
  run("npm", [
    "install",
    "--omit=dev",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    installTarget,
    ...npmFlags,
  ]);
  const installedRoot = join(temporary, "node_modules", "@glympt", "mcp");
  const installed = JSON.parse(
    await readFile(join(installedRoot, "package.json"), "utf8"),
  );
  assert.equal(installed.version, metadata.version);
  assert.equal(installed.mcpName, metadata.mcpName);
  assert.equal(installed.bin["glympt-mcp"], "dist/stdio.js");
  assert.match(
    await readFile(join(installedRoot, "dist/stdio.js"), "utf8"),
    /^#!\/usr\/bin\/env node\n/,
  );
  const tree = JSON.parse(run("npm", ["ls", "--all", "--json", ...npmFlags]));
  assert.doesNotMatch(
    JSON.stringify(tree),
    /"(?:tsx|typescript|@modelcontextprotocol\/client)":/,
  );

  const binary = join(temporary, "node_modules", ".bin", "glympt-mcp");
  for (const variables of [
    {},
    {
      GLYMPT_API_KEY: "invalid-secret-canary",
      GLYMPT_API_BASE_URL: "https://secret-canary:password@example.com",
    },
  ]) {
    const result = spawnSync(binary, [], {
      cwd: temporary,
      env: { ...environment, ...variables },
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Set GLYMPT_API_KEY/);
    assert.doesNotMatch(result.stderr, /secret-canary|password/);
  }

  await new Promise((resolve, reject) => {
    api.once("error", reject);
    api.listen(0, "127.0.0.1", resolve);
  });
  const address = api.address();
  assert.ok(address && typeof address === "object");
  const mockEnvironment = {
    ...environment,
    GLYMPT_API_KEY: apiKey,
    GLYMPT_API_BASE_URL: `http://127.0.0.1:${address.port}`,
  };

  for (const mode of ["modern", "legacy", "npx"]) {
    const transport = new StdioClientTransport({
      command: mode === "npx" ? "npx" : binary,
      args: mode === "npx" ? ["--yes", `@glympt/mcp@${metadata.version}`] : [],
      cwd: temporary,
      env: {
        ...mockEnvironment,
        npm_config_cache: join(temporary, "cache"),
        npm_config_userconfig: emptyConfig,
        npm_config_globalconfig: emptyGlobalConfig,
      },
      stderr: "pipe",
    });
    let diagnostics = "";
    transport.stderr?.on("data", (chunk) => {
      diagnostics += chunk.toString();
    });
    const client = new Client(
      { name: "glympt-packed-smoke", version: "1.0.0" },
      {
        versionNegotiation: {
          mode: mode === "legacy" ? "legacy" : { pin: "2026-07-28" },
        },
      },
    );
    try {
      await client.connect(transport);
      assert.equal((await client.listTools()).tools.length, 14);
      assert.equal(
        requests,
        mode === "modern" ? 0 : mode === "legacy" ? 1 : 2,
        "Discovery must not request paid API data",
      );
      assert.equal(
        client.getNegotiatedProtocolVersion(),
        mode === "legacy" ? "2025-11-25" : "2026-07-28",
      );
      const usage = await client.callTool({ name: "get_usage", arguments: {} });
      assert.notEqual(usage.isError, true);
      assert.ok(
        JSON.stringify(usage.structuredContent).includes(
          '"remainingCredits":500',
        ),
      );
      assert.ok(!diagnostics.includes(apiKey));
      console.log(
        `${mode}: installed executable discovers 14 tools and calls mock usage with protocol-only stdout.`,
      );
    } finally {
      await client.close();
    }
  }
  assert.equal(requests, 3);
  console.log(
    `Clean production-only install verified for ${installed.name}@${installed.version}.`,
  );
} finally {
  await new Promise((resolve) => api.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
