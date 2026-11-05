import { CenterScreen } from "../../components/center-screen";
import { Sig } from "../../components/sig";
import { TameMark } from "../../components/tame-mark";
import { signOut } from "../auth/actions";
import { ReloadButton } from "./reload-button";

export function PendingView({ email }: { email: string }) {
  return (
    <CenterScreen>
      <TameMark className="mark rise" dim />
      <div className="rise d1" style={{ display: "grid", gap: 8 }}>
        <h1>
          Access not approved <span className="tone">yet</span>
        </h1>
        <p className="lead" style={{ fontSize: 17 }}>
          This account is signed in, but it cannot use TAME yet.
        </p>
      </div>
      <form action={signOut} className="card rise d2">
        <dl className="kvs">
          <div>
            <dt>Signed in as</dt>
            <dd className="code">{email}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <Sig tone="warn">Waiting for approval</Sig>
            </dd>
          </div>
        </dl>
        <ol className="steps">
          <li>
            <span>Ask the TAME owner to approve this email.</span>
          </li>
          <li>
            <span>Reload this page once it is approved.</span>
          </li>
        </ol>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <ReloadButton />
          <button className="btn" type="submit">
            Sign out
          </button>
        </div>
      </form>
    </CenterScreen>
  );
}
