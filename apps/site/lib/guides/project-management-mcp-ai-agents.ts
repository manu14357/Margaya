import type { Guide } from "./types";

export const projectManagementMcpAiAgents: Guide = {
  slug: "project-management-mcp-ai-agents",
  question: "How do I connect AI agents to my project tracker with MCP?",
  title: "Connect AI agents to Margaya with MCP",
  description:
    "Connect Claude, Cursor and other AI clients to Margaya through the Model Context Protocol: the built-in HTTP endpoint, the stdio package, what agents can do, and how to keep them within safe limits.",
  summary:
    "Point an AI client at your Margaya server, approve it, and keep what it can change within limits you choose.",
  answer:
    "Model Context Protocol (MCP) is the standard way AI clients such as Claude, Cursor and Codex use outside tools. Every Margaya instance has a built-in MCP endpoint at /api/mcp. Add its address to your client, approve the client in Margaya, and the agent works with your permissions. For clients that only support stdio, the @margaya/mcp package runs locally and signs in with a device code.",
  topic: "connect",
  timeNeeded: "10 minutes",
  before: [
    "A Margaya account on Margaya Cloud or your own server",
    "An MCP client, such as Claude Desktop, Claude Code, Cursor or Codex",
  ],
  sections: [
    {
      heading: "What an agent can do",
      body: [
        "The MCP server exposes the same building blocks as the web app. An agent can read and change only what the person who approved it can. If a project has a feature switched off, the matching tools say so instead of working around it.",
      ],
      items: [
        {
          name: "Tasks",
          body: "List, read, create and update tasks; move them between columns; change status, assignees and due dates; read their activity; and delete to the trash or restore.",
        },
        {
          name: "Planning",
          body: "Create and update cycles and modules, add or remove tasks, and transfer unfinished work from one cycle to the next.",
        },
        {
          name: "Pages",
          body: "List, read, create and update project pages. Page content is Markdown, so an agent can draft a spec or a release note in place.",
        },
        {
          name: "Intake",
          body: "Submit requests to a project's intake queue, and triage them when the person has permission to.",
        },
        {
          name: "Everything around the work",
          body: "Search, comments, labels, task relations, time entries, workspace members and notifications.",
        },
      ],
    },
    {
      heading: "Connect a client over HTTP",
      body: [
        "This is the recommended way. There's nothing to install on the server: the endpoint is part of every Margaya instance.",
      ],
      steps: [
        {
          title: "Find your endpoint",
          body: [
            "Your MCP address is your Margaya address followed by `/api/mcp`.",
          ],
          code: {
            label: "MCP endpoint",
            content: "https://pm.example.com/api/mcp",
          },
        },
        {
          title: "Add it to your client",
          body: [
            "Each client has its own way to add a remote MCP server. Two common ones:",
          ],
          code: {
            label: "Claude Code",
            content:
              "claude mcp add --transport http margaya https://pm.example.com/api/mcp",
          },
          callout: {
            tone: "note",
            title: "Cursor and other JSON configs",
            body: 'Add an entry such as `"margaya": { "url": "https://pm.example.com/api/mcp" }` under `mcpServers` in the client\'s MCP configuration file.',
          },
        },
        {
          title: "Sign in and approve",
          body: [
            "The first time the client connects, your browser opens Margaya. Sign in, check the client's name, and approve it. The endpoint uses OAuth 2.1 with PKCE, so the client never sees your password, and every tool call runs as you.",
          ],
        },
        {
          title: "Start with a read-only request",
          body: [
            "Ask for something that changes nothing first, so you can see how the agent reads your workspace. Then try a small change you can easily check.",
          ],
          bullets: [
            "What's overdue in the Website project, and who owns it?",
            "Summarise what changed in the current cycle this week.",
            "Create a task in Website called Update the pricing FAQ, assign it to me, due Friday.",
          ],
          callout: {
            tone: "tip",
            title: "Columns are statuses",
            body: "Agents get the best results when they look up a project's columns before setting a status. The tools return the exact column names a task can move to.",
          },
        },
      ],
    },
    {
      heading: "Use the stdio package instead",
      body: [
        "Some clients only run local MCP servers. For those, use the official `@margaya/mcp` package. It needs Node.js 24 or newer.",
      ],
      steps: [
        {
          title: "Run the installer",
          body: [
            "The interactive installer registers the server with Cursor, Claude Desktop or a custom JSON config. Point it at your own instance with `--api-url`, without `/api` at the end.",
          ],
          code: {
            label: "Terminal",
            content: `npx @margaya/mcp
# or, without prompts:
margaya-mcp install --target cursor-user -y --api-url https://pm.example.com`,
          },
        },
        {
          title: "Approve the device sign-in",
          body: [
            "On the first tool call, the package shows a link and a short code, and opens your browser where it can. Approve the sign-in in Margaya. Credentials are stored in `~/.config/margaya-mcp/credentials.json` on your machine.",
          ],
        },
      ],
    },
    {
      heading: "Keep agents within safe limits",
      body: [
        "An agent can do anything its person can do, and it does it quickly. A few habits keep that useful rather than risky.",
      ],
      items: [
        {
          name: "Give automations their own account",
          body: "For unattended agents, sign in with a separate account whose role only allows what the job needs. Custom roles can be created in Settings > Workspace > Roles.",
        },
        {
          name: "Let agents propose, people decide",
          body: "Have agents submit findings to a project's intake queue instead of the board. Nothing reaches the board until a person accepts it.",
        },
        {
          name: "Deleting is recoverable",
          body: "Deleted tasks go to the trash and can be restored, by a person or by the agent.",
        },
        {
          name: "Expire API keys",
          body: "The HTTP endpoint also accepts an API key, with its owner's permissions. Create keys in Settings > Account > Developer with an expiry date, and revoke them when the job is done. The audit log records each key created or revoked.",
        },
      ],
    },
  ],
  faq: [
    {
      question: "Which AI clients work with Margaya?",
      answer:
        "Any client that supports MCP over Streamable HTTP or stdio. That includes Claude Desktop, Claude Code, Cursor and Codex. The HTTP endpoint supports both the current stateless protocol and the earlier session-based one.",
    },
    {
      question: "Does Margaya send my data to an AI provider?",
      answer:
        "Not unless you turn its AI on. Margaya's own AI features are off by default; when an admin turns them on, Margaya sends only what the person asking can already see to the model the admin chose, Claude or a model you run yourself, and keeps no prompts or answers. An MCP client you connect reads data under that client's own terms.",
    },
    {
      question: "Can an agent see private pages?",
      answer:
        "Only its own person's. The agent has exactly the access of the account that approved it, and private pages are visible only to their owner.",
    },
    {
      question: "Does this work on a self-hosted server?",
      answer:
        "Yes. The MCP endpoint is part of every install, with no extra service to run. Your MCP client needs to be able to reach your Margaya address.",
    },
  ],
  next: [
    {
      label: "MCP server reference",
      href: "/docs/core/integrations/mcp",
      description: "Every tool, authentication details and limits.",
    },
    {
      label: "Review requests with intake",
      href: "/docs/core/functional/intake",
      description: "A queue where agent and human requests wait for review.",
    },
    {
      label: "API reference",
      href: "/docs/api-reference/introduction",
      description: "The REST API behind the MCP tools.",
    },
  ],
  updatedOn: "2026-10-15",
};
