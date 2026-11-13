# Margaya MCP server

[`@margaya/mcp`](https://www.npmjs.com/package/@margaya/mcp) is the official MCP (Model Context Protocol) server for [Margaya](https://margaya.app), the open source project management platform. It is maintained in the [manu14357/Margaya](https://github.com/manu14357/Margaya) monorepo and published to npm by the Margaya team.

It runs over stdio, signs in with Margaya's device flow, and then calls the Margaya API with a bearer token. The package lives in `packages/mcp` in this monorepo and exposes the `margaya-mcp` CLI.

> **Tip:** Every Margaya instance also ships a built-in HTTP MCP endpoint at `/api/mcp`. If your MCP client supports Streamable HTTP transport (e.g. Claude Code), you can connect directly without this package. See the [MCP docs](https://margaya.app/docs/core/integrations/mcp) for details.

## Prerequisites

- Node.js 24+
- A running Margaya API (for example `http://localhost:1337`) and web app (for device approval UI).

Margaya allows `margaya-cli` and `margaya-mcp` by default, so you usually do not need extra server configuration.

If you want to run this server with a different client ID, allow it on the Margaya server:

```bash
DEVICE_AUTH_CLIENT_IDS=margaya-cli,margaya-mcp,your-client-id
```

## Environment

| Variable | Description |
|----------|-------------|
| `MARGAYA_API_URL` | Margaya API origin (default `http://localhost:1337`). Do not include `/api`. |
| `MARGAYA_MCP_CLIENT_ID` | Device-flow client id (default `margaya-mcp`). Must match `DEVICE_AUTH_CLIENT_IDS` on the server. |
| `MARGAYA_API_KEY` | **Optional.** A Margaya API key (create one under Settings → Account → Developer). When set, the server authenticates with it as a Bearer token and skips the interactive device flow. Use this for headless/Docker setups. |

## Install

**Recommended (no global install):** run the interactive installer with npx:

```bash
npx @margaya/mcp
```

npm downloads the package, then an **interactive menu** (arrow keys + Enter) asks **where** to register the server (Cursor user-wide, Cursor project, Claude Desktop, or a custom JSON path). It then merges a `mcpServers` entry that points at this package's `dist/index.js` with your current Node binary.

In a normal terminal, `npx @margaya/mcp` and `margaya-mcp` with no subcommand both start the installer. When the process is **not** attached to a TTY (for example when Cursor launches the MCP server with a pipe), the same entry runs the stdio MCP server instead.

To run the server manually from a shell (for example to debug stdio), use:

```bash
npx @margaya/mcp serve
```

If you prefer a global install:

```bash
npm install -g @margaya/mcp
margaya-mcp
```

(`margaya-mcp install` is the same installer with an explicit subcommand.)

Non-interactive example (Cursor user config, skip overwrite prompts):

```bash
margaya-mcp install --target cursor-user -y
```

Point at a self-hosted API when generating the config:

```bash
margaya-mcp install --target cursor-user -y --api-url https://margaya.example.com
```

See all options:

```bash
margaya-mcp install --help
```

If you are currently inside the local `packages/mcp` package directory, npm may resolve the local workspace package instead of the published one and fail to expose the bin. In that case, either run `npx` from outside `packages/mcp`, or use a local build:

```bash
node dist/index.js
```

The published package includes `dist/`. `prepublishOnly` runs the build before publish.

## Develop from source

From the repo root:

```bash
pnpm install
pnpm --filter @margaya/mcp run build
pnpm --filter @margaya/mcp run start
pnpm --filter @margaya/mcp run test
```

Or run it from the package directory:

```bash
pnpm -C packages/mcp run build
```

The CLI entry points to `./dist/index.js`. Use `npx @margaya/mcp` or `margaya-mcp` after a global install so your IDE config points at the resolved path.

## Authentication

On the first tool call that needs Margaya, the server:

1. Requests a device code from `POST /api/auth/device/code`
2. Prints the verification URL and user code to `stderr`
3. Tries to open the browser
4. Polls `POST /api/auth/device/token` until approved
5. Stores the access token at `~/.config/margaya-mcp/credentials.json` with mode `0600`

### Non-interactive (API key)

For headless or sandboxed environments where opening a browser is impractical, set `MARGAYA_API_KEY` to a key created under Settings → Account → Developer. The server sends it as a Bearer token on every request and skips the device flow entirely, so no token is cached to disk.

## Tools

- Session: `whoami`, `list_workspaces`, `list_workspace_members`, `list_notifications`
- Search: `search`
- Projects: `list_projects`, `get_project`, `create_project`, `update_project`, `list_project_columns`
- Tasks: `list_tasks`, `get_task`, `create_task`, `update_task`, `delete_task`, `move_task`, `update_task_status`, `update_task_assignee`, `set_task_assignees`, `update_task_assignees`, `update_task_due_date`, `list_task_activity`
- Time entries: `list_task_time_entries`, `get_time_entry`, `create_time_entry`, `update_time_entry`
- Comments: `list_task_comments`, `create_task_comment`, `update_task_comment`, `delete_task_comment`
- Labels: `list_workspace_labels`, `create_label`, `attach_label_to_task`, `detach_label_from_task`, `delete_label`
- Task relations: `create_task_relation`, `get_task_relations`, `delete_task_relation`
- Cycles: `list_cycles`, `get_cycle`, `create_cycle`, `update_cycle`, `delete_cycle`, `set_cycle_archived`, `update_cycle_tasks`, `set_task_cycle`, `transfer_cycle_tasks`
- Modules: `list_modules`, `get_module`, `create_module`, `update_module`, `delete_module`, `set_module_archived`, `list_module_tasks`, `update_module_tasks`, `set_task_modules`, `add_module_link`, `delete_module_link`
- Pages: `list_pages`, `get_page`, `create_page`, `update_page`, `replace_page_content`, `set_page_archived`, `delete_page`
- Intake: `list_intake_items`, `get_intake_item`, `submit_intake_item`, `update_intake_item`, `triage_intake_item`, `delete_intake_item`
- Project updates: `list_project_updates`, `get_project_update`, `draft_project_update`, `create_project_update`
- Agents: `list_agents`, `run_agent`, `get_agent_run`

Call `list_project_columns` before setting a status: the column slugs it
returns are the values `create_task` and `update_task_status` accept.
`list_workspace_members` resolves the user IDs the assignee tools expect.
A task can have up to 20 assignees: `set_task_assignees` replaces the list,
`update_task_assignees` adds or removes people and keeps the rest, and
`update_task_assignee` replaces everyone with one person.
There is no `delete_time_entry` tool yet.

Cycle and module dates are calendar days (`YYYY-MM-DD`). The cycle, module,
page and intake tools answer with the API's own message when a project has the
feature turned off. `triage_intake_item` checks what each action needs
before calling the API: `accept` needs `status`, `snooze` needs a future
`until`, and `duplicate` needs `duplicateOfTaskId`. Page content is markdown:
`get_page` returns it as `contentMarkdown`, and `replace_page_content` replaces
the whole document. `search` also finds pages.

`run_agent` starts one of the workspace's Margaya agents on a task and returns
the run's `id` and `status`; follow it with `get_agent_run`. Approve held
changes and answer the agent's questions in Margaya. (The HTTP endpoint at
`/api/mcp` can also return the run as an MCP Tasks handle.)

## Releasing

Bump `version` in `packages/mcp/package.json` and merge to `main`. The [publish workflow](../../.github/workflows/publish-mcp.yml) runs the package tests, publishes the new version to npm, and creates a `mcp-v<version>` GitHub release. Nothing is published while the version stays the same, so tool changes reach npm only once the version is bumped.

Publishing a GitHub release manually also works: tag it `mcp-v<version>` with the tag version matching `packages/mcp/package.json` on the tagged commit.
