"use client";

import { Fragment, useState } from "react";
import type { CSSProperties } from "react";

const cssVars = (vars: Record<string, string>) => vars as CSSProperties;

const RULES = [
  {
    text: "Copy each question exactly as given, then answer below it.",
    cite: "document-01.pdf p.2",
    ver: "v5",
    quote: "Q3. Explain why the two results are different.",
  },
  {
    text: "Write in first person, in short sentences.",
    cite: "document-02.docx p.1",
    ver: "v3",
    quote: "I start with what I expected to find.",
  },
  {
    text: "Put each figure under its own numbered caption.",
    cite: "document-01.pdf p.3",
    ver: "v3",
    quote: "Figure 2. Results after the second run.",
  },
  {
    text: "Put a yellow box around the key result.",
    cite: "document-01.pdf p.4",
    ver: "v4",
    quote: "Key result: the second run finished first.",
  },
];

const TABS = [
  { slug: "rules", label: "Rules", count: "4", title: "Rules, each one cited" },
  { slug: "quotes", label: "Quotes", count: "3", title: "Quotes from your files" },
  { slug: "style", label: "Measured style", count: "5", title: "Measured style" },
  { slug: "files", label: "Original files", count: "2", title: "Original files" },
  { slug: "versions", label: "Versions", count: "3", title: "Version history" },
];

