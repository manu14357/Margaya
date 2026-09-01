import { afterEach, describe, expect, it } from "vitest";
import {
  currentSmtpConfig,
  getSmtpTransportOptions,
  isSmtpConfigured,
  type SmtpConfig,
  setSmtpConfigProvider,
  smtpConfigFromEnv,
  smtpTransportOptions,
} from "./smtp-config";
import { getSmtpTransport, resetSmtpTransport } from "./smtp-transport";

const base: SmtpConfig = {
  host: "smtp.example.test",
  port: 587,
  security: "starttls",
  user: "me",
  password: "pw",
  from: "Margaya <no-reply@example.test>",
};

afterEach(() => {
  setSmtpConfigProvider(null);
  resetSmtpTransport();
});

describe("the default provider", () => {
  it("reproduces today's environment rules", () => {
    const env = {
      SMTP_HOST: "relay.internal",
      SMTP_PORT: "25",
      SMTP_SECURE: "false",
      SMTP_REQUIRE_TLS: "false",
      SMTP_FROM: "a@example.test",
    };
    const config = smtpConfigFromEnv(env);
    expect(config).toEqual({
      host: "relay.internal",
      port: 25,
      security: "none",
      user: "",
      password: "",
      from: "a@example.test",
    });
    const fromConfig = smtpTransportOptions(config);
    const legacy = getSmtpTransportOptions(env);
    expect(fromConfig).toEqual(legacy);
  });

  it("maps the security flags", () => {
    expect(smtpConfigFromEnv({}).security).toBe("tls");
    expect(smtpConfigFromEnv({ SMTP_SECURE: "false" }).security).toBe(
      "starttls",
    );
    expect(
      smtpConfigFromEnv({ SMTP_SECURE: "false", SMTP_REQUIRE_TLS: "false" })
        .security,
    ).toBe("none");
  });

  it("still refuses SMTP_IGNORE_TLS", () => {
    expect(() => smtpConfigFromEnv({ SMTP_IGNORE_TLS: "true" })).toThrow(
      "SMTP_IGNORE_TLS=true is no longer supported",
    );
  });
});

describe("security mapping", () => {
  it("keeps certificate validation and only authenticates with both values", () => {
    expect(smtpTransportOptions({ ...base, security: "tls" })).toMatchObject({
      secure: true,
      ignoreTLS: false,
    });
    expect(smtpTransportOptions(base)).toMatchObject({
      secure: false,
      requireTLS: true,
      auth: { user: "me", pass: "pw" },
    });
    expect(
      smtpTransportOptions({ ...base, security: "none", password: "" }),
    ).toEqual({
      host: "smtp.example.test",
      port: 587,
      secure: false,
      requireTLS: false,
      ignoreTLS: false,
    });
    expect(smtpTransportOptions({ ...base, port: null }).port).toBeUndefined();
  });
});

describe("installed provider", () => {
  it("drives isSmtpConfigured and the current config", () => {
    setSmtpConfigProvider(() => base);
    expect(isSmtpConfigured()).toBe(true);
    expect(currentSmtpConfig()).toBe(base);
    setSmtpConfigProvider(() => ({ ...base, from: "" }));
    expect(isSmtpConfigured()).toBe(false);
    setSmtpConfigProvider(() => null);
    expect(isSmtpConfigured()).toBe(false);
  });

  it("reuses the transport for the same settings and rebuilds for new ones", () => {
    let config = base;
    setSmtpConfigProvider(() => config);
    const first = getSmtpTransport();
    expect(getSmtpTransport()).toBe(first);
    config = { ...base, password: "rotated" };
    const second = getSmtpTransport();
    expect(second).not.toBe(first);
    expect(getSmtpTransport()).toBe(second);
  });
});
