// The demo data every e2e run and `pnpm db:seed` create. Specs should import
// these constants (or read the seed manifest) instead of repeating literals.
// LOCAL DEVELOPMENT AND TESTING ONLY: these passwords are public.

export const ROLES = ["owner", "admin", "member", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export type SeedUser = {
  role: Role;
  name: string;
  email: string;
  password: string;
  /** What the avatar menu button shows when the user has no image. */
  initials: string;
};

export const SEED_USERS: Record<Role, SeedUser> = {
  owner: {
    role: "owner",
    name: "Olivia Owner",
    email: "owner@margaya.test",
    password: "Margaya-Owner-2026!",
    initials: "OO",
  },
  admin: {
    role: "admin",
    name: "Adam Admin",
    email: "admin@margaya.test",
    password: "Margaya-Admin-2026!",
    initials: "AA",
  },
  member: {
    role: "member",
    name: "Mia Member",
    email: "member@margaya.test",
    password: "Margaya-Member-2026!",
    initials: "MM",
  },
  viewer: {
    role: "viewer",
    name: "Victor Viewer",
    email: "viewer@margaya.test",
    password: "Margaya-Viewer-2026!",
    initials: "VV",
  },
};

export const SEED_WORKSPACE = {
  name: "E2E Workspace",
  slug: "e2e-workspace",
} as const;

export const SEED_LABELS = [
  { key: "bug", name: "Bug", color: "red" },
  { key: "feature", name: "Feature", color: "purple" },
  { key: "docs", name: "Documentation", color: "teal" },
] as const;
export type SeedLabelKey = (typeof SEED_LABELS)[number]["key"];

export type SeedTask = {
  key: string;
  title: string;
  description: string;
  /** Column slug. */
  status: string;
  priority: "no-priority" | "low" | "medium" | "high" | "urgent";
  assignees: readonly Role[];
  labels: readonly SeedLabelKey[];
  /** A value of the project's estimate system, when it has one. */
  estimate?: string;
};

export type SeedCycle = {
  key: string;
  name: string;
  description: string;
  /** Inclusive day offsets from the seeding day; null for a draft. */
  startOffsetDays: number | null;
  endOffsetDays: number | null;
  tasks: readonly string[];
};

export type SeedModule = {
  key: string;
  name: string;
  description: string;
  status:
    | "backlog"
    | "planned"
    | "in-progress"
    | "paused"
    | "completed"
    | "cancelled";
  lead: Role | null;
  members: readonly Role[];
  tasks: readonly string[];
};

export type SeedProject = {
  key: string;
  name: string;
  /** The project key: task ids read {slug}-{number}. */
  slug: string;
  icon: string;
  /** Extra columns added after the default To Do / In Progress / In Review / Done. */
  extraColumns: readonly {
    name: string;
    group: "backlog" | "cancelled";
    first: boolean;
  }[];
  features: {
    cyclesEnabled: boolean;
    modulesEnabled: boolean;
    estimatesEnabled: boolean;
  };
  estimate?: { name: string; type: "points"; values: readonly string[] };
  tasks: readonly SeedTask[];
  cycles: readonly SeedCycle[];
  modules: readonly SeedModule[];
};

export const SEED_PROJECTS = {
  web: {
    key: "web",
    name: "Website Relaunch",
    slug: "WEB",
    icon: "Layout",
    extraColumns: [{ name: "Backlog", group: "backlog", first: true }],
    features: {
      cyclesEnabled: true,
      modulesEnabled: true,
      estimatesEnabled: true,
    },
    estimate: {
      name: "Story points",
      type: "points",
      values: ["1", "2", "3", "5", "8"],
    },
    tasks: [
      {
        key: "hero",
        title: "Design the new landing page hero",
        description: "Refresh the hero section with the new brand colours.",
        status: "to-do",
        priority: "high",
        assignees: ["member"],
        labels: ["feature"],
        estimate: "3",
      },
      {
        key: "login-bug",
        title: "Fix login redirect loop",
        description: "Users bounce between sign-in and the dashboard.",
        status: "in-progress",
        priority: "urgent",
        assignees: ["admin"],
        labels: ["bug"],
        estimate: "2",
      },
      {
        key: "api-docs",
        title: "Write API reference for webhooks",
        description: "Document the webhook payloads and retry policy.",
        status: "in-review",
        priority: "medium",
        assignees: ["member", "admin"],
        labels: ["docs"],
        estimate: "5",
      },
      {
        key: "analytics",
        title: "Set up privacy-friendly analytics",
        description: "Pick a cookie-less analytics provider.",
        status: "done",
        priority: "low",
        assignees: ["owner"],
        labels: ["feature"],
        estimate: "1",
      },
      {
        key: "seo",
        title: "Audit page titles for SEO",
        description: "Every public page needs a unique title and description.",
        status: "to-do",
        priority: "no-priority",
        assignees: [],
        labels: [],
      },
      {
        key: "pricing",
        title: "Draft the pricing page copy",
        description: "Three tiers, annual toggle, FAQ.",
        status: "backlog",
        priority: "medium",
        assignees: [],
        labels: ["docs"],
        estimate: "8",
      },
    ],
    cycles: [
      {
        key: "current",
        name: "Sprint 1",
        description: "The running sprint.",
        startOffsetDays: -7,
        endOffsetDays: 7,
        tasks: ["hero", "login-bug", "api-docs"],
      },
      {
        key: "upcoming",
        name: "Sprint 2",
        description: "The next sprint.",
        startOffsetDays: 8,
        endOffsetDays: 21,
        tasks: ["seo"],
      },
    ],
    modules: [
      {
        key: "auth",
        name: "Authentication",
        description: "Sign-in, sessions and account recovery.",
        status: "in-progress",
        lead: "admin",
        members: ["admin", "member"],
        tasks: ["login-bug"],
      },
      {
        key: "marketing",
        name: "Marketing site",
        description: "Public pages and their content.",
        status: "planned",
        lead: "member",
        members: ["member"],
        tasks: ["hero", "seo", "pricing"],
      },
    ],
  },
  mobile: {
    key: "mobile",
    name: "Mobile App",
    slug: "MOB",
    icon: "Layout",
    extraColumns: [],
    features: {
      cyclesEnabled: true,
      modulesEnabled: true,
      estimatesEnabled: false,
    },
    tasks: [
      {
        key: "push",
        title: "Add push notification opt-in",
        description: "Ask for permission after the first completed task.",
        status: "to-do",
        priority: "medium",
        assignees: ["member"],
        labels: ["feature"],
      },
      {
        key: "crash",
        title: "Crash when rotating the task screen",
        description: "Android only, reproducible on API 34.",
        status: "in-progress",
        priority: "high",
        assignees: ["admin"],
        labels: ["bug"],
      },
    ],
    cycles: [],
    modules: [],
  },
} as const satisfies Record<string, SeedProject>;

export type ProjectKey = keyof typeof SEED_PROJECTS;
type Specs = typeof SEED_PROJECTS;
export type TaskKey<P extends ProjectKey> = Specs[P]["tasks"][number]["key"];
export type CycleKey<P extends ProjectKey> = Specs[P]["cycles"][number]["key"];
export type ModuleKey<P extends ProjectKey> =
  Specs[P]["modules"][number]["key"];
