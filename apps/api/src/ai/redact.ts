// Optional PII redaction before a cloud call (B4). Emails, phone numbers,
// card and IBAN numbers and credential-looking tokens become placeholders
// like [EMAIL_1]; the same value always gets the same placeholder, so the
// model can still refer to it. The answer is restored before the user sees
// it, so redaction is invisible except to the provider.

export type RedactionKind = "EMAIL" | "PHONE" | "CARD" | "IBAN" | "SECRET";

type Rule = {
  kind: RedactionKind;
  pattern: RegExp;
  accept?: (s: string) => boolean;
};

const TOKEN =
  /(?:\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\b(?:sk-[A-Za-z0-9_-]{8,}|sk_live_[A-Za-z0-9]{8,}|pk_live_[A-Za-z0-9]{8,}|rk_live_[A-Za-z0-9]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|whsec_[A-Za-z0-9]{10,}|margaya_[A-Za-z0-9_-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}))/g;

const EMAIL =
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g;

const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g;

const CARD = /\b\d(?:[ -]?\d){12,18}\b/g;

// Candidates only; `isPhone` decides.
const PHONE =
  /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,5}(?:[\s.-]?\d{2,5}){1,4}/g;

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Luhn checksum, so ordinary long numbers are not taken for cards. */
export function passesLuhn(value: string): boolean {
  const d = digits(value);
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

function isPhone(value: string): boolean {
  const trimmed = value.trim();
  const count = digits(trimmed).length;
  if (count < 9 || count > 15) return false;
  // Dates and times are not phone numbers.
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(trimmed)) return false;
  if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/.test(trimmed)) return false;
  // A bare run of digits without separators or a "+" is more likely an id.
  return /[+\s().-]/.test(trimmed);
}

const RULES: Rule[] = [
  { kind: "SECRET", pattern: TOKEN },
  { kind: "EMAIL", pattern: EMAIL },
  { kind: "IBAN", pattern: IBAN, accept: (s) => digits(s).length >= 10 },
  { kind: "CARD", pattern: CARD, accept: passesLuhn },
  { kind: "PHONE", pattern: PHONE, accept: isPhone },
];

const PLACEHOLDER = /\[(EMAIL|PHONE|CARD|IBAN|SECRET)_(\d+)\]/g;
const MAX_PLACEHOLDER_LENGTH = 16;

export type Redactor = {
  /** Replaces sensitive values with placeholders. */
  redact(text: string): string;
  /** Puts the original values back. */
  restore(text: string): string;
  /** Restores a stream chunk by chunk; call `flush` at the end. */
  restoreStream(): { push(chunk: string): string; flush(): string };
  /** How many distinct values were replaced. */
  readonly count: number;
};

export function createRedactor(): Redactor {
  const byValue = new Map<string, string>();
  const byPlaceholder = new Map<string, string>();
  const counters: Record<RedactionKind, number> = {
    EMAIL: 0,
    PHONE: 0,
    CARD: 0,
    IBAN: 0,
    SECRET: 0,
  };

  const placeholderFor = (kind: RedactionKind, value: string) => {
    const existing = byValue.get(value);
    if (existing) return existing;
    counters[kind] += 1;
    const placeholder = `[${kind}_${counters[kind]}]`;
    byValue.set(value, placeholder);
    byPlaceholder.set(placeholder, value);
    return placeholder;
  };

  const restore = (text: string) =>
    text.replace(PLACEHOLDER, (match) => byPlaceholder.get(match) ?? match);

  return {
    get count() {
      return byValue.size;
    },
    redact(text) {
      let out = text;
      for (const rule of RULES) {
        out = out.replace(rule.pattern, (match) => {
          // Never re-redact a placeholder from an earlier rule.
          if (/^\[[A-Z]+_\d+\]$/.test(match)) return match;
          if (rule.accept && !rule.accept(match)) return match;
          return placeholderFor(rule.kind, match);
        });
      }
      return out;
    },
    restore,
    restoreStream() {
      let pending = "";
      return {
        push(chunk) {
          pending += chunk;
          // Hold back a possible placeholder that is still incomplete.
          const open = pending.lastIndexOf("[");
          const holdFrom =
            open !== -1 &&
            !pending.includes("]", open) &&
            pending.length - open <= MAX_PLACEHOLDER_LENGTH
              ? open
              : pending.length;
          const ready = pending.slice(0, holdFrom);
          pending = pending.slice(holdFrom);
          return restore(ready);
        },
        flush() {
          const rest = restore(pending);
          pending = "";
          return rest;
        },
      };
    },
  };
}
