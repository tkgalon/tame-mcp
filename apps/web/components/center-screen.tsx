import type { ReactNode } from "react";

// A full-height centred screen for sign in, access, consent and errors
export function CenterScreen({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="ta">
      <main className="center">
        <div className="auth" style={wide ? { maxWidth: 480 } : undefined}>
          {children}
        </div>
      </main>
    </div>
  );
}
