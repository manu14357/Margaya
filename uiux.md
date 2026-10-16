---
name: canopy-uiux
description: The Canopy UI/UX system (from Margaya). Use it when building or restyling any web app UI, such as boards, timelines, calendars, dashboards, forms or settings, to get the same green palette, semantic colours, density, components and light/dark behaviour.
---

# Canopy UI/UX system

This is a portable design system taken from Margaya, a project-management app. It contains:

- the palette, as tokens to copy;
- the rules for when colour may appear;
- typography, density and motion;
- component recipes;
- accessibility rules and a checklist.

The system is framework-agnostic. The examples use **Tailwind CSS v4** and React, but the tokens are plain CSS custom properties.

**How to reuse it:**
- Drop this file into another repo as `uiux.md`, or as `.claude/skills/canopy-uiux/SKILL.md` so it works as a skill.
- Then tell the agent: "follow uiux.md".

---

## 1. Principles

1. **Colour carries meaning, never decoration.** Hue appears only for these:
   - status;
   - priority;
   - area (section of the app);
   - identity (person or project);
   - a deadline signal.

   Everything else is neutral.
2. **Calm surfaces, small colour marks.** Prefer an 8px dot, a 3px edge or a soft tint over filled blocks. Colour should be noticed, not shouted.
3. **Minimal boards.** No coloured column headers and no top stripes. A column is a soft grey surface, and its status shows only as a small dot beside the name.
4. **Dense but legible.** It is a work tool:
   - body text is 13–14px and metadata 10–12px;
   - row and card heights are tight;
   - generous line-height keeps it readable.
5. **Light by default.** The app opens in light mode until the user picks dark or system. Every token has a light and a dark value.
6. **Never colour alone.** Every coloured signal also has an icon, a label or text, for colour-blind users and screen readers.
7. **Routine work stays light.** Optional features must never add clutter to the default views.

---

## 2. Palette: "Canopy green"

The palette uses a deep emerald primary on a warm off-white, with amber as the highlight. In dark mode it is a green-black base with mint primary.

### 2.1 Core tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `#fafaf7` | `#0c0d0d` | App background |
| `--foreground` | `#1c1f1d` | `#e9ebea` | Body text |
| `--card` | `#ffffff` | `#131515` | Cards, panels |
| `--popover` | `#ffffff` | `#131515` | Menus, dialogs |
| `--primary` | `#047857` | `#34d399` | Primary buttons, links, active state |
| `--primary-foreground` | `#ffffff` | `#052e22` | Text on primary |
| `--accent` | `#ecfdf5` | `#1e2120` | Hover / selected background |
| `--accent-foreground` | `#065f46` | `#f4f6f5` | Text on accent |
| `--secondary` | `#f1f4f2` | `#1b1d1d` | Secondary buttons |
| `--secondary-foreground` | `#1c1f1d` | `#e9ebea` | Text on secondary |
| `--muted` | `#f1f4f2` | `#1b1d1d` | Subtle surfaces, column backgrounds |
| `--muted-foreground` | `#5f6b65` | `#9a9f9d` | Secondary text, metadata |
| `--border` | `#e3e8e5` | `#262929` | Borders, dividers |
| `--input` | `#e3e8e5` | `#262929` | Input borders |
| `--ring` | `#10b981` | `#34d399` | Focus ring |
| `--destructive` | `#dc2626` | `#f87171` | Danger buttons |
| `--destructive-foreground` | `#b91c1c` | `#fca5a5` | Danger text |
| `--success` / `-foreground` | `#059669` / `#047857` | `#34d399` / `#6ee7b7` | Success |
| `--warning` / `-foreground` | `#d97706` / `#b45309` | `#fbbf24` / `#fcd34d` | Warning, due soon |
| `--info` / `-foreground` | `#2563eb` / `#1d4ed8` | `#60a5fa` / `#93c5fd` | Info |
| `--sidebar` | `#f4f6f4` | `#0f1010` | Sidebar / rail background |
| `--sidebar-accent` | `#e8f2ec` | `#1c1f1e` | Active sidebar item |
| `--chart-1…5` | `#047857 #f59e0b #2563eb #db2777 #7c3aed` | `#34d399 #fbbf24 #60a5fa #f472b6 #a78bfa` | Chart series, in this order |

