import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workerDirectory = process.env.TAME_TEST_WORKER_DIR ?? join(repo, "apps/worker");
const requireWeb = createRequire(pathToFileURL(join(repo, "apps/web/package.json")));
const requireParsers = createRequire(pathToFileURL(join(repo, "packages/parsers/package.json")));
const { createClient } = requireWeb("@supabase/supabase-js");
const { PDFDocument, StandardFonts } = requireParsers("pdf-lib");
const { zipSync, strToU8 } = requireParsers("fflate");
const { createBackend, claimedJobSchema } = await import(pathToFileURL(join(workerDirectory, "dist/backend.js")).href);
const { processJob } = await import(pathToFileURL(join(workerDirectory, "dist/runner.js")).href);
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

function check(condition, message) { if (!condition) throw new Error(message); }
function localConfiguration() {
  try {
    const cli = join(repo, "node_modules/supabase");
    const metadata = JSON.parse(readFileSync(join(cli, "package.json"), "utf8"));
    const status = JSON.parse(execFileSync(process.execPath, [join(cli, metadata.bin.supabase), "status", "-o", "json"], {
      cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    }));
    const url = new URL(status.API_URL);
    check(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname), "Local Supabase required.");
    const publicKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
    const secretKey = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
    check(publicKey && secretKey, "Local keys unavailable.");
    return { supabaseUrl: url.origin, publicKey, secretKey, pollMs: 2000 };
  } catch { throw new Error("Start local Supabase and run db:migrate before testing. This test refuses hosted projects."); }
}

async function pdf(text) {
  const document = await PDFDocument.create();
  const page = document.addPage();
  if (text) page.drawText(text, { font: await document.embedFont(StandardFonts.Helvetica), x: 50, y: 700 });
  return Buffer.from(await document.save());
}
function docx() {
  return Buffer.from(zipSync({
    "[Content_Types].xml": strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    "_rels/.rels": strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    "word/document.xml": strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DOCX integration evidence</w:t></w:r></w:p></w:body></w:document>'),
  }));
}

async function run() {
  const config = localConfiguration();
  const admin = createClient(config.supabaseUrl, config.secretKey, clientOptions);
  const ownerClient = createClient(config.supabaseUrl, config.publicKey, clientOptions);
  const backend = createBackend(config);
  const paths = [];
  let userId;
  try {
    const email = `tame-worker-${randomUUID()}@example.invalid`;
    const password = `Tame-test-${randomUUID()}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    check(!created.error && created.data.user, "Could not create the temporary local user.");
    userId = created.data.user.id;
    check(!(await ownerClient.auth.signInWithPassword({ email, password })).error, "Temporary owner login failed.");
    const collection = await ownerClient.from("collections").insert({ name: "Worker integration" }).select("id").single();
    check(!collection.error && collection.data, "Temporary collection creation failed.");
    const fixtures = [
      { name: "example.txt", bytes: Buffer.from("Text integration evidence 😀"), status: "ready", contains: "Text integration evidence 😀" },
      { name: "example.md", bytes: Buffer.from("# Evidence\n\nMarkdown integration evidence"), status: "ready", contains: "Markdown integration evidence" },
      { name: "example.docx", bytes: docx(), status: "ready", contains: "DOCX integration evidence" },
      { name: "example.pdf", bytes: await pdf("PDF integration evidence"), status: "ready", contains: "PDF integration evidence" },
      { name: "blank.pdf", bytes: await pdf(null), status: "needs_ocr", errorCode: "no_extractable_text" },
      { name: "invalid.pdf", bytes: Buffer.from("%PDF-1.7\ninvalid fixture"), status: "failed", errorCode: "invalid_document" },
    ];
    for (const fixture of fixtures) {
      const registered = await ownerClient.rpc("register_document_upload", { p_collection_id: collection.data.id, p_name: fixture.name, p_size_bytes: fixture.bytes.byteLength });
      check(!registered.error && registered.data, "Document registration failed.");
      const document = registered.data;
      paths.push(document.storage_path);
      const upload = await ownerClient.storage.from("documents").upload(document.storage_path, fixture.bytes, { contentType: document.media_type, upsert: false });
      check(!upload.error, "Fixture Storage upload failed.");
      check(!(await ownerClient.rpc("complete_document_upload", { p_document_id: document.id })).error, "Fixture upload confirmation failed. Apply pending migrations first.");
      const queued = await admin.from("processing_jobs").select("*").eq("document_id", document.id).eq("status", "queued").single();
      check(!queued.error && queued.data, "Temporary job was not queued. Stop other workers before running this test.");
      // Claim only this test job so unrelated queued documents are never consumed
      const leased = await admin.from("processing_jobs").update({ status: "running", attempts: 1, lease_token: randomUUID(), lease_until: new Date(Date.now() + 120_000).toISOString() })
        .eq("id", queued.data.id).eq("status", "queued").select("*").single();
      check(!leased.error && leased.data, "Could not lease the temporary job.");
      const processing = await admin.from("documents").update({ status: "processing" }).eq("id", document.id).eq("status", "uploaded").select("id").single();
      check(!processing.error && processing.data, "Could not prepare the temporary processing state.");
      const job = claimedJobSchema.parse({ ...leased.data, storage_path: document.storage_path, media_type: document.media_type, size_bytes: document.size_bytes });
      check(await processJob(backend, job, new AbortController().signal) === "completed", "Worker did not persist the fixture result.");
      const persisted = await admin.from("documents").select("status,content_hash,parser_version,extraction_error_code").eq("id", document.id).single();
      check(!persisted.error && persisted.data?.status === fixture.status, "Unexpected persisted document state.");
      check(persisted.data.content_hash === createHash("sha256").update(fixture.bytes).digest("hex"), "Original file hash was not preserved.");
      check(persisted.data.extraction_error_code === (fixture.errorCode ?? null), "Unexpected extraction error code.");
      const sections = await ownerClient.from("document_sections").select("content,source_start,source_end").eq("document_id", document.id).order("ordinal");
      check(!sections.error, "Owner could not read extracted sections.");
      if (fixture.status === "ready") check(sections.data.map(section => section.content).join("").includes(fixture.contains), "Extracted evidence missing.");
      else check(sections.data.length === 0, "A failed or OCR result stored partial sections.");
      console.info(`PASS ${fixture.name}: ${fixture.status}`);
    }
  } finally {
    let cleanupFailed = false;
    if (paths.length) {
      try { cleanupFailed ||= Boolean((await admin.storage.from("documents").remove(paths)).error); }
      catch { cleanupFailed = true; }
    }
    if (userId) {
      try {
        const deleted = await admin.auth.admin.deleteUser(userId);
        cleanupFailed = Boolean(deleted.error) || cleanupFailed;
      } catch { cleanupFailed = true; }
    }
    await ownerClient.auth.signOut({ scope: "local" }).catch(() => {});
    check(!cleanupFailed, "Temporary fixture cleanup failed.");
  }
  console.info("Worker integration passed. Temporary fixtures removed. No general queue polling was started.");
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : "Worker integration failed.");
  process.exitCode = 1;
});
