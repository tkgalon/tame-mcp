import { TameError } from "@tame/core";
import { z } from "zod";
import { getCore } from "../../../../../lib/core";
import { exportFilename } from "../../../../../lib/export";
import { getUser } from "../../../../../lib/session";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ profileId: string }> }) {
  const user = await getUser();
  if (!user) return new Response("Sign in to download templates.", { status: 401 });
  const { profileId } = await params;
  if (!z.uuid().safeParse(profileId).success) return new Response("Profile not found.", { status: 404 });

  try {
    const exported = await getCore().profiles.export(user.id, profileId);
    const template = exported.payload.output.template;
    if (!template) return new Response("This profile has no template yet.", { status: 404 });
    return new Response(template.endsWith("\n") ? template : `${template}\n`, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFilename(exported, "typ")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof TameError && error.code === "not_found")
      return new Response("Profile not found.", { status: 404 });
    throw error;
  }
}
