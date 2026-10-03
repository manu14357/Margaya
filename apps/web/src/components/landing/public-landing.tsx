import { landing as englishCopy } from "@i18n/en-US.json";
import {
  type LandingCopy,
  type LandingLinkProps,
  type LandingLinks,
  LandingPage,
  type LandingPrefs,
  LandingProviders,
} from "@margaya/landing";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  DOCS_URL,
  GITHUB_REPOSITORY_URL,
  PUBLIC_SITE_URL,
} from "@/constants/urls";
import { useGuestLocale } from "@/hooks/use-guest-locale";
import { mergeLandingCopy } from "@/lib/landing-copy";
import { useUserPreferencesStore } from "@/store/user-preferences";

// Sign-in and sign-up stay in this app; everything else is on the public site.
const LINKS: LandingLinks = {
  home: "/",
  signIn: "/auth/sign-in",
  signUp: "/auth/sign-up",
  selfHost: `${DOCS_URL}/core/installation`,
  docs: DOCS_URL,
  apiReference: `${DOCS_URL}/api-reference/introduction`,
  pricing: `${PUBLIC_SITE_URL}/pricing`,
  github: GITHUB_REPOSITORY_URL,
  features: {
    plan: `${PUBLIC_SITE_URL}/features/plan`,
    views: `${PUBLIC_SITE_URL}/features/views`,
    docs: `${PUBLIC_SITE_URL}/features/docs`,
    automate: `${PUBLIC_SITE_URL}/features/automate`,
    selfHost: `${PUBLIC_SITE_URL}/features/self-host`,
  },
  site: {
    changelog: `${GITHUB_REPOSITORY_URL}/releases`,
    roadmap: `${GITHUB_REPOSITORY_URL}/issues`,
    alternatives: `${PUBLIC_SITE_URL}/alternatives`,
    compareJira: `${PUBLIC_SITE_URL}/jira-alternative`,
    compareTrello: `${PUBLIC_SITE_URL}/trello-alternative`,
    compareLinear: `${PUBLIC_SITE_URL}/linear-alternative`,
    compareAsana: `${PUBLIC_SITE_URL}/asana-alternative`,
    compareClickup: `${PUBLIC_SITE_URL}/clickup-alternative`,
    compareMonday: `${PUBLIC_SITE_URL}/monday-alternative`,
    blog: `${PUBLIC_SITE_URL}/blog`,
    guides: `${PUBLIC_SITE_URL}/guides`,
    press: `${PUBLIC_SITE_URL}/press`,
    privacy: `${PUBLIC_SITE_URL}/privacy`,
    terms: `${PUBLIC_SITE_URL}/terms`,
    license: `${GITHUB_REPOSITORY_URL}/blob/main/LICENSE`,
  },
};

function RouterLink({ href, ...props }: LandingLinkProps) {
  return <Link to={href} {...props} />;
}

/** The product landing page, shown at `/` to signed-out visitors. */
export default function PublicLanding() {
  // Suspends until the current language's `landing` namespace is loaded.
  const { i18n } = useTranslation("landing");
  const language = i18n.resolvedLanguage ?? i18n.language;
  const copy = useMemo<LandingCopy>(
    () =>
      mergeLandingCopy(
        englishCopy,
        i18n.getResourceBundle(language, "landing"),
      ),
    [i18n, language],
  );

  // The app's own preferences: the guest language (shared with the auth
  // pages) and the theme store, which ThemeProvider applies.
  const { locale, locales, setLocale } = useGuestLocale();
  const theme = useUserPreferencesStore((state) => state.theme);
  const setTheme = useUserPreferencesStore((state) => state.setTheme);
  const prefs = useMemo<LandingPrefs>(
    () => ({
      locale,
      locales,
      setLocale: (code) => void setLocale(code),
      theme,
      setTheme: (next) => setTheme(next),
    }),
    [locale, locales, setLocale, theme, setTheme],
  );

  return (
    <LandingProviders
      copy={copy}
      links={LINKS}
      linkComponent={RouterLink}
      prefs={prefs}
    >
      <PageTitle
        title={`${copy.home.hero.title} ${copy.home.hero.titleAccent}`}
      />
      {/* The app root clips overflow; the landing scrolls on its own. */}
      <div className="h-svh w-full overflow-y-auto overflow-x-hidden">
        <LandingPage />
      </div>
    </LandingProviders>
  );
}
