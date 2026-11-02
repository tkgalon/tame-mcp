import { getCore } from "../../lib/core";
import { mcpResourceUrl, publicConfig } from "../../lib/env";
import { createTokenVerifier } from "../../mcp/auth";
import { createMcpHandler } from "../../mcp/handler";

export const dynamic = "force-dynamic";

let handler: ((request: Request) => Promise<Response>) | undefined;

function getHandler() {
  if (!handler) {
    const config = publicConfig();
    const core = getCore();
    handler = createMcpHandler({
      core,
      siteUrl: config.siteUrl,
      verify: createTokenVerifier({
        supabaseUrl: config.supabaseUrl,
        // Supabase sets aud to "authenticated" even when the client sends a resource parameter.
        // The resource URL is accepted too in case Supabase starts binding tokens to it.
        audiences: [mcpResourceUrl(config), "authenticated"],
        isSessionActive: (principal) => core.account.isSessionActive(principal),
      }),
    });
  }
  return handler;
}

export const POST = (request: Request) => getHandler()(request);
export const GET = (request: Request) => getHandler()(request);
export const DELETE = (request: Request) => getHandler()(request);
