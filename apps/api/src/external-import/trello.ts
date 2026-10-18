import {
  commentHash,
  type ExternalChecklist,
  type ExternalComment,
  type ExternalItem,
  type ParsedExport,
  parseExportDate,
} from "./types";

// Trello's board export (Menu → Print, export and share → Export as JSON):
// one JSON object with the board's lists, cards, labels, members,
// checklists and its most recent actions, where comments live.

type Json = Record<string, unknown>;

export type TrelloReadError = "notJson" | "notTrello" | "empty";

function asObject(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function asArray(value: unknown): Json[] {
  if (!Array.isArray(value)) return [];
  const objects: Json[] = [];
  for (const entry of value) {
    const object = asObject(entry);
    if (object) objects.push(object);
  }
  return objects;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function position(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Card ids are Mongo object ids: the first 8 hex digits are the creation time. */
function createdFromId(id: string): Date | null {
  if (!/^[0-9a-f]{24}$/i.test(id)) return null;
  const seconds = Number.parseInt(id.slice(0, 8), 16);
  return seconds > 0 ? new Date(seconds * 1000) : null;
}

function memberName(member: Json | null | undefined): string {
  if (!member) return "";
  return text(member.fullName).trim() || text(member.username).trim();
}

/** A member as the matcher reads it: the email when exported, else the name. */
function memberRef(member: Json): string {
  return text(member.email).trim() || memberName(member);
}

function checklistsByCard(checklists: Json[]) {
  const byCard = new Map<string, Array<ExternalChecklist & { pos: number }>>();
  for (const checklist of checklists) {
    const cardId = text(checklist.idCard);
    if (!cardId) continue;
    const items = asArray(checklist.checkItems)
      .sort((a, b) => position(a.pos) - position(b.pos))
      .map((item) => ({
        name: text(item.name).trim(),
        done: text(item.state) === "complete",
      }))
      .filter((item) => item.name);
    const list = byCard.get(cardId) ?? [];
    list.push({
      name: text(checklist.name).trim() || "Checklist",
      items,
      pos: position(checklist.pos),
    });
    byCard.set(cardId, list);
  }
  return byCard;
}

function commentsByCard(actions: Json[]) {
  const byCard = new Map<string, ExternalComment[]>();
  for (const action of actions) {
    if (text(action.type) !== "commentCard") continue;
    const data = asObject(action.data);
    const cardId = text(asObject(data?.card)?.id);
    const body = text(data?.text).trim();
    if (!cardId || !body) continue;
    const createdAt = parseExportDate(text(action.date), "UTC");
    const author = memberName(asObject(action.memberCreator)) || "Trello user";
    const list = byCard.get(cardId) ?? [];
    list.push({
      hash: commentHash([
        text(action.id),
        createdAt?.toISOString() ?? "",
        body,
      ]),
      createdAt,
      author,
      body,
    });
    byCard.set(cardId, list);
  }
  for (const list of byCard.values()) {
    list.sort(
      (a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0),
    );
  }
  return byCard;
}

export function readTrelloExport(
  content: string,
): { ok: true; parsed: ParsedExport } | { ok: false; error: TrelloReadError } {
  const clean = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  let root: Json | null;
  try {
    root = asObject(JSON.parse(clean));
  } catch {
    return { ok: false, error: "notJson" };
  }
  if (!root || !Array.isArray(root.cards) || !Array.isArray(root.lists)) {
    return { ok: false, error: "notTrello" };
  }

  const lists = new Map(
    asArray(root.lists).map((list) => [
      text(list.id),
      { name: text(list.name).trim(), closed: list.closed === true },
    ]),
  );
  const labels = new Map(
    asArray(root.labels).map((label) => [
      text(label.id),
      text(label.name).trim() || text(label.color).trim(),
    ]),
  );
  const members = new Map(
    asArray(root.members).map((member) => [text(member.id), member]),
  );
  const checklists = checklistsByCard(asArray(root.checklists));
  const comments = commentsByCard(asArray(root.actions));

  let archived = 0;
  const sectionCounts = new Map<string, number>();
  const items: ExternalItem[] = [];
  asArray(root.cards).forEach((card, index) => {
    const list = lists.get(text(card.idList));
    if (card.closed === true || list?.closed) {
      archived += 1;
      return;
    }
    const id = text(card.id);
    const status = list?.name ?? "";
    if (status) sectionCounts.set(status, (sectionCounts.get(status) ?? 0) + 1);
    const badDates: string[] = [];
    const dateOf = (field: string) => {
      const raw = text(card[field]);
      if (!raw) return null;
      const date = parseExportDate(raw, "UTC");
      if (!date) badDates.push(`${field} "${raw}"`);
      return date;
    };
    const assignees = (Array.isArray(card.idMembers) ? card.idMembers : [])
      .map((memberId) => members.get(text(memberId)))
      .flatMap((member) => (member ? [memberRef(member)] : []))
      .filter(Boolean);
    const cardLabels = (Array.isArray(card.idLabels) ? card.idLabels : [])
      .map((labelId) => labels.get(text(labelId)) ?? "")
      .filter(Boolean);
    items.push({
      line: index + 1,
      key: text(card.shortLink) || id,
      title: text(card.name).trim(),
      description: text(card.desc).trim(),
      status,
      statusCategory: "",
      priority: "",
      assignees,
      creator: "",
      labels: [...new Set(cardLabels)],
      dueDate: dateOf("due"),
      startDate: dateOf("start"),
      createdAt: createdFromId(id),
      updatedAt: dateOf("dateLastActivity"),
      completedAt: null,
      parentKey: "",
      blocks: [],
      related: [],
      comments: comments.get(id) ?? [],
      checklists: (checklists.get(id) ?? [])
        .sort((a, b) => a.pos - b.pos)
        .map(({ name, items: entries }) => ({ name, items: entries })),
      badDates,
    });
  });

  if (items.length === 0) return { ok: false, error: "empty" };
  return {
    ok: true,
    parsed: {
      items,
      columns: [...sectionCounts.entries()].map(([name, count]) => ({
        name,
        count,
      })),
      skipped:
        archived > 0
          ? [
              {
                message: "Archived cards and lists aren't imported",
                count: archived,
              },
            ]
          : [],
    },
  };
}
