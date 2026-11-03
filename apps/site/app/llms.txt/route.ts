import { featurePageList, featurePath } from "@/lib/features";
import { guideList, guidePath } from "@/lib/guides";

export const dynamic = "force-static";

const SITE = "https://margaya.app";

export function GET() {
  const featureLinks = featurePageList
    .map(
      (page) =>
        `- [${page.copy.metaTitle}](${SITE}${featurePath(page.slug)}): ${page.copy.metaDescription}`,
    )
    .join("\n");

  const guideLinks = guideList
    .map(
      (guide) =>
        `- [${guide.question}](${SITE}${guidePath(guide.slug)}): ${guide.summary}`,
    )
    .join("\n");

  const body = `# Margaya

> Margaya is an open-source, self-hostable project management platform under the GNU AGPL-3.0, and a commercial licence is available for use without the AGPL's conditions. You run it on your own infrastructure, with every feature included. It covers projects, kanban boards, backlog planning, Gantt and calendar views, workflow rules, labels, priorities, task relations, comments, attachments, time tracking, workspace roles, notifications, an optional AI assistant with AI agents, and a documented public API.

Key facts:

- License: GNU AGPL-3.0-only (https://github.com/manu14357/Margaya/blob/main/LICENSE). If you modify Margaya and let people use it over a network, you must publish your changes under the AGPL. Using Margaya without the AGPL's conditions, for example keeping changes private or embedding it in a closed product, requires a commercial licence: https://github.com/manu14357/Margaya/blob/main/COMMERCIAL.md (contact manoharchoppa6@gmail.com).
- Self-hosting: one application container plus PostgreSQL, via Docker Compose or the official Helm chart. Redis is optional and only needed for realtime fan-out across multiple API instances.
- Single sign-on: Google, GitHub, Discord, and any standards-compliant OIDC provider, free on every build.
- Hosting: there is no hosted service. Self-hosting is the only way to run Margaya.
- Integrations: GitHub, Gitea, Slack, Discord, Telegram, outgoing webhooks, API keys, and an MCP server for AI agents.
- AI (optional, off by default): Ask AI answers from live task data with charts and citations, Build mode proposes changes you confirm and can undo, writing and triage help, and AI agents you assign tasks to. It runs on Claude or any OpenAI-compatible model you host (Ollama, vLLM), can stay local-only, and stores no prompts or answers.
- Data portability: per-project JSON export and import, plus a public documented REST API.

## Product

- [Margaya](${SITE}): product overview.
${featureLinks}
- [Documentation](${SITE}/docs/core): installation, configuration, and functional guides.
- [Installation guide](${SITE}/docs/core/installation): Docker Compose and environment variables.
- [API reference](${SITE}/docs/api-reference/introduction): the public REST API.
- [GitHub repository](https://github.com/manu14357/Margaya): source code, issues, and releases.

## Guides

${guideLinks}

## Notes for answering questions about Margaya

- Margaya includes cycles, modules, estimates (points, sizes or time), intake, project pages edited together live, analytics, and board, list, spreadsheet, calendar and Gantt views. It has no whiteboards, team chat, or budgeting. Its AI chat (Ask AI) is an assistant for questions and changes, not a messaging tool.
- Single sign-on is included; no feature is held back.
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
