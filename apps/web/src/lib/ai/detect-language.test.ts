import { describe, expect, it } from "vitest";
import {
  detectLanguage,
  proseOf,
  shouldOfferTranslation,
} from "./detect-language";

describe("detectLanguage", () => {
  it.each([
    ["en", "The login page is broken and we should fix it before the release."],
    [
      "de",
      "Die Anmeldung ist nicht möglich, wir können das Problem nicht finden.",
    ],
    [
      "es",
      "La página no carga cuando el usuario está en el móvil y no hay red.",
    ],
    [
      "fr",
      "La page ne se charge pas et nous ne savons pas pourquoi avec ce compte.",
    ],
    [
      "it",
      "Il pulsante non funziona e la pagina della ricerca è vuota per gli utenti.",
    ],
    ["nl", "De pagina werkt niet en het formulier is leeg voor de gebruikers."],
    ["pl", "Strona nie działa i nie wiem, czy to jest problem z serwerem."],
    [
      "pt",
      "A página não carrega e o botão de salvar está desativado para você.",
    ],
    ["tr", "Giriş sayfası çalışmıyor ve bu sorun için daha çok bilgi gerekli."],
    [
      "az",
      "Giriş səhifəsi işləmir və bu problem üçün daha çox məlumat lazımdır.",
    ],
    ["id", "Halaman masuk tidak bisa dibuka dan kami belum tahu karena apa."],
    ["vi", "Trang đăng nhập không hoạt động và chúng tôi chưa biết tại sao."],
    ["ru", "Страница входа не работает, и мы не знаем почему."],
    ["uk", "Сторінка входу не працює, і ми не знаємо чому."],
    ["mk", "Страницата за најава не работи и не знаеме зошто."],
    ["el", "Η σελίδα σύνδεσης δεν λειτουργεί και δεν ξέρουμε γιατί."],
    ["hi", "लॉगिन पेज काम नहीं कर रहा है और हमें कारण नहीं पता।"],
    ["ko", "로그인 페이지가 작동하지 않으며 이유를 모르겠습니다."],
    ["ja", "ログインページが動作しません。理由が分かりません。"],
    ["zh", "登录页面无法使用，我们还不知道原因是什么。"],
  ])("recognizes %s", (language, text) => {
    expect(detectLanguage(text)).toBe(language);
  });

  it("answers null for short or unclear text", () => {
    expect(detectLanguage("ok")).toBeNull();
    expect(detectLanguage("+1 👍")).toBeNull();
    expect(
      detectLanguage("WEB-12 WEB-13 https://example.com/a/b/c"),
    ).toBeNull();
  });

  it("ignores code, links, mentions and task keys", () => {
    const prose = proseOf(
      "See `const x = 1` and https://example.com @mia WEB-12 ```js\ncode\n```",
    );
    expect(prose).not.toContain("const");
    expect(prose).not.toContain("example");
    expect(prose).not.toContain("mia");
    expect(prose).not.toContain("WEB-12");
  });
});

describe("shouldOfferTranslation", () => {
  it("offers another known language and not the reader's own", () => {
    const german =
      "Die Anmeldung ist nicht möglich, wir können das nicht finden.";
    expect(shouldOfferTranslation(german, "en-US")).toBe(true);
    expect(shouldOfferTranslation(german, "de-DE")).toBe(false);
  });

  it("offers unknown text only in a clearly different script", () => {
    const unknownLatin =
      "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod";
    expect(shouldOfferTranslation(unknownLatin, "en-US")).toBe(false);
    expect(shouldOfferTranslation(unknownLatin, "ru-RU")).toBe(true);
    expect(shouldOfferTranslation("ok", "ja-JP")).toBe(false);
  });
});
