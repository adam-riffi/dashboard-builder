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
  int: /^-?\d+$/,
};

/** JWT verification against a JWKS endpoint; keys are fetched once and refreshed by jose. */
export function jwtAuth({ jwksUrl, issuer, audience }: AuthConfig): Verifier {
  const keys = createRemoteJWKSet(new URL(jwksUrl));
  return async (token) => (await jwtVerify(token, keys, { issuer, audience })).payload;
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
  const token = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) throw new AuthError("Missing bearer token");

  let claims: JWTPayload;
  try {
    claims = await verify(token);
  } catch {
    // jose's reasons (expired, bad signature, wrong audience) stay server-side.
    throw new AuthError("Invalid token");
  }

  const value = claims[identity.claim];
  const pattern = typeof identity.format === "string" ? FORMATS[identity.format] : identity.format;
  const id = typeof value === "string" || typeof value === "number" ? String(value) : undefined;
  if (id === undefined || !pattern.test(id)) {
    throw new AuthError(`Identity claim ${identity.claim} is malformed`);
  }
  return { id, claims };
}
