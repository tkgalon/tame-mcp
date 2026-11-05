import { getCore } from "../../../lib/core";
import { requireUser } from "../../../lib/session";
import { CollectionsView } from "./view";

export const dynamic = "force-dynamic";

export default async function CollectionsPage() {
  const user = await requireUser();
  const core = getCore();
  const collections = await core.collections.list(user.id);
  const documents = await Promise.all(
    collections.map((collection) => core.documents.list(user.id, collection.id)),
  );
  return (
    <CollectionsView
      collections={collections.map((collection, index) => ({
        id: collection.id,
        name: collection.name,
        documents: collection.documentCount,
        attention: documents[index]!.filter((document) => document.status !== "ready" || document.outdated)
          .length,
      }))}
    />
  );
}
