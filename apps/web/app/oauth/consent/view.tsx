import type { ReactNode } from "react";
import { decideConsent } from "./actions";
import { ConsentBody, UnavailableBody } from "./consent-body";

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="ta">
      <main className="center">{children}</main>
    </div>
  );
}

export function UnavailableView() {
  return (
    <Frame>
      <div className="auth" style={{ maxWidth: 480 }}>
        <UnavailableBody />
      </div>
    </Frame>
  );
}

type Props = {
  authorizationId: string;
  clientName: string;
  email: string;
  redirectUri: string;
  error: boolean;
};

export function ConsentView({ authorizationId, ...body }: Props) {
  return (
    <Frame>
      <form action={decideConsent} className="auth" style={{ maxWidth: 480 }}>
        <input type="hidden" name="authorizationId" value={authorizationId} />
        <ConsentBody {...body} />
      </form>
    </Frame>
  );
}
