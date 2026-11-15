import {
  type BoardElement,
  elementBox,
  type LocalPoint,
  laserTrailOutline,
} from "@margaya/whiteboard";
import type { BoardController } from "./controller";
import { pictureFrame } from "./crop";
import { rotateAround } from "./handles";
import { type Interaction, isLinear } from "./interaction";
import { chromeColors, withAlpha } from "./theme-colors";
import { toScreen } from "./viewport";

// The interactive layer: selection, handles, guides, binding highlights and
// everything collaborators show (cursors, selections, laser trails). It is
// drawn in screen pixels so strokes stay crisp at every zoom level.

/** How long a laser point stays visible. */
const LASER_MS = 1000;

type Ctx = CanvasRenderingContext2D;

export function paintOverlay(
  ctx: Ctx,
  c: BoardController,
  interaction: Interaction,
  options: { coarse: boolean; reducedMotion: boolean },
): boolean {
  const state = c.state;
  const viewport = state.viewport;
  const colors = chromeColors(c.options.theme);
  const dpr = c.pixelRatio;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const project = (x: number, y: number) => toScreen(viewport, x, y);
  let animating = false;

  // Remote selections, under our own.
  for (const peer of c.remote) {
    for (const id of peer.selectedIds) {
      const element = c.get(id);
      if (element)
        outlineElement(
          ctx,
          element,
          project,
          viewport.zoom,
          peer.user.color,
          1.5,
          4,
        );
    }
  }

  // Hover.
  const hover = c.overlay.hoverId ? c.get(c.overlay.hoverId) : null;
  if (hover && !state.selectedIds.includes(hover.id)) {
    outlineElement(
      ctx,
      hover,
      project,
      viewport.zoom,
      withAlpha(colors.selection, 0.5),
      1,
      2,
    );
  }

  // Binding target.
  const bind = c.overlay.bindTargetId ? c.get(c.overlay.bindTargetId) : null;
  if (bind)
    outlineElement(ctx, bind, project, viewport.zoom, colors.bind, 6, 6);

  // Crop mode: the rest of the picture, dimmed around the kept area.
  if (state.croppingId) paintCropSurround(ctx, c, state.croppingId);

  // Selection.
  const selected = c.selectedElements();
  if (selected.length > 1) {
    for (const element of selected) {
      outlineElement(
        ctx,
        element,
        project,
        viewport.zoom,
        withAlpha(colors.selection, 0.6),
        1,
        2,
      );
    }
  }
  const frame = interaction.selectionFrame();
  const line = interaction.editableLine();
  if (frame && !line && state.editingTextId === null) {
    const corners = [
      [frame.x, frame.y],
      [frame.x + frame.width, frame.y],
      [frame.x + frame.width, frame.y + frame.height],
      [frame.x, frame.y + frame.height],
    ].map(([x, y]) => {
      const cx = frame.x + frame.width / 2;
      const cy = frame.y + frame.height / 2;
      const rotated = rotateAround(x ?? 0, y ?? 0, cx, cy, frame.angle);
      return project(rotated.x, rotated.y);
    });
    ctx.save();
    ctx.strokeStyle = colors.selection;
    ctx.lineWidth = 1.5;
    if (selected.length > 1 || state.editingGroupId) ctx.setLineDash([5, 4]);
    ctx.beginPath();
    corners.forEach((corner, index) => {
      if (index === 0) ctx.moveTo(corner.x, corner.y);
      else ctx.lineTo(corner.x, corner.y);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    const locked = selected.some((element) => element.locked);
    if (!locked) {
      for (const handle of interaction.handleLayout(options.coarse)) {
        const centre = project(handle.x, handle.y);
        const size = handle.size * viewport.zoom;
        ctx.save();
        ctx.fillStyle = colors.handleFill;
        ctx.strokeStyle = colors.selection;
        ctx.lineWidth = 1.5;
        if (handle.id === "rotate") {
          ctx.beginPath();
          ctx.arc(centre.x, centre.y, size / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.translate(centre.x, centre.y);
          ctx.rotate(frame.angle);
          ctx.beginPath();
          roundRect(ctx, -size / 2, -size / 2, size, size, 2);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  // Line point handles.
  if (line && state.editingTextId === null)
    paintLineHandles(ctx, line, project, colors, options.coarse);

  // Box selection.
  const box = c.overlay.box;
  if (box) {
    const a = project(box.x, box.y);
    const w = box.width * viewport.zoom;
    const h = box.height * viewport.zoom;
    ctx.save();
    ctx.fillStyle = colors.selectionFill;
    ctx.strokeStyle = colors.selection;
    ctx.lineWidth = 1;
    ctx.fillRect(a.x, a.y, w, h);
    ctx.strokeRect(a.x + 0.5, a.y + 0.5, w, h);
    ctx.restore();
  }

  // Snap guides.
  if (c.overlay.guides.length > 0) {
    ctx.save();
    ctx.strokeStyle = colors.guide;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    for (const guide of c.overlay.guides) {
      const from = project(guide.x1, guide.y1);
      const to = project(guide.x2, guide.y2);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Eraser trail.
  const trail = c.overlay.eraserTrail;
  if (trail.length > 1) {
    ctx.save();
    ctx.strokeStyle = colors.eraser;
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    trail.forEach(([x, y], index) => {
      const p = project(x, y);
      if (index === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
    ctx.restore();
  }

  // Laser trails: ours, then everyone else's.
  const now = performance.now();
  if (c.laser.length > 0) {
    c.laser = c.laser.filter((entry) => now - entry[2] < LASER_MS);
    if (c.laser.length > 0) {
      const points = c.laser.map(([x, y]) => [x, y] as [number, number]);
      paintLaser(ctx, points, project, colors.laser, options.reducedMotion);
      // Keep collaborators' copy fading with ours (the publisher throttles).
      c.publishLaser(points);
      animating = true;
    } else {
      c.publishLaser(null);
    }
  }
  for (const peer of c.remote) {
    if (peer.laser && peer.laser.length > 1) {
      paintLaser(
        ctx,
        peer.laser,
        project,
        peer.user.color,
        options.reducedMotion,
      );
    }
  }

  // Remote cursors on top of everything.
  for (const peer of c.remote) {
    if (!peer.cursor) continue;
    const p = project(peer.cursor.x, peer.cursor.y);
    if (
      p.x < -40 ||
      p.y < -40 ||
      p.x > state.width + 40 ||
      p.y > state.height + 40
    )
      continue;
    paintCursor(ctx, p.x, p.y, peer.user.color, peer.user.name);
  }

  return animating;
}

/** Shade laid over the part of a picture that the crop leaves out. */
const CROP_SHADE = "rgba(15, 15, 20, 0.55)";

/**
 * Draws the whole picture with the part outside the crop shaded. The kept
 * part is left alone, so the scene's own (bright, cropped) image shows
 * through it.
 */
function paintCropSurround(ctx: Ctx, c: BoardController, id: string): void {
  const element = c.get(id);
  if (element?.type !== "image" || !element.assetId) return;
  const size = c.imageSize(element);
  const frame = size ? pictureFrame(element, size) : null;
  const image = c.images.get(element.assetId);
  if (!frame || !image) return;
  const { viewport } = c.state;
  const origin = toScreen(viewport, frame.origin.x, frame.origin.y);
  const { window } = frame;
  ctx.save();
  ctx.translate(origin.x, origin.y);
  ctx.rotate(frame.angle);
  ctx.scale(viewport.zoom, viewport.zoom);
  ctx.beginPath();
  ctx.rect(0, 0, frame.width, frame.height);
  ctx.rect(window.x, window.y, window.width, window.height);
  ctx.clip("evenodd");
  ctx.globalAlpha = Math.max(0.2, element.opacity / 100);
  ctx.drawImage(image, 0, 0, frame.width, frame.height);
  ctx.globalAlpha = 1;
  ctx.fillStyle = CROP_SHADE;
  ctx.fillRect(0, 0, frame.width, frame.height);
  ctx.restore();
}

function outlineElement(
  ctx: Ctx,
  element: BoardElement,
  project: (x: number, y: number) => { x: number; y: number },
  zoom: number,
  color: string,
  width: number,
  padding: number,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  if (isLinear(element) || element.type === "draw") {
    const points = element.points as readonly LocalPoint[];
    if (isLinear(element) && points.length > 1) {
      ctx.beginPath();
      points.forEach(([x, y], index) => {
        const world = rotateLocal(element, x, y);
        const p = project(world.x, world.y);
        if (index === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.lineWidth = width + Math.max(1, element.strokeWidth * zoom * 0.5);
      ctx.globalAlpha = 0.7;
      ctx.stroke();
      ctx.restore();
      return;
    }
  }
  const box = elementBox(element);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const centre = project(cx, cy);
  ctx.translate(centre.x, centre.y);
  ctx.rotate(element.angle);
  const w = box.width * zoom + padding * 2;
  const h = box.height * zoom + padding * 2;
  ctx.beginPath();
  roundRect(ctx, -w / 2, -h / 2, w, h, 4);
  ctx.stroke();
  ctx.restore();
}

function rotateLocal(element: BoardElement, x: number, y: number) {
  const world = { x: element.x + x, y: element.y + y };
  if (!element.angle) return world;
  const box = elementBox(element);
  return rotateAround(
    world.x,
    world.y,
    box.x + box.width / 2,
    box.y + box.height / 2,
    element.angle,
  );
}

function paintLineHandles(
  ctx: Ctx,
  line: BoardElement & { points: readonly LocalPoint[]; routing: string },
  project: (x: number, y: number) => { x: number; y: number },
  colors: ReturnType<typeof chromeColors>,
  coarse: boolean,
): void {
  const radius = coarse ? 9 : 5.5;
  const world = line.points.map(([x, y]) =>
    project(...xy(rotateLocal(line, x, y))),
  );
  ctx.save();
  ctx.strokeStyle = colors.selection;
  ctx.lineWidth = 1.5;
  if (line.routing !== "elbow") {
    for (let index = 0; index < world.length - 1; index++) {
      const a = world[index];
      const b = world[index + 1];
      if (!a || !b || Math.hypot(b.x - a.x, b.y - a.y) < 40) continue;
      ctx.fillStyle = withAlpha(colors.selection, 0.35);
      ctx.beginPath();
      ctx.arc((a.x + b.x) / 2, (a.y + b.y) / 2, radius * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (const point of world) {
    ctx.fillStyle = colors.handleFill;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function xy(point: { x: number; y: number }): [number, number] {
  return [point.x, point.y];
}

function paintLaser(
  ctx: Ctx,
  points: readonly (readonly [number, number])[],
  project: (x: number, y: number) => { x: number; y: number },
  color: string,
  reducedMotion: boolean,
): void {
  const screen = points.map(([x, y]) => {
    const p = project(x, y);
    return [p.x, p.y] as const;
  });
  ctx.save();
  if (reducedMotion || screen.length < 3) {
    const last = screen[screen.length - 1];
    if (last) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(last[0], last[1], 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }
  const outline = laserTrailOutline(screen, { size: 7 });
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  outline.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function paintCursor(
  ctx: Ctx,
  x: number,
  y: number,
  color: string,
  name: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 16);
  ctx.lineTo(4.5, 12);
  ctx.lineTo(8, 19);
  ctx.lineTo(10.5, 18);
  ctx.lineTo(7, 11);
  ctx.lineTo(12.5, 11);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  const label = name.length > 24 ? `${name.slice(0, 23)}…` : name;
  ctx.font = '500 12px "Geist Variable", ui-sans-serif, system-ui, sans-serif';
  const width = ctx.measureText(label).width + 12;
  ctx.fillStyle = color;
  ctx.beginPath();
  roundRect(ctx, 12, 18, width, 20, 6);
  ctx.fill();
  ctx.fillStyle = readableOn(color);
  ctx.textBaseline = "middle";
  ctx.fillText(label, 18, 28);
  ctx.restore();
}

/** Black or white text for a label on `color`. */
function readableOn(color: string): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1];
  if (!hex) return "#ffffff";
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? "#111111" : "#ffffff";
}

function roundRect(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
