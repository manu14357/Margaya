// The composer's "/" commands. Each maps to something Ask already does or an
// existing AI route, so this is mostly a menu: saved skills follow them.

export const ASK_SLASH_COMMANDS = [
  "summarize",
  "chart",
  "brief",
  "create",
  "translate",
  "clear",
] as const;
export type AskSlashCommand = (typeof ASK_SLASH_COMMANDS)[number];

export const SLASH_COMMAND_KEYS: Record<
  AskSlashCommand,
  { label: string; hint: string }
> = {
  summarize: {
    label: "ai:ask.commands.summarize",
    hint: "ai:ask.commands.summarizeHint",
  },
  chart: { label: "ai:ask.commands.chart", hint: "ai:ask.commands.chartHint" },
  brief: { label: "ai:ask.commands.brief", hint: "ai:ask.commands.briefHint" },
  create: {
    label: "ai:ask.commands.create",
    hint: "ai:ask.commands.createHint",
  },
  translate: {
    label: "ai:ask.commands.translate",
    hint: "ai:ask.commands.translateHint",
  },
  clear: { label: "ai:ask.commands.clear", hint: "ai:ask.commands.clearHint" },
};

export type AskSkillOption = { id: string; name: string; description: string };

export type AskSlashItem =
  | { kind: "command"; id: AskSlashCommand }
  | { kind: "skill"; skill: AskSkillOption };

/**
 * The commands and skills matching what follows "/": by the command's own
 * name (in English, as typed) or its translated label, and by skill name.
 * In Build mode "create" is left out: it only switches to Build.
 */
export function slashItems(
  query: string,
  skills: readonly AskSkillOption[],
  labelOf: (command: AskSlashCommand) => string,
  building = false,
): AskSlashItem[] {
  const term = query.trim().toLocaleLowerCase();
  const commands = ASK_SLASH_COMMANDS.filter(
    (command) => !(building && command === "create"),
  )
    .filter(
      (command) =>
        !term ||
        command.startsWith(term) ||
        labelOf(command).toLocaleLowerCase().includes(term),
    )
    .map((id): AskSlashItem => ({ kind: "command", id }));
  const saved = skills
    .filter((skill) => !term || skill.name.toLocaleLowerCase().includes(term))
    .slice(0, 8)
    .map((skill): AskSlashItem => ({ kind: "skill", skill }));
  return [...commands, ...saved];
}
