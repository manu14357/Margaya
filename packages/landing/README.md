# @margaya/landing

The public landing experience, shared by the website (`apps/site`) and the
web app's signed-out root (`apps/web`). It is React 19 + Tailwind v4 class
names on the shared tokens, plus `lucide-react`. It has no dependency on
either app's code and ships TypeScript source.

- **Site:** `next.config.mjs` lists it in `transpilePackages`.
- **Web:** Vite compiles workspace TypeScript directly.
- **Both:** the main CSS has `@source "../../../packages/landing/src";`, so
  Tailwind generates the package's classes.

## Using it

```tsx
import { LandingPage, LandingProviders } from "@margaya/landing";

<LandingProviders copy={messages.landing} links={links} linkComponent={RouterLink}>
  <LandingPage />             {/* chrome={false} when the layout renders navbar/footer */}
</LandingProviders>
```

## Contracts

### Copy: `LandingCopyProvider` / `useLandingCopy()`

The value is the `landing` namespace of `i18n/en-US.json`. The `LandingCopy`
type is derived from that file, so a new key is typed as soon as it is added.

- **Site:** pass `messages.landing` (see `apps/site/lib/landing.ts`).
- **Web:** pass `i18n.getResourceBundle(lang, "landing")`, falling back to
  English.
- `fill(template, values)` fills `{{name}}` placeholders.

Key conventions:

| Keys | Holds |
| --- | --- |
| `landing.home.<section>.*` | A home section's own text: `eyebrow`, `title`, `description`, plus anything the section needs (`home.hero`, `home.facts`, `home.views`, `home.ownIt.items.*`, …). Navbar and footer copy live in `home.nav` and `home.footer`. |
| `landing.scenes.<sceneId>.caption` / `.description` | The visible caption under a demo, and the screen-reader description of what it shows. |
| `landing.demo.*` | Text shown inside replicas. Shared data is at the top: `shell` (rail, command field, view tabs), `people`, `projects`, `statuses`, `priorities`, `labels`, `sheet`, `capture`, `controls`. Data for one scene goes in `demo.<sceneId>.*`. |
| `landing.pages.*` | Feature-page bodies. |

Add keys with small edits to `en-US.json`, then run
`node scripts/i18n/check.mjs --fix` (it copies the English text into every
locale) and `pnpm i18n:schema`. Never put user-visible text in code: task
titles, names and dates all come from `landing.demo.*`, so demos translate.

### Links: `LandingLinksProvider` / `useLandingLinks()`

`LandingLinks` lists every href: `home`, `signIn`, `signUp`, `selfHost`
(install guide), `docs`, `apiReference`, `github`,
`features.{plan,views,docs,automate,selfHost}`, and optional `site.*`
(footer-only pages, including `license` and `commercial`). Each app passes its own URLs.

- Render links with `<LandingLink href>` (or `<LandingButton>`).
- `linkComponent` (optional) handles same-origin paths through the app's
  router. It receives anchor props with `href`; adapt it to the router's
  API (for TanStack, `({ href, ...rest }) => <Link to={href} {...rest} />`).
- Absolute URLs and `#hash` links are plain anchors.

## Layout

```
src/
  index.ts           public exports (everything below)
  copy.tsx           LandingCopy type, provider, useLandingCopy, fill
  links.tsx          LandingLinks type, provider, useLandingLinks, LandingLink
  landing-page.tsx   LandingPage (section order) and LandingProviders
  lib/               cn, LandingButton, LandingLogo, LazyMount
  demo/              the demo engine: DemoStage, step builders, runner, timeline, cursors
  replica/           presentational mini app shell and primitives
  scenes/<id>/       one folder per scripted scene (state.ts + <id>-scene.tsx + tests)
  sections/          one file per home section
```

## Writing a scene

A scene is a `DemoScene<State, Action>`: a tiny reducer, a script, and a
view. `scenes/hero/` is the reference; copy its shape.

1. **State and reducer** (`state.ts`): plain data plus a pure reducer.
   Build what depends on copy (titles, names) from `landing.demo.*` in a
   `create<Id>Scene(demo)` factory.
2. **View**: `render({ state, dispatch, interactive, compact })`. Compose it
   from `replica/*`.
   - Put `data-demo="…"` on every element the script aims at. Use unique,
     stable names such as `card-new`, `column-inProgress` or `tab-gantt`.
   - Wire real handlers to `dispatch` (buttons, inputs). After the visitor
     takes over, the replica works by hand.
   - `compact` is true at the phone size. Drop the rail and panel there.
