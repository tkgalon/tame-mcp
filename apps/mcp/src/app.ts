import { healthResponseSchema } from "@tame/contracts";
import express from "express";
import type { ErrorRequestHandler, Express } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AuthFailure, createAuthenticator } from "./auth.js";
import type { Authenticator, Principal } from "./auth.js";
import { readMcpConfig } from "./config.js";
import type { McpConfig } from "./config.js";
import { createGrantResolver } from "./grants.js";
import { createMcpServer } from "./server.js";

export function createApp(options: { config?: McpConfig | null; authenticate?: Authenticator } = {}): Express {
  const app = express();
  app.disable("x-powered-by");
  const config = options.config === undefined ? readMcpConfig() : options.config;
  const authenticate = config ? options.authenticate ?? createAuthenticator(config, createGrantResolver(config)) : null;
  const resource = config ? new URL(config.resourceUrl) : null;
  const metadataUrl = resource ? `${resource.origin}/.well-known/oauth-protected-resource/mcp` : null;
  app.use((_request, response, next) => { response.set("Cache-Control", "no-store"); next(); });
  app.get("/healthz", (_request, response) => {
    response.json(healthResponseSchema.parse({ status: "ok", service: "mcp" }));
  });
  app.get(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"], (_request, response) => {
    if (!config) { response.status(503).json({ error: "auth_unavailable" }); return; }
    response.set("Access-Control-Allow-Origin", "*").json({
      resource: config.resourceUrl, authorization_servers: [`${config.supabaseUrl}/auth/v1`],
      bearer_methods_supported: ["header"], scopes_supported: ["openid"], resource_name: "TAME-MCP",
    });
  });
  app.use("/mcp", (request, response, next) => {
    if (!config || !resource) { response.status(503).json({ error: "auth_unavailable" }); return; }
    if (request.get("host") !== resource.host) { response.status(403).json({ error: "invalid_host" }); return; }
    const origin = request.get("origin");
    if (origin && ![resource.origin, ...config.allowedOrigins].includes(origin)) {
      response.status(403).json({ error: "invalid_origin" }); return;
    }
    if (origin) {
      response.set("Access-Control-Allow-Origin", origin).vary("Origin");
      response.set("Access-Control-Expose-Headers", "WWW-Authenticate, MCP-Protocol-Version");
    }
    if (request.method === "OPTIONS") {
      response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      response.set("Access-Control-Allow-Headers", "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID");
      response.status(204).end(); return;
    }
    next();
  });
  app.use("/mcp", async (request, response, next) => {
    try {
      const authorizationHeaders = request.rawHeaders.filter((_, index, headers) => index % 2 === 0 && headers[index]?.toLowerCase() === "authorization");
      if (authorizationHeaders.length > 1) throw new AuthFailure(401, "invalid_token");
      response.locals["principal"] = await authenticate!(request.get("authorization"));
      next();
    } catch (error) {
      const failure = error instanceof AuthFailure ? error : new AuthFailure(503, "auth_unavailable");
      if (failure.status === 401) response.set("WWW-Authenticate", `Bearer resource_metadata="${metadataUrl}", error="invalid_token"`);
      response.status(failure.status).json({ error: failure.code });
    }
  });
  app.post("/mcp", express.json({ limit: "64kb" }), async (request, response) => {
    const server = createMcpServer(response.locals["principal"] as Principal);
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    response.once("close", () => { void server.close().catch(() => {}); });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch {
      await server.close().catch(() => {});
      if (!response.headersSent) response.status(500).json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "The MCP request could not be completed." } });
    }
  });
  app.all("/mcp", (_request, response) => { response.set("Allow", "POST, OPTIONS").status(405).end(); });
  const handleError: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    const type = typeof error === "object" && error !== null && "type" in error ? error.type : null;
    response.status(type === "entity.too.large" ? 413 : 400).json({ error: type === "entity.too.large" ? "body_too_large" : "invalid_request" });
  };
  app.use(handleError);
  return app;
}
