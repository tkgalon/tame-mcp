import { z } from "zod";

export * from "./extraction.js";
export * from "./profile.js";
export * from "./profile-registry.js";

/** Reports process liveness without checking storage, OAuth, or MCP tools. */
export const healthResponseSchema = z.strictObject({
  status: z.literal("ok"),
  service: z.enum(["web", "mcp"]),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