Brand highlight: amber `#f59e0b`. Use it sparingly, for marketing and for one highlight per screen at most.

Browser chrome: `<meta name="theme-color">` is `#fafaf7` in light mode and `#0c0d0d` in dark mode.

### 2.2 Semantic tokens

Each status has three values:
- **solid**: for dots, bars and edges;
- **tint**: for soft surfaces;
- **fg**: for text placed on the tint.

| Status | Light solid / tint / fg | Dark solid / tint / fg |
|---|---|---|
| backlog | `#94a3b8` / `#f1f5f9` / `#475569` | `#94a3b8` / `#171c21` / `#cbd5e1` |
| unstarted (To do) | `#3b82f6` / `#eff6ff` / `#1d4ed8` | `#60a5fa` / `#111a2a` / `#93c5fd` |
| started (In progress) | `#f59e0b` / `#fffbeb` / `#b45309` | `#fbbf24` / `#221b0d` / `#fcd34d` |
| review (2nd started column) | `#8b5cf6` / `#f5f3ff` / `#6d28d9` | `#a78bfa` / `#1b1630` / `#c4b5fd` |
| completed | `#10b981` / `#ecfdf5` / `#047857` | `#34d399` / `#0f241b` / `#6ee7b7` |
| cancelled | `#f43f5e` / `#fff1f2` / `#be123c` | `#fb7185` / `#2a1218` / `#fda4af` |

| Priority | Light | Dark | Icon |
|---|---|---|---|
| urgent | `#dc2626` | `#f87171` | circle-alert |
| high | `#ea580c` | `#fb923c` | chevrons-up |
| medium | `#a16207` | `#facc15` | chevron-up |
| low | `#2563eb` | `#60a5fa` | chevron-down |
| none | `#94a3b8` | `#64748b` | minus (or show nothing) |

| Area | Light | Dark |
|---|---|---|
| home | `#059669` | `#34d399` |
| inbox | `#2563eb` | `#60a5fa` |
| my work | `#7c3aed` | `#a78bfa` |
| projects | `#b45309` | `#fbbf24` |
| pages / docs | `#0d9488` | `#2dd4bf` |
| analytics | `#db2777` | `#f472b6` |
| settings | `#64748b` | `#94a3b8` |

**Avatars and identity:** eight hues, `--avatar-1…8`:
- light: `#059669 #2563eb #7c3aed #db2777 #d97706 #0d9488 #dc2626 #4f46e5`;
- dark: `#34d399 #60a5fa #a78bfa #f472b6 #fbbf24 #2dd4bf #f87171 #818cf8`.

**Timeline tokens:**

| Token | Light | Dark |
|---|---|---|
| `--today` | `#047857` | `#34d399` |
| `--today-tint` | `#ecfdf5` | `#10241c` |
| `--weekend-tint` | `#f6f7f5` | `#121414` |
| `--dependency` | `#94a3b8` | `#64748b` |
| `--dependency-conflict` | `#dc2626` | `#f87171` |

Two light values were darkened on purpose to pass contrast on white:
- `--priority-medium` is `#a16207`, not `#eab308`;
- `--area-projects` is `#b45309`, not `#d97706`.

Keep those.

---

## 3. Copy-paste CSS

Paste this into the global stylesheet. Dark mode is class-based: put `.dark` on `<html>`.

