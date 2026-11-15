// These components read the board controller (history, collaborators,
// read-only state, the scene) while rendering. It is a mutable object whose
// identity never changes, so compiler memoisation would freeze those reads.
"use no memo";

import type { BoardElement } from "@margaya/whiteboard";
import { useTranslation } from "react-i18next";
import { ContextMenu } from "@/components/ui/context-menu";
import {
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
} from "@/components/ui/menu";
import { addShape, changeShape, resetCrop, runCommand } from "./commands";
import type { BoardController } from "./controller";
import { describeSelection } from "./selection-info";
import { ShapeSubmenu } from "./shape-picker";
import { modifierLabel } from "./shortcuts";
import { useEditorState } from "./use-editor";

export type ContextMenuActions = {
  onTurnIntoTasks: () => void;
  onMakeDependency: (link: {
    sourceTaskId: string;
    targetTaskId: string;
  }) => void;
  /** The selected task-card arrow already stands for a "blocks" relation. */
  dependencyExists: boolean;
  onRemoveDependency: () => void;
  onEditLink: () => void;
  onCopyLink: (elementId: string) => void;
  onOpenLink: (url: string) => void;
  onEditText: (elementId: string) => void;
  tasksEnabled: boolean;
  pointer: () => { x: number; y: number } | null;
};

