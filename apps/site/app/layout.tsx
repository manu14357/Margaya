import type { Metadata, Viewport } from "next";
import { themeScript } from "@/lib/landing-theme";
import "./globals.css";

const siteTitle =
  "Margaya - Project management that doesn't become the project.";
const siteDescription =
  "Fast, open-source project management for teams that want clear ownership without heavy process. Use Margaya Cloud or host it yourself.";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#141414" },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL("https://margaya.app"),
  title: {
    default: siteTitle,
    template: "%s | Margaya",
  },
  description: siteDescription,
  keywords: [
    "margaya",
    "project management",
    "open source",
    "kanban",
    "task management",
    "self-hosted",
    "team collaboration",
  ],
  applicationName: "Margaya",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "https://margaya.app",
    siteName: "Margaya",
    title: siteTitle,
    description: siteDescription,
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Margaya",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
  category: "productivity",
  creator: "Margaya",
  publisher: "Margaya",
};

const jsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Margaya",
    url: "https://margaya.app",
    logo: "https://margaya.app/logo-512.png",
    sameAs: ["https://github.com/manu14357/Margaya"],
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Margaya",
    url: "https://margaya.app",
    inLanguage: "en",
  },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Margaya",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web, Linux, macOS, Windows",
    description: siteDescription,
    url: "https://margaya.app",
    image: "https://margaya.app/og-image.png",
    license: "https://github.com/manu14357/Margaya/blob/main/LICENSE",
  },
];

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: Applies the stored or system theme before hydration, so the page never flashes the wrong one.
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
        {children}
        <script
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD structured data must be inlined as a script tag for search engines to parse.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </body>
    </html>
  );
}
