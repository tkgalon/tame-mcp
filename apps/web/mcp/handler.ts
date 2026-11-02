import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Core } from "@tame/core";
import type { TokenVerifier } from "./auth";
import { createMcpServer } from "./server";

type HandlerOptions = { core: Core; verify: TokenVerifier; siteUrl: string };

export const protectedResourceMetadataUrl = (siteUrl: string) =>
  `${siteUrl}/.well-known/oauth-protected-resource/mcp`;

// Stateless: every request is authenticated again and gets a fresh server, so revocation applies immediately
export function createMcpHandler({ core, verify, siteUrl }: HandlerOptions) {
  return async (request: Request): Promise<Response> => {
    const principal = await verify(request.headers.get("authorization"));
    if (!principal) {
      return Response.json(
        { error: "invalid_token" },
        {
          status: 401,
          headers: {
            "WWW-Authenticate": `Bearer resource_metadata="${protectedResourceMetadataUrl(siteUrl)}"`,
            "Cache-Control": "no-store",
          },
        },
      );
    }
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    const server = createMcpServer(core, principal);
    await server.connect(transport);
    try {
      return await transport.handleRequest(request);
    } finally {
      await server.close();
    }
  };
}
