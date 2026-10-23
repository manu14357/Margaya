"use client";

import NumberFlow from "@number-flow/react";
import {
  ArrowRight,
  Check,
  type LucideIcon,
  Server,
  User,
  Users,
} from "lucide-react";
import { useId, useState } from "react";
import {
  type CloudPlan,
  checkoutUrl,
  cloudPrices,
  formatUsd,
  type Interval,
  pricing,
} from "@/lib/pricing";
import { siteLinks } from "@/lib/site-links";
import { cn } from "@/lib/utils";

const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";

function fill(template: string, values: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in values ? values[key] : match,
  );
}

type Card = {
  key: "selfHosted" | CloudPlan;
  icon: LucideIcon;
  name: string;
  tagline: string;
  price: number;
  period: string;
  note: string;
  cta: string;
  href: string;
  points: string[];
  featured?: boolean;
  badge?: string;
};

function cards(interval: Interval): Card[] {
  const { selfHosted, personal, team } = pricing.plans;
  const cloud = (plan: CloudPlan) => {
    const copy = pricing.plans[plan];
    const price = cloudPrices[plan][interval];
    return {
      price,
      period: interval === "monthly" ? copy.monthlyPeriod : copy.annualPeriod,
      note:
        interval === "monthly"
          ? copy.monthlyNote
          : fill(copy.annualNote, {
              price: formatUsd(Math.round((price / 12) * 100) / 100),
            }),
      href: checkoutUrl(plan, interval),
    };
  };

  return [
    {
      key: "selfHosted",
      icon: Server,
      name: selfHosted.name,
      tagline: selfHosted.tagline,
      price: 0,
      period: selfHosted.period,
      note: selfHosted.note,
      cta: selfHosted.cta,
      href: siteLinks.selfHost,
      points: Object.values(selfHosted.points),
    },
    {
      key: "personal",
      icon: User,
      name: personal.name,
      tagline: personal.tagline,
      cta: personal.cta,
      points: Object.values(personal.points),
      ...cloud("personal"),
    },
    {
      key: "team",
      icon: Users,
      name: team.name,
      tagline: team.tagline,
      cta: team.cta,
      points: Object.values(team.points),
      featured: true,
      badge: team.badge,
      ...cloud("team"),
    },
  ];
}

/** The billing-period switch and the three plan cards. */
export function PricingPlans() {
  const [interval, setInterval] = useState<Interval>("annual");
  const name = useId();
  const copy = pricing.interval;

  return (
    <div>
      <div className="flex flex-col items-center gap-3 text-center">
        <fieldset>
          <legend className="sr-only">{copy.label}</legend>
          <div className="inline-flex rounded-xl border border-border bg-muted p-1">
            {(["monthly", "annual"] as const).map((value) => (
              <label
                key={value}
                className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg px-4 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground has-checked:bg-background has-checked:text-foreground has-checked:shadow-xs has-focus-visible:ring-2 has-focus-visible:ring-ring"
              >
                <input
                  type="radio"
                  name={name}
                  value={value}
                  checked={interval === value}
                  onChange={() => setInterval(value)}
                  className="sr-only"
                />
                {copy[value]}
                {value === "annual" && (
                  <span className="rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-foreground text-xs tabular-nums">
                    {copy.saving}
                  </span>
                )}
              </label>
            ))}
          </div>
        </fieldset>
        <p className="text-muted-foreground text-sm">{pricing.trialNote}</p>
      </div>

      <ul className="mt-10 grid gap-4 lg:grid-cols-3">
        {cards(interval).map((card) => {
          const Icon = card.icon;
          return (
            <li
              key={card.key}
              className={cn(
                "flex flex-col rounded-xl border bg-card p-6 md:p-7",
                card.featured ? "border-primary/50" : "border-border",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 font-medium">
                  <Icon aria-hidden className="size-4 opacity-70" />
                  {card.name}
                </h2>
                {card.badge ? (
                  <span className="rounded-full border border-primary/30 px-2.5 py-0.5 font-medium text-primary text-xs">
                    {card.badge}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-muted-foreground text-sm">
                {card.tagline}
              </p>

              <p className="mt-8 flex flex-wrap items-baseline gap-x-2">
                <NumberFlow
                  value={card.price}
                  locales="en-US"
                  format={{
                    style: "currency",
                    currency: "USD",
                    maximumFractionDigits: 0,
                  }}
                  transformTiming={{ duration: 250, easing: EASE }}
                  opacityTiming={{ duration: 150, easing: EASE }}
                  respectMotionPreference
                  className="font-medium text-5xl tabular-nums tracking-tight"
                />
                <span className="text-muted-foreground text-sm">
                  {card.period}
                </span>
              </p>
              <p className="mt-1.5 min-h-5 text-muted-foreground text-sm">
                {card.note}
              </p>

              <a
                href={card.href}
                className={cn(
                  "mt-7 inline-flex h-11 items-center justify-center gap-2 rounded-lg border px-4 font-medium text-sm transition-colors",
                  card.featured
                    ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                    : "border-input bg-popover text-foreground hover:bg-accent/50 dark:bg-input/32 dark:hover:bg-input/64",
                  FOCUS,
                )}
              >
                {card.cta}
                <ArrowRight aria-hidden className="size-4" />
              </a>

              <ul className="mt-7 flex flex-col gap-3 border-border border-t pt-6 text-sm">
                {card.points.map((point) => (
                  <li key={point} className="flex items-start gap-2.5">
                    <Check
                      aria-hidden
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="text-foreground/85">{point}</span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
