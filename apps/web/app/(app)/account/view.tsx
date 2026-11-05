import { DeleteAccountForm } from "../../../components/delete-account-form";
import { Sig } from "../../../components/sig";

export function AccountView({ email, provider }: { email: string; provider: string }) {
  return (
    <div className="narrow">
      <div className="ph rise">
        <div>
          <h1>Account</h1>
        </div>
      </div>

      <section className="card rise d1" aria-labelledby="details">
        <div className="card-h">
          <h2 id="details">Details</h2>
        </div>
        <div className="card-b">
          <dl className="kvs">
            <div>
              <dt>Signed in as</dt>
              <dd className="code">{email}</dd>
            </div>
            <div>
              <dt>Sign-in method</dt>
              <dd>{provider}</dd>
            </div>
            <div>
              <dt>Access</dt>
              <dd>
                <Sig tone="ok">Approved</Sig>
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="card rise d2" aria-labelledby="del">
        <div className="card-h">
          <h2 id="del">Delete account</h2>
        </div>
        <DeleteAccountForm email={email} />
      </section>
    </div>
  );
}
