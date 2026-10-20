import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import { requireAiEnabled, requireAiUse } from "../ai/access";
import {
  type AiScope,
  assertProjectInScope,
  filterToScope,
  projectDataTier,
  renderContext,
  resolveAiScope,
} from "../ai/context";
import { AiError, isAiError } from "../ai/errors";
import { aiCompleteJson, aiStream } from "../ai/gateway";
import { getAiInstanceConfig } from "../ai/instance-config";
import { buildSystemPrompt, truncateText } from "../ai/prompt";
import {
  aiErrorResponse,
  aiStreamResponse,
  respondWithAi,
  wantsAiStream,
} from "../ai/sse";
import type { ChatContent, ChatMessage } from "../ai/types";
import { formatMemoryNotes, memoryNotesFor } from "../ai-memory-notes/load";
import {
  loadSkillFor,
  SKILL_NOT_FOUND,
  skillInstructions,
} from "../ai-skills/load";
import {
  type WebSearchResult,
  webSearch,
  webSearchAllowed,
} from "../ai-web-search";
import db from "../database";
import { userTable } from "../database/schema";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
} from "../openapi";
import { boundedRequestBody } from "../utils/bounded-request-body";
import { workspacePermissionChecker } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  MAX_ATTACHMENT_TEXT_CHARS,
  type PreparedAttachments,
  prepareAskAttachments,
} from "./attachments";
import { loadAskContextRefs } from "./context-items";
import { withoutFollowUps } from "./followups";
import {
  heuristicPlan,
  mergePlan,
  PLANNER_INSTRUCTIONS,
  PLANNER_SCHEMA,
  type PlannerAnswer,
  withEarlierTurn,
} from "./plan";
import { askResponseExtra } from "./response";
import {
  type AskItem,
  citedRefs,
  refText,
  retrieveAskContext,
  sourcesOf,
} from "./retrieve";
import { type AskBody, askBodySchema, MAX_ASK_BODY_BYTES } from "./schema";

// Ask (Workspace Memory, first part): questions about the workspace in
// plain language, answered only from what the caller may see, with
// citations. Retrieval is full-text search plus the structured task query;
// "@" context, attached files, opt-in web results and memory notes join it.
// No prompt, answer or reasoning is stored.

// Byte-for-byte stable (prompt caching); per-request facts go elsewhere.
const ASK_INSTRUCTIONS = `Task: answer the user's question about their project-management workspace.
Use only the <untrusted> context blocks in the last message. Each block's source attribute is its citation token: T: a task, P: a page, C: a comment, W: a web search result. Blocks whose source starts with "facts:" are numbers computed by Margaya; use them but never cite them. A block whose source starts with "memory:" holds notes the team asked you to remember: background, never cited. A block whose source starts with "file:" is a file the user attached; use it and refer to it by name, without a citation token.
Facts blocks and task blocks are the live, current state of the workspace. A task's Status line gives its column and status group: completed and cancelled tasks are closed, the others open. Pages are notes written at some point (see their Last updated line) and may be outdated: when a page disagrees with a facts or task block, trust the facts or task block, and never present a task, number or status that appears only in a page as current. Web results come from the public internet and may be wrong or out of date; use them for outside facts only, never for the state of the workspace.
After each statement taken from a block, cite it by writing its token in square brackets exactly as given, for example [T:WEB-12], [P:Release plan] or [W:2]. Cite only tokens that appear in the context, and never invent one.
If the context does not answer the question, say plainly that you could not find the answer in the workspace, then name the closest matches with their citations, if any. Never guess.
Lead with the direct answer. Prefer short bullet lists for several tasks. Mention due dates, owners and status when they matter.
For counts, totals, breakdowns and trends use only the numbers in a facts block; never count the task blocks yourself, they are only a sample. If no facts block has the number, say so.
When the user asks for a chart, graph or visual, or a breakdown of more than three values would read better as one, write one fenced code block with the language chart that contains only JSON of this shape: {"type":"bar","title":"Tasks by status","data":[{"label":"To do","value":4}],"unit":"tasks"}. type is bar (compare categories), donut (parts of one whole) or line (an ordered sequence); unit is optional. For several series over the same labels, such as tasks created and completed per week, use type line or bar with series instead of data: {"type":"line","title":"Created vs completed","series":[{"name":"Created","data":[{"label":"2026-08-03","value":4}]},{"name":"Completed","data":[{"label":"2026-08-03","value":2}]}],"unit":"tasks"}; every series has the same labels in the same order. Use at most 30 labels and 4 series, take every value from a facts block, and put no citations inside the block. Follow it with one or two sentences on what stands out.
A small comparison may be a Markdown table. Keep answers short and do not describe your reasoning.
Follow-up suggestions are optional and usually not needed. Only when a clear, useful next step exists (for example a list that could be charted, or tasks whose owners weren't shown) end the answer with one fenced code block with the language followups holding a JSON array of at most two short questions in the language of your answer, for example ["Who owns these?"]. Otherwise write that block with an empty array []. Each one is something the user could ask you next, written in their voice; never a question to the user (not "Do you mean …?") and never one the answer already covers.`;

