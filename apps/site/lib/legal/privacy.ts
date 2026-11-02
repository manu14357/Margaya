import { COMMERCIAL_EMAIL, GITHUB_URL, type LegalDocument } from "./types";

// English only, like the other long-form site pages. Keep every statement
// true to the code: cookies (Better Auth), Sentry (opt-in DSN, no default
// PII), SMTP email, AI providers and the integrations in apps/api/src.
export const privacyPolicy: LegalDocument = {
  path: "/privacy",
  metaTitle: "Privacy policy",
  metaDescription:
    "How Margaya handles personal data: this website sets no cookies, and self-hosted instances send the maintainers nothing.",
  title: "Privacy policy",
  intro:
    "How this website and the Margaya software handle personal data. Written to be read, not skimmed past.",
  updated: "2026-11-03",
  summaryTitle: "The short version",
  summary: [
    "Self-hosting means your data stays on your servers. The maintainers receive none of it.",
    "There is no hosted Margaya service, so we hold no accounts or workspace data.",
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
          text: "This policy covers this website, **margaya.app**, including the documentation, run by the Margaya maintainers (“we”). It also explains what the Margaya software does with data when you run it yourself.",
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
          text: "Margaya is open-source software under the GNU AGPL-3.0, and you run it on your own infrastructure. Everything it stores (accounts, workspaces, tasks, docs, files) lives in your PostgreSQL database and your file storage.",
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
      id: "contact-data",
      title: "When you get in touch",
      blocks: [
        {
          type: "p",
          text: `If you email us, for example about a commercial licence at ${COMMERCIAL_EMAIL}, we receive your email address and whatever you write. We use it only to answer you and, if you take a commercial licence, to keep a record of that agreement.`,
        },
        {
          type: "p",
          text: "Posts in GitHub discussions, issues and pull requests are public and are handled by GitHub under its own privacy policy.",
        },
        {
          type: "p",
          text: "We don't sell personal data, show advertising, or build advertising profiles.",
        },
      ],
    },
    {
      id: "processors",
      title: "Services your instance talks to",
      blocks: [
        {
          type: "list",
          items: [
            "**Email delivery:** the SMTP server the operator configures.",
            "**Error reports:** the operator's own Sentry project, only when a DSN is set, with default personal-data collection turned off.",
            "**Sign-in providers:** GitHub, Google, Discord or an OIDC provider, only if the operator enables them and you choose to sign in with them.",
          ],
        },
        {
          type: "p",
          text: "Integrations are your choice. When you connect GitHub, Gitea, Slack, Discord, Telegram, Mattermost, ntfy, Gotify or a webhook, Margaya sends the events you configure to that service, and its own terms apply there. The same goes for API keys and MCP clients you authorise.",
        },
        {
          type: "p",
          text: "AI features are off until a workspace admin turns them on, and Margaya doesn't send your data to an AI provider of its own choosing. When a workspace turns AI on, the text a feature needs, such as your question and the tasks it reads, goes to the provider whose API key the workspace added (or to a model the operator runs locally), and that provider's terms apply there. Margaya keeps usage metadata (the feature, model, token count and cost) for budgets; prompts and answers are stored only if you turn on server history.",
        },
      ],
    },
    {
      id: "cookies",
      title: "Cookies and local storage",
      blocks: [
        {
          type: "p",
          text: "This website sets no cookies. A Margaya instance uses cookies only to sign you in: a session cookie (`better-auth.session_token`, sent with a `__Secure-` prefix over HTTPS) and short-lived cookies that protect sign-in flows such as “Sign in with GitHub”. They are essential and are set by the instance you sign in to, not by us.",
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
            "Emails you send us are kept for as long as we need them to answer you, or for as long as a commercial licence agreement and the law require.",
            "Access logs kept by the website's hosting provider expire on that provider's schedule.",
            "Data in a self-hosted instance is kept for as long as its operator decides. In Margaya, deleted tasks and projects go to the trash first, where they can be restored until they are permanently deleted.",
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
            "Clear your browser's local storage to forget your theme and language choices on this website.",
            "In a Margaya instance, update your profile and notification settings, export your tasks as CSV, Excel or JSON, and delete your account from your account settings.",
            "For data held in an instance someone else runs, contact that instance's operator.",
          ],
        },
        {
          type: "p",
          text: "Depending on where you live (for example under the GDPR in the EU and UK), you can also ask to see, correct, receive a copy of, or erase the personal data we hold about you, or object to how it is used, and you can complain to your local data-protection authority. Get in touch as described below and we will respond within the time the law allows.",
        },
      ],
    },
    {
      id: "security",
      title: "Security",
      blocks: [
        {
          type: "p",
          text: "This website is served over TLS. In Margaya, every request is checked against your workspace role before anything is read or changed, and workspaces are kept apart from one another. Because the code is open, anyone can review how this works.",
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
          text: "Margaya is a tool for work and study, not for children. This website is not aimed at anyone under 16.",
        },
      ],
    },
    {
      id: "changes",
      title: "Changes to this policy",
      blocks: [
        {
          type: "p",
          text: "When this policy changes, the date at the top changes too. The website's source lives in the public repository, so every past version of this page is on record.",
        },
      ],
    },
    {
      id: "contact",
      title: "Contact",
      blocks: [
        {
          type: "p",
          text: `Questions about privacy go to the Margaya maintainers on [GitHub](${GITHUB_URL}/discussions). Please don't post personal details in public: open a discussion asking for a private channel, or email [${COMMERCIAL_EMAIL}](mailto:${COMMERCIAL_EMAIL}).`,
        },
      ],
    },
  ],
};
