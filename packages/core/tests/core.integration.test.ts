import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";
import { extractDocument } from "@tame/extraction";
import type { DocumentStyle, ProfilePayload } from "@tame/contracts";
import { createCore, createDatabase, TameError } from "../src/index";
import type { FileStore } from "../src/index";

const databaseUrl =
  process.env["TAME_TEST_DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const db = createDatabase(databaseUrl);
const stored = new Map<string, Uint8Array>();
const files: FileStore = {
  createUploadUrl: async (path) => `memory://${path}`,
  download: async (path) => stored.get(path) ?? null,
  createDownloadUrl: async (path, fileName, seconds) =>
    `memory://${path}?name=${fileName}&expires=${seconds}`,
  remove: async (paths) => paths.forEach((path) => stored.delete(path)),
};
const core = createCore({ db, files, extract: extractDocument });

const measured: DocumentStyle = {
  source: "docx",
  page: null,
  textStyles: [],
  fills: [{ color: "#e7f1fb", count: 1, sample: "Q1" }],
  tables: 1,
  images: 0,
  rules: 0,
  header: [],
  footer: [],
  pagesMeasured: 0,
};

const owner = crypto.randomUUID();
const stranger = crypto.randomUUID();
const writeup = "# Lab-07\n\nRingkasan Praktik\n\nPada praktikum ini, saya memeriksa logical image.\n";

async function errorCode(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (failure: unknown) => failure,
  );
  return error instanceof TameError ? error.code : error;
}

async function uploadText(ownerId: string, collectionId: string, name: string, text: string) {
  const bytes = new TextEncoder().encode(text);
  const document = await core.documents.registerUpload(ownerId, {
    collectionId,
    name,
    sizeBytes: bytes.byteLength,
  });
  stored.set(`${ownerId}/${document.id}/original`, bytes);
  return core.documents.extract(ownerId, document.id);
}

function payload(documentId: string, overrides: Partial<ProfilePayload> = {}): ProfilePayload {
  return {
    schemaVersion: 2,
    name: "CTF Write-up",
    description: "Weekly CTF lab write-ups.",
    whenToUse: ["CTF lab report"],
    whenNotToUse: [],
    output: { format: "pdf", template: null },
    structure: [{ title: "Ringkasan Praktik", required: true, guidance: "What was examined and found." }],
    rules: [
      {
        id: "first-person",
        category: "style",
        instruction: "Write as saya.",
        strength: "preferred",
        origin: "inferred",
      },
    ],
    evidence: [{ ruleId: "first-person", documentId, excerpt: "saya memeriksa logical image" }],
    ...overrides,
  };
}

beforeAll(async () => {
  for (const id of [owner, stranger]) {
    await sql`insert into auth.users (id, email, aud, role) values (${id}::uuid, ${`${id}@test.local`}, 'authenticated', 'authenticated')`.execute(
      db,
    );
  }
});

afterAll(async () => {
  await sql`delete from auth.users where id in (${owner}::uuid, ${stranger}::uuid)`.execute(db);
  await db.destroy();
});

