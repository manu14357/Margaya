"use client";

import { ArrowRight, Cloud, type LucideIcon, Server } from "lucide-react";
import { useLandingCopy } from "../copy";
import { LandingButton } from "../lib/button";
import { cn } from "../lib/cn";
import { LandingLink, useLandingLinks } from "../links";
import { LandingSection } from "./section";

/** The pricing teaser: the two ways to run Margaya, then the full page. */
export function PricingSection() {
  const copy = useLandingCopy().home.pricing;
  const links = useLandingLinks();

  const plans: {
    key: string;
    icon: LucideIcon;
    plan: typeof copy.cloud;
    href: string;
    primary: boolean;
  }[] = [
    {
      key: "selfHosted",
      icon: Server,
      plan: copy.selfHosted,
      href: links.selfHost,
      primary: false,
    },
    {
      key: "cloud",
      icon: Cloud,
      plan: copy.cloud,
      href: links.signUp,
      primary: true,
    },
  ];

  return (
    <LandingSection id="pricing" copy={copy}>
      <ul className="grid gap-4 md:grid-cols-2">
        {plans.map(({ key, icon: Icon, plan, href, primary }) => (
          <li
            key={key}
            className={cn(
              "flex flex-col rounded-xl border bg-card p-6 md:p-8",
              primary ? "border-foreground/20 shadow-xs" : "border-border",
            )}
          >
            <div className="flex items-center gap-2 text-muted-foreground">
              <Icon aria-hidden className="size-4" />
              <h3 className="font-medium text-foreground text-sm">
                {plan.name}
              </h3>
            </div>
            <p className="mt-5 flex items-baseline gap-2">
              <span className="font-medium text-4xl text-foreground tracking-tight">
                {plan.price}
              </span>
              <span className="text-muted-foreground text-sm">
                {plan.suffix}
              </span>
            </p>
            <p className="mt-3 max-w-md flex-1 text-muted-foreground text-sm leading-relaxed">
              {plan.body}
            </p>
            <LandingButton
              href={href}
              variant={primary ? "primary" : "outline"}
              size="md"
              className="mt-6 self-start"
            >
              {plan.cta}
              <ArrowRight aria-hidden />
            </LandingButton>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">{copy.note}</p>
        <LandingLink
          href={links.pricing}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-sm font-medium text-foreground text-sm underline decoration-border underline-offset-4 outline-none transition-colors hover:decoration-current focus-visible:ring-2 focus-visible:ring-ring"
        >
          {copy.compare}
          <ArrowRight aria-hidden className="size-4" />
        </LandingLink>
      </div>
    </LandingSection>
  );
}
