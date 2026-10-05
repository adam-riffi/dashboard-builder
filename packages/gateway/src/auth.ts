import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose";

export interface AuthConfig {
  jwksUrl: string;
  issuer: string;
  audience: string;
}

/** Which claim identifies the user, and the format its value must have (DESIGN.md §6). */
export interface IdentityConfig {
  claim: string;
  format: "uuid" | "int" | RegExp;
}

/** Verifies a token's signature, issuer, audience and expiry; returns its claims. */
export type Verifier = (token: string) => Promise<JWTPayload>;

/** Raised for any request that must get a 401; the message is safe to return. */
export class AuthError extends Error {}

const FORMATS = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  // Fits int8 with room to spare, so a bound parameter never overflows.
  int: /^-?\d{1,18}$/,
};

/**
 * JWT verification against a JWKS endpoint; keys are fetched once and refreshed by jose. The URL
 * is read on the first token, not here: Next.js evaluates the config at build time.
 */
export function jwtAuth({ jwksUrl, issuer, audience }: AuthConfig): Verifier {
  let keys: ReturnType<typeof createRemoteJWKSet> | undefined;
  return async (token) => {
    keys ??= createRemoteJWKSet(new URL(jwksUrl));
    // jose checks exp only when present; a token without one would never expire.
    return (await jwtVerify(token, keys, { issuer, audience, requiredClaims: ["exp"] })).payload;
  };
}

/**
 * Authenticates a request: a valid bearer token whose identity claim has the configured
 * format. Values that do not match are rejected before any query runs.
 */
export async function authenticate(
  request: Request,
  verify: Verifier,
  identity: IdentityConfig,
): Promise<{ id: string; claims: JWTPayload }> {
  // The scheme is case-insensitive (RFC 9110).
  const token = /^Bearer (\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) throw new AuthError("Missing bearer token");

  let claims: JWTPayload;
  try {
    claims = await verify(token);
  } catch (error) {
    // jose's reason (expired, bad signature, wrong audience) is logged, never returned.
    throw new AuthError("Invalid token", { cause: error });
  }

  const value = claims[identity.claim];
  // A copy without g/y: those flags make test() stateful, alternating answers per request.
  const pattern =
    typeof identity.format === "string"
      ? FORMATS[identity.format]
      : new RegExp(identity.format.source, identity.format.flags.replace(/[gy]/g, ""));
  const id = typeof value === "string" || typeof value === "number" ? String(value) : undefined;
  if (id === undefined || !pattern.test(id)) {
    throw new AuthError(`Identity claim ${identity.claim} is malformed`);
  }
  return { id, claims };
}
