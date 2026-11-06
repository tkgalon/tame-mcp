import { getCore } from "../../../lib/core";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

// Touches the database, so the deploy smoke test and the keep-alive job both prove it answers
export async function GET() {
  try {
    await getCore().health.ping();
    return Response.json({ status: "ok" }, { headers: noStore });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers: noStore });
  }
}
