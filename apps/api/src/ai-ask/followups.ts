import type { AiResult, AiStream } from "../ai/gateway";
import type { ChatDelta } from "../ai/types";

// Follow-up suggestions: the answer model ends with a fenced ```followups
// block holding a JSON array of short questions. The block is cut out of the
// streamed text (held back while it could be starting) and parsed once the
// answer is complete; `chart` blocks and citations are untouched.

export const MAX_FOLLOW_UPS = 2;
const MAX_FOLLOW_UP_CHARS = 160;
const MARK = "```followups";

/** Cleans the model's suggestions: short single-line questions, no refs. */
export function cleanFollowUps(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value
      .replace(/\[[TPCW]:[^\]\n]{1,100}\]/g, "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_FOLLOW_UP_CHARS);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= MAX_FOLLOW_UPS) break;
  }
  return out;
}

function parseBlock(body: string): string[] {
  const end = body.indexOf("```");
  const raw = (end === -1 ? body : body.slice(0, end)).trim();
  try {
    return cleanFollowUps(JSON.parse(raw));
  } catch {
    // Some models wrap the array in stray markup (a closing tag after it):
    // parse the first JSON array in the block before falling back.
    const array = /\[[\s\S]*?\](?=\s*(?:<|$))/.exec(raw)?.[0];
    if (array) {
      try {
        return cleanFollowUps(JSON.parse(array));
      } catch {
        // Fall through to the line list.
      }
    }
    // Others write a list instead of JSON; tag-like lines are dropped.
    return cleanFollowUps(
      raw
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
        .filter((line) => line && !/^<\/?[\w:.-]+[^>]*>$/.test(line))
        .map((line) => line.replace(/^"|",?$/g, "")),
    );
  }
}

const JSON_MARK = "```json";
const TRAILING_LIST = /```(?:json)?[ \t]*\r?\n?\s*(\[[\s\S]*?\])\s*```\s*$/;

/**
 * A ```json block that ends the answer and holds only 1–5 short strings:
 * follow-up questions under the wrong label. Anything else is left alone.
 */
export function trailingQuestionList(
  text: string,
): { start: number; followUps: string[] } | null {
  const match = TRAILING_LIST.exec(text);
  if (!match?.[1]) return null;
  let values: unknown;
  try {
    values = JSON.parse(match[1]);
  } catch {
    return null;
  }
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.length > 5 ||
    !values.every((v) => typeof v === "string" && v.length <= 200)
  ) {
    return null;
  }
  const followUps = cleanFollowUps(values);
  return followUps.length ? { start: match.index, followUps } : null;
}

/** The answer without its follow-up block, and the parsed suggestions. */
export function splitFollowUps(text: string): {
  text: string;
  followUps: string[];
} {
  const start = text.indexOf(MARK);
  if (start === -1) {
    // Some models label the block ```json instead; only a final block that
    // is just a short list of questions counts.
    const trailing = trailingQuestionList(text);
    return trailing
      ? {
          text: text.slice(0, trailing.start).trimEnd(),
          followUps: trailing.followUps,
        }
      : { text, followUps: [] };
  }
  const body = text.slice(start + MARK.length);
  const close = body.indexOf("```");
  const after = close === -1 ? "" : body.slice(close + 3);
  return {
    text: `${text.slice(0, start)}${after}`.trimEnd(),
    followUps: parseBlock(body),
  };
}

/** Streams text without the follow-up block (held back while it may start). */
export function followUpCutter() {
  let pending = "";
  let cut = false;
  // A ```json block is held until we know whether it ends the answer as a
  // mislabelled follow-up list (dropped) or is ordinary content (released).
  let held = "";
  return {
    push(chunk: string): string {
      if (cut) return "";
      if (held) {
        held += chunk;
        const close = held.indexOf("```", JSON_MARK.length);
        if (close === -1) return "";
        // Text after the closed block means it isn't the answer's end.
        if (held.slice(close + 3).trim()) {
          const out = held;
          held = "";
          return out;
        }
        return "";
      }
      pending += chunk;
      const start = pending.indexOf(MARK);
      if (start !== -1) {
        cut = true;
        // The whitespace before the block is not part of the answer.
        const out = pending.slice(0, start).trimEnd();
        pending = "";
        return out;
      }
      const json = pending.indexOf(JSON_MARK);
      if (json !== -1) {
        held = pending.slice(json);
        const out = pending.slice(0, json);
        pending = "";
        return out;
      }
      let keep = 0;
      const longest = Math.max(MARK.length, JSON_MARK.length) - 1;
      for (let n = Math.min(longest, pending.length); n > 0; n--) {
        const tail = pending.slice(-n);
        if (MARK.startsWith(tail) || JSON_MARK.startsWith(tail)) {
          keep = n;
          break;
        }
      }
      // Trailing whitespace waits too: it may precede the block.
      const ready = pending.slice(0, pending.length - keep);
      const out = ready.trimEnd();
      pending = pending.slice(out.length);
      return out;
    },
    flush(): string {
      if (cut) {
        pending = "";
        return "";
      }
      const rest = held ? (trailingQuestionList(held) ? "" : held) : pending;
      pending = "";
      held = "";
      return rest;
    },
  };
}

/**
 * The stream with the follow-up block cut out of its text deltas and its
 * result; `followUps()` answers once the result has settled.
 */
export function withoutFollowUps(stream: AiStream): {
  stream: AiStream;
  followUps: () => string[];
} {
  let followUps: string[] = [];
  const cutter = followUpCutter();
  async function* deltas(): AsyncIterable<ChatDelta> {
    for await (const delta of stream.deltas) {
      if (delta.type !== "text") {
        if (delta.type === "stop") {
          const rest = cutter.flush();
          if (rest) yield { type: "text", text: rest };
        }
        yield delta;
        continue;
      }
      const text = cutter.push(delta.text);
      if (text) yield { type: "text", text };
    }
  }
  const result = stream.result.then((value): AiResult => {
    const split = splitFollowUps(value.text);
    followUps = split.followUps;
    return { ...value, text: split.text };
  });
  result.catch(() => {});
  return {
    stream: { ...stream, deltas: deltas(), result },
    followUps: () => followUps,
  };
}
