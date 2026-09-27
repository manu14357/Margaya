import type { LucideIcon } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import type { TaskQueryScope } from "@/lib/task-query/model";

// Filter subjects: what the filter menu offers and how chips name values.
// Each descriptor contributes zero or more subjects (custom fields give one
// per field) from a hook, called in registration order on every render, so
// registrations happen once at module load. A later slice registers its own
// subjects from its own file:
//
//   registerFilterSubject({
//     id: "subscriber",
//     order: 150,
//     useSubjects: (context) => [...],
//   });

export type FilterOption = {
  value: string;
  label: string;
  icon?: ReactNode;
  /** A section title, e.g. the project in workspace scope. */
  section?: string;
};

export type FilterSubject = {
  /** The condition identity: the key, or `customField:{fieldId}`. */
  id: string;
  key: string;
  fieldId?: string;
  label: string;
  icon: LucideIcon;
  kind: "set" | "date";
  options: FilterOption[];
  isLoading?: boolean;
  /** Options found by a typed search, for large sets (parent tasks). */
  useSearchOptions?: (search: string) => {
    options: FilterOption[];
    isLoading: boolean;
  };
  /** Names a value that is not among the options (a parent task). */
  ValueLabel?: ComponentType<{ value: string }>;
};

export type ScopeProject = {
  id: string;
  name: string;
  slug: string;
  icon?: string | null;
  cyclesEnabled?: boolean;
  modulesEnabled?: boolean;
  estimatesEnabled?: boolean;
  viewsEnabled?: boolean;
};

export type FilterSubjectContext = {
  workspaceId: string;
  scope: TaskQueryScope;
  /** The projects in scope, with their feature flags. */
  projects: ScopeProject[];
  /** Load option lists: while the menu is open or a chip needs names. */
  isActive: (key: string) => boolean;
};

export type FilterSubjectDescriptor = {
  id: string;
  order: number;
  useSubjects: (context: FilterSubjectContext) => FilterSubject[];
};

const descriptors: FilterSubjectDescriptor[] = [];

/** Adds a descriptor; returns a function that removes it (for tests). */
export function registerFilterSubject(
  descriptor: FilterSubjectDescriptor,
): () => void {
  const existing = descriptors.findIndex(
    (candidate) => candidate.id === descriptor.id,
  );
  if (existing !== -1) descriptors.splice(existing, 1);
  descriptors.push(descriptor);
  descriptors.sort((a, b) => a.order - b.order);
  return () => {
    const index = descriptors.indexOf(descriptor);
    if (index !== -1) descriptors.splice(index, 1);
  };
}

export function getFilterSubjectDescriptors(): readonly FilterSubjectDescriptor[] {
  return descriptors;
}

/** Every subject for the context, in menu order. */
export function useFilterSubjects(
  context: FilterSubjectContext,
): FilterSubject[] {
  const subjects: FilterSubject[] = [];
  // Descriptors register once at module load, so every render calls the
  // same hooks in the same order.
  for (const descriptor of descriptors) {
    // biome-ignore lint/correctness/useHookAtTopLevel: a fixed list of hooks
    subjects.push(...descriptor.useSubjects(context));
  }
  return subjects;
}
