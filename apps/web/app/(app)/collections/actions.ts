"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { failure } from "../../../lib/action";
import type { ActionState } from "../../../lib/action";
import { getCore } from "../../../lib/core";
import { requireUser } from "../../../lib/session";

const idFrom = (form: FormData, name: string) => String(form.get(name) ?? "");

export async function createCollection(_previous: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  let collectionId: string;
  try {
    collectionId = (await getCore().collections.create(user.id, String(form.get("name") ?? ""))).id;
  } catch (error) {
    return failure(error, "Unable to create the collection.");
  }
  redirect(`/collections/${collectionId}`);
}

export async function deleteCollection(form: FormData): Promise<void> {
  const user = await requireUser();
  await getCore().collections.remove(user.id, idFrom(form, "id"));
  redirect("/collections");
}

export type UploadTicket =
  { ok: true; documentId: string; url: string; contentType: string } | { ok: false; message: string };

export async function startUpload(
  collectionId: string,
  name: string,
  sizeBytes: number,
): Promise<UploadTicket> {
  const user = await requireUser();
  try {
    const core = getCore();
    const document = await core.documents.registerUpload(user.id, { collectionId, name, sizeBytes });
    const ticket = await core.documents.createUploadUrl(user.id, document.id);
    return { ok: true, documentId: document.id, ...ticket };
  } catch (error) {
    return { ok: false, message: failure(error, "Unable to start the upload.").message };
  }
}

export async function finishUpload(documentId: string): Promise<ActionState> {
  const user = await requireUser();
  try {
    const document = await getCore().documents.extract(user.id, documentId);
    revalidatePath(`/collections/${document.collectionId}`);
    return document.status === "ready"
      ? { status: "success", message: `${document.name} is ready.` }
      : { status: "error", message: `${document.name} could not be read (${document.status}).` };
  } catch (error) {
    return failure(error, "Unable to process the upload.");
  }
}

export async function retryExtraction(form: FormData): Promise<void> {
  const user = await requireUser();
  const document = await getCore().documents.extract(user.id, idFrom(form, "id"));
  revalidatePath(`/collections/${document.collectionId}`);
}

export async function deleteDocument(form: FormData): Promise<void> {
  const user = await requireUser();
  await getCore().documents.remove(user.id, idFrom(form, "id"));
  revalidatePath(`/collections/${idFrom(form, "collectionId")}`);
}
