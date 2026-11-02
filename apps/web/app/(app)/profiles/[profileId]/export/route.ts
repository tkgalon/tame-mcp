import type { NextRequest } from "next/server";
import { TameError } from "@tame/core";
import { z } from "zod";
import { getCore } from "../../../../../lib/core";
import { exportFilename, profileMarkdown } from "../../../../../lib/export";
import { getUser } from "../../../../../lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ profileId: string }> }) {
  const user = await getUser();
  if (!user) return new Response("Sign in to export profiles.", { status: 401 });
  const { profileId } = await params;
  if (!z.uuid().safeParse(profileId).success) return new Response("Profile not found.", { status: 404 });

  try {
    const exported = await getCore().profiles.export(user.id, profileId);
    const markdown = request.nextUrl.searchParams.get("format") === "markdown";
    const body = markdown ? profileMarkdown(exported) : `${JSON.stringify(exported, null, 2)}\n`;
    return new Response(body, {
      headers: {
        "Content-Type": markdown ? "text/markdown; charset=utf-8" : "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFilename(exported, markdown ? "md" : "json")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof TameError && error.code === "not_found")
      return new Response("Profile not found.", { status: 404 });
    throw error;
  }
}
