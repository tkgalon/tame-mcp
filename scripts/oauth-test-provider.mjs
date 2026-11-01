import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function startOAuthTestProvider(siteUrl) {
  const cli = join(repo, "node_modules/supabase");
  const metadata = JSON.parse(readFileSync(join(cli, "package.json"), "utf8"));
  const status = JSON.parse(execFileSync(process.execPath, [join(cli, metadata.bin.supabase), "status", "-o", "json"], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  const originalUrl = new URL(status.API_URL);
  if (!["127.0.0.1", "localhost"].includes(originalUrl.hostname) || originalUrl.protocol !== "http:") throw new Error("Only local Supabase is supported.");
  const source = JSON.parse(execFileSync("docker", ["inspect", "supabase_auth_tame-mcp"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }))[0];
  const network = Object.keys(source.NetworkSettings.Networks)[0];
  const name = `tame-oauth-test-${randomUUID()}`;
  let authPort;
  let started = false;
  const gateway = createServer((request, response) => {
    const path = request.url ?? "/";
    const auth = path.startsWith("/auth/v1/");
    if ((!auth && !path.startsWith("/rest/v1/") && !path.startsWith("/storage/v1/")) || !authPort) { response.writeHead(404).end(); return; }
    const target = new URL(auth ? `http://127.0.0.1:${authPort}${path.slice(8)}` : `${originalUrl.origin}${path}`);
    const headers = { ...request.headers, host: target.host };
    const upstream = httpRequest(target, { method: request.method, headers }, incoming => {
      response.writeHead(incoming.statusCode ?? 502, incoming.headers);
      incoming.pipe(response);
    });
    upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    request.on("aborted", () => upstream.destroy());
    request.pipe(upstream);
  });
  await new Promise(resolve => gateway.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${gateway.address().port}`;
  const stop = async () => {
    let cleanupFailed = false;
    if (started) {
      const result = spawnSync("docker", ["rm", "-f", name], { encoding: "utf8", stdio: "pipe" });
      cleanupFailed = result.status !== 0 && !result.stderr?.includes("No such container");
      started = false;
    }
    gateway.closeAllConnections();
    await new Promise(resolve => gateway.close(resolve));
    if (cleanupFailed) throw new Error("Temporary OAuth container cleanup failed.");
  };
  try {
    const env = Object.fromEntries(source.Config.Env.map(item => { const index = item.indexOf("="); return [item.slice(0, index), item.slice(index + 1)]; }));
    for (const key of Object.keys(env)) {
      if (!["DB_DRIVER", "GOTRUE_EXTERNAL_EMAIL_ENABLED"].includes(key)
        && !["GOTRUE_DB_", "GOTRUE_JWT_", "GOTRUE_API_", "GOTRUE_SECURITY_DB_ENCRYPTION"].some(prefix => key.startsWith(prefix))) delete env[key];
    }
    Object.assign(env, {
      GOTRUE_EXTERNAL_EMAIL_ENABLED: "true",
      GOTRUE_OAUTH_SERVER_ENABLED: "true", GOTRUE_OAUTH_SERVER_ALLOW_DYNAMIC_REGISTRATION: "false",
      GOTRUE_OAUTH_SERVER_AUTHORIZATION_PATH: "/oauth/consent", GOTRUE_SITE_URL: siteUrl,
      API_EXTERNAL_URL: `${url}/auth/v1`, GOTRUE_JWT_ISSUER: `${url}/auth/v1`,
      GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED: "true",
      GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI: "pg-functions://postgres/public/mcp_access_token_hook",
    });
    if (Object.values(env).some(value => /[\r\n]/.test(value))) throw new Error("Multiline provider environment is unsupported.");
    execFileSync("docker", ["run", "--pull=never", "--rm", "-d", "--name", name, "--network", network, "--memory=512m", "-p", "127.0.0.1::9999", "--env-file", "/dev/stdin", source.Config.Image], {
      input: Object.entries(env).map(([key, value]) => `${key}=${value}`).join("\n"), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
    started = true;
    const instance = JSON.parse(execFileSync("docker", ["inspect", name], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }))[0];
    authPort = instance.NetworkSettings.Ports["9999/tcp"][0].HostPort;
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      try { if ((await fetch(`${url}/auth/v1/health`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error("Isolated OAuth test provider did not become ready.");
    if (!status.ANON_KEY || !status.SERVICE_ROLE_KEY) throw new Error("Local legacy test keys unavailable.");
    return { url, publicKey: status.ANON_KEY, secretKey: status.SERVICE_ROLE_KEY, stop };
  } catch (error) { await stop(); throw error; }
}
