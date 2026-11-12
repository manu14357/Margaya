import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAgentCard } from "../../apps/api/src/a2a/card";
import {
  agentCardJwks,
  agentCardSigningKey,
  canonicalJson,
  signAgentCard,
  verifyAgentCard,
} from "../../apps/api/src/a2a/signing";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("JSON Canonicalization Scheme (RFC 8785)", () => {
  it("sorts keys by code unit, drops undefined and keeps arrays in order", () => {
    expect(
      canonicalJson({
        b: 1,
        a: [3, { d: true, c: null }],
        e: undefined,
        "€": "x",
        "1": 2,
      }),
    ).toBe('{"1":2,"a":[3,{"c":null,"d":true}],"b":1,"€":"x"}');
    expect(canonicalJson("é\n")).toBe('"é\\n"');
    expect(canonicalJson(1e21)).toBe("1e+21");
    expect(() => canonicalJson(Number.NaN)).toThrow();
  });
});

describe("signed Agent Card", () => {
  const card = buildAgentCard({
    baseUrl: "https://m.example",
    aiEnabled: true,
  });

  it("signs the card's canonical form and verifies with the published key", () => {
    vi.stubEnv("AUTH_SECRET", "a".repeat(40));
    const signed = signAgentCard(
      card,
      "https://m.example/api/.well-known/agent-card-jwks.json",
    );
    expect(signed.signatures).toHaveLength(1);
    const [key] = agentCardJwks().keys;
    expect(key).toMatchObject({
      kty: "OKP",
      crv: "Ed25519",
      alg: "EdDSA",
      use: "sig",
    });
    expect(
      verifyAgentCard(signed, key as { kty: string; crv: string; x: string }),
    ).toBe(true);
    // Re-signing replaces, never stacks, signatures.
    expect(signAgentCard(signed, "https://x").signatures).toHaveLength(1);
    // Field order doesn't matter (JCS); content does.
    const reordered = Object.fromEntries(Object.entries(signed).reverse());
    expect(
      verifyAgentCard(
        reordered,
        key as { kty: string; crv: string; x: string },
      ),
    ).toBe(true);
    expect(
      verifyAgentCard(
        { ...signed, version: "9.9.9" },
        key as { kty: string; crv: string; x: string },
      ),
    ).toBe(false);
  });

  it("derives one stable key per AUTH_SECRET", () => {
    const first = agentCardSigningKey("b".repeat(40));
    const again = agentCardSigningKey("b".repeat(40));
    const other = agentCardSigningKey("c".repeat(40));
    expect(again.kid).toBe(first.kid);
    expect(other.kid).not.toBe(first.kid);
    expect(first.publicJwk).not.toHaveProperty("d");
  });
});