```css
@import "tailwindcss";
@import "@fontsource-variable/geist";
@import "@fontsource-variable/geist-mono";

@custom-variant dark (&:is(.dark *));

:root {
  --font-sans: "Geist Variable", ui-sans-serif, system-ui, sans-serif;
  --font-heading: var(--font-sans);
  --font-mono: "Geist Mono Variable", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --radius: 0.625rem;

  --background: #fafaf7;  --foreground: #1c1f1d;
  --card: #ffffff;        --card-foreground: var(--foreground);
  --popover: #ffffff;     --popover-foreground: var(--foreground);
  --primary: #047857;     --primary-foreground: #ffffff;
  --secondary: #f1f4f2;   --secondary-foreground: #1c1f1d;
  --muted: #f1f4f2;       --muted-foreground: #5f6b65;
  --accent: #ecfdf5;      --accent-foreground: #065f46;
  --border: #e3e8e5;      --input: #e3e8e5;  --ring: #10b981;
  --destructive: #dc2626; --destructive-foreground: #b91c1c;
  --success: #059669;     --success-foreground: #047857;
  --warning: #d97706;     --warning-foreground: #b45309;
  --info: #2563eb;        --info-foreground: #1d4ed8;
  --chart-1: #047857; --chart-2: #f59e0b; --chart-3: #2563eb; --chart-4: #db2777; --chart-5: #7c3aed;
  --sidebar: #f4f6f4; --sidebar-foreground: #3e4943;
  --sidebar-primary: #047857; --sidebar-primary-foreground: #ffffff;
  --sidebar-accent: #e8f2ec; --sidebar-accent-foreground: #065f46;
  --sidebar-border: #e3e8e5; --sidebar-ring: #10b981;

  /* Status: solid / tint / fg */
  --status-backlog: #94a3b8;   --status-backlog-tint: #f1f5f9;   --status-backlog-fg: #475569;
  --status-unstarted: #3b82f6; --status-unstarted-tint: #eff6ff; --status-unstarted-fg: #1d4ed8;
  --status-started: #f59e0b;   --status-started-tint: #fffbeb;   --status-started-fg: #b45309;
  --status-review: #8b5cf6;    --status-review-tint: #f5f3ff;    --status-review-fg: #6d28d9;
  --status-completed: #10b981; --status-completed-tint: #ecfdf5; --status-completed-fg: #047857;
  --status-cancelled: #f43f5e; --status-cancelled-tint: #fff1f2; --status-cancelled-fg: #be123c;

  --priority-urgent: #dc2626; --priority-high: #ea580c; --priority-medium: #a16207;
  --priority-low: #2563eb;    --priority-none: #94a3b8;

  --area-home: #059669; --area-inbox: #2563eb; --area-work: #7c3aed; --area-projects: #b45309;
  --area-pages: #0d9488; --area-analytics: #db2777; --area-settings: #64748b;

  --avatar-1: #059669; --avatar-2: #2563eb; --avatar-3: #7c3aed; --avatar-4: #db2777;
  --avatar-5: #d97706; --avatar-6: #0d9488; --avatar-7: #dc2626; --avatar-8: #4f46e5;

  --today: #047857; --today-tint: #ecfdf5; --weekend-tint: #f6f7f5;
  --dependency: #94a3b8; --dependency-conflict: #dc2626;
}

.dark {
  --background: #0c0d0d;  --foreground: #e9ebea;
  --card: #131515;        --popover: #131515;
  --primary: #34d399;     --primary-foreground: #052e22;
  --secondary: #1b1d1d;   --secondary-foreground: #e9ebea;
  --muted: #1b1d1d;       --muted-foreground: #9a9f9d;
  --accent: #1e2120;      --accent-foreground: #f4f6f5;
  --border: #262929;      --input: #262929;  --ring: #34d399;
  --destructive: #f87171; --destructive-foreground: #fca5a5;
  --success: #34d399;     --success-foreground: #6ee7b7;
  --warning: #fbbf24;     --warning-foreground: #fcd34d;
  --info: #60a5fa;        --info-foreground: #93c5fd;
  --chart-1: #34d399; --chart-2: #fbbf24; --chart-3: #60a5fa; --chart-4: #f472b6; --chart-5: #a78bfa;
  --sidebar: #0f1010; --sidebar-foreground: #c9cdcb;
  --sidebar-primary: #34d399; --sidebar-primary-foreground: #052e22;
  --sidebar-accent: #1c1f1e; --sidebar-accent-foreground: #f4f6f5;
  --sidebar-border: #212423; --sidebar-ring: #34d399;

  --status-backlog: #94a3b8;   --status-backlog-tint: #171c21;   --status-backlog-fg: #cbd5e1;
  --status-unstarted: #60a5fa; --status-unstarted-tint: #111a2a; --status-unstarted-fg: #93c5fd;
  --status-started: #fbbf24;   --status-started-tint: #221b0d;   --status-started-fg: #fcd34d;
  --status-review: #a78bfa;    --status-review-tint: #1b1630;    --status-review-fg: #c4b5fd;
  --status-completed: #34d399; --status-completed-tint: #0f241b; --status-completed-fg: #6ee7b7;
  --status-cancelled: #fb7185; --status-cancelled-tint: #2a1218; --status-cancelled-fg: #fda4af;

  --priority-urgent: #f87171; --priority-high: #fb923c; --priority-medium: #facc15;
  --priority-low: #60a5fa;    --priority-none: #64748b;

  --area-home: #34d399; --area-inbox: #60a5fa; --area-work: #a78bfa; --area-projects: #fbbf24;
  --area-pages: #2dd4bf; --area-analytics: #f472b6; --area-settings: #94a3b8;

  --avatar-1: #34d399; --avatar-2: #60a5fa; --avatar-3: #a78bfa; --avatar-4: #f472b6;
  --avatar-5: #fbbf24; --avatar-6: #2dd4bf; --avatar-7: #f87171; --avatar-8: #818cf8;

  --today: #34d399; --today-tint: #10241c; --weekend-tint: #121414;
  --dependency: #64748b; --dependency-conflict: #f87171;
}

/* Expose tokens as Tailwind utilities: bg-primary, text-muted-foreground, rounded-lg … */
@theme inline {
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --font-sans: var(--font-sans);
  --font-heading: var(--font-heading);
  --font-mono: var(--font-mono);
  --color-background: var(--background);   --color-foreground: var(--foreground);
  --color-card: var(--card);               --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);         --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);         --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);     --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);             --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);           --color-accent-foreground: var(--accent-foreground);
  --color-border: var(--border);           --color-input: var(--input);  --color-ring: var(--ring);
  --color-destructive: var(--destructive); --color-destructive-foreground: var(--destructive-foreground);
  --color-success: var(--success);         --color-success-foreground: var(--success-foreground);
  --color-warning: var(--warning);         --color-warning-foreground: var(--warning-foreground);
  --color-info: var(--info);               --color-info-foreground: var(--info-foreground);
  --color-sidebar: var(--sidebar);         --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border); --color-sidebar-ring: var(--sidebar-ring);
  --color-chart-1: var(--chart-1); --color-chart-2: var(--chart-2); --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4); --color-chart-5: var(--chart-5);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

@layer base {
  * { @apply border-border outline-ring/50; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
  body { @apply bg-background font-sans text-foreground antialiased; }
  h1, h2, h3, h4, h5, h6 { @apply font-heading font-semibold tracking-tight; }
}
```

