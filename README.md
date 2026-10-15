<p align="center">
  <img src="apps/web/public/logo-dark.svg" alt="Margaya logo" width="240" />
</p>

<div align="center">

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/manu14357/Margaya/ci.yml?branch=main)](https://github.com/manu14357/Margaya/actions)

</div>

<div align="center">
  <h3>
    <a href="https://margaya.app/docs/core">Quick Start</a>
    <span> | </span>
    <a href="https://margaya.app">Website</a>
  </h3>
</div>

## What is Margaya?

Margaya is a self-hosted project management platform for teams who want to plan, track, and ship work without wading through a bloated tool. It stays out of your way: a clean interface, fast performance, and only the features that earn their place.

Under the hood, Margaya gives you real project-management depth:

- **Boards** for kanban-style workflows, plus a **list/backlog** view for planning
- **Calendar** and **Gantt** views for scheduling and dependencies
- **Subtasks and relations** to break down and connect work
- **Custom fields** to track whatever matters to your team
- **Time tracking** built into every task
- **Workflow rules** to automate status changes and routine actions
- Integrations with **GitHub, Gitea, Slack, Discord, Mattermost, Telegram**, and outbound **webhooks**
- A built-in **MCP server** so AI tools can read and manage your tasks
- **20 languages**, with more added through community translations

Because Margaya is self-hosted, your data stays on your own infrastructure. It's open source under a permissive MIT license, so you can inspect it, extend it, and run it however you like.

Learn more in the [documentation](https://margaya.app/docs/core).

## Getting Started

### Quick Start with Docker Compose

The fastest way to try Margaya is with Docker Compose. This sets up Margaya and PostgreSQL with a single Margaya container:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    env_file:
      - .env
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-margaya}
      POSTGRES_DB: ${POSTGRES_DB:-margaya}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", 'pg_isready -U "$${POSTGRES_USER}" -d "$${POSTGRES_DB}"']
      interval: 10s
      timeout: 5s
      retries: 5

  margaya:
    image: ghcr.io/manu14357/margaya:latest
    ports:
      - "5173:5173"
    env_file:
      - .env
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped

volumes:
  postgres_data:
```

Save this as `compose.yml`, copy `.env.sample` to `.env`, uncomment `MARGAYA_CLIENT_URL=http://localhost:5173`, and set `POSTGRES_PASSWORD=<password>` and `AUTH_SECRET=<output of openssl rand -hex 32>`, run `docker compose up -d`, and open [http://localhost:5173](http://localhost:5173).

In Docker Compose, the bundled Margaya container reaches PostgreSQL at the service hostname `postgres`.
The database is reachable only inside the Compose network. If you run the API on your host, explicitly add a loopback-only database mapping (`127.0.0.1:5432:5432`) for development and configure `DATABASE_URL` accordingly.

> **Important:** See our [full documentation](https://margaya.app/docs/core) for detailed setup instructions, environment variable configuration, and troubleshooting guides.

### Development Setup

For development, see our [Environment Setup Guide](ENVIRONMENT_SETUP.md) for detailed instructions on configuring environment variables and troubleshooting common issues like CORS problems.

### Configuration

Margaya requires several environment variables to be configured. The Docker Compose setup above handles the database automatically, but you'll need to configure environment variables for the API and web services.

For complete configuration instructions, including all required environment variables, database setup for non-Docker deployments, and advanced settings, see the [documentation](https://margaya.app/docs/core). Advanced deployments can still use the separate `ghcr.io/manu14357/api` and `ghcr.io/manu14357/web` images.

## Kubernetes Deployment

If you're running Kubernetes, we provide a comprehensive Helm chart. Check out the [Helm chart documentation](./charts/margaya/README.md) for detailed installation instructions, production configuration examples, TLS setup, and more.

## Development

Want to hack on Margaya? See our [Environment Setup Guide](ENVIRONMENT_SETUP.md) for detailed instructions on configuring environment variables and troubleshooting common issues like CORS problems.

Quick start:
```bash
# Clone and install dependencies
git clone https://github.com/manu14357/Margaya.git
cd margaya
pnpm install

# Create a .env file in the root with required environment variables
# See ENVIRONMENT_SETUP.md for detailed instructions

# Start development servers
pnpm dev
```

For contributing guidelines, code structure, and development best practices, check out our [contributing guide](CONTRIBUTING.md) and [documentation](https://margaya.app/docs/core).

## MCP Server

Margaya has an official [MCP (Model Context Protocol) server](https://margaya.app/docs/core/integrations/mcp), so AI tools like Claude, Cursor, and other MCP clients can manage your tasks, projects, and labels. Every instance ships a built-in HTTP MCP endpoint at `/api/mcp`, and for stdio clients there is the official [@margaya/mcp](https://www.npmjs.com/package/@margaya/mcp) package on npm (`npx -y @margaya/mcp`).

## Community

- **[GitHub Issues](https://github.com/manu14357/Margaya/issues)** - Bug reports and feature requests
- **[Documentation](https://margaya.app/docs/core)** - Detailed guides, API docs, and tutorials

## Contributing

We're always looking for help, whether that's:
- Reporting bugs or suggesting features
- Improving documentation
- Contributing code
- Helping other users in GitHub Discussions

Check out [CONTRIBUTING.md](CONTRIBUTING.md) for the details on how to get involved.

## License

MIT License - see [LICENSE](LICENSE) for details.