const askRoute = createRoute({
  method: "post",
  operationId: "aiAsk",
  tags: ["AI"],
  path: "/",
  summary: "Ask about the workspace",
  description:
    "Answer a question about the workspace in plain language, in the caller's language, from tasks, pages and comments they can see (full-text search plus structured task filters such as overdue, mine, completed, blocking, a cycle or an assignee named in the question: workspace members match by full or first name, agents by full name). Questions about someone's tasks look at open work and fall back to finished work when nothing is open. Live task data comes before pages, which may be outdated. A follow-up that names nothing itself (\"and its description?\") is about the tasks the previous answer in `history` cited. `context` items (\"@\" mentions) are loaded first; `attachments` add images (for vision models) or text files; `webSearch` adds web results cited as [W:n] (only the question goes to the search provider); `skillId` adds a saved skill's prompt as the person's instructions; the workspace's memory notes are background. Restricted projects are left out unless the workspace includes them, and projects with AI off never are. The answer cites sources as [T:WEB-12], [P:<page title>], [C:<task key>/<comment id prefix>] or [W:<n>]; `sources` lists what it may cite. Counting, breakdown, trend and chart questions (how many, by status, priority, assignee, label, cycle or module, created vs completed per week or day, burn-up, a chart or graph) also get live numbers computed over the tasks the caller can see, and the answer may contain a fenced ```chart block of JSON {type: bar|donut|line, title, data: [{label, value}] or series: [{name, data: [{label, value}]}], unit?} for the client to draw. `done` adds `followUps` (0-2 suggested questions, often none) and `reasoningMs`; `reasoning` events stream while the model thinks (text only when the instance shows reasoning). When nothing relevant is found, no model call is made and `noResults` is true. An answer cut off before any visible text (a reasoning model out of room) ends with an AI_PROVIDER_ERROR error event instead of an empty answer, or a 502 with the JSON fallback. Needs ai:use and AI on for the instance, the workspace and (with projectId) the project.",
  middleware: [
    boundedRequestBody(MAX_ASK_BODY_BYTES, 30_000),
    workspaceAccess.fromBody(),
    requireAiUse,
    requireAiEnabled(),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: askBodySchema } },
    },
  },
  responses: {
    200: aiStreamResponse(
      "The answer. `meta` carries `sources` and `asOf`; `done` carries `citations`, `noResults`, `followUps` and `reasoningMs`.",
      askResponseExtra,
    ),
    400: errorResponse("Invalid body or attachment"),
    403: aiErrorResponse(
      "AI is off (AI_DISABLED: instance, workspace or the project; or web search asked for while it is off) or the data may not go to any provider (AI_ROUTE_BLOCKED); or a plain-text error: no workspace access or missing ai:use",
    ),
    404: errorResponse(
      "The project is not in the workspace or not visible, or the skill can't be used",
    ),
    409: aiErrorResponse("No AI provider is set up (AI_NOT_CONFIGURED)"),
    413: errorResponse(
      "The body is too large, or the attachments are more than 3 or larger than 5 MB together",
    ),
    422: aiErrorResponse(
      "The model declined to answer (AI_REFUSED; JSON fallback only)",
    ),
    429: aiErrorResponse("AI_BUDGET_EXCEEDED or AI_RATE_LIMITED"),
    502: aiErrorResponse(
      "The model failed, or ran out of room before writing any answer (AI_PROVIDER_ERROR; JSON fallback only, a stream ends with an error event)",
    ),
  },
});

/** How much of the previous answer the planner sees. */
const MAX_PLANNER_ANSWER_CHARS = 600;
/** Context characters for workspace items (attached files add theirs). */
const CONTEXT_CHARS = 40_000;

