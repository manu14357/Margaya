import { render } from "@react-email/render";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { OTP_EXPIRY_SECONDS } from "../otp-expiry";
import OtpEmail from "./otp";

describe("OtpEmail", () => {
  it("renders OTP and verification copy in HTML", async () => {
    const html = await render(createElement(OtpEmail, { otp: "123456" }));
    expect(html).toContain("123456");
    expect(html).toContain("verification code");
  });

  it.each([
    ["en-US", "This code expires in 5 minutes."],
    ["az-AZ", "Bu kod 5 dəqiqə ərzində etibarlıdır."],
    ["de-DE", "Dieser Code läuft in 5 Minuten ab."],
    ["el-GR", "Αυτός ο κωδικός λήγει σε 5 λεπτά."],
    ["es-ES", "Este código caduca en 5 minutos."],
    ["fr-FR", "Ce code expire dans 5 minutes."],
    ["hi-IN", "यह कोड 5 मिनट में समाप्त हो जाएगा।"],
    ["id-ID", "Kode ini berlaku selama 5 menit."],
    ["it-IT", "Questo codice scade tra 5 minuti."],
    ["ja-JP", "このコードの有効期限は5分です。"],
    ["ko-KR", "이 코드는 5분 후에 만료됩니다."],
    ["mk-MK", "Овој код истекува за 5 минути."],
    ["nl-NL", "Deze code verloopt over 5 minuten."],
    ["pl-PL", "Ten kod wygasa po 5 minutach."],
    ["pt-BR", "Este código expira em 5 minutos."],
    ["ru-RU", "Срок действия кода — 5 мин."],
    ["tr-TR", "Bu kod 5 dakika içinde geçerliliğini yitirir."],
    ["uk-UA", "Код діє 5 хв."],
    ["vi-VN", "Mã này sẽ hết hạn sau 5 phút."],
    ["zh-CN", "此验证码将在 5 分钟后失效。"],
  ])("describes the server expiry in %s", async (locale, expiry) => {
    expect(OTP_EXPIRY_SECONDS).toBe(300);
    const html = await render(
      createElement(OtpEmail, { otp: "123456", locale }),
    );
    expect(html).toContain(expiry);
    expect(html).not.toContain("15 minute");
  });
  it("says what an email verification code is for", async () => {
    const html = await render(
      createElement(OtpEmail, { otp: "123456", purpose: "email-verification" }),
    );
    expect(html).toContain("verify your email address");
    expect(html).not.toContain("finish signing in");
  });

  it("renders Japanese copy for a Japanese locale", async () => {
    const html = await render(
      createElement(OtpEmail, { otp: "123456", locale: "ja-JP" }),
    );
    expect(html).toContain("確認コード");
    expect(html).toContain("Margaya セキュリティメール");
  });
});
