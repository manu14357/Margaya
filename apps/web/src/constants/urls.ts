import { getDocsUrl, resolvePublicSiteUrl } from "@/lib/public-site-url";

export const isDemoMode = window.location.hostname === "demo.margaya.app";

/** The public Margaya website, which also hosts the documentation. */
export const PUBLIC_SITE_URL = resolvePublicSiteUrl(
  import.meta.env.VITE_PUBLIC_SITE_URL,
);

export const DOCS_URL = getDocsUrl(PUBLIC_SITE_URL);

export const GITHUB_REPOSITORY_URL = "https://github.com/manu14357/Margaya";
