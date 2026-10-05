import type { Point } from './model';

export type ViewportSize = { width: number; height: number };
export type Camera = { centerX: number; centerY: number; zoom: number };
export type FitObject = Point & { radiusMm: number };
export type ViewportPadding = number | { top: number; right: number; bottom: number; left: number };

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;

export function worldToScreen(point: Point, camera: Camera, viewport: ViewportSize): Point {
  return {
    x: viewport.width / 2 + (point.x - camera.centerX) * camera.zoom,
    y: viewport.height / 2 - (point.y - camera.centerY) * camera.zoom,
  };
}

export function screenToWorld(point: Point, camera: Camera, viewport: ViewportSize): Point {
  return {
    x: camera.centerX + (point.x - viewport.width / 2) / camera.zoom,
    y: camera.centerY - (point.y - viewport.height / 2) / camera.zoom,
  };
}

export function zoomViewAt(
  camera: Camera,
  viewport: ViewportSize,
  screenPoint: Point,
  factor: number,
): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return camera;
  const anchor = screenToWorld(screenPoint, camera, viewport);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * factor));
  return {
    centerX: anchor.x - (screenPoint.x - viewport.width / 2) / zoom,
    centerY: anchor.y + (screenPoint.y - viewport.height / 2) / zoom,
    zoom,
  };
}

export function panView(camera: Camera, screenDelta: Point): Camera {
  return {
    centerX: camera.centerX - screenDelta.x / camera.zoom,
    centerY: camera.centerY + screenDelta.y / camera.zoom,
    zoom: camera.zoom,
  };
}

export function fitViewportToObjects(
  objects: FitObject[],
  viewport: ViewportSize,
  paddingPx: ViewportPadding = 56,
): Camera {
  if (objects.length === 0) return { centerX: 0, centerY: 0, zoom: 1 };
  const padding = typeof paddingPx === 'number'
    ? { top: paddingPx, right: paddingPx, bottom: paddingPx, left: paddingPx }
    : paddingPx;
  const bounds = objects.reduce((result, object) => ({
    minX: Math.min(result.minX, object.x - object.radiusMm),
    maxX: Math.max(result.maxX, object.x + object.radiusMm),
    minY: Math.min(result.minY, object.y - object.radiusMm),
    maxY: Math.max(result.maxY, object.y + object.radiusMm),
  }), {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  });
  const widthMm = Math.max(bounds.maxX - bounds.minX, 1e-9);
  const heightMm = Math.max(bounds.maxY - bounds.minY, 1e-9);
  const innerWidth = Math.max(viewport.width - padding.left - padding.right, 1);
  const innerHeight = Math.max(viewport.height - padding.top - padding.bottom, 1);
  const zoom = Math.min(
    MAX_ZOOM,
    Math.max(MIN_ZOOM, Math.min(innerWidth / widthMm, innerHeight / heightMm)),
  );
  return {
    centerX: (bounds.minX + bounds.maxX) / 2 + (padding.right - padding.left) / (2 * zoom),
    centerY: (bounds.minY + bounds.maxY) / 2 + (padding.top - padding.bottom) / (2 * zoom),
    zoom,
  };
}
