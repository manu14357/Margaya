import { ArrowUpRight, ChevronRight } from "lucide-react";
import {
  type DocPage,
  isNavSubgroup,
  type NavItem,
  type NavTab,
  navGroupPages,
} from "@/lib/docs/source";
import { MethodBadge } from "./api-operation";

// Tabs with more groups than this (the API reference) list only the current
// group's pages; the other groups link to their first page. Every page
// carries its sidebar, so listing all ~400 endpoints would dominate its size.
const EXPANDED_GROUP_LIMIT = 12;

function NavLink({ item, page }: { item: NavItem; page: DocPage }) {
  const external = /^https?:\/\//.test(item.href);
  return (
    <a
      href={item.href}
      aria-current={item.id === page.id ? "page" : undefined}
      className="docs-nav-link"
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      {item.method ? <MethodBadge method={item.method} small /> : null}
      <span className="min-w-0 flex-1">{item.label}</span>
      {external ? (
        <ArrowUpRight aria-hidden="true" className="size-3 shrink-0" />
      ) : null}
    </a>
  );
}

/** The sidebar navigation for one docs tab, as server-rendered links. */
export function DocsSidebarNav({ tab, page }: { tab: NavTab; page: DocPage }) {
  const compact = tab.groups.length > EXPANDED_GROUP_LIMIT;
  return (
    <nav
      aria-label="Documentation"
      className={`docs-sidebar-nav${compact ? " docs-sidebar-compact" : ""}`}
    >
      {tab.groups.map((group) => {
        const pages = navGroupPages(group);
        const current = pages.some((item) => item.id === page.id);
        if (compact && !current) {
          return (
            <a
              key={group.group}
              href={pages[0]?.href ?? tab.href}
              className="docs-nav-group-link"
            >
              {group.group}
            </a>
          );
        }
        return (
          <div key={group.group} className="docs-nav-group">
            <p className="docs-nav-heading">{group.group}</p>
            <ul className="docs-nav-list">
              {group.items.map((entry) =>
                isNavSubgroup(entry) ? (
                  <li key={entry.group}>
                    <details
                      className="docs-nav-sub"
                      open={entry.items.some((item) => item.id === page.id)}
                    >
                      <summary className="docs-nav-summary">
                        <span className="min-w-0 flex-1">{entry.group}</span>
                        <ChevronRight
                          aria-hidden="true"
                          className="docs-nav-chevron"
                        />
                      </summary>
                      <ul className="docs-nav-sublist">
                        {entry.items.map((item) => (
                          <li key={item.id}>
                            <NavLink item={item} page={page} />
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                ) : (
                  <li key={entry.id}>
                    <NavLink item={entry} page={page} />
                  </li>
                ),
              )}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
