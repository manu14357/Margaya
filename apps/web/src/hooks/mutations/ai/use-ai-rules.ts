import { useMutation } from "@tanstack/react-query";
import { compileRule, dryRunRule } from "@/fetchers/ai/rules";

/** Compiles a described rule; nothing is saved by compiling. */
export function useCompileRule() {
  return useMutation({ mutationFn: compileRule });
}

/** Replays a draft rule over recent history; read-only. */
export function useRuleDryRun() {
  return useMutation({ mutationFn: dryRunRule });
}