Semantic tokens are used through arbitrary values, for example `bg-[var(--status-started)]` or `style={{ color: "var(--priority-high)" }}`.

### 3.1 The theme defaults to light

- Store the choice as `"light" | "dark" | "system"`, with the default **`"light"`**.
- Apply it before the first paint, to avoid a flash of the wrong theme:

```html
<script>
  try {
    var t = localStorage.getItem("theme") || "light";
    var dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {}
</script>
<meta name="theme-color" content="#fafaf7" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#0c0d0d" media="(prefers-color-scheme: dark)" />
```

---

## 4. Typography

| Role | Spec |
|---|---|
| Font | **Geist Variable** (sans), **Geist Mono Variable** (IDs, code, numbers in tables) |
| Page title | 20–24px, `font-semibold tracking-tight` |
| Section heading | 14–16px, `font-semibold` |
| Body / card title | 13–14px, `font-medium`, `leading-[18px]` on cards |
| Metadata, chips | 10–12px, `font-medium text-muted-foreground` |
| Task IDs | `font-mono text-[11px] text-muted-foreground` |
| Counts | `tabular-nums` |

- On mobile, controls use text one step larger (`text-base`, then `sm:text-sm`), so inputs don't trigger iOS zoom.
- Clamp long titles with `line-clamp-3 break-words`, and never let them overflow.