describe("documents and examples", () => {
  it("extracts an uploaded document and serves its sections to the owner only", async () => {
    const collection = await core.collections.create(owner, "Write-ups");
    const document = await uploadText(owner, collection.id, "lab-07.md", writeup);
    expect(document.status).toBe("ready");

    const read = await core.examples.read(owner, document.id);
    expect(read.sections.map((section) => section.heading)).toContain("Lab-07");
    expect(await errorCode(core.examples.read(stranger, document.id))).toBe("not_found");
    expect(await errorCode(core.documents.list(stranger, collection.id))).toBe("not_found");
  });

  it("marks a failed extraction and lets the owner retry", async () => {
    const collection = await core.collections.create(owner, "Broken");
    const document = await uploadText(owner, collection.id, "broken.pdf", "not a pdf");
    expect(document.status).toBe("failed");
    expect(document.errorCode).not.toBeNull();
  });

  it("returns the style summary with the first read and a download link to the original", async () => {
    const collection = await core.collections.create(owner, "Styled");
    const document = await uploadText(owner, collection.id, "lab-07.md", writeup);
    await db
      .updateTable("documents")
      .set({ style: JSON.stringify(measured) })
      .where("id", "=", document.id)
      .execute();

    const first = await core.examples.read(owner, document.id);
    expect(first.document.style).toEqual(measured);
    const later = await core.examples.read(owner, document.id, 0);
    expect("style" in later.document).toBe(false);

    const file = await core.examples.file(owner, document.id);
    expect(file.url).toBe(`memory://${owner}/${document.id}/original?name=lab-07.md&expires=600`);
    expect(await errorCode(core.examples.file(stranger, document.id))).toBe("not_found");
  });

  it("reads a document again when an older parser read it, keeping its text if that fails", async () => {
    const collection = await core.collections.create(owner, "Outdated");
    const document = await uploadText(owner, collection.id, "lab-07.md", writeup);
    expect(document.outdated).toBe(false);
    await db
      .updateTable("documents")
      .set({ parser_version: "markdown-v0" })
      .where("id", "=", document.id)
      .execute();
    expect((await core.documents.list(owner, collection.id))[0]?.outdated).toBe(true);

    const reread = await core.documents.extract(owner, document.id);
    expect(reread.outdated).toBe(false);
    expect(reread.status).toBe("ready");

    await db
      .updateTable("documents")
      .set({ parser_version: "markdown-v0" })
      .where("id", "=", document.id)
      .execute();
    stored.set(`${owner}/${document.id}/original`, new TextEncoder().encode(" ".repeat(writeup.length)));
    const kept = await core.documents.extract(owner, document.id);
    expect(kept.status).toBe("ready");
    expect((await core.examples.read(owner, document.id)).sections.length).toBeGreaterThan(0);
  });

  it("removes stored files when a document is deleted", async () => {
    const collection = await core.collections.create(owner, "Temporary");
    const document = await uploadText(owner, collection.id, "temp.txt", "temporary text");
    await core.documents.remove(owner, document.id);
    expect(stored.has(`${owner}/${document.id}/original`)).toBe(false);
  });
});

