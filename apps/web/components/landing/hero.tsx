// The hero loop: repeated documents, a cable into the TAME plug, the agent device, a new matching document
export function LandingHero() {
  return (
    <section className="wrap hero" id="top">
      <div className="scene">
        <svg
          className="loop"
          viewBox="0 0 1000 320"
          role="img"
          aria-label="Three documents with the same layout are wired to a plug labelled TAME. The plug goes into an agent device, its lights come on, and it slides out a new document with the same layout."
        >
          <defs>
            <linearGradient id="dvFront" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#3A3D42" />
              <stop offset="1" stopColor="#26292D" />
            </linearGradient>
            <linearGradient id="dvMetal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#D6D7D3" />
              <stop offset="1" stopColor="#A9AAA6" />
            </linearGradient>
            <clipPath id="outClip">
              <rect x="686" y="0" width="314" height="320" />
            </clipPath>
          </defs>
          <g transform="rotate(-6 105 160)">
            <rect className="doc" x="40" y="76" width="130" height="170" rx="8" />
            <rect className="ink" x="54" y="92" width="62" height="7" rx="3.5" />
            <rect className="gl" x="54" y="110" width="100" height="4" rx="2" />
            <rect className="gl" x="54" y="120" width="84" height="4" rx="2" />
            <rect
              className="hl k-hl"
              x="54"
              y="134"
              width="100"
              height="30"
              rx="5"
              style={{ animationDelay: "0ms" }}
            />
            <rect className="gl" x="54" y="176" width="100" height="4" rx="2" />
            <rect className="gl" x="54" y="186" width="70" height="4" rx="2" />
          </g>
          <g transform="rotate(-2 135 156)">
            <rect className="doc" x="70" y="68" width="130" height="170" rx="8" />
            <rect className="ink" x="84" y="84" width="62" height="7" rx="3.5" />
            <rect className="gl" x="84" y="102" width="100" height="4" rx="2" />
            <rect className="gl" x="84" y="112" width="84" height="4" rx="2" />
            <rect
              className="hl k-hl"
              x="84"
              y="126"
              width="100"
              height="30"
              rx="5"
              style={{ animationDelay: "220ms" }}
            />
            <rect className="gl" x="84" y="168" width="100" height="4" rx="2" />
            <rect className="gl" x="84" y="178" width="70" height="4" rx="2" />
          </g>
          <g>
            <rect className="doc" x="100" y="62" width="130" height="170" rx="8" />
            <rect className="ink" x="114" y="78" width="62" height="7" rx="3.5" />
            <rect className="gl" x="114" y="96" width="100" height="4" rx="2" />
            <rect className="gl" x="114" y="106" width="84" height="4" rx="2" />
            <rect
              className="hl k-hl"
              x="114"
              y="120"
              width="100"
              height="30"
              rx="5"
              style={{ animationDelay: "440ms" }}
            />
            <rect className="gl" x="114" y="162" width="100" height="4" rx="2" />
            <rect className="gl" x="114" y="172" width="70" height="4" rx="2" />
            <rect className="gl" x="114" y="204" width="44" height="4" rx="2" />
          </g>
          <rect x="229" y="139" width="10" height="16" rx="3" fill="#2A2C2F" />
          <path className="cablek" d="M241 147 C 272 147, 264 190, 300 190 L 380 190" />
          <path className="cablehi" d="M241 145 C 272 145, 264 188, 300 188" />
          <path className="sig k-sig" pathLength="1" d="M241 147 C 272 147, 264 190, 300 190 L 434 190" />
          <g className="k-plug">
            <path className="cablek" d="M370 190 H 440" />
            <rect x="500" y="176" width="26" height="6" rx="2" fill="url(#dvMetal)" />
            <rect x="500" y="197" width="26" height="6" rx="2" fill="url(#dvMetal)" />
            <rect x="438" y="164" width="68" height="56" rx="10" fill="#D4D4CE" />
            <rect
              x="434"
              y="160"
              width="68"
              height="56"
              rx="10"
              fill="#FFFFFF"
              stroke="#D2D1CB"
              strokeWidth="1.5"
            />
            <rect className="acc" x="446" y="172" width="8" height="8" rx="2" />
            <text
              x="446"
              y="203"
              style={{ font: "700 14px var(--display)", letterSpacing: ".05em" }}
              fill="#121314"
            >
              TAME
            </text>
          </g>
          <ellipse className="shadow" cx="598" cy="276" rx="100" ry="10" />
          <rect x="524" y="122" width="168" height="150" rx="22" fill="#1B1D20" />
          <rect x="514" y="112" width="168" height="150" rx="22" fill="url(#dvFront)" />
          <rect x="520" y="116" width="156" height="2" rx="1" fill="#FFFFFF" opacity=".12" />
          <rect x="536" y="134" width="124" height="66" rx="12" fill="#0E0F10" />
          <rect className="acc k-led" x="572" y="152" width="14" height="28" rx="7" />
          <rect className="acc k-led" x="610" y="152" width="14" height="28" rx="7" />
          <circle className="acc k-led" cx="660" cy="224" r="4" />
          <text
            x="536"
            y="236"
            style={{ font: "600 11px var(--mono)", letterSpacing: ".14em" }}
            fill="#8C9096"
          >
            AGENT
          </text>
          <rect x="508" y="170" width="10" height="40" rx="4" fill="#0E0F10" />
          <rect x="675" y="118" width="11" height="138" rx="4" fill="#0E0F10" />
          <g clipPath="url(#outClip)">
            <g className="k-out">
              <g className="k-grow">
                <rect className="doc" x="690" y="124" width="96" height="126" rx="6" />
                <rect
                  className="ink k-ln"
                  x="700"
                  y="135"
                  width="46"
                  height="5"
                  rx="2.5"
                  style={{ animationDelay: "0ms" }}
                />
                <rect
                  className="gl k-ln"
                  x="700"
                  y="148"
                  width="76"
                  height="3"
                  rx="1.5"
                  style={{ animationDelay: "80ms" }}
                />
                <rect
                  className="gl k-ln"
                  x="700"
                  y="155"
                  width="62"
                  height="3"
                  rx="1.5"
                  style={{ animationDelay: "160ms" }}
                />
                <rect
                  className="hl k-ln"
                  x="700"
                  y="165"
                  width="76"
                  height="22"
                  rx="4"
                  style={{ animationDelay: "240ms" }}
                />
                <rect
                  className="gl k-ln"
                  x="700"
                  y="196"
                  width="76"
                  height="3"
                  rx="1.5"
                  style={{ animationDelay: "320ms" }}
                />
                <rect
                  className="gl k-ln"
                  x="700"
                  y="203"
                  width="54"
                  height="3"
                  rx="1.5"
                  style={{ animationDelay: "400ms" }}
                />
                <rect
                  className="gl k-ln"
                  x="700"
                  y="220"
                  width="32"
                  height="3"
                  rx="1.5"
                  style={{ animationDelay: "480ms" }}
                />
              </g>
            </g>
          </g>
          <g className="k-chk">
            <circle className="acc" cx="860" cy="104" r="15" />
            <path
              d="M853 104.5l5 5 9-10"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </svg>
      </div>
      <h1 className="rise" style={{ animationDelay: "60ms" }} aria-label="Teach Agents My Examples">
        {"Teach Agents "}
        <span className="tone">My Examples</span>
      </h1>
      <p className="rise lead two" style={{ animationDelay: "120ms" }}>
        <span>Plug the documents you already wrote into every agent you use.</span>{" "}
        <span>Your examples become context your agents carry forward.</span>
      </p>
      <div className="rise ctas" style={{ animationDelay: "180ms" }}>
        <a className="btn p" href="/login">
          Sign in
        </a>
        <a className="btn" href="#how">
          How it works
        </a>
      </div>
    </section>
  );
}
