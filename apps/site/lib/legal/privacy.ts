import { GITHUB_URL, type LegalDocument } from "./types";

// English only, like the other long-form site pages. Keep every statement
// true to the code: cookies (Better Auth), Sentry (opt-in DSN, no default
// PII), SMTP email, Creem billing and the integrations in apps/api/src.
export const privacyPolicy: LegalDocument = {
  path: "/privacy",
  metaTitle: "Privacy policy",
  metaDescription:
    "How Margaya handles personal data: self-hosted instances send the maintainers nothing, and Margaya Cloud uses your data only to run the service.",
  title: "Privacy policy",
  intro:
    "How Margaya handles personal data, whether you run it yourself or use Margaya Cloud. Written to be read, not skimmed past.",
  updated: "2026-10-15",
  summaryTitle: "The short version",
  summary: [
    "Self-hosting means your data stays on your servers. The maintainers receive none of it.",
    "Margaya Cloud processes account and workspace data only to provide the service.",
    "No advertising, no tracking cookies, no analytics scripts, and no selling of data.",
    "Integrations send data only to the services you choose to connect.",
  ],
  sections: [
    {
      id: "scope",
      title: "Who this policy covers",
      blocks: [
        {
          type: "p",
          text: "This policy covers two things run by the Margaya maintainers (“we”): this website, **margaya.app**, including the documentation, and the hosted service **Margaya Cloud** at cloud.margaya.app.",
        },
        {
          type: "p",
          text: "It does not cover Margaya instances that other people or organisations run. If your company hosts its own Margaya, that company is the operator: it decides how your data is handled, and its own policy applies.",
        },
      ],
    },
    {
      id: "self-hosted",
      title: "Self-hosted Margaya",
      blocks: [
        {
          type: "p",
          text: "Margaya is open-source software under the MIT licence. When you install it on your own infrastructure, everything it stores (accounts, workspaces, tasks, docs, files) lives in your PostgreSQL database and your file storage.",
        },
        {
          type: "list",
          items: [
            "The software sends no telemetry, usage statistics or licence checks to the maintainers.",
            "Error reporting is off unless the operator sets a Sentry DSN. Reports then go to the operator's own Sentry project, with Sentry's default personal-data collection turned off.",
            "Email goes out through the SMTP server the operator configures.",
            `The source code is public on [GitHub](${GITHUB_URL}), so you can check all of this yourself.`,
          ],
        },
      ],
    },
    {
      id: "website",
      title: "This website",
      blocks: [
        {
          type: "p",
          text: "margaya.app is a static site. It sets no cookies and loads no analytics, advertising or tracking scripts. Fonts are served from the site itself, not from a third-party font service.",
        },
        {
          type: "p",
          text: "Your theme and language choices are kept in your browser's local storage. They never leave your device. The hosting provider that serves the pages may keep standard access logs (IP address, time, requested page and browser) for security and operations.",
        },
      ],
    },
    {
      id: "cloud-data",
      title: "What Margaya Cloud collects",
      blocks: [
        {
          type: "list",
          items: [
            "**Account details:** your name, email address and profile picture. If you sign in with GitHub, Google or Discord, we receive the basic profile those providers share, never your password for them. Passwords you set with us are stored only as salted hashes.",
            "**Workspace content:** the projects, tasks, comments, docs, attachments and other content you and your teammates create.",
            "**Session and security records:** the IP address and browser of each signed-in session, and the workspace audit log of who changed what.",
            "**Billing details:** your plan, subscription status and seat count. Card details are collected by our payment provider, Creem, and never reach Margaya.",
          ],
        },
      ],
    },
    {
      id: "use",
      title: "How we use it",
      blocks: [
        {
          type: "p",
          text: "We use this data to run Margaya Cloud for you, and for nothing else:",
        },
        {
          type: "list",
          items: [
            "signing you in and keeping your session secure;",
            "storing your work and keeping every open view up to date in real time;",
            "sending email you need or asked for: invitations, sign-in links, notifications and digests you've switched on, and billing notices;",
            "billing subscriptions and running free trials;",
            "protecting the service, for example by limiting repeated sign-in attempts;",
            "answering you when you get in touch.",
          ],
        },
        {
          type: "p",
          text: "We don't sell personal data, show advertising, or build advertising profiles.",
        },
      ],
    },
    {
      id: "processors",
      title: "Services that help run Margaya Cloud",
      blocks: [
        {
          type: "list",
          items: [
            "**Hosting:** servers, the database and file storage, in EU data centres.",
            "**Email delivery:** a mail provider we send through over SMTP.",
            "**Payments:** Creem, which acts as merchant of record and handles payment, invoices and tax under its own privacy policy.",
            "**Error reports:** Sentry, when enabled, with default personal-data collection turned off.",
            "**Sign-in providers:** GitHub, Google or Discord, only if you choose to sign in with them.",
          ],
        },
        {
          type: "p",
          text: "Integrations are your choice. When you connect GitHub, Gitea, Slack, Discord, Telegram, Mattermost, ntfy, Gotify or a webhook, Margaya sends the events you configure to that service, and its own terms apply there. The same goes for API keys and MCP clients you authorise.",
        },
      ],
    },
    {
      id: "cookies",
      title: "Cookies and local storage",
      blocks: [
        {
          type: "p",
          text: "Margaya Cloud uses cookies only to sign you in: a session cookie (`better-auth.session_token`, sent with a `__Secure-` prefix over HTTPS) and short-lived cookies that protect sign-in flows such as “Sign in with GitHub”. They are essential, so there is no banner asking about them.",
        },
        {
          type: "p",
          text: "The app also keeps a few interface preferences, such as your theme, in your browser's local storage. There are no advertising, analytics or cross-site tracking cookies.",
        },
      ],
    },
    {
      id: "retention",
      title: "How long we keep it",
      blocks: [
        {
          type: "list",
          items: [
            "Account details and workspace content stay for as long as your account and workspaces exist.",
            "Deleted tasks and projects go to the trash first, where they can be restored until they are permanently deleted.",
            "When you delete your account, your account data is removed from the live database. Copies in backups disappear as those backups expire.",
            "Billing records are kept by Creem for as long as tax law requires.",
          ],
        },
      ],
    },
    {
      id: "rights",
      title: "Your choices and rights",
      blocks: [
        {
          type: "list",
          items: [
            "Update your profile and notification settings at any time in the app.",
            "Export your tasks as CSV, Excel or JSON.",
            "Delete your account from your account settings.",
          ],
        },
        {
          type: "p",
          text: "Depending on where you live (for example under the GDPR in the EU and UK), you can also ask to see, correct, receive a copy of, or erase your personal data, or object to how it is used, and you can complain to your local data-protection authority. Get in touch as described below and we will respond within the time the law allows.",
        },
      ],
    },
    {
      id: "security",
      title: "Security",
      blocks: [
        {
          type: "p",
          text: "Connections are encrypted with TLS. Every request is checked against your workspace role before anything is read or changed, and workspaces are kept apart from one another. Because the code is open, anyone can review how this works.",
        },
        {
          type: "p",
          text: `Found a vulnerability? Please report it privately through [GitHub's private vulnerability reporting](${GITHUB_URL}/security/advisories/new), as described in the project's security policy.`,
        },
      ],
    },
    {
      id: "children",
      title: "Children",
      blocks: [
        {
          type: "p",
          text: "Margaya is a tool for work and study, not for children. Margaya Cloud is not intended for anyone under 16.",
        },
      ],
    },
    {
      id: "changes",
      title: "Changes to this policy",
      blocks: [
        {
          type: "p",
          text: "When this policy changes, the date at the top changes too. We will tell Margaya Cloud users about significant changes before they take effect. The website's source lives in the public repository, so every past version of this page is on record.",
        },
      ],
    },
    {
      id: "contact",
      title: "Contact",
      blocks: [
        {
          type: "p",
          text: `Questions about privacy go to the Margaya maintainers on [GitHub](${GITHUB_URL}/discussions). Please don't post personal details in public: open a discussion asking for a private channel and we will take it from there.`,
        },
      ],
    },
  ],
};
