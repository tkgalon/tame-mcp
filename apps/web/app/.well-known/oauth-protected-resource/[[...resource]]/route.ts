import { mcpResourceUrl, publicConfig } from "../../../../lib/env";

export const dynamic = "force-dynamic";

// MCP clients read this to find the Supabase authorization server before starting OAuth
export function GET() {
  const config = publicConfig();
  return Response.json(
    {
      resource: mcpResourceUrl(config),
      authorization_servers: [`${config.supabaseUrl}/auth/v1`],
      bearer_methods_supported: ["header"],
      resource_name: "TAME",
    },
    { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } },
  );
}
