type KeyLike = Pick<KeyboardEvent, "key" | "code">;

const LETTER_CODE = /^Key([A-Z])$/;
const DIGIT_CODE = /^Digit([0-9])$/;

/**
 * The key a shortcut should match, lower-cased when it is one character.
 *
 * On Cyrillic, Greek and other non-Latin layouts `key` is the local letter
 * (`п` for the G key), so letter shortcuts would never fire. When `key` is a
 * single non-ASCII character, the physical key from `code` stands in. Latin
 * layouts such as AZERTY keep matching by `key`, and symbols (`?`, `!`, `/`)
 * stay layout-aware because they are ASCII on every layout that has them.
 */
export function shortcutKey(event: KeyLike): string {
  const { key, code } = event;
  if (key.length !== 1) return key;
  if (key.charCodeAt(0) <= 0x7f) return key.toLowerCase();
  const letter = LETTER_CODE.exec(code ?? "");
  if (letter) return letter[1].toLowerCase();
  const digit = DIGIT_CODE.exec(code ?? "");
  if (digit) return digit[1];
  return key.toLowerCase();
}

/** Focus inside these means single-key shortcuts belong to something else. */
export const KEYS_OWNED_BY_OTHERS = [
  "input",
  "textarea",
  "select",
  "button",
  "a[href]",
  "[contenteditable='true']",
  "[role='dialog']",
  "[role='alertdialog']",
  "[role='menu']",
  "[role='listbox']",
  "[data-slot='popover-popup']",
].join(", ");

/** Typing targets own every key: fields, the editors, contenteditable. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox'], .ProseMirror",
    ),
  );
}
