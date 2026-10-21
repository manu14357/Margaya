import { ruleReferenceIssues } from "../automation-rule/references";
import { hasAutomationChanges } from "../project-automation/settings";
import { type CompiledRule, compiledRuleSchema } from "./vocabulary";

// A compiled rule must pass the engine's own Zod schema and fit the
// project: real columns, a Cancelled-group column for auto-close, and at
// least one setting to change. The engine routes check the same again on
// save; checking here keeps invalid drafts away from the editor.

export type RuleColumn = { id: string; group: string };

/** Problems with a rule for this project; empty when it is valid. */
export function validateCompiledRule(
  value: unknown,
  columns: readonly RuleColumn[],
): string[] {
  const parsed = compiledRuleSchema.safeParse(value);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) =>
      issue.path.length > 0
        ? `${issue.path.join(".")}: ${issue.message}`
        : issue.message,
    );
  }
  const rule: CompiledRule = parsed.data;

  if (rule.engine === "workflow_rule") {
    return columns.some((column) => column.id === rule.rule.columnId)
      ? []
      : ["rule.columnId: not a column of this project"];
  }
  // Automation rules name more than columns: checkTaskRuleReferences.
  if (rule.engine === "automation_rule") return [];

  const { patch } = rule;
  if (!hasAutomationChanges(patch)) {
    return ["patch: provide at least one setting to change"];
  }
  const columnId = patch.autoClose?.columnId;
  if (columnId) {
    const column = columns.find((entry) => entry.id === columnId);
    if (column?.group !== "cancelled") {
      return [
        "patch.autoClose.columnId: choose a column in the Cancelled group of this project",
      ];
    }
  } else if (patch.autoClose?.enabled === true) {
    return [
      "patch.autoClose.columnId: turning auto-close on needs a column in the Cancelled group",
    ];
  }
  return [];
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

/** The model's unsupported parts, cleaned and bounded. */
export function parseUnsupported(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const record = entry as Record<string, unknown>;
      const request = cleanText(record.request, 300);
      const reason = cleanText(record.reason, 300);
      return request && reason ? [{ request, reason }] : [];
    })
    .slice(0, 10);
}

/**
 * Keeps the model's rules that pass the engines' schemas and fit the
 * project; the rest only count as rejected. Duplicates collapse to the
 * last one, like the engines' own upserts.
 */
export function resolveRules(
  value: unknown,
  columns: readonly RuleColumn[],
): { rules: CompiledRule[]; rejected: number } {
  const proposed = Array.isArray(value) ? value.slice(0, 10) : [];
  const byKey = new Map<string, CompiledRule>();
  let rejected = 0;
  for (const candidate of proposed) {
    if (validateCompiledRule(candidate, columns).length > 0) {
      rejected += 1;
      continue;
    }
    const rule = candidate as CompiledRule;
    const key =
      rule.engine === "workflow_rule"
        ? `wf:${rule.rule.integrationType}:${rule.rule.eventType}`
        : rule.engine === "automation_rule"
          ? `ar:${JSON.stringify(rule.rule)}`
          : `pa:${Object.keys(rule.patch).sort().join(",")}`;
    byKey.delete(key);
    byKey.set(key, rule);
  }
  return { rules: [...byKey.values()], rejected };
}

/**
 * Problems with an automation rule's references (people, cycles, modules,
 * custom fields, templates) for this project; empty for the other engines.
 */
export async function checkTaskRuleReferences(
  projectId: string,
  rule: CompiledRule,
): Promise<string[]> {
  if (rule.engine !== "automation_rule") return [];
  return (await ruleReferenceIssues(projectId, rule.rule)).map(
    (issue) => `rule.${issue}`,
  );
}
