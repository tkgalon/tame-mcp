import type { ReactNode } from "react";

export type Tone = "ok" | "acc" | "warn" | "bad" | "off";

type Props = { tone: Tone; quiet?: boolean; chip?: boolean; children: ReactNode };

// Status as the agent device's two LED eyes plus a plain label, never a dot pill
export function Sig({ tone, quiet, chip, children }: Props) {
  const className = ["sig", tone, quiet && "quiet", chip && "chip"].filter(Boolean).join(" ");
  return (
    <span className={className}>
      <i className="eyes" aria-hidden="true" />
      {children}
    </span>
  );
}
