/**
 * Escapes raw control characters (newlines, tabs) inside JSON strings.
 * Models without enforced structured output often put literal line breaks
 * in long string values, such as a translated Markdown page, which
 * JSON.parse rejects.
 */
function escapeControlCharsInStrings(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i] as string;
    if (inString) {
      if (char === "\\") {
        out += char + (text[i + 1] ?? "");
        i++;
        continue;
      }
      if (char === '"') inString = false;
      else if (char < " ") {
        out +=
          char === "\n"
            ? "\\n"
            : char === "\r"
              ? "\\r"
              : char === "\t"
                ? "\\t"
                : `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
        continue;
      }
    } else if (char === '"') inString = true;
    out += char;
  }
  return out;
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Retry with raw control characters escaped.
  }
  try {
    return JSON.parse(escapeControlCharsInStrings(text));
  } catch {
    return undefined;
  }
}

/**
 * The JSON in a model's answer: the whole text, else the first complete
 * object in it. Models without enforced structured output wrap it in code
 * fences or a sentence ("Here is the plan: {…}"). Undefined when none parses.
 * An object cut off before its closing brace (the answer hit the token
 * limit) is never returned, nor is an object nested inside another.
 */
export function parseJsonAnswer(text: string): unknown {
  const raw = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const whole = tryParse(raw);
  if (whole !== undefined) return whole;
  let start = raw.indexOf("{");
  while (start !== -1) {
    let depth = 0;
    let inString = false;
    let end = -1;
    for (let i = start; i < raw.length; i++) {
      const char = raw[i];
      if (inString) {
        if (char === "\\") i++;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    // Unclosed: the answer was cut off.
    if (end === -1) return undefined;
    const value = tryParse(raw.slice(start, end + 1));
    if (value !== undefined) return value;
    // Braces in prose ("{name}") before the real object: try the next
    // candidate after this one, never an object nested inside it.
    start = raw.indexOf("{", end + 1);
  }
  return undefined;
}
