import { Check, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { cn } from "@/lib/cn";
import { getInitials } from "@/lib/get-initials";

export type ModulePerson = { id: string; name: string; image: string | null };

/** The workspace's active members, as pickers show them. */
export function useWorkspacePeople(workspaceId: string): ModulePerson[] {
  const { data } = useGetActiveWorkspaceUsers(workspaceId);
  return useMemo(
    () =>
      (data?.members ?? []).map((member) => ({
        id: member.userId,
        name: member.user?.name ?? "",
        image: member.user?.image ?? null,
      })),
    [data],
  );
}

/**
 * Resolves user ids to people: workspace members first, then `known`
 * (e.g. a module's members, which may include people who left).
 */
export function resolvePeople(
  ids: readonly string[],
  people: readonly ModulePerson[],
  known: readonly ModulePerson[] = [],
): ModulePerson[] {
  return ids.flatMap((id) => {
    const person =
      people.find((candidate) => candidate.id === id) ??
      known.find((candidate) => candidate.id === id);
    return person ? [person] : [];
  });
}

export function PersonAvatar({
  person,
  className,
}: {
  person: Pick<ModulePerson, "name" | "image">;
  className?: string;
}) {
  return (
    <Avatar className={cn("size-5", className)}>
      <AvatarImage src={person.image ?? ""} alt={person.name} />
      <AvatarFallback className="border border-border/30 font-medium text-[9px]">
        {getInitials(person.name)}
      </AvatarFallback>
    </Avatar>
  );
}

/** Up to three overlapping avatars, then "+N". */
export function StackedAvatars({
  people,
  max = 3,
}: {
  people: readonly ModulePerson[];
  max?: number;
}) {
  const { t } = useTranslation();
  if (people.length === 0) return null;
  const extra = people.length - max;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-flex -space-x-1.5">
        {people.slice(0, max).map((person) => (
          <PersonAvatar
            key={person.id}
            person={person}
            className="ring-2 ring-background"
          />
        ))}
      </span>
      {extra > 0 && (
        <span className="text-muted-foreground text-xs">
          {t("modules:form.moreMembers", { count: extra })}
        </span>
      )}
    </span>
  );
}

type PeopleListProps = {
  people: readonly ModulePerson[];
  isSelected: (id: string) => boolean;
  onSelect: (id: string) => void;
  /** A leading "nobody" row (e.g. "No lead"). */
  none?: { label: string; selected: boolean; onSelect: () => void };
};

/** A searchable list of people with a check column. */
export function PeopleList({
  people,
  isSelected,
  onSelect,
  none,
}: PeopleListProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? people.filter((person) => person.name.toLowerCase().includes(needle))
    : people;

  const rowClassName =
    "flex h-8 w-full items-center gap-2 px-2 text-left text-sm transition-colors hover:bg-accent/50";

  return (
    <div className="w-64 max-w-[calc(100vw-2rem)]">
      <div className="flex items-center gap-2 border-border border-b p-2">
        <Search className="size-3 text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("modules:form.searchMembers")}
          aria-label={t("modules:form.searchMembers")}
          className="h-auto border-none p-0 shadow-none focus-visible:ring-0 !bg-transparent"
        />
      </div>
      <div className="max-h-72 overflow-y-auto py-1">
        {none && !needle && (
          <button
            type="button"
            className={rowClassName}
            onClick={none.onSelect}
          >
            <span className="flex w-4 shrink-0 justify-center">
              {none.selected && <Check className="size-3.5" />}
            </span>
            <span className="text-muted-foreground">{none.label}</span>
          </button>
        )}
        {visible.map((person) => (
          <button
            key={person.id}
            type="button"
            aria-pressed={isSelected(person.id)}
            className={rowClassName}
            onClick={() => onSelect(person.id)}
          >
            <span className="flex w-4 shrink-0 justify-center">
              {isSelected(person.id) && <Check className="size-3.5" />}
            </span>
            <PersonAvatar person={person} />
            <span className="truncate">{person.name}</span>
          </button>
        ))}
        {visible.length === 0 && (
          <p className="px-2 py-2 text-muted-foreground text-xs">
            {t("modules:form.noPeopleFound")}
          </p>
        )}
      </div>
    </div>
  );
}