---

## 5. Layout, density and shape

- **Radius:**
  - base `--radius` is 10px;
  - cards and buttons use `rounded-lg`;
  - board columns use `rounded-xl`;
  - dialogs use `rounded-2xl`;
  - chips use `rounded` or `rounded-sm`;
  - dots use `rounded-full`.
- **Spacing:** 4px grid. Cards use `px-2.5 py-2`, columns `px-1.5`/`px-2`, and the gap between cards is 6–8px.
- **Control heights:** buttons are `h-9` on mobile and `sm:h-8` on desktop; small buttons `h-8` / `sm:h-7`; icon buttons `size-8`. On touch screens (`pointer-coarse`), extend every hit area to at least 44×44px with an invisible `::after`.
- **Elevation:** very soft:
  - cards `shadow-xs/5`, rising to `shadow-sm` on hover;
  - popovers and dialogs `shadow-lg/5`;
  - in dark mode, shadows are replaced by a 1px top highlight (`white/6%`).
- **Borders:** 1px `border-border`, often at 70–80% opacity inside cards (`border-border/80`).
- **App shell:**
  - a slim icon rail or sidebar on `--sidebar`, with area-coloured icons;
  - a top bar holding breadcrumbs and view tabs (Board / List / Gantt / Calendar);
  - content on `--background`;
  - on mobile, a bottom tab bar.

---

## 6. Motion

