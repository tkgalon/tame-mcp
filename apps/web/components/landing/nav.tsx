"use client";

import { useState } from "react";

export function LandingNav() {
  const [menu, setMenu] = useState(false);
  const menuExpanded = menu;
  const openMenu = () => setMenu(true);
  const closeMenu = () => setMenu(false);
  const menuOpen = menu;
  return (
    <header className="nav">
      <div className="nav-in">
        <a className="logo" href="#top" aria-label="TAME, back to top">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="2" y="3" width="20" height="18" rx="5" fill="#2C2F33" />
            <rect x="5" y="7" width="14" height="8" rx="3" fill="#0E0F10" />
            <rect x="8" y="9.5" width="2.4" height="3.4" rx="1.2" fill="var(--acc)" />
            <rect x="13.6" y="9.5" width="2.4" height="3.4" rx="1.2" fill="var(--acc)" />
          </svg>
          {" TAME "}
        </a>
        <nav className="links" aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#holds">What it holds</a>
          <a href="#start">Connect</a>
          <a
            className="gh-ico"
            href="https://github.com/tkgalon/tame-mcp"
            target="_blank"
            rel="noopener"
            aria-label="TAME on GitHub"
            title="GitHub"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z"
              />
            </svg>
          </a>
        </nav>
        <div className="nav-r">
          <a className="btn p" href="/login">
            Sign in
          </a>
          <button className="menu-btn" type="button" aria-expanded={menuExpanded} onClick={openMenu}>
            Menu
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M2 5.5h12M2 10.5h12" />
            </svg>
          </button>
        </div>
      </div>
      {menuOpen && (
        <>
          <div className="menu" role="dialog" aria-label="Menu">
            <div className="menu-top">
              <span className="logo">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="2" y="3" width="20" height="18" rx="5" fill="#2C2F33" />
                  <rect x="5" y="7" width="14" height="8" rx="3" fill="#0E0F10" />
                  <rect x="8" y="9.5" width="2.4" height="3.4" rx="1.2" fill="var(--acc)" />
                  <rect x="13.6" y="9.5" width="2.4" height="3.4" rx="1.2" fill="var(--acc)" />
                </svg>
                TAME
              </span>
              <button className="menu-close" type="button" onClick={closeMenu}>
                Close
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
                </svg>
              </button>
            </div>
            <ol>
              <li>
                <a href="#how" onClick={closeMenu}>
                  <span className="n">01</span>How it works
                </a>
              </li>
              <li>
                <a href="#holds" onClick={closeMenu}>
                  <span className="n">02</span>What it holds
                </a>
              </li>
              <li>
                <a href="#start" onClick={closeMenu}>
                  <span className="n">03</span>Connect
                </a>
              </li>
              <li>
                <a href="https://github.com/tkgalon/tame-mcp" target="_blank" rel="noopener">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z"
                    />
                  </svg>
                  GitHub
                </a>
              </li>
            </ol>
            <a className="btn p" href="/login" onClick={closeMenu}>
              Sign in
            </a>
          </div>
        </>
      )}
    </header>
  );
}