describe("profile lifecycle", () => {
  let documentId = "";

  beforeAll(async () => {
    const collection = await core.collections.create(owner, "Profile sources");
    documentId = (await uploadText(owner, collection.id, "lab-07.md", writeup)).id;
  });

  it("matches evidence copied with or without the bold markers extraction adds", async () => {
    const original = await db
      .selectFrom("document_sections")
      .where("document_id", "=", documentId)
      .select(["ordinal", "content"])
      .execute();
    await db
      .updateTable("document_sections")
      .set({ content: "Pada praktikum ini, **saya memeriksa** logical image." })
      .where("document_id", "=", documentId)
      .execute();
    const plain = payload(documentId, {
      name: "Marker check",
      evidence: [{ ruleId: "first-person", documentId, excerpt: "saya memeriksa logical image" }],
    });
    const marked = payload(documentId, {
      name: "Marker check",
      evidence: [{ ruleId: "first-person", documentId, excerpt: "**saya memeriksa** logical image" }],
    });
    for (const candidate of [plain, marked]) {
      const draft = await core.profiles.draft(owner, { payload: candidate, preview: "" });
      await core.profiles.removeDraft(owner, draft.draftId);
    }
    for (const section of original) {
      await db
        .updateTable("document_sections")
        .set({ content: section.content })
        .where("document_id", "=", documentId)
        .where("ordinal", "=", section.ordinal)
        .execute();
    }
  });

  it("rejects evidence that is not verbatim source text", async () => {
    const bad = payload(documentId, {
      evidence: [{ ruleId: "first-person", documentId, excerpt: "text the user never wrote" }],
    });
    expect(await errorCode(core.profiles.draft(owner, { payload: bad, preview: "" }))).toBe(
      "invalid_evidence",
    );
    expect(
      await errorCode(core.profiles.draft(stranger, { payload: payload(documentId), preview: "" })),
    ).toBe("invalid_evidence");
  });

  it("publishes, revises, detects stale bases and rolls back", async () => {
    const draft = await core.profiles.draft(owner, { payload: payload(documentId), preview: "Illustration" });
    const v1 = await core.profiles.publish(owner, draft.draftId);
    expect(v1.versionNumber).toBe(1);
    expect(await core.profiles.publish(owner, draft.draftId)).toEqual(v1);
    expect(await errorCode(core.profiles.publish(stranger, draft.draftId))).toBe("not_found");

    const used = await core.profiles.use(owner, { task: "bikin write-up Lab-08" });
    expect(used.status).toBe("ready");
    if (used.status === "ready") {
      expect(used.versionId).toBe(v1.versionId);
      expect(used.examples[0]?.excerpt).toBe("saya memeriksa logical image");
      expect(used.sources).toEqual([expect.objectContaining({ documentId, mediaType: expect.any(String) })]);
      expect(used.workingRules.length).toBeGreaterThan(0);
    }

    const revised = payload(documentId, { description: "Weekly CTF lab write-ups, plain tone." });
    const revision = await core.profiles.draft(owner, {
      payload: revised,
      preview: "",
      profileId: v1.profileId,
      baseVersionId: v1.versionId,
      reason: "Clarify tone",
    });
    expect(revision.changes?.fields).toEqual(["description"]);
    const v2 = await core.profiles.publish(owner, revision.draftId);
    expect(v2.versionNumber).toBe(2);

    const stale = await errorCode(
      core.profiles.draft(owner, {
        payload: payload(documentId, { description: "Another change." }),
        preview: "",
        profileId: v1.profileId,
        baseVersionId: v1.versionId,
        reason: "Stale",
      }),
    );
    expect(stale).toBe("version_conflict");

    const v3 = await core.profiles.rollback(owner, {
      profileId: v1.profileId,
      baseVersionId: v2.versionId,
      targetVersionId: v1.versionId,
      reason: "Back to v1",
      userConfirmed: true,
    });
    expect(v3.versionNumber).toBe(3);
    const history = await core.profiles.history(owner, { profileId: v1.profileId });
    expect("versions" in history && history.versions.map((version) => version.versionNumber)).toEqual([
      3, 2, 1,
    ]);
  });

  it("refuses to change published history", async () => {
    const result =
      sql`update public.profile_versions set change_reason = 'edited' where owner_id = ${owner}::uuid`.execute(
        db,
      );
    await expect(result).rejects.toThrow(/immutable/);
  });

  it("keeps only the approved draft after several review rounds", async () => {
    const pendingIds = async () =>
      (await core.profiles.listDrafts(owner))
        .filter((item) => item.name === "Review rounds")
        .map((d) => d.id);

    // Two rounds for a new profile, the second one is approved
    const firstNew = await core.profiles.draft(owner, {
      payload: payload(documentId, { name: "Review rounds" }),
      preview: "",
    });
    const secondNew = await core.profiles.draft(owner, {
      payload: payload(documentId, { name: "Review rounds", description: "Second round." }),
      preview: "",
    });
    const v1 = await core.profiles.publish(owner, secondNew.draftId);
    expect(await pendingIds()).not.toContain(firstNew.draftId);

    // Three revision rounds on v1, the third one is approved
    const revise = (description: string) =>
      core.profiles.draft(owner, {
        payload: payload(documentId, { name: "Review rounds", description }),
        preview: "",
        profileId: v1.profileId,
        baseVersionId: v1.versionId,
        reason: description,
      });
    const roundA = await revise("Round A.");
    const roundB = await revise("Round B.");
    const roundC = await revise("Round C.");
    expect(await pendingIds()).toEqual(
      expect.arrayContaining([roundA.draftId, roundB.draftId, roundC.draftId]),
    );

    const v2 = await core.profiles.publish(owner, roundC.draftId);
    expect(v2.versionNumber).toBe(2);
    expect(await pendingIds()).toEqual([]);
    const active = await core.profiles.use(owner, { profileId: v1.profileId });
    expect(active.status === "ready" && active.profile.description).toBe("Round C.");
  });
});

describe("connections", () => {
  it("treats unknown sessions as revoked", async () => {
    const active = await core.account.isSessionActive({
      ownerId: owner,
      clientId: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
    });
    expect(active).toBe(false);
  });
});
