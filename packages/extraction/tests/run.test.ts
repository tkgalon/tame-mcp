import { describe, expect, it } from "vitest";
import { MAX_DOCUMENT_BYTES } from "@tame/contracts";
import { extractDocument, ExtractionRunError } from "../dist/index.js";

const encode = (value: string) => new TextEncoder().encode(value);

describe("extractDocument", () => {
  it("parses a document in a child process", async () => {
    const result = await extractDocument(encode("# Lab-07\n\nRingkasan Praktik\n"), "text/markdown");
    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.sections[0]?.heading).toBe("Lab-07");
  });

  it("reports unsupported media types without failing", async () => {
    const result = await extractDocument(encode("data"), "image/png");
    expect(result.status).toBe("unsupported");
  });

  it("rejects input above the size limit before spawning", async () => {
    const error = await extractDocument(new Uint8Array(MAX_DOCUMENT_BYTES + 1), "text/plain").catch(
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(ExtractionRunError);
    expect((error as ExtractionRunError).code).toBe("input_too_large");
  });

  it("stops a parser that runs past the timeout", async () => {
    const error = await extractDocument(encode("slow"), "text/plain", 1).catch((failure: unknown) => failure);
    expect((error as ExtractionRunError).code).toBe("parser_timeout");
  });
});
