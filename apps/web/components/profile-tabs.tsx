"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { PROFILE_TABS, type ProfileTab } from "../lib/profile-tabs";

const LABELS: Record<ProfileTab, string> = {
  overview: "Overview",
  structure: "Structure",
  rules: "Rules",
  evidence: "Evidence",
  template: "Template",
  history: "History",
};

// Tabs switch in place and keep the choice in the address, so a reload or shared link opens the same tab
export function ProfileTabs({
  initial,
  panels,
}: {
  initial: ProfileTab;
  panels: Record<ProfileTab, ReactNode>;
}) {
  const [tab, setTab] = useState<ProfileTab>(initial);
  return (
    <>
      <div className="seg rise d1" role="tablist" aria-label="Profile sections">
        {PROFILE_TABS.map((name) => (
          <button
            key={name}
            id={`tab-${name}`}
            type="button"
            role="tab"
            aria-selected={name === tab}
            aria-controls="profile-panel"
            onClick={() => {
              setTab(name);
              const url = new URL(window.location.href);
              url.searchParams.set("tab", name);
              window.history.replaceState(null, "", url);
            }}
          >
            {LABELS[name]}
          </button>
        ))}
      </div>
      <section className="card rise d2" id="profile-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <div className="card-b" key={tab}>
          {panels[tab]}
        </div>
      </section>
    </>
  );
}
