import { generateKeyPair } from "jose";
import { afterAll, describe, expect, it } from "vitest";
import { jwtAuth } from "../../src/auth.ts";
import { AUDIENCE, ISSUER, startJwks, USER } from "./jwks.ts";

const jwks = await startJwks();
const stranger = await generateKeyPair("ES256");
const verify = jwtAuth({ jwksUrl: jwks.url, issuer: ISSUER, audience: AUDIENCE });

afterAll(() => jwks.close());

describe("jwtAuth", () => {
  it("verifies a token signed by a key from the JWKS", async () => {
    await expect(verify(await jwks.sign({ sub: USER }))).resolves.toMatchObject({ sub: USER });
  });

  it("rejects an expired token", async () => {
    await expect(verify(await jwks.sign({ sub: USER }, { exp: "-1m" }))).rejects.toThrow();
  });

  it("rejects a token without an expiry, which would never expire", async () => {
    await expect(verify(await jwks.sign({ sub: USER }, { exp: null }))).rejects.toThrow();
  });

  it("rejects a token for another audience", async () => {
    await expect(verify(await jwks.sign({ sub: USER, aud: "service_role" }))).rejects.toThrow();
  });

  it("rejects a token from another issuer", async () => {
    await expect(verify(await jwks.sign({ sub: USER, iss: "http://evil.test" }))).rejects.toThrow();
  });

  it("rejects a token signed by a key outside the JWKS", async () => {
    const token = await jwks.sign({ sub: USER }, { key: stranger.privateKey });
    await expect(verify(token)).rejects.toThrow();
  });

  it("rejects a malformed token", async () => {
    await expect(verify("not.a.jwt")).rejects.toThrow();
  });
});
