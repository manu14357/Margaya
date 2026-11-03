import type { Guide } from "./types";

export const euHostedProjectManagementGdpr: Guide = {
  slug: "eu-hosted-project-management-gdpr",
  question: "How do I keep project management data in the EU?",
  title: "Keep project data in the EU: a practical checklist",
  description:
    "Two ways to keep project management data in the EU, hosted or self-hosted, and a checklist that covers more than the database: file storage, email, backups, integrations, exports and deletion.",
  summary:
    "Hosted or self-hosted, and a checklist that covers files, email, backups and integrations, not only the database.",
  answer:
    "There are two routes: a hosted tool that stores your data in the EU, or an open-source tool you run on EU servers yourself. Margaya is the second kind: you run it yourself, so it lives wherever you put it. Either way, data residency covers more than the database: check file storage, email, backups and integrations too.",
  topic: "self-host",
  timeNeeded: "30 minutes",
  sections: [
    {
      heading: "Choose your route",
      items: [
        {
          name: "Self-hosted Margaya",
          href: "/guides/self-host-project-management-docker",
          meta: "Any server you choose",
          body: "Run it on an EU provider, in your own data centre or on an internal network. A self-hosted install sends nothing to us.",
        },
        {
          name: "Other hosted tools",
          meta: "Check the details",
          body: "Several large vendors offer EU data residency, often on particular plans. Ask which data it covers: attachments, search indexes, backups and logs aren't always included.",
        },
      ],
      callout: {
        tone: "note",
        title: "Residency isn't the same as compliance",
        body: "Keeping data in the EU helps, but GDPR also needs a lawful basis, processing agreements with your providers, and a way to answer access and deletion requests. This guide covers the technical side, not legal advice.",
      },
    },
    {
      heading: "The self-hosted checklist",
      body: [
        "If you run Margaya yourself, these are the places data can leave the region you chose. Work through them once and note the answers for your records.",
      ],
      steps: [
        {
          title: "Put the server and database in an EU region",
          body: [
            "All of Margaya's data lives in PostgreSQL, next to the application container. Choose an EU region for the server, and make sure the database volume and any snapshots stay there too.",
          ],
        },
        {
          title: "Keep uploads in the same region",
          body: [
            "Images and files in descriptions and comments go to S3-compatible object storage. Create the bucket in an EU region, or run MinIO on your own hardware. Margaya serves files back through its own API, so the bucket never has to be public.",
          ],
        },
        {
          title: "Send email through an EU provider",
          body: [
            "Invitations, sign-in codes and notifications are sent through the SMTP server you configure. Pick a provider that processes mail in the EU, or use your own mail server.",
          ],
        },
        {
          title: "Back up to an EU location",
          body: [
            "A nightly `pg_dump` copied to storage in another EU location protects you without moving data out of the region.",
          ],
          code: {
            label: "Terminal",
            content:
              "docker compose exec -T postgres pg_dump -U margaya margaya | gzip > margaya-$(date +%F).sql.gz",
          },
        },
        {
          title: "Review what each integration sends out",
          body: [
            "Integrations exist to share data with other services. Before you switch one on, check where that service stores what it receives:",
          ],
          bullets: [
            "Chat notifications to Slack, Discord, Mattermost or Telegram include task details.",
            "Webhooks send task events to the address you configure.",
            "The GitHub and Gitea integrations sync issues and pull requests.",
            "MCP clients and API keys read data with the permissions of the person who authorised them.",
            "Error reporting is off unless you set `SENTRY_DSN`. If you turn it on, use an EU-hosted or self-hosted endpoint.",
          ],
          callout: {
            tone: "tip",
            title: "Keep a record",
            body: "The audit log in Settings > Workspace > Audit log records who created or changed API keys, webhooks, integrations, members and roles, and exports to CSV for your records.",
          },
        },
        {
          title: "Be ready for access and deletion requests",
          body: [
            "Settings > Workspace > Exports produces CSV, Excel or JSON files of a workspace's tasks for an access request or an archive. A person can delete their own account under Settings > Account, which asks them to type their email address to confirm.",
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: "Is there a hosted Margaya in the EU?",
      answer:
        "No. There is no hosted Margaya service: you run it on your own servers, so you choose the region and every provider it talks to. It's open source and free to use under the GNU AGPL-3.0.",
    },
    {
      question: "Does self-hosting make a tool GDPR compliant?",
      answer:
        "Not by itself. It gives you control over where data lives and who can reach it, which makes compliance easier. You still need the organisational side: a lawful basis, agreements with your providers and a process for requests.",
    },
    {
      question: "Does a self-hosted Margaya send any data to the Margaya team?",
      answer:
        "No. A self-hosted install doesn't report usage to us. Data only leaves your server through the email, storage, integrations and error reporting you configure yourself.",
    },
    {
      question: "Can we keep Margaya entirely on an internal network?",
      answer:
        "Yes. It needs PostgreSQL and nothing else from the internet. Without SMTP, people can still be invited with links, and without object storage, file uploads are simply unavailable.",
    },
  ],
  next: [
    {
      label: "Self-host with Docker Compose",
      href: "/guides/self-host-project-management-docker",
      description: "Set up the server you'll be keeping in the EU.",
    },
    {
      label: "Storage backends",
      href: "/docs/core/installation/storage-backends",
      description: "Configure S3-compatible storage or MinIO for uploads.",
    },
    {
      label: "Audit log",
      href: "/docs/core/functional/audit-log",
      description: "What's recorded, who can see it, and how to export it.",
    },
  ],
  updatedOn: "2026-11-03",
};
