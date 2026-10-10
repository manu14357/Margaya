import { GITHUB_URL, type LegalDocument } from "./types";

// English only, like the other long-form site pages. Plan and billing facts
// must match lib/pricing.ts and apps/api/src/billing.
export const termsOfService: LegalDocument = {
  path: "/terms",
  metaTitle: "Terms of service",
  metaDescription:
    "The terms for using Margaya Cloud and margaya.app. The Margaya software itself is covered by the MIT licence.",
  title: "Terms of service",
  intro:
    "The rules for using Margaya Cloud and this website. The Margaya software itself is covered by its MIT licence, not by these terms.",
  updated: "2026-10-15",
  summaryTitle: "The short version",
  summary: [
    "Running Margaya on your own servers is governed by the MIT licence alone.",
    "These terms apply to Margaya Cloud and to margaya.app.",
    "Your content stays yours. We use it only to run the service for you.",
    "Use the service lawfully and fairly, and leave other workspaces alone.",
  ],
  sections: [
    {
      id: "scope",
      title: "What these terms cover",
      blocks: [
        {
          type: "p",
          text: "These terms apply when you use **Margaya Cloud** (cloud.margaya.app) or this website, both provided by the Margaya maintainers (“we”). By creating a Cloud account or using the service, you accept them. If you accept on behalf of an organisation, you confirm that you are allowed to.",
        },
      ],
    },
    {
      id: "licence",
      title: "The software and its licence",
      blocks: [
        {
          type: "p",
          text: `Margaya's source code is published under the [MIT licence](${GITHUB_URL}/blob/main/LICENSE). Installing, changing and running it on your own infrastructure is governed by that licence, which comes without warranty, and not by these terms.`,
        },
        {
          type: "p",
          text: "If you run a Margaya instance for other people, you are its operator. You set the terms and privacy policy for your users, and you are responsible for the data on your instance.",
        },
      ],
    },
    {
      id: "account",
      title: "Your account",
      blocks: [
        {
          type: "list",
          items: [
            "Use an email address you can receive mail at, and keep your sign-in details to yourself.",
            "You are responsible for what happens under your account, including through API keys and connected tools you authorise.",
            "Workspace owners and admins decide who joins their workspace and what each role may do.",
            "If you think someone else is using your account, revoke their access (sign out other sessions, delete API keys) and let us know.",
          ],
        },
      ],
    },
    {
      id: "billing",
      title: "Plans, trials and billing",
      blocks: [
        {
          type: "list",
          items: [
            "Current prices are on the [pricing page](/pricing). Cloud Personal is for one person; Cloud Team is billed for each member of the workspace, and the seat count follows the membership.",
            "New Cloud workspaces start with a 14-day free trial, with no card needed to begin.",
            "Payments are handled by **Creem** as merchant of record. Creem is the seller for the purchase, collects payment, issues invoices and handles tax, and its terms also apply to the transaction.",
            "Subscriptions renew automatically, monthly or yearly, until cancelled. When you cancel, your plan stays active until the end of the period you've paid for.",
            "If you think you were charged by mistake, tell us within 14 days and we will work with you on a refund where appropriate.",
            "We will announce price changes before they apply to your next renewal.",
            "Workspaces created before paid plans launched keep free access for at least 12 months, with at least six months' notice before anything changes.",
          ],
        },
      ],
    },
    {
      id: "content",
      title: "Your content",
      blocks: [
        {
          type: "p",
          text: "Everything you put into Margaya Cloud remains yours. You give us permission to store, copy, process and display it only as far as needed to run the service for you: showing tasks to your teammates, sending the notifications you set up, running your integrations and automations, and keeping backups.",
        },
        {
          type: "p",
          text: "Anything you publish on a public board can be seen by anyone with the link. You can export your tasks as CSV, Excel or JSON at any time.",
        },
      ],
    },
    {
      id: "acceptable-use",
      title: "Acceptable use",
      blocks: [
        {
          type: "p",
          text: "Please don't use Margaya Cloud to:",
        },
        {
          type: "list",
          items: [
            "break the law or infringe anyone's rights;",
            "store or spread malware, or content meant to deceive or harm;",
            "try to reach workspaces, data or accounts that aren't yours, or get around permission checks;",
            "overload or disrupt the service, for example with automated traffic that ignores rate limits;",
            "send spam through invitations, notifications or integrations.",
          ],
        },
        {
          type: "p",
          text: `Security research is welcome when it is reported privately through [GitHub's private vulnerability reporting](${GITHUB_URL}/security/advisories/new) and doesn't touch other people's data.`,
        },
      ],
    },
    {
      id: "third-parties",
      title: "Integrations and other services",
      blocks: [
        {
          type: "p",
          text: "When you connect GitHub, Gitea, Slack, Discord, Telegram, Mattermost, ntfy, Gotify, a webhook, an API client or an MCP client, data flows to that service under its own terms. We are not responsible for services we don't run.",
        },
      ],
    },
    {
      id: "availability",
      title: "Availability and changes",
      blocks: [
        {
          type: "p",
          text: "We work to keep Margaya Cloud available, up to date and backed up, but we can't promise it will never be interrupted. Maintenance and updates sometimes need a short pause. Features change as Margaya develops, and every change to the code is visible in the public repository.",
        },
      ],
    },
    {
      id: "liability",
      title: "No warranty, and limits on liability",
      blocks: [
        {
          type: "p",
          text: "Margaya Cloud is provided “as is”. As far as the law allows, we give no warranties beyond those in these terms, and we are not liable for indirect or consequential losses such as lost profits or lost data. Our total liability for any claim is limited to what you paid for Margaya Cloud in the 12 months before it arose.",
        },
        {
          type: "p",
          text: "None of this limits rights you have under consumer-protection law in your country that cannot be waived.",
        },
      ],
    },
    {
      id: "ending",
      title: "Ending your use",
      blocks: [
        {
          type: "p",
          text: "You can stop using Margaya Cloud and delete your account at any time. We may suspend or close accounts that break these terms, with notice where that is reasonable. After an account is closed, its data is deleted as described in the [privacy policy](/privacy).",
        },
      ],
    },
    {
      id: "changes",
      title: "Changes to these terms",
      blocks: [
        {
          type: "p",
          text: "When these terms change, the date at the top changes too. We will tell Margaya Cloud users about significant changes at least 30 days before they take effect.",
        },
      ],
    },
    {
      id: "contact",
      title: "Contact",
      blocks: [
        {
          type: "p",
          text: `Questions about these terms go to the Margaya maintainers on [GitHub](${GITHUB_URL}/discussions).`,
        },
      ],
    },
  ],
};
