import { execFileSync, spawn } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { constants, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { createClient } = createRequire(join(repo, "apps/web/package.json"))("@supabase/supabase-js");
const resourceUrl = "http://127.0.0.1:3001/mcp";
const check = (value, message) => { if (!value) throw new Error(message); };

async function findCodex() {
  const candidates = process.env.TAME_CODEX_BIN ? [process.env.TAME_CODEX_BIN]
    : (process.env.PATH ?? "").split(delimiter).map(directory => join(directory, process.platform === "win32" ? "codex.exe" : "codex"));
  if (!process.env.TAME_CODEX_BIN && process.platform === "darwin") {
    const extensions = join(homedir(), ".vscode/extensions");
    const names = await readdir(extensions).catch(() => []);
    for (const name of names.filter(name => name.startsWith("openai.chatgpt-")).sort().reverse()) {
      candidates.push(join(extensions, name, "bin", process.arch === "arm64" ? "macos-aarch64" : "macos-x86_64", "codex"));
    }
  }
  for (const candidate of candidates) { try { await access(candidate, constants.X_OK); return candidate; } catch {} }
  throw new Error("Codex CLI unavailable. Set TAME_CODEX_BIN to the installed Codex executable.");
}

async function probeCallback(binary) {
  const args = [
    "-c", `mcp_servers.tame_setup_probe.url="${resourceUrl}"`,
    "-c", 'mcp_servers.tame_setup_probe.oauth.client_id="00000000-0000-4000-8000-000000000001"',
    "-c", 'mcp_servers.tame_setup_probe.oauth.callback_url="http://127.0.0.1:4321/callback"',
    "-c", "mcp_servers.tame_setup_probe.oauth.callback_port=4321",
    "-c", 'mcp_oauth_callback_url="http://127.0.0.1:4321/callback"',
    "-c", "mcp_oauth_callback_port=4321",
    "mcp", "login", "tame_setup_probe", "--scopes", "openid", "--no-browser",
  ];
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/SUPABASE|TOKEN|SECRET|KEY|NODE_OPTIONS/.test(name)));
  return new Promise((accept, reject) => {
    const child = spawn(binary, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let output = "", callback = null, failure = null;
    const timer = setTimeout(() => { failure = new Error("Codex callback probe timed out. Start the local web and MCP servers first."); child.kill("SIGKILL"); }, 20000);
    const inspect = chunk => {
      if (callback || failure) return;
      output += chunk.toString();
      if (output.length > 65536) { failure = new Error("Unexpected Codex output."); child.kill("SIGKILL"); return; }
      for (const match of output.matchAll(/https?:\/\/[^\s<>"']+/g)) {
        let url;
        try { url = new URL(match[0]); } catch { continue; }
        if (!url.searchParams.has("code_challenge")) continue;
        const value = URL.parse(url.searchParams.get("redirect_uri") ?? "");
        if (!value || value.protocol !== "http:" || value.hostname !== "127.0.0.1" || value.port !== "4321"
          || !/^\/callback(?:\/[A-Za-z0-9_-]+)?$/.test(value.pathname) || value.search || value.hash
          || url.searchParams.get("resource") !== resourceUrl || url.searchParams.get("code_challenge_method") !== "S256") {
          failure = new Error("Codex returned an unexpected callback, resource, or PKCE method.");
        } else callback = value.href;
        child.kill("SIGTERM");
        return;
      }
    };
    child.stdout.on("data", inspect); child.stderr.on("data", inspect);
    child.on("error", () => { failure = new Error("Could not start Codex CLI."); });
    child.on("close", () => {
      clearTimeout(timer);
      if (failure || !callback) reject(failure ?? new Error("Codex could not discover OAuth. Check the local MCP and Supabase servers."));
      else accept(callback);
    });
  });
}

function localAdmin() {
  try {
    const cli = join(repo, "node_modules/supabase");
    const metadata = JSON.parse(readFileSync(join(cli, "package.json"), "utf8"));
    const status = JSON.parse(execFileSync(process.execPath, [join(cli, metadata.bin.supabase), "status", "-o", "json"], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
    const url = new URL(status.API_URL);
    check(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname), "Local Supabase required.");
    const key = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
    check(key, "Local backend key unavailable.");
    return createClient(url.origin, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  } catch { throw new Error("Start local Supabase and apply migrations before setup."); }
}

export async function setupLocalCodex({ name = "TAME Codex Local" } = {}) {
  const binary = await findCodex();
  const callbackUrl = await probeCallback(binary);
  const admin = localAdmin();
  const matches = [];
  for (let page = 1; page <= 20; page++) {
    const result = await admin.auth.admin.oauth.listClients({ page, perPage: 100 });
    check(!result.error, "Could not list OAuth clients. Check that the OAuth server is enabled.");
    const clients = Array.isArray(result.data.clients) ? result.data.clients
      : Object.entries(result.data).filter(([key]) => /^\d+$/.test(key)).map(([, value]) => value);
    check(clients.every(client => client && typeof client.client_id === "string"), "OAuth client listing returned an invalid response.");
    matches.push(...clients.filter(client => client.client_name === name));
    if (clients.length < 100) break;
    check(page < 20, "Too many OAuth clients to safely identify the local setup.");
  }
  check(matches.length <= 1, "Multiple local Codex clients share this name. Resolve duplicates before setup.");
  let client = matches[0];
  let created = false;
  if (!client) {
    const result = await admin.auth.admin.oauth.createClient({ client_name: name, redirect_uris: [callbackUrl], grant_types: ["authorization_code", "refresh_token"], token_endpoint_auth_method: "none" });
    check(!result.error && result.data, "Local Codex client registration failed.");
    client = result.data;
    created = true;
  }
  try {
    check(client.client_type === "public" && client.token_endpoint_auth_method === "none" && client.redirect_uris.includes(callbackUrl), "Existing client has different OAuth settings. It was not modified.");
    const stored = await admin.from("mcp_oauth_clients").select("resource_url,active").eq("client_id", client.client_id).maybeSingle();
    check(!stored.error, "MCP registry unavailable. Apply migrations first.");
    if (stored.data) check(stored.data.resource_url === resourceUrl && stored.data.active, "Existing MCP resource binding is different or disabled. It was not modified.");
    else check(!(await admin.from("mcp_oauth_clients").insert({ client_id: client.client_id, resource_url: resourceUrl })).error, "Could not register the MCP resource.");
    return { binary, clientId: client.client_id, callbackUrl, resourceUrl };
  } catch (error) { if (created) await admin.auth.admin.oauth.deleteClient(client.client_id); throw error; }
}

function shellQuote(value) { return "'" + value.replaceAll("'", "'\"'\"'") + "'"; }
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  setupLocalCodex().then(result => {
    console.info("Local Codex OAuth client ready. Add or replace this server's block in ~/.codex/config.toml:\n");
    console.info(`[mcp_servers.tame_local]\nurl = ${JSON.stringify(result.resourceUrl)}\n\n[mcp_servers.tame_local.oauth]\nclient_id = ${JSON.stringify(result.clientId)}\ncallback_url = ${JSON.stringify(result.callbackUrl)}\ncallback_port = 4321\n`);
    console.info(`Login command:\n${shellQuote(result.binary)} mcp login tame_local --scopes openid`);
    console.info("Your Codex config and OAuth credentials were not changed by this setup command.");
  }).catch(error => { console.error(error instanceof Error ? error.message : "Local setup failed."); process.exitCode = 1; });
}
