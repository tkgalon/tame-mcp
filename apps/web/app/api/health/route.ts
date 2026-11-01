import { healthResponseSchema } from "@tame/contracts";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(healthResponseSchema.parse({ status: "ok", service: "web" }));
}
