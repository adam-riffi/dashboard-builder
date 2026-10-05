import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, type JWTPayload, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jwtAuth } from "../../src/auth.ts";

// A local JWKS endpoint and real ES256 tokens, the way Supabase Auth signs them.
const ISSUER = "http://auth.test/auth/v1";
const AUDIENCE = "authenticated";

const { publicKey, privateKey } = await generateKeyPair("ES256");
const stranger = await generateKeyPair("ES256");
const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256", use: "sig" }] };

const server = createServer((_, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(jwks));
});
let verify: ReturnType<typeof jwtAuth>;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  verify = jwtAuth({
    jwksUrl: `http://127.0.0.1:${port}/auth/v1/.well-known/jwks.json`,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const sign = (claims: JWTPayload, options: { key?: CryptoKey; exp?: string } = {}) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", kid: "k1" })
    .setIssuedAt()
    .setExpirationTime(options.exp ?? "5m")
    .sign(options.key ?? privateKey);

const valid = { sub: "4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f", iss: ISSUER, aud: AUDIENCE };

describe("jwtAuth", () => {
  it("verifies a token signed by a key from the JWKS", async () => {
    await expect(verify(await sign(valid))).resolves.toMatchObject({ sub: valid.sub });
  });

  it("rejects an expired token", async () => {
    await expect(verify(await sign(valid, { exp: "-1m" }))).rejects.toThrow();
  });

  it("rejects a token for another audience", async () => {
    await expect(verify(await sign({ ...valid, aud: "service_role" }))).rejects.toThrow();
  });

  it("rejects a token from another issuer", async () => {
    await expect(verify(await sign({ ...valid, iss: "http://evil.test" }))).rejects.toThrow();
  });

  it("rejects a token signed by a key outside the JWKS", async () => {
    await expect(verify(await sign(valid, { key: stranger.privateKey }))).rejects.toThrow();
  });

  it("rejects a malformed token", async () => {
    await expect(verify("not.a.jwt")).rejects.toThrow();
  });
});
