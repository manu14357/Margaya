import { describe, expect, it } from "vitest";
import {
  checkNewPassword,
  PASSWORD_MIN_LENGTH,
} from "../../../apps/api/src/utils/password-policy";

function code(password: string, email?: string) {
  return checkNewPassword(password, { email })?.code ?? null;
}

describe("checkNewPassword", () => {
  it("requires at least 10 characters", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10);
    expect(code("Tr0ub4dor")).toBe("PASSWORD_TOO_SHORT");
    expect(code("x".repeat(129))).toBe("PASSWORD_TOO_LONG");
  });

  it("accepts a long, uncommon passphrase", () => {
    expect(code("correct horse battery staple")).toBeNull();
    expect(code("violet-otter-harbor-42")).toBeNull();
  });

  it("refuses passwords from the bundled common list, in any case", () => {
    expect(code("1234567890")).toBe("PASSWORD_TOO_COMMON");
    expect(code("QWERTYUIOP")).toBe("PASSWORD_TOO_COMMON");
    expect(code("1q2w3e4r5t")).toBe("PASSWORD_TOO_COMMON");
  });

  it("refuses a common word dressed up with digits and symbols", () => {
    expect(code("Password2024!")).toBe("PASSWORD_TOO_COMMON");
    expect(code("!!welcome!!123")).toBe("PASSWORD_TOO_COMMON");
    expect(code("Margaya12345")).toBe("PASSWORD_TOO_COMMON");
  });

  it("refuses repeated characters, runs and digits only", () => {
    expect(code("aaaaaaaaaaaa")).toBe("PASSWORD_TOO_COMMON");
    expect(code("abababababab")).toBe("PASSWORD_TOO_COMMON");
    expect(code("abcdefghijkl")).toBe("PASSWORD_TOO_COMMON");
    expect(code("8462951730")).toBe("PASSWORD_TOO_COMMON");
  });

  it("refuses the account's email address or its local part", () => {
    expect(code("Jordan.Lee@example.com", "jordan.lee@example.com")).toBe(
      "PASSWORD_MATCHES_EMAIL",
    );
    expect(code("jordan.lee.dev", "jordan.lee.dev@example.com")).toBe(
      "PASSWORD_MATCHES_EMAIL",
    );
    expect(code("jordan.lee.dev", "someone@example.com")).toBeNull();
  });

  it("never echoes the password in its message", () => {
    const result = checkNewPassword("Password2024!");
    expect(result?.message).not.toContain("Password2024!");
  });
});
