import { describe, expect, it } from "vitest";
import type { Core } from "@tame/core";
import { createMcpHandler } from "../mcp/handler";

const handler = createMcpHandler({
  core: {} as Core,
  verify: async () => null,
  siteUrl: "http://localhost:3000",
});

describe("createMcpHandler", () => {
  it("answers unauthenticated requests with the resource metadata location", async () => {
    const response = await handler(new Request("http://localhost:3000/mcp", { method: "POST" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      'Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/mcp"',
    );
  });
});
