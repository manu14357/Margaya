import type { Guide } from "./types";

export const projectManagementToolsWithFreeSso: Guide = {
  slug: "project-management-tools-with-free-sso",
  question: "Where can I get single sign-on without an enterprise plan?",
  title: "Single sign-on without the upgrade: set up SSO in Margaya",
  description:
    "Why single sign-on is often a paid upgrade, which kinds of tools include it, and a step-by-step setup of Google, GitHub, Discord or any OpenID Connect provider in Margaya.",
  summary:
    "Why SSO often costs extra, and how to connect your identity provider to Margaya in a few minutes.",
  answer:
    "Many hosted tools keep SAML or OIDC single sign-on for their higher plans. Open-source tools you host yourself often include it, though it varies by edition. In Margaya, sign-in with Google, GitHub, Discord or any OpenID Connect provider, such as Keycloak, Authentik, Okta, Microsoft Entra ID or Auth0, is part of every install. An instance admin sets it up in Settings, or with environment variables.",
  topic: "self-host",
  timeNeeded: "15 minutes",
  before: [
    "An instance admin account on your Margaya server",
    "Admin access to your identity provider",
  ],
  sections: [
    {
      heading: "Why SSO is often a paid upgrade",
      body: [
        "Single sign-on is cheap to build but valuable to buyers. It's usually the first thing a security review asks for, so many vendors keep it for their business or enterprise plans. The result is that teams pay a higher tier for the one feature that makes a tool safe to roll out.",
        "Self-hosted, open-source tools tend to treat SSO as part of the product, but check edition by edition, because open-core projects sometimes hold it back. In Margaya there's one build, and it includes sign-in with Google, GitHub, Discord and any OpenID Connect provider.",
      ],
    },
    {
      heading: "Connect your identity provider",
      body: [
        "These steps use the in-app settings, which most teams find easiest. Each value can also be set in .env instead, as shown in step 3.",
      ],
      steps: [
        {
          title: "Open the authentication settings",
          body: [
            "Sign in as an instance admin and open Settings > Instance > Authentication. Under Sign-in methods you'll see Email and password, Email code, GitHub, Google, Discord and Custom OAuth / OIDC, each with its status.",
            "Choose Configure on the provider you want. For an identity provider such as Keycloak or Okta, that's Custom OAuth / OIDC.",
          ],
        },
        {
          title: "Register Margaya with your provider",
          body: [
            "Copy the Callback URL from the panel. In your identity provider, create an OIDC application (sometimes called a client) and paste the callback URL as its redirect URI. For a custom provider it looks like this:",
          ],
          code: {
            label: "Redirect URI",
            content: "https://pm.example.com/api/auth/oauth2/callback/custom",
          },
          callout: {
            tone: "note",
            title: "Google, GitHub and Discord",
            body: "These use their own callback URLs, ending in `/api/auth/callback/google`, `/github` or `/discord`. The panel shows the exact address for your server.",
          },
        },
        {
          title: "Enter the client details",
          body: [
            "Paste the client ID and client secret from your provider. For OpenID Connect, the discovery URL is all Margaya needs to find the other endpoints. Add `openid` to the scopes if your provider expects it, give the button a label such as Continue with Okta, and save.",
            "If you'd rather keep this in configuration, set the same values in `.env` and restart. Settings that come from the environment show as read-only in the app.",
          ],
          code: {
            label: ".env",
            content: `CUSTOM_OAUTH_CLIENT_ID=margaya
CUSTOM_OAUTH_CLIENT_SECRET=from-your-identity-provider
CUSTOM_OAUTH_DISCOVERY_URL=https://id.example.com/.well-known/openid-configuration
CUSTOM_OAUTH_SCOPES=openid,profile,email`,
          },
        },
        {
          title: "Test it in a private window",
          body: [
            "Open Margaya in a private browser window and sign in with the new button. Keep your admin session open in the other window until it works, so you can fix settings without locking yourself out.",
          ],
        },
        {
          title: "Decide who can join",
          body: [
            "Under Sign-up, turn off Anyone can sign up if people should need an invitation. Turn off Email sign-up to make SSO the only way to create an account.",
          ],
        },
        {
          title: "Make SSO the only way in, carefully",
          body: [
            "Once everyone signs in through your provider, you can turn off Email and password, and switch on Sign in automatically so the sign-in screen goes straight to your provider. The environment equivalents are `DISABLE_LOGIN_FORM=true` and `CUSTOM_OAUTH_AUTO_LOGIN=true`.",
          ],
          callout: {
            tone: "warning",
            title: "Check email verification first",
            body: "An SSO identity can only be linked to an existing account whose email address is verified. Before you turn off email sign-in, make sure existing users have signed in once with an email code or link, or they'll be unable to link their account.",
          },
        },
      ],
    },
  ],
  faq: [
    {
      question: "Does Margaya support SAML?",
      answer:
        "Margaya connects to identity providers over OAuth 2.0 and OpenID Connect. Most providers that offer SAML, such as Okta, Entra ID, Keycloak and Authentik, also offer OIDC, which is what you'd use.",
    },
    {
      question: "Is SSO included on Margaya Cloud too?",
      answer:
        "Yes. Single sign-on isn't an add-on on any version of Margaya. See the pricing page for current plans.",
    },
    {
      question: "Can I stop sign-up entirely and invite people instead?",
      answer:
        "Yes. Turn off Anyone can sign up in Settings > Instance > Authentication, or set DISABLE_REGISTRATION=true. People with an invitation can still join.",
    },
    {
      question: "What happens if the identity provider is down?",
      answer:
        "People who sign in only through it can't sign in until it's back, although existing sessions keep working. Margaya won't let you turn off the last working sign-in method, so an admin path always remains.",
    },
  ],
  next: [
    {
      label: "Custom OAuth / OIDC reference",
      href: "/docs/core/social-providers/custom-oauth",
      description: "Every variable, with example provider configurations.",
    },
    {
      label: "Instance administration",
      href: "/docs/core/installation/instance-admin",
      description:
        "Sign-up, sign-in, email and admin settings for the whole installation.",
    },
    {
      label: "Self-host with Docker Compose",
      href: "/guides/self-host-project-management-docker",
      description: "Get a Margaya server running first.",
    },
  ],
  updatedOn: "2026-10-15",
};
