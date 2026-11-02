import { COMMERCIAL_EMAIL, GITHUB_URL, type LegalDocument } from "./types";

// English only, like the other long-form site pages. Licence facts must match
// the repository's LICENSE and COMMERCIAL.md.
export const termsOfService: LegalDocument = {
  path: "/terms",
  metaTitle: "Terms of service",
  metaDescription:
    "The terms for using margaya.app, and how the Margaya software is licensed: the GNU AGPL-3.0, or a commercial licence for use without the AGPL's conditions.",
  title: "Terms of service",
  intro:
    "The rules for using this website, and how the Margaya software is licensed. The software itself is covered by its licence, not by these terms.",
  updated: "2026-11-03",
  summaryTitle: "The short version",
  summary: [
    "Margaya is open source under the GNU AGPL-3.0, and you can use it free under that licence.",
    "If you modify Margaya and let people use it over a network, you must publish your changes under the AGPL.",
    "Using Margaya without the AGPL's conditions requires a commercial licence.",
    "These terms apply to margaya.app. There is no hosted service: you run Margaya on your own servers.",
  ],
  sections: [
    {
      id: "scope",
      title: "What these terms cover",
      blocks: [
        {
          type: "p",
          text: "These terms apply when you use this website, **margaya.app**, including the documentation, provided by the Margaya maintainers (“we”). By using the website, you accept them. If you accept on behalf of an organisation, you confirm that you are allowed to.",
        },
        {
          type: "p",
          text: "We don't run a hosted version of Margaya. The software runs only on infrastructure that you or someone else operates, under the licence described below.",
        },
      ],
    },
    {
      id: "licence",
      title: "The software and its licence",
      blocks: [
        {
          type: "p",
          text: `Margaya's source code is published under the [GNU Affero General Public License, version 3 only](${GITHUB_URL}/blob/main/LICENSE) (AGPL-3.0-only). Installing, changing and running it is governed by that licence, which comes without warranty, and not by these terms.`,
        },
        {
          type: "list",
          items: [
            "You may use, study, change and share Margaya free of charge under the AGPL.",
            "If you modify Margaya and let people interact with it over a network, you must offer those people the source code of your modified version under the AGPL.",
            "If you distribute Margaya, changed or not, you must do so under the AGPL and include its source code.",
          ],
        },
      ],
    },
    {
      id: "commercial",
      title: "Commercial licence",
      blocks: [
        {
          type: "p",
          text: "A commercial licence is available for anyone who wants to use Margaya without the AGPL's conditions, and is required for that use. For example:",
        },
        {
          type: "list",
          items: [
            "keeping your changes to Margaya private;",
            "embedding Margaya in a closed-source product;",
            "hosting Margaya for your customers without sharing the source of your version;",
            "working under a company policy that doesn't allow AGPL software.",
          ],
        },
        {
          type: "p",
          text: `If you follow the AGPL, you don't need a commercial licence. The [commercial licence page](${GITHUB_URL}/blob/main/COMMERCIAL.md) explains the options. To ask about one, email [${COMMERCIAL_EMAIL}](mailto:${COMMERCIAL_EMAIL}).`,
        },
      ],
    },
    {
      id: "operators",
      title: "Running Margaya for other people",
      blocks: [
        {
          type: "p",
          text: "If you run a Margaya instance for other people, you are its operator. You set the terms and privacy policy for your users, and you are responsible for the data on your instance and for meeting the licence you use Margaya under.",
        },
        {
          type: "p",
          text: "Everything stored in a Margaya instance stays with whoever runs it. The maintainers never receive it.",
        },
      ],
    },
    {
      id: "acceptable-use",
      title: "Acceptable use",
      blocks: [
        {
          type: "p",
          text: "Please don't use this website to:",
        },
        {
          type: "list",
          items: [
            "break the law or infringe anyone's rights;",
            "store or spread malware, or content meant to deceive or harm;",
            "overload or disrupt the website, for example with automated traffic that ignores rate limits.",
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
          text: "When a Margaya instance connects to GitHub, Gitea, Slack, Discord, Telegram, Mattermost, ntfy, Gotify, a webhook, an API client, an MCP client or an AI provider, data flows to that service under its own terms. We are not responsible for services we don't run.",
        },
      ],
    },
    {
      id: "availability",
      title: "Availability and changes",
      blocks: [
        {
          type: "p",
          text: "We work to keep this website and its documentation available and accurate, but we can't promise it will never be interrupted or out of date. Margaya changes as it develops, and every change to the code is visible in the public repository.",
        },
      ],
    },
    {
      id: "liability",
      title: "No warranty, and limits on liability",
      blocks: [
        {
          type: "p",
          text: "The website is provided “as is”. The software comes with no warranty, as its licence sets out. As far as the law allows, we are not liable for indirect or consequential losses such as lost profits or lost data arising from using the website or the software.",
        },
        {
          type: "p",
          text: "None of this limits rights you have under consumer-protection law in your country that cannot be waived.",
        },
      ],
    },
    {
      id: "changes",
      title: "Changes to these terms",
      blocks: [
        {
          type: "p",
          text: "When these terms change, the date at the top changes too. The website's source lives in the public repository, so every past version of this page is on record.",
        },
      ],
    },
    {
      id: "contact",
      title: "Contact",
      blocks: [
        {
          type: "p",
          text: `Questions about these terms go to the Margaya maintainers on [GitHub](${GITHUB_URL}/discussions). Questions about a commercial licence go to [${COMMERCIAL_EMAIL}](mailto:${COMMERCIAL_EMAIL}).`,
        },
      ],
    },
  ],
};
