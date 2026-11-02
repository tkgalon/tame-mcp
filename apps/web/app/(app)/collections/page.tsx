import Link from "next/link";
import { CreateCollectionForm } from "../../../components/create-collection-form";
import { getCore } from "../../../lib/core";
import { requireUser } from "../../../lib/session";

export const dynamic = "force-dynamic";

export default async function CollectionsPage() {
  const user = await requireUser();
  const collections = await getCore().collections.list(user.id);
  return (
    <>
      <h1>Collections</h1>
      <p>A collection holds examples of one kind of document, for example your CTF write-ups.</p>
      <CreateCollectionForm />
      <section aria-labelledby="your-collections">
        <h2 id="your-collections">Your collections</h2>
        {collections.length === 0 ? (
          <p>No collections yet.</p>
        ) : (
          <ul>
            {collections.map((collection) => (
              <li key={collection.id}>
                <Link href={`/collections/${collection.id}`}>{collection.name}</Link> (
                {collection.documentCount} documents)
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
