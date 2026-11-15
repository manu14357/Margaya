// These components read the board controller (history, collaborators,
// read-only state, the scene) while rendering. It is a mutable object whose
// identity never changes, so compiler memoisation would freeze those reads.
"use no memo";

import {
  CircleHelp,
  Map as MapIcon,
  Maximize,
  Minus,
  Plus,
  Redo2,
  Undo2,
} from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import MemberAvatar from "@/components/page/member-avatar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { BackgroundButton } from "./background-control";
import { runCommand } from "./commands";
import { type BoardController, unionBounds } from "./controller";
import { modifierLabel } from "./shortcuts";
import { chromeColors } from "./theme-colors";
import {
  useController,
  useEditorState,
  usePresenceVersion,
} from "./use-editor";
import { centreOn, visibleRect } from "./viewport";

function ChromeButton({
  label,
  shortcut,
  onClick,
  disabled,
  pressed,
  children,
  testId,
  className,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={onClick}
            data-testid={testId}
            className={cn("pointer-coarse:size-11", className)}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top" className="flex items-center gap-2">
        {label}
        {shortcut && <span className="text-muted-foreground">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Zoom, undo/redo and help: at the bottom of the canvas, or at the top of a
 * compact (phone-sized) board. A compact board shows no minimap, and touch
 * zooms with a pinch, so it leaves those buttons out to keep every control,
 * the Style button last, on screen at 360px.
 */
export function BottomBar({
  extra,
  compact = false,
}: {
  extra?: ReactNode;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const c = useController();
  const zoom = useEditorState((state) => state.viewport.zoom);
  const showMinimap = useEditorState((state) => state.showMinimap);
  // Re-render on scene changes so undo/redo availability stays current.
  useEditorState((state) => state.sceneVersion);
  const mod = modifierLabel();
  // Key names follow the language, as in the shortcuts dialog.
  const shift = t("whiteboardEditor:help.keys.shift");
  const alt = t("whiteboardEditor:help.keys.alt");
  const percent = Math.round(zoom * 100);
  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
      <fieldset
        aria-label={t("whiteboardEditor:zoom.label")}
        className="flex items-center rounded-xl border bg-card p-0.5 shadow-lg/5"
      >
        <ChromeButton
          label={t("whiteboardEditor:zoom.out")}
          shortcut={`${mod} -`}
          onClick={() => runCommand(c, "zoomOut")}
          className={compact ? "pointer-coarse:hidden" : undefined}
        >
          <Minus aria-hidden="true" />
        </ChromeButton>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="min-w-14 tabular-nums pointer-coarse:h-11"
                aria-label={t("whiteboardEditor:zoom.resetTo", { percent })}
                onClick={() => runCommand(c, "zoomReset")}
                data-testid="whiteboard-zoom-reset"
              />
            }
          >
            {t("whiteboardEditor:zoom.percent", { percent })}
          </TooltipTrigger>
          <TooltipContent side="top">
            {t("whiteboardEditor:zoom.reset")}
          </TooltipContent>
        </Tooltip>
        <ChromeButton
          label={t("whiteboardEditor:zoom.in")}
          shortcut={`${mod} +`}
          onClick={() => runCommand(c, "zoomIn")}
          className={compact ? "pointer-coarse:hidden" : undefined}
        >
          <Plus aria-hidden="true" />
        </ChromeButton>
        <ChromeButton
          label={t("whiteboardEditor:zoom.fit")}
          shortcut={`${shift} 1`}
          onClick={() => runCommand(c, "zoomFit")}
        >
          <Maximize aria-hidden="true" />
        </ChromeButton>
      </fieldset>
      {!c.readOnly && (
        <fieldset
          aria-label={t("whiteboardEditor:commands.history")}
          className="flex items-center rounded-xl border bg-card p-0.5 shadow-lg/5"
        >
          <ChromeButton
            label={t("whiteboardEditor:commands.undo")}
            shortcut={`${mod} Z`}
            disabled={!c.history.canUndo}
            onClick={() => c.undo()}
            testId="whiteboard-undo"
          >
            <Undo2 aria-hidden="true" />
          </ChromeButton>
          <ChromeButton
            label={t("whiteboardEditor:commands.redo")}
            shortcut={`${mod} ${shift} Z`}
            disabled={!c.history.canRedo}
            onClick={() => c.redo()}
            testId="whiteboard-redo"
          >
            <Redo2 aria-hidden="true" />
          </ChromeButton>
        </fieldset>
      )}
      <div className="flex items-center rounded-xl border bg-card p-0.5 shadow-lg/5">
        {!compact && (
          <ChromeButton
            label={t("whiteboardEditor:commands.toggleMinimap")}
            shortcut={`${alt} M`}
            pressed={showMinimap}
            onClick={() => runCommand(c, "toggleMinimap")}
          >
            <MapIcon aria-hidden="true" />
          </ChromeButton>
        )}
        {/* A compact board offers the background in its Style popover. */}
        {!compact && <BackgroundButton />}
        <ChromeButton
          label={t("whiteboardEditor:commands.help")}
          shortcut="?"
          onClick={() => runCommand(c, "help")}
        >
          <CircleHelp aria-hidden="true" />
        </ChromeButton>
        {extra}
      </div>
    </div>
  );
}

/** Collaborators on the board; clicking one follows their view. */
export function Collaborators() {
  const { t } = useTranslation();
  const c = useController();
  usePresenceVersion(c);
  const following = useEditorState((state) => state.followingClientId);
  // One entry per person, even with several tabs open.
  const people = new Map<string, (typeof c.remote)[number]>();
  for (const peer of c.remote)
    if (!people.has(peer.user.id)) people.set(peer.user.id, peer);
  const list = [...people.values()].slice(0, 8);
  if (list.length === 0) return null;
  const leader = c.remote.find((peer) => peer.clientId === following);
  return (
    <div className="pointer-events-auto flex flex-col items-end gap-1.5">
      <ul
        className="flex items-center gap-1 rounded-xl border bg-card p-1 shadow-lg/5"
        aria-label={t("whiteboardEditor:presence.label")}
      >
        {list.map((peer) => {
          const isFollowed = peer.clientId === following;
          const label = isFollowed
            ? t("whiteboardEditor:presence.stopFollowing", {
                name: peer.user.name,
              })
            : t("whiteboardEditor:presence.follow", { name: peer.user.name });
          return (
            <li key={peer.user.id}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={label}
                      aria-pressed={isFollowed}
                      onClick={() =>
                        c.follow(isFollowed ? null : peer.clientId)
                      }
                      className="relative inline-flex rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:after:absolute pointer-coarse:after:inset-[-10px]"
                      style={{ boxShadow: `0 0 0 2px ${peer.user.color}` }}
                    />
                  }
                >
                  <MemberAvatar
                    name={peer.user.name}
                    image={peer.user.image}
                    className="size-6"
                  />
                </TooltipTrigger>
                <TooltipContent side="bottom">{label}</TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ul>
      {leader && (
        <output className="flex items-center gap-2 rounded-lg border bg-card px-2 py-1 text-xs shadow-lg/5">
          <span>
            {t("whiteboardEditor:presence.following", {
              name: leader.user.name,
            })}
          </span>
          <Button size="xs" variant="ghost" onClick={() => c.follow(null)}>
            {t("whiteboardEditor:presence.stop")}
          </Button>
        </output>
      )}
    </div>
  );
}

/** A coloured edge around the canvas while following someone. */
export function FollowFrame() {
  const c = useController();
  usePresenceVersion(c);
  const following = useEditorState((state) => state.followingClientId);
  const leader = c.remote.find((peer) => peer.clientId === following);
  if (!leader) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 border-2"
      style={{ borderColor: leader.user.color }}
    />
  );
}

const MINIMAP = { width: 200, height: 140 };

/** A small overview of the board; click or drag it to move the view. */
export function Minimap({ controller: c }: { controller: BoardController }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLCanvasElement | null>(null);
  const viewport = useEditorState((state) => state.viewport);
  const width = useEditorState((state) => state.width);
  const height = useEditorState((state) => state.height);
  const version = useEditorState((state) => state.sceneVersion);
  const layout = useRef<{ x: number; y: number; scale: number } | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    void version;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = MINIMAP.width * dpr;
    canvas.height = MINIMAP.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, MINIMAP.width, MINIMAP.height);
    const view = visibleRect(viewport, width, height);
    const content = unionBounds(c.scene.elements);
    const box = content
      ? {
          x: Math.min(content.x, view.x),
          y: Math.min(content.y, view.y),
          width:
            Math.max(content.x + content.width, view.x + view.width) -
            Math.min(content.x, view.x),
          height:
            Math.max(content.y + content.height, view.y + view.height) -
            Math.min(content.y, view.y),
        }
      : view;
    const scale = Math.min(
      (MINIMAP.width - 12) / Math.max(1, box.width),
      (MINIMAP.height - 12) / Math.max(1, box.height),
    );
    const ox = (MINIMAP.width - box.width * scale) / 2 - box.x * scale;
    const oy = (MINIMAP.height - box.height * scale) / 2 - box.y * scale;
    layout.current = { x: ox, y: oy, scale };
    const colors = chromeColors(c.options.theme);
    ctx.fillStyle = colors.foreground;
    ctx.globalAlpha = 0.28;
    for (const element of c.scene.elements) {
      const bounds = unionBounds([element]);
      if (!bounds) continue;
      ctx.fillRect(
        ox + bounds.x * scale,
        oy + bounds.y * scale,
        Math.max(1, bounds.width * scale),
        Math.max(1, bounds.height * scale),
      );
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colors.selection;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      ox + view.x * scale,
      oy + view.y * scale,
      view.width * scale,
      view.height * scale,
    );
  }, [c, viewport, width, height, version]);

  const moveTo = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const current = layout.current;
    if (!current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left - current.x) / current.scale;
    const y = (event.clientY - rect.top - current.y) / current.scale;
    c.setViewport(
      centreOn(x, y, c.state.viewport.zoom, {
        width: c.state.width,
        height: c.state.height,
      }),
    );
  };

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={t("whiteboardEditor:minimap.label")}
      className="pointer-events-auto cursor-pointer rounded-xl border bg-card shadow-lg/5"
      style={{ width: MINIMAP.width, height: MINIMAP.height }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        moveTo(event);
      }}
      onPointerMove={(event) => {
        if (event.buttons) moveTo(event);
      }}
    />
  );
}
