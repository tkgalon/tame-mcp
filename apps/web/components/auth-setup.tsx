export function AuthSetup() {
  return (
    <section aria-labelledby="setup-title">
      <h2 id="setup-title">Authentication setup required</h2>
      <p>Configure this installation before signing in.</p>
      <ol>
        <li>Copy <code>apps/web/.env.example</code> to <code>apps/web/.env.local</code>.</li>
        <li>Set the Supabase URL, publishable key, and site URL for this installation.</li>
        <li>Restart the web server.</li>
      </ol>
      <p>A publishable key or legacy anon key is supported. Do not use a service-role or secret key.</p>
    </section>
  );
}
