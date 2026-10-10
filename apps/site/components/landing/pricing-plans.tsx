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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <fieldset>
          <legend className="sr-only">{copy.label}</legend>
          <div className="inline-flex rounded-xl border border-border bg-sidebar p-1">
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
                  <span className="rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-foreground text-xs">
                    {copy.saving}
                  </span>
                )}
              </label>
            ))}
          </div>
        </fieldset>
        <p className="text-muted-foreground text-sm">{pricing.trialNote}</p>
      </div>

      <ul className="mt-8 grid gap-5 lg:grid-cols-3">
        {cards(interval).map((card) => {
          const Icon = card.icon;
          return (
            <li
              key={card.key}
              className={cn(
                "flex flex-col rounded-2xl border p-6 md:p-7",
                card.featured
                  ? "border-primary bg-primary text-primary-foreground shadow-xl"
                  : "border-border bg-card",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 font-medium">
                  <Icon aria-hidden className="size-4 opacity-70" />
                  {card.name}
                </h2>
                {card.badge ? (
                  <span className="rounded-full border border-primary-foreground/20 px-2.5 py-0.5 text-xs">
                    {card.badge}
                  </span>
                ) : null}
              </div>
              <p
                className={cn(
                  "mt-1 text-sm",
                  card.featured
                    ? "text-primary-foreground/70"
                    : "text-muted-foreground",
                )}
              >
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
                <span
                  className={cn(
                    "text-sm",
                    card.featured
                      ? "text-primary-foreground/70"
                      : "text-muted-foreground",
                  )}
                >
                  {card.period}
                </span>
              </p>
              <p
                className={cn(
                  "mt-1.5 min-h-5 text-sm",
                  card.featured
                    ? "text-primary-foreground/70"
                    : "text-muted-foreground",
                )}
              >
                {card.note}
              </p>

              <a
                href={card.href}
                className={cn(
                  "mt-7 inline-flex h-11 items-center justify-center gap-2 rounded-lg border px-4 font-medium text-sm transition-colors",
                  card.featured
                    ? "border-primary-foreground bg-primary-foreground text-primary hover:bg-primary-foreground/90"
                    : "border-input bg-popover text-foreground shadow-xs/5 hover:bg-accent/50 dark:bg-input/32 dark:hover:bg-input/64",
                  FOCUS,
                  card.featured &&
                    "focus-visible:ring-primary-foreground focus-visible:ring-offset-primary",
                )}
              >
                {card.cta}
                <ArrowRight aria-hidden className="size-4" />
              </a>

              <ul
                className={cn(
                  "mt-7 flex flex-col gap-3 border-t pt-6 text-sm",
                  card.featured
                    ? "border-primary-foreground/15"
                    : "border-border",
                )}
              >
                {card.points.map((point) => (
                  <li key={point} className="flex items-start gap-2.5">
                    <Check
                      aria-hidden
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        card.featured
                          ? "text-primary-foreground"
                          : "text-foreground",
                      )}
                    />
                    <span
                      className={
                        card.featured
                          ? "text-primary-foreground/90"
                          : "text-foreground/85"
                      }
                    >
                      {point}
                    </span>
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
