"use client";

import { useEffect, useRef, useState } from "react";

// The real first step: the agent opens the sign in page itself the first time it connects
export function HeroCommand({ mcpUrl }: { mcpUrl: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className="hcmd">
      <code>
        <b aria-hidden="true">$</b>codex mcp add tame --url …/mcp
      </code>
      <button
        type="button"
        className={copied ? "hcopy copied" : "hcopy"}
        aria-label="Copy the Codex command"
        onClick={() => {
          navigator.clipboard?.writeText(`codex mcp add tame --url ${mcpUrl}`).catch(() => {});
          clearTimeout(timer.current);
          setCopied(true);
          timer.current = setTimeout(() => setCopied(false), 1600);
        }}
      >
        <span className="idle">Copy</span>
        <span className="done">Copied</span>
      </button>
    </div>
  );
}
