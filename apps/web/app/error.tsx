"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main>
      <h1>Something went wrong</h1>
      <p>The action could not be completed. Try again, and check that the file or item still exists.</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
