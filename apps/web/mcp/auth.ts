import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTVerifyGetKey } from "jose";
import { z } from "zod";

export type Principal = { ownerId: string; clientId: string; sessionId: string };

export type TokenVerifier = (authorization: string | null) => Promise<Principal | null>;

const claimsSchema = z.object({
  sub: z.uuid(),
  client_id: z.uuid(),
  session_id: z.uuid(),
  role: z.literal("authenticated"),
});

type VerifierOptions = {
  supabaseUrl: string;
  audiences: string[];
  isSessionActive: (principal: Principal) => Promise<boolean>;
  keys?: JWTVerifyGetKey;
};

// Only OAuth tokens carry client_id, so a browser session token cannot reach MCP tools
export function createTokenVerifier(options: VerifierOptions): TokenVerifier {
  const issuer = `${options.supabaseUrl}/auth/v1`;
  const keys =
    options.keys ??
    createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), { timeoutDuration: 5_000 });

  return async (authorization) => {
    const token = /^Bearer ([^\s,]+)$/i.exec(authorization ?? "")?.[1];
    if (!token || token.length > 16_384) return null;
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer,
        audience: options.audiences,
        algorithms: ["ES256", "RS256"],
        clockTolerance: 5,
      });
      const claims = claimsSchema.parse(payload);
      const principal = { ownerId: claims.sub, clientId: claims.client_id, sessionId: claims.session_id };
      return (await options.isSessionActive(principal)) ? principal : null;
    } catch {
      return null;
    }
  };
}
