import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Clock,
  Info,
  Laptop,
  Monitor,
  Server,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CodeBlock } from "@/components/download/code-block";
import { DesktopPlatformProvider } from "@/components/download/desktop-platform";
import { DownloadFiles } from "@/components/download/download-files";
import { DownloadPicker } from "@/components/download/download-picker";
import { LinuxCommands } from "@/components/download/linux-commands";
import { PlatformTabs } from "@/components/download/platform-tabs";
import { Footer } from "@/components/landing/footer";
import { breadcrumbJsonLd, JsonLd } from "@/components/landing/json-ld";
import { Navbar } from "@/components/landing/navbar";
import { OnThisPage } from "@/components/landing/on-this-page";
import { PageIntro } from "@/components/landing/page-intro";
import {
  type DesktopFileKey,
  type DesktopRelease,
  desktopLinks,
  download,
  loadDesktopRelease,
} from "@/lib/desktop-release";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: download.title,
  description: download.description,
  alternates: { canonical: "/download" },
  openGraph: {
    title: `${download.title} | Margaya`,
    description: download.description,
    url: "/download",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${download.title} | Margaya`,
    description: download.description,
    images: ["/og-image.png"],
  },
};

const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

const TEXT_LINK = cn(
  "inline-flex items-center gap-1 rounded-sm font-medium text-foreground text-sm underline decoration-border underline-offset-4 hover:decoration-current",
  FOCUS,
);

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
        <p className="mt-3 max-w-2xl text-pretty text-muted-foreground leading-relaxed">
          {description}
        </p>
      ) : null}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(iso));
}

function ComingSoon() {
  return (
    <div className="mt-9 flex w-full max-w-xl flex-col items-center gap-4 rounded-2xl border border-border bg-card p-6 text-center shadow-xs/5 sm:p-8">
      <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Clock aria-hidden className="size-5" />
      </span>
      <div>
        <p className="font-medium text-lg">{download.comingSoon.title}</p>
        <p className="mt-2 text-pretty text-muted-foreground leading-relaxed">
          {download.comingSoon.body}
        </p>
      </div>
      <a
        href={desktopLinks.releases}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "inline-flex h-10 items-center gap-1.5 rounded-md border border-input bg-popover px-4 font-medium text-foreground text-sm shadow-xs/5 transition-colors hover:bg-accent/50 dark:bg-input/32 dark:hover:bg-input/64",
          FOCUS,
        )}
      >
        {download.comingSoon.action}
        <ArrowUpRight aria-hidden className="size-4" />
      </a>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 flex gap-3 rounded-xl bg-muted/70 px-4 py-3 text-muted-foreground text-sm leading-relaxed">
      <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="overflow-hidden rounded-2xl border border-border bg-card">
      {steps.map((step, index) => (
        <li
          key={step}
          className="flex gap-4 border-border border-t px-4 py-4 first:border-t-0 sm:px-5"
        >
          <span
            aria-hidden
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 font-medium text-primary text-sm"
          >
            {index + 1}
          </span>
          <span className="pt-0.5 text-pretty text-foreground/90 leading-relaxed">
            {step}
          </span>
        </li>
      ))}
    </ol>
  );
}

function fileName(
  release: DesktopRelease,
  key: DesktopFileKey,
  fallback: string,
) {
  return release.files.find((file) => file.key === key)?.name ?? fallback;
}

const tabsCopy = download.platforms;

export default async function DownloadPage() {
  const release = await loadDesktopRelease();
  const launch = download.firstLaunch;

  const toc = [
    ...(release ? [{ id: "downloads", label: download.files.title }] : []),
    { id: "install", label: launch.title },
    { id: "requirements", label: download.requirements.title },
    ...(release ? [{ id: "verify", label: download.verify.title }] : []),
    { id: "help", label: download.help.title },
  ];

  const requirements = [
    { icon: Laptop, ...download.requirements.macos },
    { icon: Monitor, ...download.requirements.windows },
    { icon: Terminal, ...download.requirements.linux },
  ];

  const help = [
    {
      icon: BookOpen,
      href: desktopLinks.guide,
      external: false,
      ...download.help.guide,
    },
    {
      icon: ShieldCheck,
      href: desktopLinks.admin,
      external: false,
      ...download.help.admin,
    },
    {
      icon: ArrowUpRight,
      href: desktopLinks.releases,
      external: true,
      ...download.help.releases,
    },
  ];

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Margaya", path: "/" },
          { name: download.title, path: "/download" },
        ])}
      />
      <Navbar />
      <DesktopPlatformProvider>
        <main className="min-h-screen bg-background text-foreground">
          <section className="px-4 pt-16 pb-14 sm:px-6 md:pt-24 md:pb-20">
            <div className="mx-auto w-full max-w-6xl">
              <PageIntro
                align="center"
                eyebrow={download.eyebrow}
                title={download.headline}
                description={download.intro}
              >
                {release ? (
                  <DownloadPicker
                    files={release.files}
                    copy={{ ...download.picker, ...download.meta }}
                    version={release.version}
                    releasedOn={
                      release.publishedAt
                        ? formatDate(release.publishedAt)
                        : null
                    }
                    notesUrl={release.notesUrl}
                    allDownloadsHref="#downloads"
                  />
                ) : (
                  <ComingSoon />
                )}
              </PageIntro>
            </div>
          </section>

          <div className="px-4 pb-20 sm:px-6 md:pb-28">
            <div className="mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-16">
              <OnThisPage
                title={download.onThisPage}
                items={toc}
                className="max-lg:hidden"
              />
              <div className="flex min-w-0 flex-col gap-16">
                {release ? (
                  <Section
                    id="downloads"
                    title={download.files.title}
                    description={download.files.description}
                  >
                    <DownloadFiles
                      files={release.files}
                      copy={download.files}
                      tabs={tabsCopy}
                    />
                    <p className="mt-4">
                      <a
                        href={desktopLinks.releases}
                        target="_blank"
                        rel="noreferrer"
                        className={cn(TEXT_LINK, "text-muted-foreground")}
                      >
                        {download.meta.allReleases}
                        <ArrowUpRight aria-hidden className="size-3.5" />
                      </a>
                    </p>
                  </Section>
                ) : null}

                <Section
                  id="install"
                  title={launch.title}
                  description={launch.description}
                >
                  <PlatformTabs
                    copy={tabsCopy}
                    panels={{
                      macos: (
                        <>
                          <Steps
                            steps={[
                              launch.macos.step1,
                              launch.macos.step2,
                              launch.macos.step3,
                            ]}
                          />
                          <Note>{launch.macos.note}</Note>
                        </>
                      ),
                      windows: (
                        <>
                          <Steps
                            steps={[
                              launch.windows.step1,
                              launch.windows.step2,
                              launch.windows.step3,
                            ]}
                          />
                          <Note>{launch.windows.note}</Note>
                        </>
                      ),
                      linux: (
                        <>
                          <p className="mb-4 max-w-2xl text-pretty text-muted-foreground leading-relaxed">
                            {launch.linux.intro}
                          </p>
                          <LinuxCommands
                            files={release?.files ?? []}
                            copy={launch.linux}
                            code={download.code}
                          />
                          <Note>{launch.linux.note}</Note>
                        </>
                      ),
                    }}
                  />
                  <p className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
                    <a
                      href={`${desktopLinks.guide}#download-and-install`}
                      className={TEXT_LINK}
                    >
                      {launch.guide}
                      <ArrowRight aria-hidden className="size-3.5" />
                    </a>
                    <a
                      href={`${desktopLinks.guide}#troubleshooting`}
                      className={TEXT_LINK}
                    >
                      {launch.troubleshooting}
                      <ArrowRight aria-hidden className="size-3.5" />
                    </a>
                  </p>
                </Section>

                <Section id="requirements" title={download.requirements.title}>
                  <div className="overflow-hidden rounded-2xl border border-border bg-card">
                    <dl className="grid sm:grid-cols-3">
                      {requirements.map(({ icon: Icon, name, value }) => (
                        <div
                          key={name}
                          className="border-border border-t p-5 first:border-t-0 sm:border-t-0 sm:border-l sm:first:border-l-0"
                        >
                          <dt className="flex items-center gap-2 font-medium text-sm">
                            <Icon
                              aria-hidden
                              className="size-4 text-muted-foreground"
                            />
                            {name}
                          </dt>
                          <dd className="mt-2 text-pretty text-muted-foreground text-sm leading-relaxed">
                            {value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <p className="flex gap-2 border-border border-t bg-muted/40 px-5 py-3 text-muted-foreground text-sm leading-relaxed">
                      <Server aria-hidden className="mt-0.5 size-4 shrink-0" />
                      <span>
                        <span className="font-medium text-foreground">
                          {download.requirements.server.name}:
                        </span>{" "}
                        {download.requirements.server.value}
                      </span>
                    </p>
                  </div>
                </Section>

                {release ? (
                  <Section
                    id="verify"
                    title={download.verify.title}
                    description={download.verify.description}
                  >
                    <div className="flex flex-col gap-3">
                      <CodeBlock
                        label={download.verify.macos}
                        lines={[
                          `shasum -a 256 ~/Downloads/${fileName(
                            release,
                            "macArm",
                            `Margaya_${release.version}_aarch64.dmg`,
                          )}`,
                        ]}
                        copy={download.code}
                      />
                      <CodeBlock
                        label={download.verify.windows}
                        lines={[
                          `Get-FileHash "$HOME\\Downloads\\${fileName(
                            release,
                            "windowsExe",
                            `Margaya_${release.version}_x64-setup.exe`,
                          )}"`,
                        ]}
                        copy={download.code}
                      />
                      <CodeBlock
                        label={download.verify.linux}
                        lines={[
                          `sha256sum ~/Downloads/${fileName(
                            release,
                            "linuxAppImage",
                            `Margaya_${release.version}_amd64.AppImage`,
                          )}`,
                        ]}
                        copy={download.code}
                      />
                    </div>
                  </Section>
                ) : null}

                <Section id="help" title={download.help.title}>
                  <ul className="grid gap-4 md:grid-cols-3">
                    {help.map(
                      ({ icon: Icon, href, title, body, link, external }) => (
                        <li key={href}>
                          <a
                            href={href}
                            {...(external
                              ? { target: "_blank", rel: "noreferrer" }
                              : {})}
                            className={cn(
                              "group flex h-full flex-col rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-accent/30",
                              FOCUS,
                            )}
                          >
                            <span className="flex items-center gap-3 font-medium">
                              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <Icon aria-hidden className="size-4" />
                              </span>
                              {title}
                            </span>
                            <span className="mt-3 text-pretty text-muted-foreground text-sm leading-relaxed">
                              {body}
                            </span>
                            <span className="mt-auto inline-flex items-center gap-1 pt-4 font-medium text-primary text-sm">
                              {link}
                              {external ? (
                                <ArrowUpRight
                                  aria-hidden
                                  className="size-3.5"
                                />
                              ) : (
                                <ArrowRight
                                  aria-hidden
                                  className="size-3.5 transition-transform group-hover:translate-x-0.5"
                                />
                              )}
                            </span>
                          </a>
                        </li>
                      ),
                    )}
                  </ul>
                </Section>
              </div>
            </div>
          </div>
        </main>
      </DesktopPlatformProvider>
      <Footer />
    </>
  );
}
