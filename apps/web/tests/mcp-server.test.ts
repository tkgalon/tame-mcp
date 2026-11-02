import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Core } from "@tame/core";
import { describe, expect, it, vi } from "vitest";
import { DRAFT_NEXT_STEP, SERVER_INSTRUCTIONS, createMcpServer } from "../mcp/server";

const principal = {
  ownerId: "11111111-1111-4111-8111-111111111111",
  clientId: "22222222-2222-4222-8222-222222222222",
  sessionId: "33333333-3333-4333-8333-333333333333",
};

const payload = {
  schemaVersion: 2,
  name: "CTF Write-up",
  description: "Weekly lab reports.",
  whenToUse: ["CTF lab"],
  whenNotToUse: [],
  output: { format: "pdf", template: null },
  structure: [],
  rules: [
    {
      id: "plain-tone",
      category: "style",
      instruction: "Plain tone.",
      strength: "preferred",
      origin: "user_stated",
    },
  ],
  evidence: [],
};

async function connect(core: Partial<Core>) {
  const server = createMcpServer(core as Core, principal);
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("draft_profile", () => {
  it("returns the review guidance with every draft", async () => {
    const draft = vi.fn(async () => ({
      draftId: "44444444-4444-4444-8444-444444444444",
      profileId: null,
      changes: null,
      preview: "",
    }));
    const client = await connect({ profiles: { draft } as unknown as Core["profiles"] });

    const result = await client.callTool({ name: "draft_profile", arguments: { payload, preview: "" } });

    expect(draft).toHaveBeenCalledOnce();
    expect(result.structuredContent).toMatchObject({ status: "not_active", nextStep: DRAFT_NEXT_STEP });
    expect(DRAFT_NEXT_STEP).toContain('reply "oke"');
    expect(DRAFT_NEXT_STEP).toContain("removed rule");
    expect(DRAFT_NEXT_STEP).toContain("Any clear approval counts");
    expect(DRAFT_NEXT_STEP).toContain("still asks for changes is not approval");
  });
});

describe("server instructions", () => {
  it("tell agents to follow nextStep even when asked to update", async () => {
    const client = await connect({});
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    expect(SERVER_INSTRUCTIONS).toContain("follow the nextStep");
  });
});
