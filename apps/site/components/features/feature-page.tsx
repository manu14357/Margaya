"use client";

import {
  LandingButton,
  LandingLink,
  LazyMount,
  OwnItSection,
  useLandingCopy,
  useLandingLinks,
} from "@margaya/landing";
import { ArrowRight } from "lucide-react";
import { ClosingCta } from "@/components/content/closing-cta";
import {
  type FeatureCopyKey,
  type FeatureSlug,
  featureCopyKey,
  featureSlugs,
} from "@/lib/features";
import { featureScene } from "./feature-scenes";

/** Where the AI page's second button leads: the AI setup guide. */
const AI_GUIDE = "/docs/core/functional/ai-setup";

function SceneSlot({
  page,
  section,
}: {
  page: FeatureCopyKey;
  section: string;
}) {
  const placeholder = useLandingCopy().home.placeholder;
  const Scene = featureScene(page, section);
  if (Scene && Scene !== "pending") {
    return (
      <LazyMount className="aspect-[16/10]">
        <Scene />
      </LazyMount>
    );
  }
  return (
    <div
      data-scene-pending={`${page}.${section}`}
      className="flex aspect-[16/10] w-full items-center justify-center rounded-xl border border-border border-dashed bg-muted/30 px-6 text-center text-muted-foreground text-sm"
    >
      {placeholder}
    </div>
  );
}

export function FeaturePageBody({ slug }: { slug: FeatureSlug }) {
  const landing = useLandingCopy();
  const links = useLandingLinks();
  const copyKey = featureCopyKey(slug);
  const common = landing.pages.common;
  const page = landing.pages[copyKey];
  const sections = Object.entries(page.sections) as [
    string,
    { title: string; body: string },
  ][];
  const withScene = sections.filter(([key]) => featureScene(copyKey, key));
  const textOnly = sections.filter(([key]) => !featureScene(copyKey, key));
  const otherPages = featureSlugs.filter((other) => other !== slug);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="px-4 pt-16 pb-16 sm:px-6 md:pt-24 md:pb-20">
        <header className="mx-auto flex w-full max-w-3xl flex-col items-center text-center">
          <p className="font-medium text-muted-foreground text-sm">
            {page.eyebrow}
          </p>
          <h1 className="mt-3 text-balance font-medium text-[2.5rem] leading-[1.08] tracking-[-0.03em] sm:text-5xl md:text-6xl">
            {page.title}
          </h1>
          <p className="mt-6 max-w-xl text-pretty text-base text-muted-foreground leading-relaxed sm:text-lg">
            {page.description}
          </p>
          <div className="mt-9 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
            <LandingButton href={links.signUp} className="w-full sm:w-auto">
              {common.getStarted}
              <ArrowRight aria-hidden />
            </LandingButton>
            <LandingButton
              href={
                slug === "automate"
                  ? links.apiReference
                  : slug === "ai"
                    ? AI_GUIDE
                    : links.selfHost
              }
              variant="outline"
              className="w-full sm:w-auto"
            >
              {slug === "automate" || slug === "ai"
                ? common.readDocs
                : common.selfHost}
            </LandingButton>
          </div>
        </header>
      </section>

      {slug === "self-host" ? <OwnItSection /> : null}

      {withScene.map(([key, section]) => (
        <section
          key={key}
          aria-labelledby={`feature-${key}`}
          className="px-4 py-16 sm:px-6 md:py-24"
        >
          <div className="mx-auto w-full max-w-6xl">
            <header className="mx-auto max-w-2xl text-center">
              <h2
                id={`feature-${key}`}
                className="text-balance font-medium text-3xl leading-[1.15] tracking-[-0.02em] md:text-4xl"
              >
                {section.title}
              </h2>
              <p className="mt-4 text-pretty text-base text-muted-foreground leading-relaxed md:text-lg">
                {section.body}
              </p>
            </header>
            <div className="mx-auto mt-10 max-w-5xl md:mt-14">
              <SceneSlot page={copyKey} section={key} />
            </div>
          </div>
        </section>
      ))}

      {textOnly.length > 0 ? (
        <section className="px-4 py-16 sm:px-6 md:py-24">
          <ul className="mx-auto grid w-full max-w-6xl gap-4 md:grid-cols-2">
            {textOnly.map(([key, section]) => (
              <li
                key={key}
                className="rounded-xl border border-border bg-card p-6 md:p-8 md:last:odd:col-span-2"
              >
                <h2 className="font-medium text-lg">{section.title}</h2>
                <p className="mt-2 text-muted-foreground leading-relaxed">
                  {section.body}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ClosingCta
        id="feature-cta"
        title={page.cta.title}
        description={page.cta.description}
        actions={
          <>
            <LandingButton href={links.signUp}>
              {common.getStarted}
              <ArrowRight aria-hidden />
            </LandingButton>
            <LandingButton href={links.selfHost} variant="outline">
              {common.selfHost}
            </LandingButton>
          </>
        }
      />

      <nav
        aria-labelledby="feature-more"
        className="border-border border-t px-4 py-16 sm:px-6 md:py-20"
      >
        <div className="mx-auto w-full max-w-6xl">
          <h2 id="feature-more" className="font-medium text-xl">
            {common.moreFeatures}
          </h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {otherPages.map((other) => {
              const key = featureCopyKey(other);
              const item = landing.home.nav.items[key];
              return (
                <li key={other}>
                  <LandingLink
                    href={links.features[key]}
                    className="group flex h-full flex-col rounded-xl border border-border bg-card p-5 outline-none transition-colors hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex items-center justify-between font-medium">
                      {item.title}
                      <ArrowRight
                        aria-hidden
                        className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                      />
                    </span>
                    <span className="mt-1.5 text-muted-foreground text-sm leading-relaxed">
                      {item.description}
                    </span>
                  </LandingLink>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>
    </main>
  );
}
