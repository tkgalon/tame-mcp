// Closing line: the cable runs across the page and plugs into the Sign in button
export function LandingOutro() {
  return (
    <footer className="end">
      <section className="outro rv" aria-labelledby="outro-h">
        <h2 id="outro-h">
          {"Your examples become "}
          <span className="muted">reusable context.</span>
        </h2>
        <p>Write the documents once. Every agent you plug in carries them forward.</p>
        <div className="outro-line">
          <span className="pull">
            <svg className="outro-cable" viewBox="0 0 1000 60" preserveAspectRatio="none" aria-hidden="true">
              <path vectorEffect="non-scaling-stroke" d="M0 30 C 260 30, 380 10, 560 26 S 860 40, 1000 30" />
            </svg>
            <span className="oplug" aria-hidden="true">
              <i />
              TAME
            </span>
          </span>
          <a className="btn p socket" href="/login">
            <span className="led" aria-hidden="true" />
            Sign in
          </a>
          <span className="wait" aria-hidden="true" />
        </div>
      </section>
      <div className="fbar">
        <span className="logo">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="2" y="3" width="20" height="18" rx="5" fill="#2C2F33" />
            <rect x="5" y="7" width="14" height="8" rx="3" fill="#0E0F10" />
            <rect x="8" y="9.5" width="2.4" height="3.4" rx="1.2" fill="var(--acc)" />
            <rect x="13.6" y="9.5" width="2.4" height="3.4" rx="1.2" fill="var(--acc)" />
          </svg>
          TAME<span className="muted fb-tag">Teach Agents My Examples</span>
        </span>
        <span className="muted">Non-profit. Runs on free tiers.</span>
      </div>
    </footer>
  );
}
