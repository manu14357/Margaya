// A model's control tokens and tool-call markup, printed as plain text when
// the server serving it doesn't parse them (a local server started without a
// tool-call parser, a chat template that doesn't match the model). None of it
// is ever part of an answer: tokens are dropped, and tool calls written as
// text are parsed so a run doesn't lose them.

export type TextToolCall = { name: string; input: Record<string, unknown> };

type Section = {
  open: string;
  close: string;
  /** How its body becomes tool calls; absent: dropped. */
  parse?: (body: string) => TextToolCall[];
  /** Whitespace right after it is part of it (a role header's newlines). */
  trimAfter?: boolean;
};

const NAME = /^[A-Za-z0-9_.-]{1,128}$/;

function objectOf(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return objectOf(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A call, unless its name or its (possibly cut off) arguments are invalid. */
function call(name: string, args: unknown): TextToolCall[] {
  const clean = name.trim();
  const input = objectOf(args);
  return NAME.test(clean) && input ? [{ name: clean, input }] : [];
}

/** `functions.add_comment:0<|tool_call_argument_begin|>{…}` per call. */
function parsePipeCalls(body: string): TextToolCall[] {
  const parts = body.includes("<|tool_call_begin|>")
    ? body.split("<|tool_call_begin|>").slice(1)
    : [body];
  return parts.flatMap((part) => {
    const [header = "", args = ""] = part
      .replace(/<\|tool_call_end\|>[\s\S]*$/, "")
      .split("<|tool_call_argument_begin|>");
    const name = header
      .trim()
      .replace(/^functions\./, "")
      .replace(/:\d+$/, "");
    return name ? call(name, args.trim() || "{}") : [];
  });
}

/** `function<｜tool▁sep｜>name\n```json\n{…}\n```` per call. */
function parseFullwidthCalls(body: string): TextToolCall[] {
  return body
    .split("<｜tool▁call▁begin｜>")
    .slice(1)
    .flatMap((part) => {
      const inner = part.replace(/<｜tool▁call▁end｜>[\s\S]*$/, "");
      const afterSep = inner.split("<｜tool▁sep｜>")[1] ?? "";
      const newline = afterSep.indexOf("\n");
      const name = newline === -1 ? afterSep : afterSep.slice(0, newline);
      const rest = newline === -1 ? "" : afterSep.slice(newline + 1);
      const fenced = rest.match(/```(?:json)?\s*([\s\S]*?)```/);
      return call(name, (fenced?.[1] ?? rest).trim() || "{}");
    });
}

/** `{"name": "…", "arguments": {…}}` inside <tool_call> tags. */
function parseJsonCall(body: string): TextToolCall[] {
  const value = objectOf(body.trim());
  if (!value || typeof value.name !== "string") return [];
  return call(value.name, value.arguments ?? value.parameters ?? {});
}

const SECTIONS: Section[] = [
  {
    open: "<|tool_calls_section_begin|>",
    close: "<|tool_calls_section_end|>",
    parse: parsePipeCalls,
  },
  {
    open: "<|tool_call_begin|>",
    close: "<|tool_call_end|>",
    parse: parsePipeCalls,
  },
  {
    open: "<｜tool▁calls▁begin｜>",
    close: "<｜tool▁calls▁end｜>",
    parse: parseFullwidthCalls,
  },
  { open: "<tool_call>", close: "</tool_call>", parse: parseJsonCall },
  {
    open: "<|start_header_id|>",
    close: "<|end_header_id|>",
    trimAfter: true,
  },
  // "<|im_start|>assistant\n": the role's name runs to the line's end.
  { open: "<|im_start|>", close: "\n" },
];

// Any other single token: <|im_end|>, <|eot_id|>, <｜end▁of▁sentence｜>…
const TOKEN = /<\|[A-Za-z0-9_.:-]{1,64}\|>|<｜[^｜<>\s]{1,64}｜>/;
// A tail that could still grow into a token or a section's opening tag.
const POSSIBLE_START = /<[^\s<>]{0,80}$/;

/**
 * Removes control tokens and tool-call sections from streamed text, tags
 * split across chunks included. `push` returns the visible text, and
 * `takeCalls()` the tool calls the sections held.
 */
export function modelTokenFilter() {
  let pending = "";
  let inside: Section | null = null;
  let trimNext = false;
  let calls: TextToolCall[] = [];

  const close = (section: Section, body: string) => {
    if (section.parse) calls.push(...section.parse(body));
    if (section.trimAfter) trimNext = true;
  };

  const emit = (text: string) => {
    if (!trimNext) return text;
    const trimmed = text.replace(/^\s+/, "");
    if (trimmed) trimNext = false;
    return trimmed;
  };

  return {
    push(chunk: string): string {
      pending += chunk;
      let out = "";
      for (;;) {
        if (inside) {
          const end = pending.indexOf(inside.close);
          if (end === -1) return out;
          close(inside, pending.slice(0, end));
          pending = pending.slice(end + inside.close.length);
          inside = null;
          continue;
        }
        let first: { index: number; section?: Section; length: number } | null =
          null;
        for (const section of SECTIONS) {
          const index = pending.indexOf(section.open);
          if (index !== -1 && (!first || index < first.index)) {
            first = { index, section, length: section.open.length };
          }
        }
        const token = TOKEN.exec(pending);
        if (token && (!first || token.index < first.index)) {
          first = { index: token.index, length: token[0].length };
        }
        if (first) {
          out += emit(pending.slice(0, first.index));
          pending = pending.slice(first.index + first.length);
          if (first.section) inside = first.section;
          continue;
        }
        const tail = POSSIBLE_START.exec(pending);
        const keep = tail ? pending.length - tail.index : 0;
        out += emit(pending.slice(0, pending.length - keep));
        pending = pending.slice(pending.length - keep);
        return out;
      }
    },
    /** The rest at the end; an unclosed section is dropped, its calls kept. */
    flush(): string {
      if (inside) {
        close(inside, pending);
        inside = null;
        pending = "";
        return "";
      }
      const rest = emit(pending);
      pending = "";
      return rest;
    },
    /** Tool calls parsed since the last call. */
    takeCalls(): TextToolCall[] {
      const taken = calls;
      calls = [];
      return taken;
    },
  };
}

/** Text without control tokens or tool-call sections (calls discarded). */
export function stripModelTokens(text: string): string {
  const filter = modelTokenFilter();
  return (filter.push(text) + filter.flush()).trim();
}
