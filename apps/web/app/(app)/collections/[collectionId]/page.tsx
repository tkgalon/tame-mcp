import { notFound } from "next/navigation";
import { z } from "zod";
import { TameError } from "@tame/core";
import { getCore } from "../../../../lib/core";
import { requireUser } from "../../../../lib/session";
import { CollectionView } from "./view";

export const dynamic = "force-dynamic";

export default async function CollectionPage({ params }: { params: Promise<{ collectionId: string }> }) {
  const user = await requireUser();
  const { collectionId } = await params;
  if (!z.uuid().safeParse(collectionId).success) notFound();
  const core = getCore();
  const collection = await core.collections.get(user.id, collectionId).catch((error: unknown) => {
    if (error instanceof TameError) notFound();
    throw error;
  });
  const documents = await core.documents.list(user.id, collection.id);
  return (
    <CollectionView
      collection={{ id: collection.id, name: collection.name }}
      documents={documents.map(({ id, name, sizeBytes, status, errorCode, outdated, style }) => ({
        id,
        name,
        sizeBytes,
        status,
        errorCode,
        outdated,
        style,
      }))}
    />
  );
}
