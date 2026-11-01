export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16 sm:px-12">
      <p className="mb-6 text-sm font-medium uppercase tracking-[0.2em] text-neutral-500">
        Teach Agents My Examples
      </p>
      <h1 className="text-5xl font-semibold tracking-tight sm:text-7xl">TAME-MCP</h1>
      <p className="mt-6 max-w-2xl text-xl leading-relaxed text-neutral-600 sm:text-2xl">
        Turn examples into reusable AI task profiles.
      </p>
      <div className="mt-12 border-t border-neutral-200 pt-6">
        <p className="text-sm font-medium">In development</p>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-neutral-500">
          Document collections and task profiles are coming next.
        </p>
      </div>
    </main>
  );
}