- Easing: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` for almost everything.
- Durations:
  - 150ms for hover, press and colour changes;
  - 200ms for dialogs, popovers and sheets.
- Press feedback: `active:scale-[0.97]` on buttons and `active:scale-[0.98]` on cards.
- Entrance: fade plus `scale-98`. Do not slide large distances.
- **Reduced motion:** with `prefers-reduced-motion: reduce`, keep only opacity transitions; remove scale, translate and drag-reflow animations.
- Skeleton loaders use a slow 2s linear shimmer.

---

## 7. Component recipes

### Buttons

| Variant | Look |
|---|---|
| default | `bg-primary text-primary-foreground border-primary shadow-xs`, `hover:bg-primary/90`, subtle inner top highlight |
| outline | `bg-popover border-input`, `hover:bg-accent/50` |
| secondary | `bg-secondary`, `hover:bg-secondary/90` |
| ghost | transparent, `hover:bg-accent` |
| destructive | `bg-destructive text-white` |
| destructive-outline | `bg-popover`, red text, `hover:bg-destructive/4` |
| link | text only, underline on hover |

- Focus style: `focus-visible:ring-2 ring-ring ring-offset-1 ring-offset-background`.
- Disabled style: `opacity-64`, with no pointer events.
- Loading: the label turns transparent and a spinner is centred, so the width does not jump.

### Badges and soft status chips

- Status, info and warning use a **soft tint**: `bg-success/8 text-success-foreground` (`dark:bg-success/16`), and the same pattern for `warning`, `info` and `error`.
- Solid badges are only for the primary count or highlight.

### Board (kanban): minimal

- **Column:** `rounded-xl bg-muted/50 dark:bg-card/60`. It has no border, no coloured header and no top stripe.
- **Column header:** `h-7`. From left to right it holds:
  - an **8px status dot** (`size-2 rounded-full bg-[var(--col)]`);
  - the name (`text-[13px] font-medium`);
  - the count (`text-xs text-muted-foreground tabular-nums`);
  - action buttons on the right, at 60% opacity until the column is hovered.
- **Status colour:** pass it once as a CSS variable on the column (`style={{ "--col": "var(--status-started)" }}`). The column's own custom colour overrides its group's colour. The second and later "started" columns (such as In review) use the **review** hue, so neighbouring stages stay distinct.
- **Card:** `rounded-lg border border-border/80 bg-background px-2.5 py-2 shadow-xs/5`, and on hover `hover:shadow-sm`. It contains:
  - an optional mono ID line;
  - the title (`text-[13px] font-medium`, clamped to 3 lines);
  - a meta row of small neutral chips: `h-5 rounded border border-border/70 bg-muted/55 px-1.5 text-[10px] text-muted-foreground`.
- **Card states:**
  - **selected:** `border-ring/40 bg-accent/50 ring-1 ring-inset ring-ring/30`;
  - **keyboard focus:** `ring-2 ring-inset ring-ring/50`;
  - **dragging:** the original spot becomes a neutral dashed slot (`border-dashed border-foreground/25 bg-muted/40`, with the children hidden);
  - **drop target column:** `outline-2 outline-dashed outline-foreground/20`.
- **Empty column:** a short muted line plus a "+ Add task" ghost action. No illustrations.

### Due dates

| State | Style |
|---|---|
| overdue | `bg-destructive/10 text-destructive-foreground ring-1 ring-destructive/25` + calendar-x icon |
| due soon | `bg-warning/12 text-warning-foreground ring-1 ring-warning/30` + calendar-clock icon |
| later / none | `bg-muted/60 text-muted-foreground` + calendar icon |

### Priority

- Show a coloured icon (see §2.2) with an `aria-label`. A 6px dot (`size-1.5`) can be used where space is tight.
- "None" shows nothing on cards and a grey minus in pickers.

### Gantt / timeline

- **Bars:** set three variables on a bar, `--tone`, `--tone-tint` and `--tone-fg`, from the task's status. Then:
  - the bar body is `bg-[var(--tone-tint)]` with a 3px solid left edge (`border-l-[3px] border-[var(--tone)]`);
  - the text is `text-[var(--tone-fg)]`.
- **Custom colours:** a column with its own hex colour derives the three values with `color-mix`:
  - tint: `color-mix(in srgb, C 14%, var(--card))`;
  - fg: `color-mix(in srgb, C 45%, var(--foreground))`.
- **Grid:**
  - weekend columns use `--weekend-tint`;
  - today is a 2px `--today` vertical line with a `--today-tint` header cell.
- **Dependencies:** 1.5px `--dependency` connectors. A dependency that is violated turns `--dependency-conflict`.
- **Completed and cancelled bars:** 60% opacity. Cancelled bars also get a strikethrough title.

### Calendar

- **Month grid:** cells on `--card`, and weekend cells on `--weekend-tint`. Today's date number sits in a filled `--today` circle with white text.
- **Task chips:** a status-tinted chip with a 3px left edge, the same recipe as gantt bars, 20px high and truncated.
- **Overflow:** "+3 more" opens a popover.
- **Overdue tasks:** a small red dot plus a screen-reader label ("Overdue").

### Avatars and identity colours

- Pick the hue with a stable hash of the user id or project id (FNV-1a), so a person keeps the same colour everywhere:

```ts
export function identityHue(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return ((h >>> 0) % 8) + 1;            // 1..8 → var(--avatar-N)
}
export const identityTileStyle = (seed: string) => {
  const c = `var(--avatar-${identityHue(seed)})`;
  return {
    backgroundColor: `color-mix(in srgb, ${c} 18%, var(--background))`, // soft tile
    color: `color-mix(in srgb, ${c} 60%, var(--foreground))`,           // ≥ 4.5:1 text
  };
};
```

- The fallback initials avatar uses `identityTileStyle`. An unknown user ("?") stays grey.
- Project tiles use the same function, seeded with the project id.

### Labels

- A label is a neutral chip with a small coloured dot (`size-2 rounded-full`) followed by the label name.
- The chip itself is never filled with the label colour.

### Sidebar / icon rail

- Each area icon is tinted with its `--area-*` colour; the text stays neutral.
- The active item uses `bg-sidebar-accent text-sidebar-accent-foreground`.

### Dashboard and analytics

- **Widget cards:** `bg-card rounded-xl border`. A small area-coloured icon sits in the header.
- **Charts:**
  - series use `--chart-1…5` in order, and status charts reuse the status hues;
  - gridlines are `--border`, axes `--muted-foreground`, and tooltips use the `popover` surface;
  - every chart has a text legend.
- **Progress bars:** a `--muted` track with a `--primary` fill (or the status colour), plus a text percentage.

### Dialogs, popovers and menus

- **Backdrop:** `bg-black/50 backdrop-blur-[6px]`.
- **Dialog:** `rounded-2xl bg-popover border shadow-lg/5`, `max-w-lg`.
- **Menu items:**
  - `rounded-md px-2 py-1.5 text-sm`;
  - `hover:bg-accent hover:text-accent-foreground`;
  - keyboard shortcuts shown in `Kbd` chips.

### Mentions and links

- **Mention:** `color: var(--primary)` on `color-mix(in srgb, var(--primary) 12%, transparent)`, `rounded px-0.5 font-medium`.
- **Links in rich text:** `--primary`, underlined on hover.

### Empty, loading and error states

- **Empty:** a muted icon, a single sentence and one primary action. It never blocks the page.
- **Loading:** skeletons that match the final layout (cards, rows). Do not use a full-page spinner.
- **Error:** an inline `Alert` in the destructive tint, with a retry action. Route-level errors get a friendly page with "Go back".

---

## 8. Accessibility rules

- Text contrast must be **≥ 4.5:1** (normal text) and ≥ 3:1 (large text or UI glyphs) in **both** themes. The `-fg` tokens exist for exactly this.
- Never signal by colour alone: pair it with an icon, text or an `aria-label`. Decorative dots get `aria-hidden="true"`.
- Every interactive element has a visible `focus-visible` ring (`--ring`).
- The board can be used from the keyboard: Enter opens a card, Escape closes it, and the arrow keys move focus.
- Touch targets are at least 44px on coarse pointers.
- Respect `prefers-reduced-motion` (see §6).
- All user-facing copy comes from i18n keys. Do not hard-code strings.

---

## 9. Do / Don't

| Do | Don't |
|---|---|
| A small status dot beside the column name | Coloured column headers or top stripes |
| Soft tints (`/8`–`/16`) for chips | Saturated filled chips everywhere |
| One primary button per view | Several green buttons competing |
| Neutral cards with neutral metadata chips | Rainbow cards |
| The same hue for the same meaning everywhere | Reusing a status hue for decoration |
| Light theme as the default, dark fully supported | Shipping dark-only or light-only tokens |
| `color-mix` to derive tints from a custom colour | Hand-picking new one-off hex values |

---

## 10. Checklist for a new screen

- [ ] Uses only tokens, with no raw hex values in components (except the token file).
- [ ] Looks right in light **and** dark mode, and light is the default.
- [ ] Colour appears only for status, priority, area, identity or deadline.
- [ ] Every coloured signal has an icon, label or `aria-label` too.
- [ ] Contrast is ≥ 4.5:1 for text, and the focus ring is visible.
- [ ] Empty, loading and error states are designed.
- [ ] Density matches: 13px titles, 10–12px metadata and compact controls.
- [ ] Motion runs 150–200ms on ease-out and respects reduced motion.
- [ ] Hit areas are ≥ 44px on touch, and the layout works at 360px wide.
- [ ] The copy comes from i18n keys.
