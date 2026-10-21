import { A2A_PROTOCOL_VERSION, type Skill } from "./protocol";

// Margaya's A2A Agent Card. The public card (/.well-known/agent-card.json)
// describes the endpoint, how to authenticate and the skills; it names no
// workspace, project, person or internal id. The extended card, for an
// authenticated caller, adds one interface per workspace the caller may
// delegate into, each with its slug as the A2A tenant.

const DOCS_URL = "https://margaya.app/docs/core/integrations/a2a";

type SkillCard = {
  id: Skill;
  name: string;
  description: string;
  tags: string[];
  examples: string[];
  inputModes: string[];
  outputModes: string[];
};

const MODES = ["text/plain", "application/json"];

const SKILL_CARDS: SkillCard[] = [
  {
    id: "create_task",
    name: "Create task",
    description:
      'Create a task in a project. Send a data part {"skill":"create_task","project":"<project slug or id>"} plus a text part: the first line is the title, the rest the description. Optional data fields: title, description, priority (no-priority, low, medium, high, urgent), status (a column slug), dueDate (ISO 8601). Completes at once with the created task.',
    tags: ["tasks", "project-management"],
    examples: ["Create a task in WEB: Fix the broken login redirect"],
    inputModes: MODES,
    outputModes: MODES,
  },
  {
    id: "triage_request",
    name: "Submit a request for triage",
    description:
      'Submit work to a project\'s intake queue, where people accept, decline or merge it. Data part {"skill":"triage_request","project":"<project slug or id>"} plus a text part (title, then description). The task stays submitted until someone triages it: accepted or duplicate completes it, declined rejects it. This is the default skill.',
    tags: ["intake", "triage", "requests"],
    examples: ["Request: Customers can't export invoices as PDF"],
    inputModes: MODES,
    outputModes: MODES,
  },
  {
    id: "ask_workspace",
    name: "Ask the workspace",
    description:
      'Ask a question answered from the tasks, pages and comments the caller can see, with cited sources. Data part {"skill":"ask_workspace"} (optionally "project") plus the question as text. Needs AI to be on for the workspace. Completes at once; the answer is not stored.',
    tags: ["search", "questions", "ai"],
    examples: ["What is blocking the 2.0 release?"],
    inputModes: MODES,
    outputModes: MODES,
  },
  {
    id: "run_agent",
    name: "Run a Margaya agent",
    description:
      'Hand a task to one of the workspace\'s Margaya agents. Data part {"skill":"run_agent","agent":"<agent name or id>","task":"<task id>"} plus the instructions as text. The run works with at most the caller\'s rights; risky changes wait for a person\'s approval in Margaya. Completes with the agent\'s summary.',
    tags: ["agents", "delegation", "ai"],
    examples: ["Split this task into subtasks and estimate each"],
    inputModes: MODES,
    outputModes: MODES,
  },
];

const AI_SKILLS: readonly Skill[] = ["ask_workspace", "run_agent"];

function agentVersion(): string {
  return process.env.npm_package_version || "1.0.0";
}

export function buildAgentCard(input: {
  baseUrl: string;
  aiEnabled: boolean;
  /** Workspace slugs for the extended card; omitted on the public card. */
  tenants?: string[];
}) {
  const endpoint = `${input.baseUrl}/api/a2a`;
  const generic = {
    url: endpoint,
    protocolBinding: "JSONRPC",
    protocolVersion: A2A_PROTOCOL_VERSION,
  };
  const supportedInterfaces =
    input.tenants && input.tenants.length > 0
      ? input.tenants.map((tenant) => ({ ...generic, tenant }))
      : [generic];
  return {
    name: "Margaya",
    description:
      "Project management for teams and their agents. Hand Margaya work as tasks or triage requests, ask questions about the workspace, or delegate to a Margaya agent; every action runs with the caller's own permissions and is recorded in the audit log.",
    supportedInterfaces,
    version: agentVersion(),
    documentationUrl: DOCS_URL,
    capabilities: {
      streaming: true,
      pushNotifications: false,
      extendedAgentCard: true,
    },
    securitySchemes: {
      bearer: {
        httpAuthSecurityScheme: {
          scheme: "Bearer",
          description:
            "A Margaya API key, or an OAuth access token from the authorization server below.",
        },
      },
      apiKey: {
        apiKeySecurityScheme: {
          location: "header",
          name: "x-api-key",
          description: "A Margaya API key.",
        },
      },
      oauth2: {
        oauth2SecurityScheme: {
          flows: {
            authorizationCode: {
              authorizationUrl: `${input.baseUrl}/api/mcp/authorize`,
              tokenUrl: `${input.baseUrl}/api/mcp/token`,
              scopes: {},
              pkceRequired: true,
            },
          },
          oauth2MetadataUrl: `${input.baseUrl}/.well-known/oauth-authorization-server/api`,
        },
      },
    },
    securityRequirements: [
      { schemes: { bearer: { list: [] } } },
      { schemes: { apiKey: { list: [] } } },
      { schemes: { oauth2: { list: [] } } },
    ],
    defaultInputModes: MODES,
    defaultOutputModes: MODES,
    skills: SKILL_CARDS.filter(
      (skill) => input.aiEnabled || !AI_SKILLS.includes(skill.id),
    ),
  };
}
