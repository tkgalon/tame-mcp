import { DeleteAccountForm } from "../../../components/delete-account-form";
import { requireUser } from "../../../lib/session";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <>
      <h1>Account</h1>
      <section aria-labelledby="details">
        <h2 id="details">Details</h2>
        <p>Signed in as {user.email}.</p>
      </section>
      <section aria-labelledby="delete">
        <h2 id="delete">Delete account</h2>
        <p>Export the profiles you want to keep first.</p>
        <DeleteAccountForm />
      </section>
    </>
  );
}
