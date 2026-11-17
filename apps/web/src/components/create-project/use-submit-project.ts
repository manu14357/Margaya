import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import type {
  CreatedProject,
  CreateProjectRequest,
} from "@/fetchers/project/create-project";
import { invalidateProjectListQueries } from "@/hooks/mutations/project/invalidate-project-list-queries";
import useCreateProject from "@/hooks/mutations/project/use-create-project";
import {
  clearProjectDraft,
  countCreatedProject,
  FIRST_STEPS_PROJECT_LIMIT,
  writeFirstSteps,
  writeLastChoice,
} from "@/lib/create-flow-storage";
import { HttpError } from "@/lib/http-error";

export type CreateFailure =
  | { kind: "conflict"; key: string }
  | { kind: "template" }
  | { kind: "forbidden" }
  | { kind: "generic" };

export type CreateOutcome =
  | {
      ok: true;
      project: CreatedProject;
      sampleTaskCount: number;
      /** The board shows its "First steps" strip. */
      firstSteps: boolean;
    }
  | { ok: false; failure: CreateFailure };

export function classifyCreateError(
  error: unknown,
  key: string,
): CreateFailure {
  if (error instanceof HttpError) {
    if (error.status === 409) return { kind: "conflict", key };
    if (error.status === 404 || error.status === 400)
      return { kind: "template" };
    if (error.status === 403) return { kind: "forbidden" };
  }
  return { kind: "generic" };
}

/**
 * One atomic create, then the browser-side bookkeeping: the remembered
 * choice, the cleared draft, and the board's "First steps" record. The
 * creating tab refreshes its project lists itself (the socket skips it).
 */
export function useSubmitProject(workspaceId: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const { mutateAsync } = useCreateProject();
  const [isPending, setIsPending] = useState(false);

  const submit = async (
    request: CreateProjectRequest,
    remember: { categoryId: string | null; templateId: string | null },
  ): Promise<CreateOutcome> => {
    setIsPending(true);
    try {
      const project = await mutateAsync(request);
      invalidateProjectListQueries(queryClient, workspaceId);
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      const sampleTaskCount = project.template?.sampleTaskCount ?? 0;
      let firstSteps = sampleTaskCount > 0;
      if (userId) {
        clearProjectDraft(userId, workspaceId);
        writeLastChoice(userId, workspaceId, remember);
        const count = countCreatedProject(userId, workspaceId);
        firstSteps = firstSteps || count <= FIRST_STEPS_PROJECT_LIMIT;
      }
      writeFirstSteps(project.id, {
        projectName: project.name,
        sampleTaskCount,
        appliedByMe: sampleTaskCount > 0,
        skippedLabels: Boolean(
          project.template?.skipped.some(
            (item) => item.kind === "label" && item.reason === "permission",
          ),
        ),
        dismissed: !firstSteps,
      });
      return { ok: true, project, sampleTaskCount, firstSteps };
    } catch (error) {
      return {
        ok: false,
        failure: classifyCreateError(error, request.slug),
      };
    } finally {
      setIsPending(false);
    }
  };

  return { submit, isPending };
}