3. **Script**: build it from `step.*`. Every step waits on play time.

   | Step | Does |
   | --- | --- |
   | `step.move(target, { cursor?, anchor?, duration? })` | Glides a cursor to a target. Over inputs, the cursor becomes the text cursor. |
   | `step.click(target, action?, options?)` | Moves if needed, presses with a ripple, then dispatches. |
   | `step.type(target, text, toAction, cps = 16)` | Dispatches `toAction(prefix)` once per character. |
   | `step.key(combo, action?)` | Shows the key-hint chip (`"Ctrl+K"`, `"Enter"`, `"j"`), then dispatches. |
   | `step.drag(from, to, action?, { anchor? })` | Grabs `from` (a lifted clone follows the cursor), drops on `to`, then dispatches. |
   | `step.wait(ms)` / `step.set(action)` | Pauses / dispatches with no cursor. `set` waits one frame so the view renders before the next step aims. |
   | `step.scroll(target)` | Scrolls the nearest `data-demo-scroll` ancestor so the target is in view. |
   | `step.parallel(trackA, trackB)` | Runs tracks at once, e.g. the collaborator cursor (`{ cursor: "collab" }`) while the main one types. |

   Anchors are fractions of the target box (`{ x: 0.5, y: 0.12 }`). A
   target that is not rendered is skipped, but its action is still
   dispatched.
4. **Stage**: render the scene in a `DemoStage`:

   ```tsx
   <DemoStage
     scene={scene}
     caption={copy.scenes.views.caption}
     description={copy.scenes.views.description}
     size={{ width: 1280, height: 800 }}
     compactSize={{ width: 640, height: 820 }}
     collaborator={copy.demo.people.mira.name}
   />
   ```

   Memoise the scene on the copy: `useMemo(() => createXScene(copy.demo), [copy.demo])`.
   Below the fold, wrap the stage in `<LazyMount className="aspect-[16/10]">`
   so it mounts only when it nears the viewport.

What the stage does for you:

- Plays only while on screen and while the tab is visible.
- Loops: it resets to `initialState` and waits `loopDelay` between passes.
- Shows a play / pause / replay button.
- Stops for good when the visitor presses in it. The replica is `inert`
  while the script plays.
- With reduced motion, shows a still final frame with no cursor:
  `finalStateOf(scene)` applies every scripted action in order. Typed text
  counts once, in full. Pass `finalState` when that is not the frame you
  want (for example, with parallel tracks whose order matters).

Test the reducer and `finalStateOf(scene)` (see `scenes/hero/hero.test.ts`).
The engine's own tests live in `demo/*.test.ts(x)`.

## Replica primitives

These are modelled on `apps/web/src/components/common/*`, the board card,
the capture bar, the chips, the avatar stack and the task sheet. They use
the same tokens, radii, spacing and type sizes.

- **Shell:** `ReplicaShell` (rail | panel | page), `IconRail`,
  `ContextPanel` + `PanelSection` / `PanelRow` / `PanelCount` /
  `ProjectTile`, `TopBar` + `CommandField`, `ViewTabs` /
  `ProjectViewTabs`, `FilterBar` + `FilterChip`, `ReplicaButton`.
- **Work:** `Board`, `BoardColumn`, `CaptureBar`, `TaskCard`, `TaskSheet`
  + `PropertyValue`, `PropertyPopover`.
- **Chips:** `StatusIcon` / `StatusChip`, `PriorityIcon` / `PriorityChip`,
  `LabelChip` / `LabelDot`, `DueChip`, `TokenChip`, `Kbd`, `Avatar` /
  `AvatarStack`.

Rules:

- No new colour tokens.
- No images except the logo.
- No app imports.
- Every component file that uses hooks starts with `"use client"`.

## Sections and ownership

`LandingPage` renders, in order:

1. Navbar
2. Hero
3. Facts strip
4. Views
5. AI
6. Plan
7. Triage
8. Docs
9. Your day
10. Insight
11. Automate
12. Public boards
13. Keyboard
14. Own it
15. FAQ
16. Final CTA
17. Footer

Each section is one file in `src/sections/`. Stubs render `SectionStub` and
say `STUB. Owner: Lx`. When you replace a stub, keep its export name and
anchor id, and build on `LandingSection` for the heading block.

| Lane | Owns |
| --- | --- |
| L1 | Package foundation, demo engine, replica, hero scene, `HeroSection`, `FactsStrip` |
| L2 | Views (`views-section.tsx`) and Keyboard (`keyboard-section.tsx`), plus their scenes |
| L3 | Plan, Triage and Your day, plus their scenes |
| L4 | Docs, Insight, Automate and Public boards, plus their scenes |
| L5 | Site pages and shell: navbar, footer, Own it, FAQ, final CTA, and the feature pages |

Put new scenes in `src/scenes/<id>/` and export them from `src/scenes/index.ts`.
