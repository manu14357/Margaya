# App shell and page layout

The authenticated app runs inside one shell, mounted once by
`routes/_layout/_authenticated/dashboard.tsx` (`AppShell`). Pages never render
the shell; they render a **page frame** inside it.

```
rail (64px, md+) | context panel (248px; pinned lg+, drawer below) | page frame
                                                   bottom tab bar (< 768px)
```

- **Rail** (`components/app-rail.tsx`): workspace tile, Home, Inbox (unread
  badge), Your work, Projects, Pages, Analytics (permission-gated), then
  Create (+), Help, Settings and the avatar menu. Clicking the active item
  toggles the panel.
- **Context panel** (`components/context-panel/*`): only the active
  destination's navigation (`shell-destinations.ts` maps a pathname to one).
  `Ctrl B` (or the top bar's toggle) shows or hides it.
- **Command bar**: the top bar's field and `Ctrl K` open
  `components/command-palette`. Prefixes: `>` actions, `#` tasks, `@`
  people, `/` places. Open it from code with `openCommandPalette(query?)`;
  open a create dialog with `requestCreate("task" | "project" | "workspace")`
  (`command-palette/palette-store.ts`).

## Page frame

```tsx
import Layout from "@/components/common/layout";

<Layout>
  <Layout.TopBar title={t("…")} actions={<Button>…</Button>} />
  <Layout.ViewTabs label={t("…")} tabs={tabs} value={current} />  {/* optional */}
  <Layout.FilterBar trailing={<DisplayMenu />}>{chips}</Layout.FilterBar>  {/* optional */}
  <Layout.ContentArea width="narrow">
    <Layout.PageHeader title={…} description={…} actions={…} />
    …
  </Layout.ContentArea>
</Layout>
```

Every piece is also a named export from its own file.

| Component | Props | Use |
| --- | --- | --- |
| `TopBar` (`header/top-bar.tsx`) | `title?`, `place?` (replaces title: tile, switcher, `· context`), `actions?` (the one primary action), `className?` | 48px bar: panel toggle, place, centred command field, notifications, actions. No breadcrumbs. |
| `ViewTabs` (`view-tabs.tsx`) | `tabs: ViewTab[]` (`value`, `label`, `icon?`, `badge?`, `onSelect`, `separated?`), `value: string \| null`, `label` (aria), `trailing?` | Underline tab row under the top bar; scrolls sideways on phones. |
| `FilterBar` (`filter-bar.tsx`) | `children` (chips, Filter button), `trailing?` (Display, Sort), `className?` | The lens bar; only where filtering applies. |
| `PageHeader` (`page-header.tsx`) | `title`, `description?`, `icon?`, `actions?`, `children?` | Heading block at the top of the content. |
| `ContentArea` (`content-area.tsx`) | `width?: "narrow" \| "wide" \| "full"` (default full), `padded?` (default true), `scroll?: "auto" \| "none"` | The scrolling canvas. |
| `SplitView` (`split-view.tsx`) | `primary`, `secondary`, `showSecondary?` (which pane under 1024px), `primaryWidth?: "sm" \| "md" \| "lg" \| "half"`, `primaryLabel?`, `secondaryLabel?` | Two panes (inbox reader, triage, cycle planner); one pane at a time below lg. |
| `Layout.Content` | `children`, `className?` | Legacy body: fills the height and scrolls. |
| `Layout.Header` | `children`, `className?` | Legacy free-form 48px row; prefer `TopBar`. |
| `ContextPanelSlot` (`context-panel/panel-slot.tsx`) | `children`, `fallback?` | Portals page-owned navigation (e.g. settings sub-nav) into the panel; `fallback` renders in place while the panel is closed. Build rows with `PanelSection` / `PanelLink` (`context-panel/panel-primitives.tsx`). |

Ready-made frames:

- `WorkspaceLayout` — `title`, `headerActions?`, `className?` (actions
  wrapper), `children`.
- `ProjectLayout` — `projectId`, `workspaceId`, `headerActions?`,
  `activeView?`, `activeSection?`, `showViewSwitcher?`, `extraCrumbs?` (shown
  after the project as `· …`), `tabsTrailing?`, `children`. Renders the
  project switcher, favorite and public badge in the top bar, and the tab row
  (Backlog, Board, Spreadsheet, Calendar, Gantt, then the enabled sections
  from the project-section registry, which also registers the `g` keys).
- `TaskLayout` — `taskId`, `projectId`, `workspaceId`, `headerActions?`,
  `rightSidebar?`, `children`.

Rules: colours, fonts and `components/ui/*` primitives stay as they are; use
the existing tokens (`bg-card`, `border-border`, `text-muted-foreground`,
`sidebar-*` for panel rows). Compact density: 30px panel rows, 48px top bar,
40px tab and filter rows. New copy goes into `i18n/en-US.json` as static keys.
