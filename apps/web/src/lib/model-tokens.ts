// A model's control tokens and tool-call markup, as a local server without
// a tool-call parser prints them into the answer. The API strips them from
// new answers (apps/api/src/ai/provider/model-tokens.ts); this keeps answers
// stored before that, in notifications and runs, from showing them.

// Whole sections, each to its closing tag or, cut off, to the end.
const SECTIONS = [
  /<\|tool_calls_section_begin\|>[\s\S]*?(?:<\|tool_calls_section_end\|>|$)/g,
  /<\|tool_call_begin\|>[\s\S]*?(?:<\|tool_call_end\|>|$)/g,
  /<｜tool▁calls▁begin｜>[\s\S]*?(?:<｜tool▁calls▁end｜>|$)/g,
  /<tool_call>[\s\S]*?(?:<\/tool_call>|$)/g,
  /<\|start_header_id\|>[\s\S]*?(?:<\|end_header_id\|>\s*|$)/g,
  /<\|im_start\|>[^\n]*(?:\n|$)/g,
];
// Any other single token: <|im_end|>, <|eot_id|>, <｜end▁of▁sentence｜>…
const TOKENS = /<\|[A-Za-z0-9_.:-]{1,64}\|>|<｜[^｜<>\s]{1,64}｜>/g;
const ANY_TOKEN = /<\||<｜|<tool_call>/;

/** Text without a model's control tokens or tool-call sections. */
export function stripModelTokens(text: string): string {
  if (!ANY_TOKEN.test(text)) return text;
  let out = text;
  for (const section of SECTIONS) out = out.replace(section, "");
  return out.replace(TOKENS, "").trim();
}
