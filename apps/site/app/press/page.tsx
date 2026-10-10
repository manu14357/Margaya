import { statSync } from "node:fs";
import { join } from "node:path";
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  Copy,
  MessagesSquare,
  X,
} from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import type { ReactNode } from "react";
import { CopyButton } from "@/components/landing/copy-button";
import { Footer } from "@/components/landing/footer";
import { breadcrumbJsonLd, JsonLd } from "@/components/landing/json-ld";
import { Navbar } from "@/components/landing/navbar";
import { OnThisPage } from "@/components/landing/on-this-page";
import { PageIntro } from "@/components/landing/page-intro";
import { ScreenshotGallery } from "@/components/press/screenshot-gallery";
import {
  formatBytes,
  press,
  pressColours,
  pressKitPath,
  pressLinks,
  pressLogos,
  pressUrl,
} from "@/lib/press";
import { pressScreenshots, pressWordmarkPngs } from "@/lib/press-assets";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: press.title,
  description: press.description,
  alternates: { canonical: "/press" },
  openGraph: {
    title: `${press.title} | Margaya`,
    description: press.description,
    url: "/press",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${press.title} | Margaya`,
    description: press.description,
    images: ["/og-image.png"],
  },
};

const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

const ACTION = cn(
  "inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-popover px-2.5 font-medium text-foreground text-sm shadow-xs/5 transition-colors hover:bg-accent/50 dark:bg-input/32 dark:hover:bg-input/64",
  FOCUS,
);

/** The archive's size, read at build time; null if it is missing. */
function pressKitSize() {
  try {
    return formatBytes(
      statSync(join(process.cwd(), "public", pressKitPath)).size,
    );
  } catch {
    return null;
  }
}

function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-24 border-border border-t pt-10 first:border-t-0 first:pt-0"
    >
      <h2
        id={`${id}-title`}
        className="text-balance font-medium text-2xl leading-tight md:text-3xl"
      >
        {title}
      </h2>
      {description ? (
        <p className="mt-3 max-w-2xl text-balance text-muted-foreground leading-relaxed">
          {description}
        </p>
      ) : null}
      <div className="mt-8">{children}</div>
    </section>
  );
}

const facts = [
  press.facts.founded,
  press.facts.licence,
  press.facts.hosting,
  press.facts.languages,
  press.facts.stack,
  press.facts.interfaces,
];

const guidelines = {
  do: Object.values(press.guidelines.do),
  dont: Object.values(press.guidelines.dont),
};

export default function PressPage() {
  const kitSize = pressKitSize();
  const toc = [
    { id: "facts", label: press.facts.title },
    { id: "boilerplate", label: press.boilerplate.title },
    { id: "logos", label: press.logos.title },
    { id: "screenshots", label: press.screenshots.title },
    { id: "colours", label: press.colours.title },
    { id: "guidelines", label: press.guidelines.title },
    { id: "contact", label: press.contact.title },
  ];

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Margaya", path: "/" },
          { name: press.title, path: "/press" },
        ])}
      />
      <Navbar />
      <main className="min-h-screen bg-background text-foreground">
        <section className="px-4 pt-14 pb-12 md:px-6 md:pt-20 md:pb-16 lg:pt-24">
          <div className="mx-auto w-full max-w-6xl">
            <PageIntro
              eyebrow={press.eyebrow}
              title={press.headline}
              description={press.intro}
            >
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <a
                  href={pressKitPath}
                  download
                  className={cn(
                    "inline-flex h-12 items-center justify-center gap-3 rounded-lg border border-primary bg-primary px-5 font-medium text-primary-foreground text-sm shadow-primary/24 shadow-xs transition-colors hover:bg-primary/90",
                    FOCUS,
                  )}
                >
                  <ArrowDown aria-hidden className="size-4" />
                  {press.downloadKit}
                  {kitSize ? (
                    <span className="border-primary-foreground/25 border-l pl-3 font-normal text-primary-foreground/70">
                      {fill(press.downloadKitMeta, { size: kitSize })}
                    </span>
                  ) : null}
                </a>
                <CopyButton
                  value={pressLinks.kit}
                  label={press.copyUrl}
                  copiedLabel={press.copied}
                  className="h-12 px-4"
                />
              </div>
            </PageIntro>
          </div>
        </section>

        <div className="px-4 pb-20 md:px-6 md:pb-28">
          <div className="mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-16">
            <OnThisPage
              title={press.onThisPage}
              items={toc}
              className="max-lg:hidden"
            />
            <div className="flex min-w-0 flex-col gap-16">
              <Section
                id="facts"
                title={press.facts.title}
                description={press.facts.description}
              >
                <dl className="grid overflow-hidden rounded-2xl border border-border sm:grid-cols-2 lg:grid-cols-3">
                  {facts.map((fact) => (
                    <div
                      key={fact.label}
                      className="-mt-px -ml-px border-border border-t border-l p-5"
                    >
                      <dt className="font-medium text-muted-foreground text-xs uppercase tracking-[0.08em]">
                        {fact.label}
                      </dt>
                      <dd className="mt-2 text-balance text-foreground leading-snug">
                        {fact.value}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-4 text-muted-foreground text-sm">
                  {press.facts.source.label}:{" "}
                  <a
                    href={pressLinks.source}
                    className={cn(
                      "rounded-sm font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-current",
                      FOCUS,
                    )}
                  >
                    {press.facts.source.value}
                  </a>
                </p>
              </Section>

              <Section
                id="boilerplate"
                title={press.boilerplate.title}
                description={press.boilerplate.description}
              >
                <div className="grid gap-5 xl:grid-cols-[2fr_3fr]">
                  {[press.boilerplate.short, press.boilerplate.long].map(
                    (text) => (
                      <figure
                        key={text.label}
                        className="flex flex-col rounded-2xl border border-border bg-card"
                      >
                        <figcaption className="flex items-center justify-between gap-3 border-border border-b px-5 py-3">
                          <span className="font-medium text-sm">
                            {text.label}
                          </span>
                          <CopyButton
                            value={text.text}
                            label={press.copy}
                            copiedLabel={press.copied}
                          />
                        </figcaption>
                        <blockquote className="p-5 text-foreground/85 leading-relaxed">
                          {text.text}
                        </blockquote>
                      </figure>
                    ),
                  )}
                </div>
              </Section>

              <Section
                id="logos"
                title={press.logos.title}
                description={press.logos.description}
              >
                <ul className="grid gap-5 sm:grid-cols-2">
                  {pressLogos.map((logo) => {
                    const copy = press.logos[logo.key];
                    const png =
                      logo.key === "wordmarkDark" ||
                      logo.key === "wordmarkLight"
                        ? pressWordmarkPngs.find(
                            (wordmark) => wordmark.surface === logo.surface,
                          )
                        : undefined;
                    const url = pressUrl(logo.path);
                    const isIcon = logo.width === logo.height;
                    return (
                      <li
                        key={logo.key}
                        className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card"
                      >
                        <div
                          className={cn(
                            "flex aspect-[16/9] items-center justify-center p-10",
                            logo.surface === "dark"
                              ? "bg-[#141414]"
                              : "bg-[#F5F5F5]",
                          )}
                        >
                          <Image
                            src={logo.path}
                            alt={copy.alt}
                            width={logo.width}
                            height={logo.height}
                            className={
                              isIcon ? "size-20 md:size-24" : "h-auto w-3/4"
                            }
                          />
                        </div>
                        <div className="flex flex-1 flex-col gap-3 border-border border-t px-4 py-3">
                          <div>
                            <p className="font-medium text-sm">{copy.name}</p>
                            <p className="mt-0.5 text-muted-foreground text-xs">
                              {copy.detail}
                            </p>
                          </div>
                          <code className="truncate rounded-md bg-muted px-2 py-1 font-mono text-muted-foreground text-xs">
                            {url}
                          </code>
                          <div className="flex flex-wrap gap-2">
                            <a
                              href={logo.path}
                              download
                              aria-label={`${press.download}: ${copy.name}`}
                              className={ACTION}
                            >
                              <ArrowDown aria-hidden className="size-3.5" />
                              {press.download}
                            </a>
                            <CopyButton
                              value={url}
                              label={press.copyUrl}
                              copiedLabel={press.copied}
                            />
                            {png ? (
                              <a
                                href={png.path}
                                download
                                aria-label={`${press.downloadPng}: ${copy.name}`}
                                className={ACTION}
                              >
                                <ArrowDown aria-hidden className="size-3.5" />
                                {press.downloadPng}
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Section>

              <Section
                id="screenshots"
                title={press.screenshots.title}
                description={press.screenshots.description}
              >
                <ScreenshotGallery
                  assets={pressScreenshots}
                  copy={{
                    ...press.screenshots,
                    download: press.download,
                    copyUrl: press.copyUrl,
                    copied: press.copied,
                  }}
                />
              </Section>

              <Section
                id="colours"
                title={press.colours.title}
                description={press.colours.description}
              >
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {pressColours.map((colour) => {
                    const copy = press.colours[colour.key];
                    return (
                      <li key={colour.key}>
                        <CopyButton
                          value={colour.hex}
                          label={fill(press.colours.copyHex, {
                            hex: colour.hex,
                          })}
                          copiedLabel={press.copied}
                          className="group flex h-full w-full flex-col items-stretch gap-0 overflow-hidden rounded-2xl border border-border bg-card text-left"
                        >
                          <span
                            aria-hidden
                            className="block aspect-[4/3] border-border border-b"
                            style={{ backgroundColor: colour.hex }}
                          />
                          <span className="flex flex-col gap-0.5 p-3">
                            <span className="flex items-center justify-between gap-2">
                              <span className="font-medium text-sm">
                                {copy.name}
                              </span>
                              <Copy
                                aria-hidden
                                className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                              />
                            </span>
                            <span className="font-mono text-muted-foreground text-xs">
                              {colour.hex}
                            </span>
                            <span className="mt-1 font-normal text-muted-foreground text-xs leading-snug">
                              {copy.usage}
                            </span>
                          </span>
                        </CopyButton>
                      </li>
                    );
                  })}
                </ul>

                <h3 className="mt-12 font-medium text-lg">
                  {press.colours.typeTitle}
                </h3>
                <div className="mt-4 grid gap-5 md:grid-cols-2">
                  {[
                    { font: press.colours.sans, className: "font-sans" },
                    { font: press.colours.mono, className: "font-mono" },
                  ].map(({ font, className }) => (
                    <div
                      key={font.name}
                      className="flex flex-col rounded-2xl border border-border bg-card p-6"
                    >
                      <p
                        aria-hidden
                        className={cn(
                          "font-semibold text-6xl text-foreground tracking-tight",
                          className,
                        )}
                      >
                        Aa
                      </p>
                      <p className={cn("mt-4 text-foreground/85", className)}>
                        {press.colours.sample}
                      </p>
                      <p className="mt-5 font-medium text-sm">{font.name}</p>
                      <p className="mt-0.5 text-muted-foreground text-sm leading-relaxed">
                        {font.usage}
                      </p>
                    </div>
                  ))}
                </div>
              </Section>

              <Section id="guidelines" title={press.guidelines.title}>
                <div className="grid gap-5 md:grid-cols-2">
                  {(
                    [
                      ["do", press.guidelines.doTitle, guidelines.do],
                      ["dont", press.guidelines.dontTitle, guidelines.dont],
                    ] as const
                  ).map(([kind, title, items]) => (
                    <div
                      key={kind}
                      className="rounded-2xl border border-border bg-card p-6"
                    >
                      <h3 className="flex items-center gap-2 font-medium">
                        <span
                          aria-hidden
                          className={cn(
                            "flex size-6 items-center justify-center rounded-full",
                            kind === "do"
                              ? "bg-success/12 text-success-foreground"
                              : "bg-destructive/12 text-destructive-foreground",
                          )}
                        >
                          {kind === "do" ? (
                            <Check className="size-3.5" />
                          ) : (
                            <X className="size-3.5" />
                          )}
                        </span>
                        {title}
                      </h3>
                      <ul className="mt-4 flex flex-col gap-3 text-foreground/85 text-sm leading-relaxed">
                        {items.map((item) => (
                          <li
                            key={item}
                            className="border-border border-t pt-3 first:border-t-0 first:pt-0"
                          >
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </Section>

              <Section id="contact" title={press.contact.title}>
                <div className="flex flex-col gap-6 rounded-2xl border border-border bg-sidebar p-6 md:flex-row md:items-center md:justify-between md:p-8">
                  <div className="flex gap-4">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground">
                      <MessagesSquare aria-hidden className="size-5" />
                    </span>
                    <p className="max-w-xl text-foreground/85 leading-relaxed">
                      {press.contact.body}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                    <a
                      href={pressLinks.discussions}
                      target="_blank"
                      rel="noreferrer"
                      className={cn(
                        "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-primary bg-primary px-4 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90",
                        FOCUS,
                      )}
                    >
                      {press.contact.discussions}
                      <ArrowUpRight aria-hidden className="size-4" />
                    </a>
                    <a
                      href={pressLinks.issues}
                      target="_blank"
                      rel="noreferrer"
                      className={cn(ACTION, "h-10 justify-center px-4")}
                    >
                      {press.contact.issues}
                      <ArrowUpRight aria-hidden className="size-4" />
                    </a>
                  </div>
                </div>
              </Section>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
