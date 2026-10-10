import type { Guide } from "./types";

export const selfHostProjectManagementDocker: Guide = {
  slug: "self-host-project-management-docker",
  question: "How do I run my own project management server with Docker?",
  title: "Self-host Margaya with Docker Compose, step by step",
  description:
    "Run Margaya on your own server with Docker Compose: the compose file, the environment file, HTTPS behind a reverse proxy, backups, upgrades, and when to use the Helm chart instead.",
  summary:
    "From an empty server to Margaya on HTTPS, with backups and a calm upgrade routine.",
  answer:
    "Margaya ships as one container that serves both the web app and the API, next to a PostgreSQL container. Write a compose.yml with those two services, fill in a .env file with your address and two generated secrets, run docker compose up -d, and put a reverse proxy in front for HTTPS. Redis and object storage are optional.",
  topic: "self-host",
  timeNeeded: "45 minutes",
  before: [
    "A Linux server (or macOS, or Windows with WSL) with Docker 20.10+ and Docker Compose v2",
    "At least 2 GB of RAM and 10 GB of disk",
    "A domain name pointed at the server, with ports 80 and 443 open",
  ],
  sections: [
    {
      heading: "Install and start Margaya",
      body: [
        "Everything lives in one folder on the server, such as `/opt/margaya`. You'll create two files there: `compose.yml` and `.env`.",
      ],
      steps: [
        {
          title: "Create the compose file",
          body: [
            "The compose file defines two services. `postgres` keeps its data in a named volume. `margaya` is the combined web app and API, and it waits for the database to report healthy before it starts.",
          ],
          code: {
            label: "compose.yml",
            content: `services:
  postgres:
    image: postgres:16-alpine
    env_file: .env
    environment:
      POSTGRES_USER: \${POSTGRES_USER:-margaya}
      POSTGRES_DB: \${POSTGRES_DB:-margaya}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", 'pg_isready -U "$\${POSTGRES_USER}" -d "$\${POSTGRES_DB}"']
      interval: 10s
      timeout: 5s
      retries: 5

  margaya:
    image: ghcr.io/manu14357/margaya:latest
    ports:
      - "127.0.0.1:5173:5173"
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped

volumes:
  postgres_data:`,
          },
          callout: {
            tone: "tip",
            title: "Why 127.0.0.1?",
            body: "Binding port `5173` to the loopback address means only the reverse proxy on the same machine can reach Margaya. Visitors always come in over HTTPS, never straight to the container.",
          },
        },
        {
          title: "Write the environment file",
          body: [
            "`MARGAYA_CLIENT_URL` is the address people will type into their browser. The API is served from the same address under `/api`, so you don't need to set `MARGAYA_API_URL` unless a proxy changes that path.",
            "Generate both secrets with `openssl rand -hex 32` and paste them in. `AUTH_SECRET` signs sessions. `NOTIFICATION_SECRET_ENCRYPTION_KEY` encrypts the webhook secrets and tokens people save in their notification settings.",
          ],
          code: {
            label: ".env",
            content: `MARGAYA_CLIENT_URL=https://pm.example.com
POSTGRES_DB=margaya
POSTGRES_USER=margaya
POSTGRES_PASSWORD=use-a-long-random-password
AUTH_SECRET=paste-the-output-of-openssl-rand-hex-32
NOTIFICATION_SECRET_ENCRYPTION_KEY=paste-another-one`,
          },
          callout: {
            tone: "warning",
            title: "Keep .env out of version control",
            body: "It holds your database password and signing secrets. Restrict it to the user that runs Docker, for example with `chmod 600 .env`.",
          },
        },
        {
          title: "Start the stack and check it",
          body: [
            'Start both containers in the background, then confirm they\'re healthy. The health endpoint answers `{"status":"ok"}` once the API is ready. On first start, Margaya runs its database migrations before it begins serving.',
          ],
          code: {
            label: "Terminal",
            content: `docker compose up -d
docker compose ps
curl -s http://127.0.0.1:5173/api/health`,
          },
        },
        {
          title: "Put HTTPS in front",
          body: [
            "Any reverse proxy works. Caddy is the shortest route, because it requests and renews certificates on its own. The documentation also has a full nginx example.",
          ],
          code: {
            label: "Caddyfile",
            content: `pm.example.com {
  reverse_proxy 127.0.0.1:5173
}`,
          },
        },
        {
          title: "Create the first account",
          body: [
            "Open your address in a browser and sign up. The first account on a new instance becomes its instance admin, with an Instance tab in Settings for sign-up, sign-in, email and other installation-wide settings.",
            "Once the team is invited, decide who else may sign up. You can turn public sign-up off in Settings > Instance, or with `DISABLE_REGISTRATION=true` in `.env`.",
          ],
          callout: {
            tone: "note",
            title: "Create your account first",
            body: "Whoever signs up first becomes the instance admin, so do it straight after the stack starts, before you share the address with anyone.",
          },
        },
      ],
    },
    {
      heading: "Keep it healthy",
      steps: [
        {
          title: "Back up the database, and test a restore",
          body: [
            "All of Margaya's data lives in PostgreSQL. A nightly dump copied to another machine or to object storage is enough for most teams. A backup that sits on the same server isn't really a backup.",
            "Restore a dump into a scratch database once, so you know it works before you need it.",
          ],
          code: {
            label: "Terminal",
            content:
              "docker compose exec -T postgres pg_dump -U margaya margaya | gzip > margaya-$(date +%F).sql.gz",
          },
        },
        {
          title: "Upgrade on purpose",
          body: [
            "In production, pin the image to a version tag instead of `latest`, so upgrades happen when you choose. To upgrade, take a dump, change the tag, read the release notes, then pull and recreate the container. Migrations run on startup. Your volumes and `.env` are left alone.",
          ],
          code: {
            label: "Terminal",
            content: `docker compose pull margaya
docker compose up -d margaya
docker compose logs -f margaya`,
          },
          callout: {
            tone: "tip",
            title: "Rolling back",
            body: "Put the previous tag back and run the same two commands. Restore the dump only if the new version's migrations changed data the old version can't read. The release notes say when that's the case.",
          },
        },
      ],
    },
    {
      heading: "Optional pieces",
      body: [
        "The setup above is complete for a single server. Add these only when you need them.",
      ],
      items: [
        {
          name: "Email (SMTP)",
          href: "/docs/core/installation/environment-variables",
          body: "Set the `SMTP_*` variables so Margaya can send invitations, sign-in codes and notification emails.",
        },
        {
          name: "File uploads",
          href: "/docs/core/installation/object-storage-and-image-uploads",
          body: "Images and files in descriptions and comments need S3-compatible storage. MinIO works well on your own hardware, and the bucket doesn't need to be public.",
        },
        {
          name: "Single sign-on",
          href: "/guides/project-management-tools-with-free-sso",
          body: "Google, GitHub, Discord or any OpenID Connect provider, configured in `.env`, on every install.",
        },
        {
          name: "Redis",
          href: "/docs/core/installation/environment-variables",
          body: "Only needed when you run more than one API instance and want realtime updates delivered across all of them. A single server doesn't need it.",
        },
        {
          name: "Kubernetes with Helm",
          href: "/docs/core/installation",
          meta: "helm install margaya oci://ghcr.io/manu14357/charts/margaya",
          body: "The official chart deploys Margaya and PostgreSQL, with optional Ingress or Gateway API routing.",
        },
      ],
    },
  ],
  faq: [
    {
      question: "What does Margaya need to run?",
      answer:
        "Docker with Compose v2, about 2 GB of RAM and 10 GB of disk, and PostgreSQL, which the compose file provides. Redis, object storage and SMTP are all optional.",
    },
    {
      question: "Is the self-hosted version limited?",
      answer:
        "No. The self-hosted build has every feature, including single sign-on, roles, the audit log, the API and the MCP server. It's MIT licensed.",
    },
    {
      question: "Can the web app and the API live on different domains?",
      answer:
        "Yes. The bundled container keeps both on one address, which is the simplest setup. If you host them separately, set MARGAYA_API_URL and the related variables described in the environment variables reference.",
    },
    {
      question: "How do I run it on Kubernetes?",
      answer:
        "Use the official Helm chart: helm install margaya oci://ghcr.io/manu14357/charts/margaya --namespace margaya --create-namespace. Enable Ingress or Gateway API routing with chart values.",
    },
  ],
  next: [
    {
      label: "Environment variables",
      href: "/docs/core/installation/environment-variables",
      description: "Every setting, from URLs and secrets to SMTP and Redis.",
    },
    {
      label: "Set up single sign-on",
      href: "/guides/project-management-tools-with-free-sso",
      description:
        "Let people sign in with the identity provider you already use.",
    },
    {
      label: "Keep project data in the EU",
      href: "/guides/eu-hosted-project-management-gdpr",
      description: "Where your data goes, and the settings that keep it there.",
    },
  ],
  updatedOn: "2026-10-15",
};
