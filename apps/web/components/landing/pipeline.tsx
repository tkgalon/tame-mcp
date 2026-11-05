"use client";

import { useState } from "react";
import type { CSSProperties } from "react";

const cssVars = (vars: Record<string, string>) => vars as CSSProperties;

export function LandingPipeline() {
  const [quote, setQuote] = useState(false);
  const quoteExpanded = quote;
  const quoteLabel = quote ? "Close source" : "Open source";
  const srcClass = "src" + (quote ? " open" : "");
  const toggleQuote = () => setQuote(!quote);
  return (
    <section className="wrap sec" id="how">
      <div className="head rv">
        <h2>
          {"One profile. "}
          <span className="muted">Every device, every chat.</span>
        </h2>
        <p>
          Upload what you already wrote, approve the rules your agent drafts from it, then ask for the next
          one.
        </p>
      </div>
      <div className="pipe">
        <span className="rail grow" aria-hidden="true" />
        <article className="stage rv" style={cssVars({ "--d": "0ms", "--p": "400ms" })}>
          <div className="st-h">
            <div className="st-row">
              <span className="node">1</span>
              <span className="st-k">ingest</span>
            </div>
            <h3>Upload finished documents</h3>
            <p>PDF or DOCX, measured straight from the file. No model involved.</p>
          </div>
          <div className="cw">
            <div className="cw-bar">
              <span className="code">extract · document-01.pdf</span>
              <span className="tag2">no model</span>
            </div>
            <pre className="cb">
              <span className="cl" style={cssVars({ "--t": "0ms" })}>
                <span className="p">{"{"}</span>
              </span>
              <span className="cl" style={cssVars({ "--t": "70ms" })}>
                {"  "}
                <span className="k">{'"body"'}</span>
                <span className="p">{":"}</span>
                {"       "}
                <span className="s">{'"Arial 12pt, justified"'}</span>
                <span className="p">{","}</span>
              </span>
              <span className="cl" style={cssVars({ "--t": "140ms" })}>
                {"  "}
                <span className="k">{'"headings"'}</span>
                <span className="p">{":"}</span>
                {"   "}
                <span className="s">{'"bold, numbered"'}</span>
                <span className="p">{","}</span>
              </span>
              <span className="cl" style={cssVars({ "--t": "210ms" })}>
                {"  "}
                <span className="k">{'"figures"'}</span>
                <span className="p">{":"}</span>
                {"    "}
                <span className="s">{'"numbered captions"'}</span>
                <span className="p">{","}</span>
              </span>
              <span className="cl" style={cssVars({ "--t": "280ms" })}>
                {"  "}
                <span className="k">{'"key_result"'}</span>
                <span className="p">{":"}</span> <span className="s">{'"yellow box"'}</span>
                <span className="p">{","}</span>
              </span>
              <span className="cl" style={cssVars({ "--t": "350ms" })}>
                {"  "}
                <span className="k">{'"header"'}</span>
                <span className="p">{":"}</span>
                {"     "}
                <span className="s">{'"title, page number"'}</span>
                <span className="p">{","}</span>
              </span>
              <span className="cl" style={cssVars({ "--t": "420ms" })}>
                {"  "}
                <span className="k">{'"pages"'}</span>
                <span className="p">{":"}</span>
                {"      "}
                <span className="n">{"4"}</span>
              </span>
              <span className="cl" style={cssVars({ "--t": "490ms" })}>
                <span className="p">{"}"}</span>
              </span>
            </pre>
          </div>
        </article>
        <article className="stage mid rv" style={cssVars({ "--d": "120ms", "--p": "1200ms" })}>
          <div className="st-h">
            <div className="st-row">
              <span className="node">2</span>
              <span className="st-k">review</span>
            </div>
            <h3>Approve the rules</h3>
            <p>Your agent drafts the profile. Nothing is active until you say oke.</p>
          </div>
          <div className="cw">
            <div className="cw-bar">
              <span className="code">profile · my-documents</span>
              <span className="tag2">v4 → v5</span>
            </div>
            <pre className="cb">
              <span className="cl hunk" style={cssVars({ "--t": "0ms" })}>
                {"@@ rules @@"}
              </span>
              <span className="cl" style={cssVars({ "--t": "60ms" })}>
                {"  01  first person, short sentences"}
              </span>
              <span className="cl" style={cssVars({ "--t": "120ms" })}>
                {"  02  numbered figure captions"}
              </span>
              <span className="cl" style={cssVars({ "--t": "180ms" })}>
                {"  03  key result in a yellow box"}
              </span>
              <span className="cl add" style={cssVars({ "--t": "300ms" })}>
                {"+ 04  copy each question exactly"}
              </span>
              <span className="cl add" style={cssVars({ "--t": "400ms" })}>
                {"+     \u21b3 document-01.pdf p.2"}
              </span>
            </pre>
            <div className="cw-act cl" style={cssVars({ "--t": "550ms" })}>
              <button className="srcbtn" type="button" aria-expanded={quoteExpanded} onClick={toggleQuote}>
                {quoteLabel}
                <svg
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M6 2v8M2 6h8" />
                </svg>
              </button>
              <div className={srcClass}>
                <div>
                  <div className="src-in">
                    <span className="code">document-01.pdf, page 2</span>
                    <p>
                      <mark>Q3. Explain why the two results are different.</mark>
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <pre className="cb cb-tail">
              <span className="cl type" style={cssVars({ "--t": "800ms", "--n": "5" })}>
                <span className="s">{"\u203a"}</span>
                {" oke"}
              </span>
              <span className="cl ok" style={cssVars({ "--t": "1150ms" })}>
                {"\u2713 v5 published, active"}
              </span>
            </pre>
          </div>
        </article>
        <article className="stage last rv" style={cssVars({ "--d": "240ms", "--p": "2700ms" })}>
          <div className="st-h">
            <div className="st-row">
              <span className="node">3</span>
              <span className="st-k">write</span>
            </div>
            <h3>Ask in one sentence</h3>
            <p>The agent pulls the profile and files over MCP, writes, then checks.</p>
          </div>
          <div className="cw">
            <div className="cw-bar">
              <span className="code">codex · mcp</span>
              <span className="esig ok sm">
                <i className="eyes" aria-hidden="true" />
                connected
              </span>
            </div>
            <pre className="cb">
              <span className="cl type" style={cssVars({ "--t": "0ms", "--n": "31" })}>
                <span className="s">{"\u203a"}</span>
                {" write document-03 in my style"}
              </span>
              <span className="cl" style={cssVars({ "--t": "1200ms" })}>
                {" "}
              </span>
              <span className="cl" style={cssVars({ "--t": "1400ms" })}>
                <span className="p">{"\u2192"}</span>
                {" use_profile       "}
                <span className="s">{"my-documents@v5"}</span>
              </span>
              <span className="cl" style={cssVars({ "--t": "1750ms" })}>
                <span className="p">{"\u2192"}</span>
                {" get_example_file  "}
                <span className="s">{"document-01.pdf"}</span>
              </span>
              <span className="cl" style={cssVars({ "--t": "2100ms" })}>
                <span className="p">{"\u2192"}</span>
                {" write             "}
                <span className="s">{"document-03.docx"}</span>
              </span>
              <span className="cl ok" style={cssVars({ "--t": "2550ms" })}>
                {"\u2713 check             4/4 rules passed"}
              </span>
              <span className="cl" style={cssVars({ "--t": "2750ms" })}>
                <span className="s">{"\u203a"}</span> <span className="caret" />
              </span>
            </pre>
          </div>
        </article>
      </div>
    </section>
  );
}
