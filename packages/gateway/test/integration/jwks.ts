import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, type JWTPayload, SignJWT } from "jose";

export const ISSUER = "http://auth.test/auth/v1";
export const AUDIENCE = "authenticated";
export const USER = "4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

/** A local JWKS endpoint and real ES256 tokens, the way Supabase Auth signs them. */
export async function startJwks() {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256", use: "sig" };
  const server = createServer((_, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/auth/v1/.well-known/jwks.json`,
    /** Signs with the JWKS key; `exp: null` leaves the expiry claim out. */
    sign: (claims: JWTPayload, options: { key?: CryptoKey; exp?: string | null } = {}) => {
      const jwt = new SignJWT({ iss: ISSUER, aud: AUDIENCE, ...claims })
        .setProtectedHeader({ alg: "ES256", kid: "k1" })
        .setIssuedAt();
      if (options.exp !== null) jwt.setExpirationTime(options.exp ?? "5m");
      return jwt.sign(options.key ?? privateKey);
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
