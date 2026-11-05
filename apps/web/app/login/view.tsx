import Link from "next/link";
import { CenterScreen } from "../../components/center-screen";
import { TameMark } from "../../components/tame-mark";
import { signInWithGoogle } from "../auth/actions";
import { GoogleButton } from "./google-button";

export function LoginView({ authorizationId, error }: { authorizationId: string | null; error: boolean }) {
  return (
    <CenterScreen>
      <Link href="/" aria-label="TAME home">
        <TameMark className="mark rise" />
      </Link>
      <div className="rise d1" style={{ display: "grid", gap: 6 }}>
        <h1 style={{ fontSize: 40 }}>TAME</h1>
        <p className="lead" style={{ fontSize: 17 }}>
          Teach Agents My Examples
        </p>
      </div>
      <form action={signInWithGoogle} className="card rise d2">
        {authorizationId && <input type="hidden" name="authorizationId" value={authorizationId} />}
        {authorizationId && (
          <p className="alert info">
            Sign in to finish connecting <b>your agent</b> to your TAME profiles.
          </p>
        )}
        {error && (
          <p className="alert" role="alert">
            Unable to sign in with Google. Try again.
          </p>
        )}
        <GoogleButton />
        <p className="small" style={{ textAlign: "center" }}>
          A new account is created the first time you sign in.
        </p>
      </form>
      <p className="small rise d3">New accounts open after the owner approves the email.</p>
    </CenterScreen>
  );
}