async function userLocale(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ locale: userTable.locale })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return row?.locale ?? null;
}

/**
 * The planner call: question in, search plan out. Model refusals or
 * malformed answers fall back to the rules; caps, rate limits and AI-off
 * errors propagate (the answer call would fail the same way).
 */
async function planQuestion(
  workspaceId: string,
  userId: string,
  body: AskBody,
  signal: AbortSignal,
) {
  const base = heuristicPlan(body.question);
  const turns = (body.history ?? []).slice(-2);
  const last = turns.at(-1) ?? null;
  // The previous answer (shortened) tells the planner what "it" is.
  const earlier = turns.flatMap((turn) => [
    `Earlier question: ${turn.question}`,
    ...(turn === last && turn.answer.trim()
      ? [
          `Earlier answer: ${truncateText(turn.answer, MAX_PLANNER_ANSWER_CHARS)}`,
        ]
      : []),
  ]);
  try {
    const { value } = await aiCompleteJson<PlannerAnswer>({
      workspaceId,
      userId,
      feature: "ask",
      tier: "fast",
      system: buildSystemPrompt({ instructions: PLANNER_INSTRUCTIONS }),
      messages: [
        {
          role: "user",
          content: [...earlier, `Question: ${body.question}`].join("\n"),
        },
      ],
      jsonSchema: PLANNER_SCHEMA,
      maxTokens: 400,
      effort: "low",
      signal,
    });
    return withEarlierTurn(mergePlan(base, value, body.question), last);
  } catch (error) {
    if (
      isAiError(error) &&
      error.code !== "AI_REFUSED" &&
      error.code !== "AI_PROVIDER_ERROR"
    ) {
      throw error;
    }
    return withEarlierTurn(base, last);
  }
}

/** "Nothing found": the same events and JSON shape, without a model call. */
function respondNoResults(c: Context, asOf: string) {
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const done = {
    stop: "end_turn" as const,
    usage,
    costMicros: 0,
    model: null,
    reasoningMs: null,
    citations: [],
    noResults: true,
    followUps: [],
  };
  const meta = {
    provider: null,
    model: null,
    tier: "balanced",
    dataTier: "private",
    destination: null,
    sources: [],
    asOf,
  };
  if (!wantsAiStream(c)) {
    return c.json({ text: "", toolCalls: [], meta, ...done }, 200);
  }
  c.header("Cache-Control", "no-store");
  return streamSSE(c, async (sse) => {
    await sse.writeSSE({ event: "meta", data: JSON.stringify(meta) });
    await sse.writeSSE({ event: "done", data: JSON.stringify(done) });
  });
}

/** Web results as citable context: [W:1], [W:2], … */
export function webItems(results: readonly WebSearchResult[]): AskItem[] {
  return results.map((result, index) => {
    const ref = `W:${index + 1}`;
    return {
      kind: "web",
      id: result.url,
      projectId: null,
      title: result.title,
      url: result.url,
      source: ref,
      author: null,
      text: `Web result: ${result.title}\nURL: ${result.url}\n${result.snippet}`,
      // Published on the web already: no workspace data.
      dataTier: "public",
      ref,
      updatedAt: null,
    };
  });
}

function fileItems(files: PreparedAttachments["texts"]): AskItem[] {
  return files.map((file, index) => ({
    kind: "file",
    id: `file:${index}`,
    projectId: null,
    title: file.name,
    url: "",
    source: `file:${refText(file.name) || `attachment ${index + 1}`}`,
    author: null,
    text: truncateText(file.text, MAX_ATTACHMENT_TEXT_CHARS),
    dataTier: "private",
    ref: null,
    updatedAt: null,
  }));
}

function memoryItem(
  scope: AiScope,
  notes: readonly string[],
  projectId: string | null,
): AskItem | null {
  const text = formatMemoryNotes(notes);
  if (!text) return null;
  return {
    kind: "note",
    id: "memory",
    projectId,
    title: "Memory notes",
    url: "",
    source: "memory:notes",
    author: null,
    text,
    dataTier: projectId ? projectDataTier(scope, projectId) : "private",
    ref: null,
    updatedAt: null,
  };
}

