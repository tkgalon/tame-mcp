import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { permissionSchema } from "./auth.js";
import type { Principal } from "./auth.js";

export function createMcpServer(principal: Principal): McpServer {
  const server = new McpServer({ name: "tame-mcp", version: "0.0.0" }, { maxToolInputElements: 100 });
  server.registerTool("get_connection_info", {
    description: "Show the account and application permissions for this authenticated TAME connection.",
    inputSchema: z.strictObject({}),
    outputSchema: z.object({ ownerId: z.uuid(), clientId: z.uuid(), connectionId: z.uuid(), permissions: z.array(permissionSchema) }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    const result = { ownerId: principal.ownerId, clientId: principal.clientId, connectionId: principal.connectionId, permissions: principal.permissions };
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
  });
  return server;
}
