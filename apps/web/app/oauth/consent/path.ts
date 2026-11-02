const AUTHORIZATION_ID = /^[A-Za-z0-9_-]{8,128}$/;

export function authorizationIdFrom(value: unknown): string | null {
  return typeof value === "string" && AUTHORIZATION_ID.test(value) ? value : null;
}

// After signing in, continue an OAuth request that sent the user to the login page
export function afterSignIn(value: unknown): string {
  const id = authorizationIdFrom(value);
  return id ? `/oauth/consent?authorization_id=${id}` : "/";
}
