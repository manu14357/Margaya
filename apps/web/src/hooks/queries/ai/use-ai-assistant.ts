import { useQuery } from "@tanstack/react-query";
import { listConversations } from "@/fetchers/ai/conversations";
import { listAiMemory } from "@/fetchers/ai/memory";
import { listAiSkills } from "@/fetchers/ai/skills";
import { aiKeys } from "./use-ai";

/** Saved prompts the caller can use: their own and the shared ones. */
export function useAiSkills(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: aiKeys.skills(workspaceId ?? ""),
    queryFn: () => listAiSkills(workspaceId ?? ""),
    enabled: Boolean(workspaceId) && enabled,
    staleTime: 60_000,
    retry: false,
  });
}

/** Memory notes the caller can see: workspace, project and their own. */
export function useAiMemory(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: aiKeys.memory(workspaceId ?? ""),
    queryFn: () => listAiMemory(workspaceId ?? ""),
    enabled: Boolean(workspaceId) && enabled,
    retry: false,
  });
}

/** Server-side Ask history (only while the workspace keeps it). */
export function useAiConversations(
  workspaceId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: aiKeys.conversations(workspaceId ?? ""),
    queryFn: () => listConversations(workspaceId ?? ""),
    enabled: Boolean(workspaceId) && enabled,
    retry: false,
  });
}
