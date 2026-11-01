import Link from "next/link";
import { requireUser } from "../../lib/auth/session";
import { listCollections } from "../../lib/collections/data";
import { readCollectionPage } from "../../lib/collections/schema";
import { CreateCollectionForm } from "../../components/create-collection-form";

export const dynamic = "force-dynamic";

export default async function CollectionsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const user = await requireUser();
  const page = readCollectionPage((await searchParams).page);
  const result = await listCollections(user.id, page).catch(() => null);

  return (
    <main>
      <p><Link href="/">Home</Link></p>
      <h1>Collections</h1>
      <CreateCollectionForm />
      <h2>Your collections</h2>
      {!result ? (
        <p role="alert">Unable to load collections. <Link href="/collections">Try again</Link>.</p>
      ) : result.items.length === 0 ? (
        <p>{page === 1 ? "No collections yet. Create one to get started." : "No collections on this page."}</p>
      ) : (
        <ul>
          {result.items.map(collection => <li key={collection.id}>{collection.name}</li>)}
        </ul>
      )}
      {result && (
        <nav aria-label="Collection pages">
          {page > 1 && <p><Link href={`/collections?page=${page - 1}`}>Previous page</Link></p>}
          {result.hasNextPage && <p><Link href={`/collections?page=${page + 1}`}>Next page</Link></p>}
        </nav>
      )}
    </main>
  );
}
