import { healthResponseSchema } from "@tame/contracts";
import express from "express";
import type { Express } from "express";

export function createApp(): Express {
  const app = express();
  app.disable("x-powered-by");

  app.get("/healthz", (_request, response) => {
    response.json(healthResponseSchema.parse({ status: "ok", service: "mcp" }));
  });

  // The transport and OAuth are added together in the MCP integration milestone.
  // Keep the endpoint unavailable rather than accepting unauthenticated tools.
  app.all("/mcp", (_request, response) => {
    response.status(503).json({ error: "MCP transport is not configured yet." });
  });

  return app;
}
