import messages from "../../../i18n/en-US.json";

// The pricing page is English-only; its copy is the canonical `pricing`.
export const pricing = messages.pricing;

export const CLOUD_URL = "https://cloud.margaya.app";

export type Interval = "monthly" | "annual";
export type CloudPlan = "personal" | "team";

/**
 * Margaya Cloud prices in USD. The API sells these through Creem products
 * (apps/api/src/billing/config.ts); keep both in step. A year costs ten
 * months.
 */
export const cloudPrices: Record<CloudPlan, Record<Interval, number>> = {
  personal: { monthly: 4, annual: 40 },
  team: { monthly: 5, annual: 50 },
};

/** Sign-up that resumes into checkout (apps/web/src/lib/checkout-intent.ts). */
export function checkoutUrl(plan: CloudPlan, interval: Interval) {
  return `${CLOUD_URL}/auth/sign-up?checkout=${plan}-${interval}`;
}

export function formatUsd(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

type ValueKey = keyof typeof pricing.table.values;
type RowKey = keyof typeof pricing.table.rows;
type GroupKey = keyof typeof pricing.table.groups;

/** `true` is included, `false` is not, a string is a `table.values` key. */
export type PlanCell = boolean | ValueKey;

/** Columns: Self-hosted, Cloud Personal, Cloud Team. */
export const comparison: {
  group: GroupKey;
  rows: { key: RowKey; cells: [PlanCell, PlanCell, PlanCell] }[];
}[] = [
  {
    group: "work",
    rows: [
      { key: "people", cells: ["unlimited", "one", "perMember"] },
      { key: "projects", cells: ["unlimited", "unlimited", "unlimited"] },
      { key: "views", cells: [true, true, true] },
      { key: "docs", cells: [true, true, true] },
      { key: "publicBoards", cells: [true, true, true] },
    ],
  },
  {
    group: "planning",
    rows: [
      { key: "cycles", cells: [true, true, true] },
      { key: "intake", cells: [true, true, true] },
      { key: "analytics", cells: [true, true, true] },
      // AI usage isn't bundled: every plan brings its own provider key or model.
      { key: "ai", cells: ["ownKey", "ownKey", "ownKey"] },
      { key: "roles", cells: [true, "notNeeded", true] },
    ],
  },
  {
    group: "connect",
    rows: [
      { key: "api", cells: [true, true, true] },
      { key: "integrations", cells: [true, true, true] },
      { key: "jira", cells: [true, true, true] },
      { key: "export", cells: [true, true, true] },
    ],
  },
  {
    group: "running",
    rows: [
      { key: "hosting", cells: ["yourServers", "eu", "eu"] },
      { key: "updates", cells: ["yourSchedule", "automatic", "automatic"] },
      { key: "backups", cells: ["yours", "automatic", "automatic"] },
      { key: "admin", cells: [true, false, false] },
      { key: "support", cells: ["community", "email", "priorityEmail"] },
    ],
  },
];
