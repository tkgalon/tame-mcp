import { createRemoteJWKSet, errors, jwtVerify } from "jose";
import type { JWTVerifyGetKey } from "jose";
import { z } from "zod";
import type { McpConfig } from "./config.js";

export const permissionSchema = z.enum(["read_profiles", "read_examples", "write_profiles"]);
export const connectionSchema = z.strictObject({
  id: z.uuid(), owner_id: z.uuid(), client_id: z.uuid(), provider_session_id: z.uuid(),
  permissions: z.array(permissionSchema).min(1).max(3),
});
export type Connection = z.infer<typeof connectionSchema>;
export type Identity = { ownerId: string; clientId: string; sessionId: string };
export type Principal = Identity & { connectionId: string; permissions: Connection["permissions"] };
export type GrantResolver = (identity: Identity) => Promise<Connection | null>;
export type Authenticator = (authorization: string | undefined) => Promise<Principal>;

export class AuthFailure extends Error {
  constructor(readonly status: 401 | 503, readonly code: "invalid_token" | "auth_unavailable") { super(code); }
}
const claimsSchema = z.object({
  sub: z.uuid(), client_id: z.uuid(), session_id: z.uuid(), role: z.literal("authenticated"),
  iat: z.number().int().nonnegative(), exp: z.number().int().positive(), is_anonymous: z.literal(false).optional(),
});

export function createAuthenticator(config: McpConfig, resolve: GrantResolver, getKey?: JWTVerifyGetKey): Authenticator {
  const issuer = `${config.supabaseUrl}/auth/v1`;
  const keys = getKey ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), { timeoutDuration: 5_000 });
  return async authorization => {
    if (!authorization || authorization.length > 16_384) throw new AuthFailure(401, "invalid_token");
    const token = /^Bearer ([^\s,]+)$/i.exec(authorization)?.[1];
    if (!token) throw new AuthFailure(401, "invalid_token");
    let identity: Identity;
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer, audience: config.resourceUrl, algorithms: ["ES256", "RS256"], clockTolerance: 5,
        requiredClaims: ["exp", "iat", "sub", "client_id", "session_id"],
      });
      const claims = claimsSchema.parse(payload);
      if (claims.iat > Date.now() / 1000 + 5 || claims.exp <= claims.iat) throw new Error("Invalid token times.");
      identity = { ownerId: claims.sub.toLowerCase(), clientId: claims.client_id.toLowerCase(), sessionId: claims.session_id.toLowerCase() };
    } catch (error) {
      if (error instanceof errors.JWKSTimeout || error instanceof TypeError) throw new AuthFailure(503, "auth_unavailable");
      throw new AuthFailure(401, "invalid_token");
    }
    let grant: Connection | null;
    try { grant = await resolve(identity); } catch { throw new AuthFailure(503, "auth_unavailable"); }
    if (grant === null) throw new AuthFailure(401, "invalid_token");
    const parsed = connectionSchema.safeParse(grant);
    if (!parsed.success || parsed.data.owner_id !== identity.ownerId || parsed.data.client_id !== identity.clientId
      || parsed.data.provider_session_id !== identity.sessionId) throw new AuthFailure(503, "auth_unavailable");
    return { ...identity, connectionId: parsed.data.id, permissions: parsed.data.permissions };
  };
}
