import { useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { KbdSequence } from "@/components/ui/kbd";
import { shortcuts } from "@/constants/shortcuts";
import { getProjectSections } from "@/lib/project-sections";

type ShortcutItem = {
  keys: string[];
  description: string;
  icon?: React.ReactNode;
};

type ShortcutCategory = {
  title: string;
  shortcuts: ShortcutItem[];
};

function useShortcutCategories(): ShortcutCategory[] {
  const { t } = useTranslation();

  return useMemo(() => {
    // Listed only once a feature slice adds a section besides Tasks.
    const sections = getProjectSections();
    const sectionShortcuts: ShortcutItem[] =
      sections.length > 1
        ? sections.flatMap((section) =>
            section.shortcutKey
              ? [
                  {
                    keys: [shortcuts.section.prefix, section.shortcutKey],
                    description: t(
                      "navigation:keyboardShortcuts.items.goToSection",
                      { section: t(section.labelKey) },
                    ),
                  },
                ]
              : [],
          )
        : [];

    return [
      {
        title: t("navigation:keyboardShortcuts.categories.general"),
        shortcuts: [
          {
            keys: [shortcuts.palette.prefix, shortcuts.palette.open],
            description: t(
              "navigation:keyboardShortcuts.items.openCommandPalette",
            ),
          },
          {
            keys: [shortcuts.search.prefix],
            description: t("navigation:keyboardShortcuts.items.globalSearch"),
          },
          {
            keys: [shortcuts.ask.prefix, shortcuts.ask.toggle],
            description: t("ai:ask.shortcut"),
          },
          {
            keys: [shortcuts.sidebar.prefix, shortcuts.sidebar.toggle],
            description: t("navigation:shell.togglePanel"),
          },
          {
            keys: [shortcuts.notification.prefix, shortcuts.notification.inbox],
            description: t("navigation:keyboardShortcuts.items.openInbox"),
          },
          {
            keys: ["?"],
            description: t("navigation:keyboardShortcuts.items.showShortcuts"),
          },
          {
            keys: ["Escape"],
            description: t("navigation:keyboardShortcuts.items.closeModal"),
          },
        ],
      },
      {
        // Typed first in the command bar (Ctrl K) to narrow it.
        title: t("navigation:keyboardShortcuts.categories.commandBar"),
        shortcuts: [
          {
            keys: [">"],
            description: t("navigation:keyboardShortcuts.items.paletteActions"),
          },
          {
            keys: ["#"],
            description: t("navigation:keyboardShortcuts.items.paletteTasks"),
          },
          {
            keys: ["@"],
            description: t("navigation:keyboardShortcuts.items.palettePeople"),
          },
          {
            keys: ["/"],
            description: t("navigation:keyboardShortcuts.items.palettePlaces"),
          },
        ],
      },
      {
        title: t("navigation:keyboardShortcuts.categories.create"),
        shortcuts: [
          {
            keys: [shortcuts.task.prefix, shortcuts.task.create],
            description: t("navigation:keyboardShortcuts.items.createTask"),
          },
          {
            keys: [shortcuts.capture.open],
            description: t("navigation:keyboardShortcuts.items.captureTask"),
          },
          {
            keys: [shortcuts.project.prefix, shortcuts.project.create],
            description: t("navigation:keyboardShortcuts.items.createProject"),
          },
          {
            keys: [shortcuts.workspace.prefix, shortcuts.workspace.create],
            description: t(
              "navigation:keyboardShortcuts.items.createWorkspace",
            ),
          },
        ],
      },
      {
        title: t("navigation:keyboardShortcuts.categories.views"),
        shortcuts: [
          {
            keys: [shortcuts.view.prefix, shortcuts.view.board],
            description: t("navigation:keyboardShortcuts.items.boardView"),
          },
          {
            keys: [shortcuts.view.prefix, shortcuts.view.list],
            description: t("navigation:keyboardShortcuts.items.listView"),
          },
          {
            keys: [shortcuts.view.prefix, shortcuts.view.backlog],
            description: t("navigation:keyboardShortcuts.items.backlogView"),
          },
          {
            keys: [shortcuts.view.prefix, shortcuts.view.calendar],
            description: t("navigation:keyboardShortcuts.items.calendarView"),
          },
          {
            keys: [shortcuts.view.prefix, shortcuts.view.spreadsheet],
            description: t(
              "navigation:keyboardShortcuts.items.spreadsheetView",
            ),
          },
          {
            keys: [
              shortcuts.workspaceGo.prefix,
              shortcuts.workspaceGo.allTasks,
            ],
            description: t("navigation:keyboardShortcuts.items.goToAllTasks"),
          },
          {
            keys: [shortcuts.workspaceGo.prefix, shortcuts.workspaceGo.myWork],
            description: t("navigation:keyboardShortcuts.items.goToMyWork"),
          },
          {
            keys: [shortcuts.workspaceGo.prefix, shortcuts.workspaceGo.home],
            description: t("navigation:keyboardShortcuts.items.goToHome"),
          },
          {
            keys: [
              shortcuts.workspaceGo.prefix,
              shortcuts.workspaceGo.stickies,
            ],
            description: t("navigation:keyboardShortcuts.items.goToStickies"),
          },
        ],
      },
      ...(sectionShortcuts.length > 0
        ? [
            {
              title: t("navigation:keyboardShortcuts.categories.sections"),
              shortcuts: sectionShortcuts,
            },
          ]
        : []),
      {
        title: t("navigation:keyboardShortcuts.categories.navigation"),
        shortcuts: [
          {
            keys: ["j"],
            description: t("navigation:keyboardShortcuts.items.nextTask"),
          },
          {
            keys: ["k"],
            description: t("navigation:keyboardShortcuts.items.prevTask"),
          },
          {
            keys: ["Enter"],
            description: t("navigation:keyboardShortcuts.items.openTask"),
          },
        ],
      },
      {
        title: t("navigation:keyboardShortcuts.categories.triage"),
        shortcuts: [
          {
            keys: [shortcuts.triage.select],
            description: t("navigation:keyboardShortcuts.items.selectTask"),
          },
          {
            keys: [shortcuts.triage.status],
            description: t("navigation:keyboardShortcuts.items.triageStatus"),
          },
          {
            keys: [shortcuts.triage.priority],
            description: t("navigation:keyboardShortcuts.items.triagePriority"),
          },
          {
            keys: [shortcuts.triage.assignee],
            description: t("navigation:keyboardShortcuts.items.triageAssignee"),
          },
        ],
      },
      {
        // The open task, in the sheet or on its page.
        title: t("navigation:keyboardShortcuts.categories.task"),
        shortcuts: [
          {
            keys: [shortcuts.taskDetails.status],
            description: t("navigation:keyboardShortcuts.items.taskStatus"),
          },
          {
            keys: [shortcuts.taskDetails.priority],
            description: t("navigation:keyboardShortcuts.items.taskPriority"),
          },
          {
            keys: [shortcuts.taskDetails.assignee],
            description: t("navigation:keyboardShortcuts.items.taskAssignees"),
          },
          {
            keys: [shortcuts.taskDetails.labels],
            description: t("navigation:keyboardShortcuts.items.taskLabels"),
          },
          {
            keys: [shortcuts.taskDetails.dueDate],
            description: t("navigation:keyboardShortcuts.items.taskDueDate"),
          },
          {
            keys: [shortcuts.taskDetails.assignSelf],
            description: t("navigation:keyboardShortcuts.items.taskAssignSelf"),
          },
          {
            keys: [
              shortcuts.taskDetails.modifier,
              shortcuts.taskDetails.copyKey,
            ],
            description: t("navigation:keyboardShortcuts.items.taskCopyKey"),
          },
          {
            keys: [
              shortcuts.taskDetails.modifier,
              "Shift",
              shortcuts.taskDetails.copyLink,
            ],
            description: t("navigation:keyboardShortcuts.items.taskCopyLink"),
          },
          {
            keys: [
              shortcuts.taskDetails.modifier,
              "Shift",
              shortcuts.taskDetails.copyBranch,
            ],
            description: t("navigation:keyboardShortcuts.items.taskCopyBranch"),
          },
          {
            keys: [
              shortcuts.taskDetails.modifier,
              shortcuts.taskDetails.delete,
            ],
            description: t("navigation:keyboardShortcuts.items.taskDelete"),
          },
        ],
      },
      {
        title: t("navigation:keyboardShortcuts.categories.quickSelect"),
        shortcuts: [
          {
            keys: ["1", "2", "3", "..."],
            description: t(
              "navigation:keyboardShortcuts.items.quickSelectNumber",
            ),
          },
        ],
      },
    ];
  }, [t]);
}

export function KeyboardShortcutsHelp() {
  const { t } = useTranslation();
  const shortcutCategories = useShortcutCategories();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTyping =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.contentEditable === "true";

      if (e.key === "?" && !isTyping) {
        e.preventDefault();
        setOpen(true);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const filteredCategories = shortcutCategories
    .map((category) => ({
      ...category,
      shortcuts: category.shortcuts.filter(
        (shortcut) =>
          shortcut.description
            .toLowerCase()
            .includes(searchQuery.toLowerCase()) ||
          shortcut.keys.some((key) =>
            key.toLowerCase().includes(searchQuery.toLowerCase()),
          ),
      ),
    }))
    .filter((category) => category.shortcuts.length > 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="px-4 max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("navigation:keyboardShortcuts.title")}</DialogTitle>
          <DialogDescription>
            {t("navigation:keyboardShortcuts.subtitle")}
          </DialogDescription>
        </DialogHeader>

        <Input
          placeholder={t("navigation:keyboardShortcuts.searchPlaceholder")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="mb-4"
        />

        <div className="overflow-y-auto flex-1">
          <div className="space-y-4">
            {filteredCategories.map((category) => (
              <div key={category.title}>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {category.title}
                </h3>
                <div className="space-y-1">
                  {category.shortcuts.map((shortcut) => (
                    <div
                      key={`${category.title}-${shortcut.description}-${shortcut.keys.join("+")}`}
                      className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-muted/50"
                    >
                      <span className="text-xs">{shortcut.description}</span>
                      <KbdSequence keys={shortcut.keys} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 pt-4 border-t text-xs text-muted-foreground mb-4">
          <Trans
            i18nKey="navigation:keyboardShortcuts.footer"
            components={{
              kbd: <kbd className="px-1.5 py-0.5 rounded bg-muted" />,
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