export function EditorContextMenu({
  controller: c,
  actions,
}: {
  controller: BoardController;
  actions: ContextMenuActions;
}) {
  const { t } = useTranslation();
  const menu = useEditorState((state) => state.contextMenu);
  const selectedIds = useEditorState((state) => state.selectedIds);
  const snap = useEditorState((state) => state.snapToObjects);
  useEditorState((state) => state.sceneVersion);
  const close = () => c.update((state) => ({ ...state, contextMenu: null }));
  if (!menu) return null;

  const readOnly = c.readOnly;
  const selected = selectedIds
    .map((id) => c.get(id))
    .filter((e): e is BoardElement => Boolean(e));
  const info = describeSelection(selected, (id) => c.get(id));
  const only = selected.length === 1 ? selected[0] : undefined;
  const mod = modifierLabel();
  // Key names follow the language, as in the shortcuts dialog.
  const shift = t("whiteboardEditor:help.keys.shift");
  const alt = t("whiteboardEditor:help.keys.alt");
  const enter = t("whiteboardEditor:help.keys.enter");
  const del = t("whiteboardEditor:help.keys.delete");
  const run = (command: Parameters<typeof runCommand>[1]) => () => {
    close();
    runCommand(c, command, {
      at: actions.pointer(),
      editText: actions.onEditText,
    });
  };
  const anchor = {
    getBoundingClientRect: () => new DOMRect(menu.clientX, menu.clientY, 0, 0),
  };

  const item = (
    label: string,
    onClick: () => void,
    shortcut?: string,
    destructive?: boolean,
  ) => (
    <MenuItem
      key={label}
      onClick={onClick}
      variant={destructive ? "destructive" : "default"}
    >
      {label}
      {shortcut && <MenuShortcut>{shortcut}</MenuShortcut>}
    </MenuItem>
  );

  const groups: React.ReactNode[][] = [];
  if (selected.length > 0) {
    const edit: React.ReactNode[] = [];
    if (!readOnly)
      edit.push(
        item(t("whiteboardEditor:commands.cut"), run("cut"), `${mod}+X`),
      );
    edit.push(
      item(t("whiteboardEditor:commands.copy"), run("copy"), `${mod}+C`),
    );
    if (!readOnly) {
      edit.push(
        item(t("whiteboardEditor:commands.paste"), run("paste"), `${mod}+V`),
      );
      edit.push(
        item(
          t("whiteboardEditor:commands.duplicate"),
          run("duplicate"),
          `${mod}+D`,
        ),
      );
    }
    groups.push(edit);

    const special: React.ReactNode[] = [];
    if (only?.type === "task") {
      special.push(
        item(t("whiteboardEditor:tasks.openTask"), () => {
          close();
          c.callbacks.openTask?.(only.taskId);
        }),
      );
    }
    if (!readOnly && actions.tasksEnabled && info.stickies.length > 0) {
      special.push(
        item(
          t("whiteboardEditor:tasks.turnIntoTasks", {
            count: info.stickies.length,
          }),
          () => {
            close();
            actions.onTurnIntoTasks();
          },
        ),
      );
    }
    if (!readOnly && actions.tasksEnabled && info.dependency) {
      const link = info.dependency;
      special.push(
        actions.dependencyExists
          ? item(
              t("whiteboardEditor:tasks.removeDependency"),
              () => {
                close();
                actions.onRemoveDependency();
              },
              undefined,
              true,
            )
          : item(t("whiteboardEditor:tasks.makeDependency"), () => {
              close();
              actions.onMakeDependency(link);
            }),
      );
    }
    if (!readOnly && only?.type === "image" && !only.locked && only.assetId) {
      const cropping = c.state.croppingId === only.id;
      special.push(
        item(
          cropping
            ? t("whiteboardEditor:crop.finish")
            : t("whiteboardEditor:crop.start"),
          () => {
            close();
            if (cropping) c.endCrop();
            else c.startCrop(only.id);
          },
          enter,
        ),
      );
      if (only.crop)
        special.push(
          item(t("whiteboardEditor:crop.reset"), () => {
            close();
            resetCrop(c);
          }),
        );
    }
    if (!readOnly && info.allShapes && !info.allLocked) {
      special.push(
        <ShapeSubmenu
          key="change-shape"
          label={t("whiteboardEditor:shapes.change")}
          value={info.shapeChoice}
          onPick={(shape) => {
            close();
            changeShape(c, shape);
          }}
        />,
      );
    }
    if (
      !readOnly &&
      only &&
      only.type !== "image" &&
      only.type !== "draw" &&
      only.type !== "task"
    ) {
      special.push(
        item(
          t("whiteboardEditor:commands.editText"),
          () => {
            close();
            actions.onEditText(only.id);
          },
          enter,
        ),
      );
    }
    if (special.length > 0) groups.push(special);

    if (!readOnly) {
      groups.push([
        item(
          t("whiteboardEditor:commands.copyStyle"),
          run("copyStyle"),
          `${mod}+${alt}+C`,
        ),
        ...(c.copiedStyle
          ? [
              item(
                t("whiteboardEditor:commands.pasteStyle"),
                run("pasteStyle"),
                `${mod}+${alt}+V`,
              ),
            ]
          : []),
      ]);
      groups.push([
        item(
          t("whiteboardEditor:commands.bringToFront"),
          run("bringToFront"),
          `${mod}+${shift}+]`,
        ),
        item(
          t("whiteboardEditor:commands.bringForward"),
          run("bringForward"),
          `${mod}+]`,
        ),
        item(
          t("whiteboardEditor:commands.sendBackward"),
          run("sendBackward"),
          `${mod}+[`,
        ),
        item(
          t("whiteboardEditor:commands.sendToBack"),
          run("sendToBack"),
          `${mod}+${shift}+[`,
        ),
      ]);
      const arrange: React.ReactNode[] = [];
      if (selected.length > 1)
        arrange.push(
          item(t("whiteboardEditor:commands.group"), run("group"), `${mod}+G`),
        );
      if (info.grouped)
        arrange.push(
          item(
            t("whiteboardEditor:commands.ungroup"),
            run("ungroup"),
            `${mod}+${shift}+G`,
          ),
        );
      arrange.push(
        item(
          t("whiteboardEditor:commands.flipHorizontal"),
          run("flipHorizontal"),
          `${shift}+H`,
        ),
      );
      arrange.push(
        item(
          t("whiteboardEditor:commands.flipVertical"),
          run("flipVertical"),
          `${shift}+V`,
        ),
      );
      arrange.push(
        item(
          info.allLocked
            ? t("whiteboardEditor:commands.unlock")
            : t("whiteboardEditor:commands.lock"),
          run("toggleElementLock"),
          `${mod}+${shift}+L`,
        ),
      );
      groups.push(arrange);
    }

    const links: React.ReactNode[] = [];
    if (only) {
      if (only.link) {
        const link = only.link;
        links.push(
          item(t("whiteboardEditor:link.open"), () => {
            close();
            actions.onOpenLink(link);
          }),
        );
      }
      if (!readOnly)
        links.push(
          item(t("whiteboardEditor:commands.editLink"), () => {
            close();
            actions.onEditLink();
          }),
        );
      links.push(
        item(t("whiteboardEditor:link.copyElementLink"), () => {
          close();
          actions.onCopyLink(only.id);
        }),
      );
    }
    if (links.length > 0) groups.push(links);
    if (!readOnly && !info.allLocked) {
      groups.push([
        item(t("whiteboardEditor:commands.delete"), run("delete"), del, true),
      ]);
    }
  } else {
    const board: React.ReactNode[] = [];
    if (!readOnly) {
      board.push(
        item(t("whiteboardEditor:commands.paste"), run("paste"), `${mod}+V`),
      );
      const at = c.toBoard(menu.clientX, menu.clientY);
      board.push(
        <ShapeSubmenu
          key="add-shape"
          label={t("whiteboardEditor:shapes.add")}
          value={null}
          onPick={(shape) => {
            close();
            addShape(c, shape, at);
          }}
        />,
      );
    }
    board.push(
      item(
        t("whiteboardEditor:commands.selectAll"),
        run("selectAll"),
        `${mod}+A`,
      ),
    );
    groups.push(board);
    const view: React.ReactNode[] = [
      item(t("whiteboardEditor:zoom.fit"), run("zoomFit"), `${shift}+1`),
      item(t("whiteboardEditor:zoom.reset"), run("zoomReset"), `${mod}+0`),
    ];
    if (!readOnly) {
      view.push(
        <MenuCheckboxItem
          key="grid"
          checked={c.settings.gridSize > 0}
          onCheckedChange={() => {
            close();
            runCommand(c, "toggleGrid");
          }}
        >
          {t("whiteboardEditor:commands.toggleGrid")}
        </MenuCheckboxItem>,
        <MenuCheckboxItem
          key="snap"
          checked={snap}
          onCheckedChange={() => {
            close();
            runCommand(c, "toggleSnap");
          }}
        >
          {t("whiteboardEditor:commands.toggleSnap")}
        </MenuCheckboxItem>,
      );
    }
    groups.push(view);
    groups.push([item(t("whiteboardEditor:commands.help"), run("help"), "?")]);
  }

  return (
    // A context-menu root, not a plain Menu: a trigger-less Menu never joins
    // the floating tree, so opening "Add shape" or "Change shape" would read
    // as a sibling menu opening and close the whole menu.
    <ContextMenu open onOpenChange={(open) => !open && close()}>
      <MenuPopup
        anchor={anchor}
        side="bottom"
        align="start"
        sideOffset={2}
        className="min-w-52"
        aria-label={t("whiteboardEditor:contextMenu.label")}
      >
        {groups
          .filter((group) => group.length > 0)
          .map((group, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the groups are positional
            <div key={index}>
              {index > 0 && <MenuSeparator />}
              {group}
            </div>
          ))}
      </MenuPopup>
    </ContextMenu>
  );
}
