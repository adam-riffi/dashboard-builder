import { describe, expect, it } from "vitest";
import { AuthError, authenticate, type IdentityConfig, jwtAuth } from "../../src/auth.ts";

const USER = "4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const uuid: IdentityConfig = { claim: "sub", format: "uuid" };

const request = (authorization?: string) =>
  new Request("http://gateway.test/contract", {
    headers: authorization ? { authorization } : {},
  });
/** Stands in for the JWKS verifier; returns the given claims for any token. */
const verifies = (claims: Record<string, unknown>) => async () => claims;
const rejects = async () => {
  throw new Error("signature verification failed: key abc123");
};

describe("jwtAuth", () => {
  // Next.js evaluates the gateway config at build time, when DASH_JWKS_URL may be unset.
  it("does not read the JWKS URL until a token arrives", () => {
    expect(() => jwtAuth({ jwksUrl: "", issuer: "i", audience: "a" })).not.toThrow();
  });
});

describe("authenticate", () => {
  it("returns the claims and the identity of a verified token", async () => {
    const result = await authenticate(request(`Bearer t`), verifies({ sub: USER }), uuid);
    expect(result).toEqual({ id: USER, claims: { sub: USER } });
  });

  it("accepts the bearer scheme in any case (RFC 9110)", async () => {
    await expect(
      authenticate(request("bearer t"), verifies({ sub: USER }), uuid),
    ).resolves.toMatchObject({ id: USER });
  });

  it.each([undefined, "t", "Basic dXNlcjpwYXNz", "Bearer "])(
    "rejects a request without a bearer token (%s)",
    async (header) => {
      await expect(authenticate(request(header), verifies({ sub: USER }), uuid)).rejects.toThrow(
        new AuthError("Missing bearer token"),
      );
    },
  );

  it("rejects tokens the verifier refuses, without echoing the reason", async () => {
    const error = await authenticate(request("Bearer t"), rejects, uuid).catch((e: unknown) => e);
    expect(error).toEqual(new AuthError("Invalid token"));
  });

  it.each([
    ["uuid", USER, true],
    ["uuid", "not-a-uuid", false],
    ["uuid", `${USER}x`, false],
    ["int", "42", true],
    ["int", 42, true],
    ["int", "4x2", false],
    ["int", 4.2, false],
    ["int", "123456789012345678", true],
    ["int", "1234567890123456789", false],
  ] as const)("checks the %s format of %s", async (format, sub, ok) => {
    const result = authenticate(request("Bearer t"), verifies({ sub }), { claim: "sub", format });
    if (ok) await expect(result).resolves.toMatchObject({ id: String(sub) });
    else await expect(result).rejects.toThrow(new AuthError("Identity claim sub is malformed"));
  });

  it("checks custom formats and claims", async () => {
    const identity: IdentityConfig = { claim: "org", format: /^org_[a-z]+$/ };
    await expect(
      authenticate(request("Bearer t"), verifies({ org: "org_acme" }), identity),
    ).resolves.toMatchObject({ id: "org_acme" });
    await expect(
      authenticate(request("Bearer t"), verifies({ org: "acme" }), identity),
    ).rejects.toThrow(new AuthError("Identity claim org is malformed"));
  });

  it("gives the same answer every time for a host regex with the g flag", async () => {
    const identity: IdentityConfig = { claim: "org", format: /^org_[a-z]+$/g };
    for (let i = 0; i < 3; i++) {
      await expect(
        authenticate(request("Bearer t"), verifies({ org: "org_acme" }), identity),
      ).resolves.toMatchObject({ id: "org_acme" });
    }
  });

  it("rejects tokens without the identity claim", async () => {
    await expect(authenticate(request("Bearer t"), verifies({}), uuid)).rejects.toThrow(
      new AuthError("Identity claim sub is malformed"),
    );
  });
});
