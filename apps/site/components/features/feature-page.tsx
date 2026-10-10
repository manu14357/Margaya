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
import {
  type FeatureCopyKey,
  type FeatureSlug,
  featureCopyKey,
  featureSlugs,
} from "@/lib/features";
import { cn } from "@/lib/utils";
import { featureScene } from "./feature-scenes";

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
      <section className="px-4 pt-14 pb-12 md:px-6 md:pt-20 md:pb-16 lg:pt-24">
        <div className="mx-auto w-full max-w-6xl">
          <header className="max-w-3xl">
            <p className="font-medium text-muted-foreground text-sm">
              {page.eyebrow}
            </p>
            <h1 className="mt-3 text-balance font-medium text-4xl leading-[1.06] md:text-6xl">
              {page.title}
            </h1>
            <p className="mt-5 max-w-2xl text-balance text-lg text-muted-foreground leading-relaxed md:text-xl">
              {page.description}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <LandingButton href={links.signUp}>
                {common.getStarted}
                <ArrowRight aria-hidden />
              </LandingButton>
              <LandingButton
                href={slug === "automate" ? links.apiReference : links.selfHost}
                variant="outline"
              >
                {slug === "automate" ? common.readDocs : common.selfHost}
              </LandingButton>
            </div>
          </header>
        </div>
      </section>

      {slug === "self-host" ? <OwnItSection /> : null}

      {withScene.map(([key, section], index) => (
        <section
          key={key}
          aria-labelledby={`feature-${key}`}
          className="border-border border-t px-4 py-16 md:px-6 md:py-24"
        >
          <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-16">
            <div className={cn(index % 2 === 1 && "lg:order-2")}>
              <h2
                id={`feature-${key}`}
                className="text-balance font-medium text-2xl leading-tight md:text-3xl"
              >
                {section.title}
              </h2>
              <p className="mt-4 text-balance text-lg text-muted-foreground leading-relaxed">
                {section.body}
              </p>
            </div>
            <SceneSlot page={copyKey} section={key} />
          </div>
        </section>
      ))}

      {textOnly.length > 0 ? (
        <section className="border-border border-t px-4 py-16 md:px-6 md:py-24">
          <ul className="mx-auto grid w-full max-w-6xl gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-2">
            {textOnly.map(([key, section]) => (
              <li
                key={key}
                className="bg-background p-6 md:p-8 md:last:odd:col-span-2"
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

      <section
        aria-labelledby="feature-cta"
        className="px-4 pt-8 pb-16 md:px-6 md:pb-24"
      >
        <div className="mx-auto w-full max-w-6xl rounded-2xl bg-primary px-6 py-14 text-center text-primary-foreground md:px-12 md:py-16">
          <h2
            id="feature-cta"
            className="mx-auto max-w-2xl text-balance font-medium text-3xl leading-tight md:text-4xl"
          >
            {page.cta.title}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-balance text-lg leading-relaxed opacity-75">
            {page.cta.description}
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <LandingLink
              href={links.signUp}
              className="inline-flex h-12 items-center gap-2 rounded-lg bg-primary-foreground px-5 font-medium text-primary text-sm outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
            >
              {common.getStarted}
              <ArrowRight aria-hidden className="size-4" />
            </LandingLink>
            <LandingLink
              href={links.selfHost}
              className="inline-flex h-12 items-center rounded-lg border border-primary-foreground/25 px-5 font-medium text-sm outline-none transition-colors hover:bg-primary-foreground/10 focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
            >
              {common.selfHost}
            </LandingLink>
          </div>
        </div>
      </section>

      <nav
        aria-labelledby="feature-more"
        className="border-border border-t px-4 py-16 md:px-6 md:py-20"
      >
        <div className="mx-auto w-full max-w-6xl">
          <h2 id="feature-more" className="font-medium text-xl">
            {common.moreFeatures}
          </h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
