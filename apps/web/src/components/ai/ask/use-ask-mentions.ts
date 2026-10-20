import { useMemo } from "react";
import { useWorkspacePeople } from "@/components/module/module-people";
import { useAgents } from "@/hooks/queries/ai/use-agents";
import useGlobalSearch from "@/hooks/queries/search/use-global-search";
import type { AskContextItem, AskContextKind } from "./use-ask-session";

const MAX_PER_KIND = 4;
const MAX_ITEMS = 12;
const SEARCH_KINDS: Partial<Record<string, AskContextKind>> = {
  task: "task",
  page: "page",
  project: "project",
  cycle: "cycle",
  module: "module",
};

/** The "@" token just before the caret: `@web` gives "web". */
export function mentionQuery(text: string, caret: number): string | null {
  const before = text.slice(0, caret);
  const match = /(?:^|\s)@([^\s@]{0,40})$/.exec(before);
  return match ? (match[1] ?? "") : null;
}

/** The "/" command being typed: only as the first word of the composer. */
export function slashQuery(text: string, caret: number): string | null {
  const before = text.slice(0, caret);
  const match = /^\/([^\s/]{0,30})$/.exec(before);
  return match ? (match[1] ?? "") : null;
}

/** `text` with the "@query" before the caret removed. */
export function removeMentionToken(
  text: string,
  caret: number,
): { text: string; caret: number } {
  const before = text.slice(0, caret);
  const match = /@([^\s@]{0,40})$/.exec(before);
  if (!match) return { text, caret };
  const start = before.length - match[0].length;
  return {
    text: `${text.slice(0, start)}${text.slice(caret)}`,
    caret: start,
  };
}

function matches(term: string, ...values: (string | null | undefined)[]) {
  if (!term) return true;
  const lower = term.toLocaleLowerCase();
  return values.some((value) => value?.toLocaleLowerCase().includes(lower));
}

/**
 * What "@" can insert for `query`: tasks, pages, projects, cycles and
 * modules from workspace search, plus people and agents. A null `query`
 * (no picker open) keeps the lookups off.
 */
export function useAskMentions(input: {
  workspaceId: string | undefined;
  query: string | null;
}) {
  const open = input.query !== null;
  const term = (input.query ?? "").trim();
  const workspaceId = open ? input.workspaceId : undefined;
  const search = useGlobalSearch({
    q: open ? term : "",
    type: "all",
    workspaceId,
    limit: 20,
  });
  const people = useWorkspacePeople(open ? (input.workspaceId ?? "") : "");
  const agents = useAgents(open ? input.workspaceId : undefined);

  const items = useMemo<AskContextItem[]>(() => {
    if (!open) return [];
    const found: AskContextItem[] = [];
    const counts = new Map<AskContextKind, number>();
    const add = (item: AskContextItem) => {
      const count = counts.get(item.kind) ?? 0;
      if (count >= MAX_PER_KIND) return;
      if (
        found.some((other) => other.kind === item.kind && other.id === item.id)
      ) {
        return;
      }
      counts.set(item.kind, count + 1);
      found.push(item);
    };
    for (const result of search.data?.results ?? []) {
      const kind = SEARCH_KINDS[result.type];
      if (!kind) continue;
      const key =
        kind === "task" && result.projectSlug && result.taskNumber
          ? `${result.projectSlug}-${result.taskNumber}`
          : null;
      add({
        kind,
        id: result.id,
        label: key ? `${key} ${result.title}` : result.title,
        projectId: kind === "project" ? result.id : (result.projectId ?? null),
      });
    }
    for (const person of people) {
      if (person.name && matches(term, person.name)) {
        add({ kind: "user", id: person.id, label: person.name });
      }
    }
    for (const agent of agents.data ?? []) {
      if (agent.enabled && matches(term, agent.name)) {
        add({ kind: "agent", id: agent.id, label: agent.name });
      }
    }
    return found.slice(0, MAX_ITEMS);
  }, [open, search.data, people, agents.data, term]);

  return { items, isSearching: open && term.length > 0 && search.isFetching };
}