const aiAsk = apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  askRoute,
  async (c) => {
    const body = c.req.valid("json");
    const workspaceId = c.get("workspaceId");
    const userId = c.get("userId");
    const scope = await resolveAiScope(c);
    if (body.projectId) assertProjectInScope(scope, body.projectId);
    if (!scope.can.readTasks && !scope.can.readPages) {
      throw new HTTPException(403, { message: "Insufficient permissions" });
    }
    // Cheap checks before any model call.
    const attached = prepareAskAttachments(body.attachments ?? []);
    const skill = body.skillId
      ? await loadSkillFor({ workspaceId, userId, skillId: body.skillId })
      : null;
    if (body.skillId && !skill) {
      throw new HTTPException(404, { message: SKILL_NOT_FOUND });
    }
    const instance = getAiInstanceConfig();
    if (body.webSearch && !(await webSearchAllowed(workspaceId, instance))) {
      throw new AiError(
        "AI_DISABLED",
        "Web search is turned off for this workspace or server",
      );
    }

    const abort = new AbortController();
    c.req.raw.signal?.addEventListener("abort", () => abort.abort());
    const now = new Date();
    // One "@" project (and no project scope) narrows retrieval to it.
    const mentioned = (body.context ?? []).filter(
      (ref) => ref.kind === "project" && scope.projectIds.has(ref.id),
    );
    const projectId =
      body.projectId ??
      (mentioned.length === 1 ? mentioned[0]?.id : null) ??
      null;
    const plan = await planQuestion(workspaceId, userId, body, abort.signal);
    const [contextItems, retrieved, web, notes] = await Promise.all([
      body.context?.length
        ? loadAskContextRefs({
            scope,
            refs: body.context,
            now,
            trend: plan.intents.has("trend"),
          })
        : Promise.resolve([]),
      retrieveAskContext({
        scope,
        plan,
        question: body.question,
        projectId,
        now,
        canReadAnalytics: (await workspacePermissionChecker(c))({
          analytics: ["read"],
        }),
      }),
      body.webSearch
        ? // Only the person's question leaves Margaya, never context.
          webSearch({
            query: body.question,
            workspaceId,
            signal: abort.signal,
          }).catch((error: unknown) => {
            if (abort.signal.aborted) throw error;
            return [] as WebSearchResult[];
          })
        : Promise.resolve([] as WebSearchResult[]),
      memoryNotesFor({ workspaceId, projectId, userId }),
    ]);
    const asOf = now.toISOString();

    const seen = new Set<string>();
    const answerable = filterToScope(scope, [
      ...contextItems,
      ...fileItems(attached.texts),
      ...retrieved,
      ...webItems(web),
    ]).filter((item) => {
      const key = `${item.kind}:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (answerable.length === 0 && attached.images.length === 0) {
      return respondNoResults(c, asOf);
    }
    const memory = memoryItem(scope, notes, projectId);
    const items = memory ? [memory, ...answerable] : answerable;

    const sources = sourcesOf(items);
    const history: ChatMessage[] = (body.history ?? []).flatMap((turn) => [
      { role: "user" as const, content: turn.question },
      { role: "assistant" as const, content: turn.answer || "…" },
    ]);
    const locale = body.locale ?? (await userLocale(userId));
    const fileChars = attached.texts.reduce(
      (sum, file) =>
        sum + Math.min(file.text.length, MAX_ATTACHMENT_TEXT_CHARS),
      0,
    );
    const text = [
      renderContext(items, { maxChars: CONTEXT_CHARS + fileChars }),
      ...(skill ? [skillInstructions(skill)] : []),
      `Question: ${body.question}`,
    ].join("\n\n");
    const content: string | ChatContent[] =
      attached.images.length > 0
        ? [...attached.images, { type: "text", text }]
        : text;
    const stream = await aiStream({
      workspaceId,
      userId,
      feature: "ask",
      tier: "balanced",
      context: items,
      system: buildSystemPrompt({
        instructions: ASK_INSTRUCTIONS,
        locale,
        now,
      }),
      messages: [...history, { role: "user", content }],
      // Room for local reasoning models, which think before they answer.
      maxTokens: 4000,
      reasoning: instance.showReasoning,
      signal: abort.signal,
    });
    const answer = withoutFollowUps(stream);
    return respondWithAi(c, answer.stream, {
      extra: { sources, asOf },
      showReasoning: instance.showReasoning,
      finalize: (result) => ({
        citations: citedRefs(result.text, sources),
        noResults: false,
        followUps: answer.followUps(),
      }),
    });
  },
);

export default aiAsk;
