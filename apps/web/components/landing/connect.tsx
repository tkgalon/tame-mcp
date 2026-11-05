"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

const cssVars = (vars: Record<string, string>) => vars as CSSProperties;

export function LandingConnect({ mcpUrl }: { mcpUrl: string }) {
  const [agent, setAgent] = useState(0);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const list = [
    { label: "Codex", cmd: "codex mcp add tame --url " + mcpUrl },
    { label: "Claude Code", cmd: "claude mcp add --transport http tame " + mcpUrl },
  ];
  const cur = list[agent]!;
  const agents = list.map((a, i) => ({
    label: a.label,
    pressed: i === agent,
    pick: () => {
      setAgent(i);
      setCopied(false);
    },
  }));
  const cmdText = cur.cmd;
  const ctaLabel = "Sign in, then connect " + cur.label;
  const statusLine = "Profile my-documents v5, ready in " + cur.label;
  const confClass = "conf-r ag-" + agent;
  const miniAria = "The TAME plug seated in the agent device, labelled " + cur.label + ", lights on.";
  const copyClass = "copybtn" + (copied ? " copied" : "");
  const copyAria = "Copy the " + cur.label + " command";
  const copy = () => {
    navigator.clipboard?.writeText(cur.cmd).catch(() => {});
    clearTimeout(timer.current);
    setCopied(true);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };
  return (
    <section className="wrap sec" id="start" style={{ paddingTop: "24px" }}>
      <div className="head rv">
        <h2>Plug in once per device.</h2>
        <p>One command per agent. After that, ask in plain words.</p>
      </div>
      <div className="conf rv" style={cssVars({ "--d": "80ms" })}>
        <div className="conf-l">
          <p className="q">
            <span>01</span>Which agent?
          </p>
          <div className="opts" role="group" aria-label="Agent">
            {agents.map((a, i) => (
              <Fragment key={i}>
                <button className="opt" type="button" aria-pressed={a.pressed} onClick={a.pick}>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="3" y="5" width="18" height="14" rx="3" />
                    <path d="M7 10l3 2.5L7 15M12.5 15H17" strokeLinecap="round" />
                  </svg>
                  <span>{a.label}</span>
                </button>
              </Fragment>
            ))}
          </div>
          <p className="q">
            <span>02</span>Run this once
          </p>
          <div className="cmd">
            <code>{cmdText}</code>
            <button type="button" className={copyClass} onClick={copy} aria-label={copyAria}>
              <span className="idle">Copy</span>
              <span className="done">Copied</span>
            </button>
          </div>
          <p className="q">
            <span>03</span>Then ask
          </p>
          <p className="msg me" style={{ justifySelf: "start" }}>
            write document-03 in my style
          </p>
        </div>
        <div className={confClass}>
          <svg className="mini" viewBox="0 0 420 220" role="img" aria-label={miniAria}>
            <defs>
              <linearGradient id="dvFront2" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#3A3D42" />
                <stop offset="1" stopColor="#26292D" />
              </linearGradient>
            </defs>
            <g transform="rotate(-6 60 110)">
              <rect className="doc" x="16" y="60" width="80" height="104" rx="6" />
            </g>
            <rect className="doc" x="30" y="52" width="80" height="104" rx="6" />
            <rect className="ink" x="40" y="63" width="38" height="5" rx="2.5" />
            <rect className="gl" x="40" y="75" width="60" height="3" rx="1.5" />
            <rect className="gl" x="40" y="82" width="48" height="3" rx="1.5" />
            <rect className="hl" x="40" y="92" width="60" height="18" rx="3" />
            <rect className="gl" x="40" y="118" width="60" height="3" rx="1.5" />
            <rect className="gl" x="40" y="125" width="42" height="3" rx="1.5" />
            <text x="30" y="178" style={{ font: "500 10.5px var(--mono)" }} fill="#6E6E73">
              my-documents v5
            </text>
            <rect x="109" y="97" width="9" height="14" rx="3" fill="#2A2C2F" />
            <path className="cablek" d="M120 104 C 140 104, 134 126, 156 126 L 196 126" />
            <g className="seat">
              <path className="cablek" d="M186 126 H 214" />
              <rect x="258" y="114" width="22" height="5" rx="2" fill="#B8B9B5" />
              <rect x="258" y="133" width="22" height="5" rx="2" fill="#B8B9B5" />
              <rect x="214" y="108" width="50" height="44" rx="9" fill="#D4D4CE" />
              <rect
                x="210"
                y="104"
                width="50"
                height="44"
                rx="9"
                fill="#FFFFFF"
                stroke="#D2D1CB"
                strokeWidth="1.5"
              />
              <text
                x="217"
                y="131"
                style={{ font: "700 11px var(--display)", letterSpacing: ".05em" }}
                fill="#1D1D1F"
              >
                TAME
              </text>
            </g>
            <ellipse className="shadow" cx="334" cy="200" rx="74" ry="7" />
            <rect x="272" y="72" width="128" height="120" rx="18" fill="#1B1D20" />
            <rect x="264" y="64" width="128" height="120" rx="18" fill="url(#dvFront2)" />
            <rect x="270" y="68" width="116" height="2" rx="1" fill="#FFFFFF" opacity=".12" />
            <rect x="280" y="80" width="96" height="50" rx="10" fill="#0E0F10" />
            <rect className="acc wake" x="309" y="93" width="12" height="24" rx="6" />
            <rect className="acc wake" x="335" y="93" width="12" height="24" rx="6" />
            <text className="nm0" x="280" y="156" style={{ font: "600 13px var(--display)" }} fill="#E6E7E3">
              Codex
            </text>
            <text className="nm1" x="280" y="156" style={{ font: "600 13px var(--display)" }} fill="#E6E7E3">
              Claude Code
            </text>
            <text
              x="280"
              y="172"
              style={{ font: "500 10px var(--mono)", letterSpacing: ".06em" }}
              fill="#8C9096"
            >
              AGENT
            </text>
            <circle className="acc wake" cx="376" cy="168" r="4" />
            <rect x="259" y="108" width="9" height="36" rx="3.5" fill="#0E0F10" />
          </svg>
          <p className="small">{statusLine}</p>
          <a className="btn p" href="/login">
            {ctaLabel}
          </a>
        </div>
      </div>
    </section>
  );
}
