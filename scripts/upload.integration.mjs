import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDirectory = process.env.TAME_TEST_WEB_DIR ?? join(repo, "apps/web");
const require = createRequire(pathToFileURL(join(repo, "apps/web/package.json")));
const { createClient } = require("@supabase/supabase-js");
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const workerDirectory = process.env.TAME_TEST_WORKER_DIR ?? join(repo, "apps/worker");
const { createBackend, claimedJobSchema } = await import(pathToFileURL(join(workerDirectory, "dist/backend.js")).href);
const { processJob } = await import(pathToFileURL(join(workerDirectory, "dist/runner.js")).href);

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function localConfiguration() {
  try {
    const packageDirectory = join(repo, "node_modules/supabase");
    const cliPackage = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"));
    const executable = join(packageDirectory, cliPackage.bin.supabase);
    const status = JSON.parse(execFileSync(process.execPath, [executable, "status", "-o", "json"], {
      cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    }));
    const url = new URL(status.API_URL);
    check(["127.0.0.1", "localhost"].includes(url.hostname), "Only loopback Supabase is allowed.");
    const publicKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
    const adminKey = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
    check(publicKey && adminKey, "Local keys unavailable.");
    return { url: url.origin, publicKey, adminKey };
  } catch {
    throw new Error("Start local Supabase and run db:migrate before testing. Hosted projects are not supported by this test.");
  }
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function hiddenFormFields(html) {
  const form = html.match(/<form\b[^>]*>[\s\S]*?<\/form>/)?.[0];
  check(form, "The login form is unavailable.");
  const decode = value => value.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&amp;", "&");
  const data = new FormData();
  for (const input of form.matchAll(/<input\b[^>]*>/g)) {
    const attributes = Object.fromEntries([...input[0].matchAll(/([\w$:-]+)="([^"]*)"/g)].map(match => [match[1], decode(match[2])]));
    if (attributes.type === "hidden" && attributes.name) data.append(attributes.name, attributes.value ?? "");
  }
  return data;
}

async function run() {
  await access(join(webDirectory, ".next/BUILD_ID")).catch(() => {
    throw new Error("Build the web app before testing with pnpm --filter @tame/web build.");
  });
  const config = localConfiguration();
  const admin = createClient(config.url, config.adminKey, clientOptions);
  const publicClient = createClient(config.url, config.publicKey, clientOptions);
  const createdUsers = [];
  const uploadedPaths = [];
  const cookieJar = new Map();
  const site = `http://127.0.0.1:${await availablePort()}`;
  let web;
  let exited = false;

  function captureCookies(response) {
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0];
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (!value || /max-age=0/i.test(cookie)) cookieJar.delete(name);
      else cookieJar.set(name, value);
    }
  }

  async function endpoint(path, { method = "GET", body, origin = site, authenticated = true } = {}) {
    const response = await fetch(site + path, {
      method, redirect: "manual",
      headers: {
        ...(method === "POST" ? { Origin: origin } : {}),
        ...(authenticated ? { Cookie: [...cookieJar].map(([name, value]) => `${name}=${value}`).join("; ") } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    captureCookies(response);
    return response;
  }

  async function expectResponse(response, expected, operation) {
    check(response.status === expected, `${operation}: expected HTTP ${expected}, received ${response.status}.`);
    check(response.headers.get("Cache-Control")?.includes("no-store"), `${operation}: cache protection missing.`);
    return response.json();
  }

  async function login(user, password) {
    cookieJar.clear();
    const form = hiddenFormFields(await (await fetch(`${site}/login`)).text());
    form.set("email", user.email);
    form.set("password", password);
    const response = await fetch(`${site}/login`, { method: "POST", headers: { Origin: site }, body: form, redirect: "manual" });
    captureCookies(response);
    check(response.status === 303, "Web session login failed.");
  }

  try {
    const suffix = randomUUID();
    const password = `Tame-test-${randomUUID()}`;
    for (const label of ["a", "b"]) {
      const email = `tame-upload-${label}-${suffix}@example.invalid`;
      const result = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      check(!result.error && result.data.user, "Could not create a temporary local user.");
      createdUsers.push({ id: result.data.user.id, email });
    }

    const ownerClient = createClient(config.url, config.publicKey, clientOptions);
    const session = await ownerClient.auth.signInWithPassword({ email: createdUsers[0].email, password });
    check(!session.error, "Could not create the temporary owner session.");
    const collection = await ownerClient.from("collections").insert({ owner_id: createdUsers[0].id, name: `Upload integration ${suffix}` }).select("id").single();
    check(!collection.error && collection.data, "Could not create the temporary collection.");
    const collectionId = collection.data.id;

    web = spawn(process.execPath, [join(repo, "apps/web/node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", new URL(site).port], {
      cwd: webDirectory,
      env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: config.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.publicKey, TAME_SITE_URL: site },
      stdio: "ignore",
    });
    web.on("exit", () => { exited = true; });
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      check(!exited, "The integration web server exited during startup.");
      try {
        if ((await fetch(`${site}/api/health`)).ok) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    check(ready, "The integration web server did not become ready.");

    await expectResponse(await endpoint(`/api/collections/${collectionId}/documents`, { authenticated: false }), 401, "Anonymous access");
    await login(createdUsers[0], password);
    const collectionListPage = await endpoint("/collections");
    check(collectionListPage.ok && (await collectionListPage.text()).includes(`href="/collections/${collectionId}"`), "Collection name is not a navigable link.");
    const collectionPage = await endpoint(`/collections/${collectionId}`);
    const collectionHtml = await collectionPage.text();
    check(collectionPage.ok && collectionHtml.includes('type="file"') && collectionHtml.includes("Upload document") && collectionHtml.includes("No documents yet"), "Collection page did not expose the upload form and empty state.");
    const source = Array.from({ length: 12 }, (_, ordinal) => `# Evidence ${ordinal}\n\nFinding ${ordinal} 😀\n`).join("\n");
    const bytes = new TextEncoder().encode(source);
    const registered = await expectResponse(await endpoint(`/api/collections/${collectionId}/uploads`, { method: "POST", body: { name: "writeup.md", sizeBytes: bytes.length } }), 201, "Register upload");
    const documentId = registered.document.id;
    await expectResponse(await endpoint(`/api/documents/${documentId}`, { authenticated: false }), 401, "Anonymous detail access");
    await expectResponse(await endpoint(`/api/documents/${documentId}/sections`, { authenticated: false }), 401, "Anonymous section access");
    const pending = await expectResponse(await endpoint(`/api/documents/${documentId}`), 200, "Pending document detail");
    check(pending.document.status === "uploading" && pending.document.extraction_version === 1, "Pending extraction metadata missing.");
    check(!("owner_id" in pending.document) && !("storage_path" in pending.document), "Private document fields leaked.");
    await expectResponse(await endpoint(`/api/documents/${documentId}/sections`), 409, "Pending sections unavailable");
    uploadedPaths.push(`${createdUsers[0].id}/${documentId}/original`);
    const ticket = await expectResponse(await endpoint(`/api/documents/${documentId}/upload-url`, { method: "POST" }), 200, "Sign upload");
    check(ticket.upload.path === uploadedPaths[0] && ticket.upload.contentType === "text/markdown", "Incorrect upload target or type.");
    await expectResponse(await endpoint(`/api/documents/${documentId}/complete`, { method: "POST" }), 404, "Confirm missing object");
    const transfer = await publicClient.storage.from("documents").uploadToSignedUrl(ticket.upload.path, ticket.upload.token, new Blob([bytes], { type: ticket.upload.contentType }), { contentType: ticket.upload.contentType });
    check(!transfer.error, "Direct Storage transfer failed.");
    for (let retry = 0; retry < 2; retry++) {
      const confirmed = await expectResponse(await endpoint(`/api/documents/${documentId}/complete`, { method: "POST" }), 200, "Confirm stored upload");
      check(confirmed.document.status === "uploaded", "Confirmation returned an unexpected state.");
    }
    const list = await expectResponse(await endpoint(`/api/collections/${collectionId}/documents`), 200, "Document list");
    check(list.items.length === 1 && list.items[0].id === documentId && list.items[0].status === "uploaded", "The stored document is not visible in its collection.");
    const uploadedPage = await endpoint(`/collections/${collectionId}`);
    const uploadedHtml = await uploadedPage.text();
    check(uploadedPage.ok && uploadedHtml.includes("writeup.md") && uploadedHtml.includes("Waiting for extraction"), "Collection page did not show the uploaded document status.");
    await expectResponse(await endpoint(`/api/documents/${documentId}/upload-url`, { method: "POST" }), 409, "Closed upload");
    await expectResponse(await endpoint(`/api/documents/${documentId}/complete`, { method: "POST", origin: "https://evil.example" }), 403, "Cross-origin request");
    console.info("PASS: registration, signed Storage transfer, confirmation retry, listing, and origin checks");

    // Scope the worker fixture to this document without polling unrelated queued jobs
    const queued = await admin.from("processing_jobs").select("id").eq("document_id", documentId).eq("status", "queued").single();
    check(!queued.error && queued.data, "Fixture job not queued. Apply migrations and stop other workers before testing.");
    const leased = await admin.from("processing_jobs").update({ status: "running", attempts: 1, lease_token: randomUUID(), lease_until: new Date(Date.now() + 120000).toISOString() })
      .eq("id", queued.data.id).eq("status", "queued").select("*").single();
    check(!leased.error && leased.data, "Could not lease the document fixture.");
    const processing = await admin.from("documents").update({ status: "processing" }).eq("id", documentId).eq("status", "uploaded").select("id").single();
    check(!processing.error && processing.data, "Could not prepare the document fixture.");
    const claimed = claimedJobSchema.parse({ ...leased.data, storage_path: uploadedPaths[0], media_type: "text/markdown", size_bytes: bytes.length });
    const backend = createBackend({ supabaseUrl: config.url, secretKey: config.adminKey, pollMs: 2000 });
    check(await processJob(backend, claimed, new AbortController().signal) === "completed", "Fixture worker processing failed.");
    const detail = await expectResponse(await endpoint(`/api/documents/${documentId}`), 200, "Ready document detail");
    check(detail.document.status === "ready" && detail.document.parser_version === "markdown-v1", "Ready extraction metadata missing.");
    const first = await expectResponse(await endpoint(`/api/documents/${documentId}/sections?version=1`), 200, "First section page");
    check(first.items.length === 10 && first.nextAfter === 9 && first.extractionVersion === 1, "First section page is not bounded.");
    const second = await expectResponse(await endpoint(`/api/documents/${documentId}/sections?version=1&after=${first.nextAfter}`), 200, "Second section page");
    check(second.items.length === 2 && second.nextAfter === null && second.extractionVersion === 1, "Section continuation failed.");
    const sections = [...first.items, ...second.items];
    check(sections.map(section => section.content).join("") === source, "Section pagination lost or duplicated source content.");
    check(sections.every((section, ordinal) => section.ordinal === ordinal && !("owner_id" in section)), "Section identity or private-field filtering failed.");
    await expectResponse(await endpoint(`/api/documents/${documentId}/sections?version=2`), 409, "Stale extraction version");
    await expectResponse(await endpoint(`/api/documents/${documentId}/sections?after=9`), 400, "Unversioned continuation");
    console.info("PASS: worker extraction, private metadata, and versioned section pagination");

    const mismatch = await expectResponse(await endpoint(`/api/collections/${collectionId}/uploads`, { method: "POST", body: { name: "mismatch.md", sizeBytes: bytes.length + 1 } }), 201, "Register size mismatch");
    uploadedPaths.push(`${createdUsers[0].id}/${mismatch.document.id}/original`);
    const secondTicket = await expectResponse(await endpoint(`/api/documents/${mismatch.document.id}/upload-url`, { method: "POST" }), 200, "Sign mismatch fixture");
    // Exercise raw PUT as well as the SDK transfer path
    const rawTransfer = await fetch(secondTicket.upload.signedUrl, { method: "PUT", headers: { "Content-Type": secondTicket.upload.contentType }, body: bytes });
    check(rawTransfer.ok, "Raw signed PUT transfer failed.");
    await expectResponse(await endpoint(`/api/documents/${mismatch.document.id}/complete`, { method: "POST" }), 409, "Reject metadata mismatch");

    await login(createdUsers[1], password);
    const forbiddenPage = await endpoint(`/collections/${collectionId}`);
    const forbiddenHtml = await forbiddenPage.text();
    check(forbiddenHtml.includes("This page could not be found") && !forbiddenHtml.includes(`Upload integration ${suffix}`), "Collection page exposed another account's collection.");
    await expectResponse(await endpoint(`/api/collections/${collectionId}/documents`), 404, "Cross-owner document list");
    await expectResponse(await endpoint(`/api/documents/${documentId}/upload-url`, { method: "POST" }), 404, "Cross-owner signing");
    await expectResponse(await endpoint(`/api/documents/${documentId}/complete`, { method: "POST" }), 404, "Cross-owner confirmation");
    await expectResponse(await endpoint(`/api/documents/${documentId}`), 404, "Cross-owner document detail");
    await expectResponse(await endpoint(`/api/documents/${documentId}/sections?version=1`), 404, "Cross-owner sections");
    console.info("PASS: raw PUT, size mismatch rejection, and second-account isolation");
  } finally {
    if (web && !exited) { web.kill("SIGTERM"); await once(web, "exit"); }
    let cleanupFailed = false;
    if (uploadedPaths.length) {
      try {
        const removed = await admin.storage.from("documents").remove(uploadedPaths);
        cleanupFailed ||= Boolean(removed.error);
      } catch { cleanupFailed = true; }
    }
    for (const user of createdUsers) {
      try {
        const removed = await admin.auth.admin.deleteUser(user.id);
        cleanupFailed ||= Boolean(removed.error);
      } catch { cleanupFailed = true; }
    }
    check(!cleanupFailed, "Temporary resource cleanup failed. Inspect the local integration test resources.");
    console.info("Temporary test resources cleaned up");
  }
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : "Upload integration test failed.");
  process.exitCode = 1;
});
