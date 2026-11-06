import { describe, expect, it, vi } from "vitest";

const ping = vi.fn<() => Promise<void>>();
vi.mock("../lib/core", () => ({ getCore: () => ({ health: { ping } }) }));

const { GET } = await import("../app/api/health/route");

describe("GET /api/health", () => {
  it("reports ok when the database answers", async () => {
    ping.mockResolvedValueOnce(undefined);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 503 without details when the database fails", async () => {
    ping.mockRejectedValueOnce(new Error("connection refused at 10.0.0.1"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });
});
