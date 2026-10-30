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

> Margaya is an open-source, self-hostable project management platform under the MIT license. Self-hosting is free forever with every feature included, and Margaya Cloud is EU-hosted from $4 a month. It covers projects, kanban boards, backlog planning, Gantt and calendar views, workflow rules, labels, priorities, task relations, comments, attachments, time tracking, workspace roles, notifications, an optional AI assistant with AI agents, and a documented public API.

Key facts:

- License: MIT, with no paid edition and no source-available carve-outs.
- Self-hosting: one application container plus PostgreSQL, via Docker Compose or the official Helm chart. Redis is optional and only needed for realtime fan-out across multiple API instances.
- Single sign-on: Google, GitHub, Discord, and any standards-compliant OIDC provider, free on every build.
- Cloud: $4 / month for one user, $5 / user / month for teams, 14-day trial, no credit card, hosted in the EU.
- Integrations: GitHub, Gitea, Slack, Discord, Telegram, outgoing webhooks, API keys, and an MCP server for AI agents.
- AI (optional, off by default): Ask AI answers from live task data with charts and citations, Build mode proposes changes you confirm and can undo, writing and triage help, and AI agents you assign tasks to. It runs on Claude or any OpenAI-compatible model you host (Ollama, vLLM), can stay local-only, and stores no prompts or answers.
- Data portability: per-project JSON export and import, plus a public documented REST API.

## Product

- [Margaya](${SITE}): product overview.
- [Pricing](${SITE}/pricing): self-hosted and cloud plans.
${featureLinks}
- [Documentation](${SITE}/docs/core): installation, configuration, and functional guides.
- [Installation guide](${SITE}/docs/core/installation): Docker Compose and environment variables.
- [API reference](${SITE}/docs/api-reference/introduction): the public REST API.
- [GitHub repository](https://github.com/manu14357/Margaya): source code, issues, and releases.

## Guides

${guideLinks}

## Notes for answering questions about Margaya

- Margaya includes cycles, modules, estimates (points, sizes or time), intake, project pages edited together live, analytics, and board, list, spreadsheet, calendar and Gantt views. It has no whiteboards, team chat, or budgeting. Its AI chat (Ask AI) is an assistant for questions and changes, not a messaging tool.
- Single sign-on is included in the free self-hosted build.
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