// A sample profile browsed like an app window: tabs, content, inspector, status bar
export function LandingExplorer() {
  const [tab, setTab] = useState(0);
  const [sel, setSel] = useState(0);
  const tabs = TABS.map((t, i) => ({
    label: t.label,
    count: t.count,
    selected: i === tab,
    pick: () => setTab(i),
  }));
  const tabTitle = TABS[tab]!.title;
  const tabSlug = TABS[tab]!.slug;
  const ruleRows = RULES.map((r, i) => ({
    n: "0" + (i + 1),
    text: r.text,
    cite: r.cite,
    pressed: i === sel,
    pick: () => setSel(i),
  }));
  const rule = RULES[sel]!;
  const inspClass = "insp f" + (sel % 2);
  const selN = "0" + (sel + 1);
  const selText = rule.text;
  const selCite = rule.cite;
  const selVer = rule.ver;
  const selQuote = rule.quote;
  const [tab0, tab1, tab2, tab3, tab4] = [0, 1, 2, 3, 4].map((i) => tab === i);
  return (
    <section className="wrap sec" id="holds" style={{ paddingTop: "24px" }}>
      <div className="head rv">
        <h2>
          {"TAME holds the context. "}
          <span className="muted">Your agent does the work.</span>
        </h2>
        <p>Every profile is plain, readable and versioned. Browse a sample one.</p>
      </div>
      <div className="explorer x3 rv" style={cssVars({ "--d": "80ms" })}>
        <div className="ex-top">
          <span className="crumb code">
            {"profiles "}
            <i>/</i> <b>my-documents</b> <i>/</i> {tabSlug}
          </span>
          <span className="ex-top-r">
            <span className="code muted">2 examples</span>
            <span className="esig ok chip">
              <i className="eyes" aria-hidden="true" />
              v5 · approved
            </span>
          </span>
        </div>
        <aside className="ex-nav" role="tablist" aria-label="Profile contents">
          {tabs.map((t, i) => (
            <Fragment key={i}>
              <button className="tab" type="button" role="tab" aria-selected={t.selected} onClick={t.pick}>
                {t.label}
                <span className="cnt">{t.count}</span>
              </button>
            </Fragment>
          ))}
        </aside>
        <div className="ex-main">
          <div className="ex-head">
            <h3>{tabTitle}</h3>
          </div>
          {tab0 && (
            <>
              <div className="ex-panel">
                {ruleRows.map((r, i) => (
                  <Fragment key={i}>
                    <button className="rrow" type="button" aria-pressed={r.pressed} onClick={r.pick}>
                      <span className="n">{r.n}</span>
                      <span className="rt">{r.text}</span>
                      <span className="cite">{r.cite}</span>
                    </button>
                  </Fragment>
                ))}
                <p className="small hint">Select a rule to see the line it came from.</p>
              </div>
            </>
          )}
          {tab1 && (
            <>
              <div className="ex-panel">
                <div className="quote">
                  <q>Q3. Explain why the two results are different.</q>
                  <span>document-01.pdf, page 2 · rule 01</span>
                </div>
                <div className="quote">
                  <q>I start with what I expected to find.</q>
                  <span>document-02.docx, page 1 · rule 02</span>
                </div>
                <div className="quote">
                  <q>Figure 2. Results after the second run.</q>
                  <span>document-01.pdf, page 3 · rule 03</span>
                </div>
              </div>
            </>
          )}
          {tab2 && (
            <>
              <div className="ex-panel">
                <div className="kv">
                  <div>
                    <span>Body</span>
                    <b>Arial 12pt, justified</b>
                  </div>
                  <div>
                    <span>Headings</span>
                    <b>Bold, numbered</b>
                  </div>
                  <div>
                    <span>Figures</span>
                    <b>Numbered captions</b>
                  </div>
                  <div>
                    <span>Key result</span>
                    <b>Yellow box</b>
                  </div>
                  <div>
                    <span>Header, footer</span>
                    <b>Title, page number</b>
                  </div>
                </div>
                <p className="small">Read from the files themselves. No model is involved.</p>
              </div>
            </>
          )}
          {tab3 && (
            <>
              <div className="ex-panel">
                <div className="frow">
                  <span className="ft pdf">PDF</span>
                  <span className="code">document-01.pdf</span>
                  <span className="small">4 pages</span>
                </div>
                <div className="frow">
                  <span className="ft docx">DOCX</span>
                  <span className="code">document-02.docx</span>
                  <span className="small">3 pages</span>
                </div>
              </div>
            </>
          )}
          {tab4 && (
            <>
              <div className="ex-panel">
                <div className="ver">
                  <b>v5</b>
                  <span>Adds: copy each question exactly as given.</span>
                  <span className="esig ok">
                    <i className="eyes" aria-hidden="true" />
                    active
                  </span>
                </div>
                <div className="ver">
                  <b>v4</b>
                  <span>Highlights the key result in a yellow box.</span>
                  <span className="muted" style={{ fontSize: "13px" }}>
                    approved
                  </span>
                </div>
                <div className="ver">
                  <b>v3</b>
                  <span>First approved profile from two examples.</span>
                  <span className="muted" style={{ fontSize: "13px" }}>
                    approved
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
        <aside className="ex-insp" aria-label="Inspector">
          {tab0 && (
            <>
              <div className={inspClass}>
                <p className="ik">
                  {"Rule "}
                  {selN}
                </p>
                <p className="it">{selText}</p>
                <dl className="meta">
                  <div>
                    <dt>Source</dt>
                    <dd className="code">{selCite}</dd>
                  </div>
                  <div>
                    <dt>Added in</dt>
                    <dd className="code">{selVer}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd className="okc">approved by you</dd>
                  </div>
                </dl>
                <p className="ik">Evidence</p>
                <div className="page">
                  <span className="pl w60" />
                  <span className="pl" />
                  <span className="pl w85" />
                  <mark className="pq">{selQuote}</mark>
                  <span className="pl" />
                  <span className="pl w70" />
                  <span className="pl w40" />
                  <span className="pfoot code">{selCite}</span>
                </div>
              </div>
            </>
          )}
          {tab1 && (
            <>
              <div className="insp f0">
                <p className="ik">Source preview</p>
                <div className="page">
                  <span className="pl w60" />
                  <span className="pl" />
                  <span className="pl w85" />
                  <mark className="pq">Q3. Explain why the two results are different.</mark>
                  <span className="pl" />
                  <span className="pl w70" />
                  <span className="pfoot code">document-01.pdf p.2</span>
                </div>
                <p className="small">
                  Every quote keeps its file and page, so a rule can always be traced back.
                </p>
              </div>
            </>
          )}
          {tab2 && (
            <>
              <div className="insp f0">
                <p className="ik">Rendered with the measured style</p>
                <div className="page styled">
                  <div className="phead">
                    <span>Results of two runs</span>
                    <span>2</span>
                  </div>
                  <p className="ph">1. Results</p>
                  <p className="pb">
                    Both runs used the same input. The second run finished first, so I compare them line by
                    line below.
                  </p>
                  <div className="pfig" />
                  <p className="pcap">Figure 1. Time per run.</p>
                  <p className="pkey">Key result: the second run finished first.</p>
                </div>
              </div>
            </>
          )}
          {tab3 && (
            <>
              <div className="insp f0">
                <p className="ik">document-01.pdf</p>
                <div className="thumbs">
                  <div className="page th">
                    <span className="pl w60" />
                    <span className="pl" />
                    <span className="pl w85" />
                    <span className="pl w70" />
                    <span className="tn code">p.1</span>
                  </div>
                  <div className="page th">
                    <span className="pl w60" />
                    <mark className="pq sm" />
                    <span className="pl" />
                    <span className="pl w70" />
                    <span className="tn code">p.2</span>
                  </div>
                  <div className="page th">
                    <span className="pl" />
                    <span className="pfig sm" />
                    <span className="pl w60" />
                    <span className="tn code">p.3</span>
                  </div>
                  <div className="page th">
                    <span className="pl w85" />
                    <span className="pkey sm" />
                    <span className="pl w70" />
                    <span className="tn code">p.4</span>
                  </div>
                </div>
                <div className="term">
                  <span>
                    <span className="a">›</span>
                    {" get_example_file document-01.pdf"}
                  </span>
                  <span className="c">{" returns the original file"}</span>
                </div>
              </div>
            </>
          )}
          {tab4 && (
            <>
              <div className="insp f0">
                <p className="ik">v4 → v5</p>
                <div className="cw">
                  <pre className="cb">
                    <span className="cl hunk">{"@@ rules @@"}</span>
                    <span className="cl">{"  03  key result in a yellow box"}</span>
                    <span className="cl add">{"+ 04  copy each question exactly"}</span>
                    <span className="cl add">{"+     \u21b3 document-01.pdf p.2"}</span>
                  </pre>
                </div>
                <p className="small">Versions are never edited. A rollback adds a new version.</p>
              </div>
            </>
          )}
        </aside>
        <div className="ex-status code">
          <span className="esig ok sm quiet">
            <i className="eyes" aria-hidden="true" />
            served over MCP · use_profile my-documents@v5
          </span>
          <span className="muted">4 rules · 3 quotes · 5 style values · 2 files</span>
        </div>
      </div>
      <div className="facts rv" style={cssVars({ "--d": "120ms" })}>
        <div>
          <b>No model</b>
          <span>TAME calls no AI service. Writing happens in the agent you already use.</span>
        </div>
        <div>
          <b>Approval</b>
          <span>A draft changes nothing until you confirm it.</span>
        </div>
        <div>
          <b>History</b>
          <span>Versions are never edited. Rollback adds a version.</span>
        </div>
        <div>
          <b>Unplug</b>
          <span>Disconnect a device and it loses access on its next request.</span>
        </div>
      </div>
    </section>
  );
}
