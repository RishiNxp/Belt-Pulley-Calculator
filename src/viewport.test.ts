import { describe, expect, it } from 'vitest';
import { fitViewportToObjects, panView, screenToWorld, worldToScreen, zoomViewAt } from './viewport';

describe('sketch viewport', () => {
  it('viewportRoundTripsWorldCoordinates', () => {
    const camera = { centerX: 13.4, centerY: -3, zoom: 2.75 };
    const viewport = { width: 1200, height: 780 };
    const point = { x: 97.5, y: 51.1 };
    const roundTrip = screenToWorld(worldToScreen(point, camera, viewport), camera, viewport);
    expect(Math.abs(roundTrip.x - point.x)).toBeLessThan(1e-9);
    expect(Math.abs(roundTrip.y - point.y)).toBeLessThan(1e-9);
  });

  it('fitIncludesAllObjectBounds', () => {
    const viewport = { width: 900, height: 600 };
    const padding = 48;
    const objects = [
      { x: -30, y: 40, radiusMm: 12 },
      { x: 125, y: -10, radiusMm: 20 },
    ];
    const camera = fitViewportToObjects(objects, viewport, padding);
    for (const object of objects) {
      const center = worldToScreen(object, camera, viewport);
      const radius = object.radiusMm * camera.zoom;
      expect(center.x - radius).toBeGreaterThanOrEqual(padding - 1e-9);
      expect(center.x + radius).toBeLessThanOrEqual(viewport.width - padding + 1e-9);
      expect(center.y - radius).toBeGreaterThanOrEqual(padding - 1e-9);
      expect(center.y + radius).toBeLessThanOrEqual(viewport.height - padding + 1e-9);
    }
  });

  it('fitReservesAnAsymmetricLabelGutter', () => {
    const viewport = { width: 900, height: 600 };
    const padding = { top: 48, right: 150, bottom: 48, left: 48 };
    const objects = [
      { x: -30, y: 40, radiusMm: 12 },
      { x: 125, y: -10, radiusMm: 20 },
    ];
    const camera = fitViewportToObjects(objects, viewport, padding);
    const rightmost = objects.reduce((right, object) => Math.max(right, object.x + object.radiusMm), Number.NEGATIVE_INFINITY);
    const screenRight = worldToScreen({ x: rightmost, y: 0 }, camera, viewport).x;
    expect(screenRight).toBeLessThanOrEqual(viewport.width - padding.right + 1e-9);
    expect(camera.centerX).not.toBe((objects[0]!.x + objects[1]!.x) / 2);
  });

  it('zoomKeepsTheWorldPointUnderThePointer', () => {
    const camera = { centerX: 0, centerY: 0, zoom: 1 };
    const viewport = { width: 900, height: 600 };
    const pointer = { x: 300, y: 250 };
    const before = screenToWorld(pointer, camera, viewport);
    const afterCamera = zoomViewAt(camera, viewport, pointer, 2);
    const after = screenToWorld(pointer, afterCamera, viewport);
    expect(after.x).toBeCloseTo(before.x, 10);
    expect(after.y).toBeCloseTo(before.y, 10);
  });

  it('renders positive coordinates right and up, and negative coordinates left and down', () => {
    const camera = { centerX: 0, centerY: 0, zoom: 2 };
    const viewport = { width: 900, height: 600 };
    expect(worldToScreen({ x: 100, y: 50 }, camera, viewport)).toEqual({ x: 650, y: 200 });
    expect(worldToScreen({ x: -100, y: -50 }, camera, viewport)).toEqual({ x: 250, y: 400 });
    const panned = panView(camera, { x: 40, y: -20 });
    expect(worldToScreen({ x: 100, y: 50 }, panned, viewport)).toEqual({ x: 690, y: 180 });
    expect(screenToWorld({ x: 690, y: 180 }, panned, viewport)).toEqual({ x: 100, y: 50 });
  });
});
