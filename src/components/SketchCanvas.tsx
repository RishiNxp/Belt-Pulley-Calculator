import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { pitchDiameter } from '../geometry';
import type {
  ArcSegment,
  BeltGeometryResult,
  LineSegment,
  Point,
  Sketch,
  SketchDimension,
  SketchTool,
} from '../model';
import { findBeltSpan } from '../tensioner';
import {
  fitViewportToObjects,
  panView,
  screenToWorld,
  worldToScreen,
  zoomViewAt,
} from '../viewport';
import type { Camera, ViewportSize } from '../viewport';

type DimensionKind = 'horizontal' | 'vertical' | 'aligned';
type DragState = { kind: 'drag'; id: string; startScreen: Point; offset: Point; started: boolean } | { kind: 'pan' } | null;
type DimensionPlacement = { kind: DimensionKind; fromId: string; toId: string };

type SketchCanvasProps = {
  sketch: Sketch;
  geometry: BeltGeometryResult;
  selectedId: string | null;
  tool: SketchTool;
  fitRequest: number;
  notice: string | null;
  onNotice: (notice: string | null) => void;
  onViewChange: (view: Camera) => void;
  onSelect: (id: string | null) => void;
  onAddPulleyAt: (point: Point, span?: LineSegment) => void;
  onAddIdlerOnSegment: (span: LineSegment, point: Point) => void;
  onDeleteObject: (id: string) => void;
  onMoveObject: (id: string, point: Point) => void;
  onBeginDrag: (id: string) => void;
  onEndDrag: () => void;
  onRouteObject: (id: string) => void;
  onPlaceDimension: (kind: DimensionKind, firstId: string, secondId: string, offsetMm: number) => void;
  onAddConstraint: (kind: 'horizontal' | 'vertical', firstId: string, secondId: string) => void;
  onCommitDimension: (id: string, valueMm: number) => void;
};

const NUMBER_FORMAT = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatMm(value: number): string {
  return NUMBER_FORMAT.format(value);
}

function objectPoint(sketch: Sketch, id: string): Point | undefined {
  const pulley = sketch.pulleys.find((item) => item.id === id);
  if (pulley) return pulley;
  const idler = sketch.idlers.find((item) => item.id === id);
  return idler;
}

function gridSpacing(zoom: number): number {
  const target = 36 / Math.max(zoom, 0.01);
  const exponent = 10 ** Math.floor(Math.log10(target));
  const normalized = target / exponent;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return multiplier * exponent;
}

function makeGridPath(camera: Camera, size: ViewportSize, step: number): string {
  const left = camera.centerX - size.width / (2 * camera.zoom);
  const right = camera.centerX + size.width / (2 * camera.zoom);
  const bottom = camera.centerY - size.height / (2 * camera.zoom);
  const top = camera.centerY + size.height / (2 * camera.zoom);
  const commands: string[] = [];
  const startX = Math.floor(left / step) * step;
  const startY = Math.floor(bottom / step) * step;
  const maxLines = 320;

  for (let x = startX, count = 0; x <= right && count < maxLines; x += step, count += 1) {
    const screen = worldToScreen({ x, y: 0 }, camera, size);
    commands.push(`M ${screen.x} 0 V ${size.height}`);
  }
  for (let y = startY, count = 0; y <= top && count < maxLines; y += step, count += 1) {
    const screen = worldToScreen({ x: 0, y }, camera, size);
    commands.push(`M 0 ${screen.y} H ${size.width}`);
  }
  return commands.join(' ');
}

export function dimensionGeometry(sketch: Sketch, dimension: Sketch['dimensions'][number]): {
  first: Point;
  second: Point;
  firstExtension: Point;
  secondExtension: Point;
} | null {
  const fromObject = objectPoint(sketch, dimension.fromId);
  const to = dimension.toId ? objectPoint(sketch, dimension.toId) : undefined;
  if (!fromObject || (dimension.toId && !to)) return null;
  const from = to ? fromObject : { x: 0, y: 0 };
  const target = to ?? fromObject;
  const offset = dimension.offsetMm;

  if (dimension.kind === 'horizontal') {
    const y = from.y + offset;
    return {
      first: { x: from.x, y },
      second: { x: target.x, y },
      firstExtension: from,
      secondExtension: target,
    };
  }
  if (dimension.kind === 'vertical') {
    const x = from.x + offset;
    return {
      first: { x, y: from.y },
      second: { x, y: target.y },
      firstExtension: from,
      secondExtension: target,
    };
  }

  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const normal = { x: -dy / length, y: dx / length };
  const first = { x: from.x + normal.x * offset, y: from.y + normal.y * offset };
  const second = { x: target.x + normal.x * offset, y: target.y + normal.y * offset };
  return {
    first,
    second,
    firstExtension: from,
    secondExtension: target,
  };
}

function dimensionOffset(kind: DimensionKind, from: Point, to: Point, cursor: Point): number {
  if (kind === 'horizontal') return cursor.y - from.y;
  if (kind === 'vertical') return cursor.x - from.x;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return (cursor.x - from.x) * (-dy / length) + (cursor.y - from.y) * (dx / length);
}

function arcSvgPath(segment: ArcSegment, camera: Camera, size: ViewportSize): string {
  const start = worldToScreen({
    x: segment.center.x + segment.radiusMm * Math.cos(segment.startAngle),
    y: segment.center.y + segment.radiusMm * Math.sin(segment.startAngle),
  }, camera, size);
  const end = worldToScreen({
    x: segment.center.x + segment.radiusMm * Math.cos(segment.endAngle),
    y: segment.center.y + segment.radiusMm * Math.sin(segment.endAngle),
  }, camera, size);
  const radius = segment.radiusMm * camera.zoom;
  const sweep = segment.endAngle - segment.startAngle;
  const largeArc = Math.abs(sweep) > Math.PI ? 1 : 0;
  const sweepFlag = sweep < 0 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} ${sweepFlag} ${end.x} ${end.y}`;
}

function eventPoint(event: ReactPointerEvent<SVGElement>, svg: SVGSVGElement): Point {
  const bounds = svg.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

export default function SketchCanvas(props: SketchCanvasProps) {
  const {
    sketch,
    geometry,
    selectedId,
    tool,
    fitRequest,
    notice,
    onNotice,
    onViewChange,
    onSelect,
    onAddPulleyAt,
    onAddIdlerOnSegment,
    onDeleteObject,
    onMoveObject,
    onBeginDrag,
    onEndDrag,
    onRouteObject,
    onPlaceDimension,
    onAddConstraint,
    onCommitDimension,
  } = props;
  const frameRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const coordinateRef = useRef<HTMLSpanElement>(null);
  const dragRef = useRef<DragState>(null);
  const lastScreenPoint = useRef<Point | null>(null);
  const spaceDown = useRef(false);
  const lastFitRequest = useRef(fitRequest);
  const cameraRef = useRef(sketch.view);
  cameraRef.current = sketch.view;
  const [size, setSize] = useState<ViewportSize>({ width: 0, height: 0 });
  const [pairStart, setPairStart] = useState<string | null>(null);
  const [placement, setPlacement] = useState<DimensionPlacement | null>(null);
  const [placementPoint, setPlacementPoint] = useState<Point | null>(null);
  const [hoverCenterId, setHoverCenterId] = useState<string | null>(null);
  const [editingDimensionId, setEditingDimensionId] = useState<string | null>(null);
  const [dimensionDraft, setDimensionDraft] = useState('');

  useEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    const resize = () => {
      const bounds = element.getBoundingClientRect();
      setSize({ width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (fitRequest === lastFitRequest.current || size.width === 0 || size.height === 0) return;
    lastFitRequest.current = fitRequest;
    const objects = [
      ...sketch.pulleys.map((pulley) => ({ ...pulley, radiusMm: pitchDiameter(pulley.profile, pulley.toothCount) / 2 })),
      ...sketch.idlers.map((idler) => ({ ...idler, radiusMm: idler.diameterMm / 2 })),
      ...sketch.dimensions.flatMap(dimension => {
        const layout = dimensionGeometry(sketch, dimension);
        return layout ? [layout.first, layout.second].map(point => ({ ...point, radiusMm: 0 })) : [];
      }),
    ];
    const labelWidths = [
      ...sketch.pulleys.map((pulley) => Math.max(
        `${pulley.id}${pulley.isOrigin ? ' · ORIGIN' : ''}`.length * 6,
        `${pulley.toothCount}T · Ø ${formatMm(pitchDiameter(pulley.profile, pulley.toothCount))} mm`.length * 5.4,
      )),
      ...sketch.idlers.map((idler) => Math.max(
        `${idler.label} · IDLER`.length * 6,
        `Ø ${formatMm(idler.diameterMm)} mm · smooth`.length * 5.4,
      )),
    ];
    const rightPadding = Math.max(112, Math.ceil(Math.max(...labelWidths, 0)) + 24);
    const view = fitViewportToObjects(objects, size, { top: 56, right: rightPadding, bottom: 56, left: 56 });
    cameraRef.current = view;
    onViewChange(view);
  }, [fitRequest, onViewChange, size, sketch.pulleys, sketch.idlers, sketch.dimensions]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && target.isContentEditable)) return;
      if (event.code === 'Space') {
        spaceDown.current = true;
        event.preventDefault();
      }
      if (event.key === 'Escape') {
        setPairStart(null);
        setPlacement(null);
        setEditingDimensionId(null);
        dragRef.current = null;
        lastScreenPoint.current = null;
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') spaceDown.current = false;
    };
    const onBlur = () => {
      spaceDown.current = false;
      if (dragRef.current?.kind === 'drag' && dragRef.current.started) onEndDrag();
      dragRef.current = null;
      lastScreenPoint.current = null;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  useEffect(() => {
    setPairStart(null);
    setPlacement(null);
    setPlacementPoint(null);
    setEditingDimensionId(null);
  }, [tool]);

  useEffect(() => {
    if (pairStart && !objectPoint(sketch, pairStart)) setPairStart(null);
    if (placement && (!objectPoint(sketch, placement.fromId) || !objectPoint(sketch, placement.toId))) setPlacement(null);
    if (editingDimensionId && !sketch.dimensions.some(dimension => dimension.id === editingDimensionId)) setEditingDimensionId(null);
  }, [sketch, pairStart, placement, editingDimensionId]);

  const grid = useMemo(() => {
    if (!size.width || !size.height) return { minor: '', major: '' };
    const step = gridSpacing(cameraRef.current.zoom);
    return {
      minor: makeGridPath(cameraRef.current, size, step),
      major: makeGridPath(cameraRef.current, size, step * 5),
    };
  }, [size, sketch.view.centerX, sketch.view.centerY, sketch.view.zoom]);

  const changeCamera = (camera: Camera) => {
    cameraRef.current = camera;
    onViewChange(camera);
  };

  const worldAt = (screen: Point) => screenToWorld(screen, cameraRef.current, size);

  const nearestCenterAt = (screen: Point): { id: string; point: Point } | null => {
    let nearest: { id: string; point: Point; distance: number } | null = null;
    for (const object of [...sketch.pulleys, ...sketch.idlers]) {
      const center = worldToScreen(object, cameraRef.current, size);
      const distance = Math.hypot(center.x - screen.x, center.y - screen.y);
      if (distance <= 12 && (!nearest || distance < nearest.distance)) nearest = { id: object.id, point: object, distance };
    }
    return nearest;
  };

  const snappedWorldAt = (screen: Point): Point => nearestCenterAt(screen)?.point ?? worldAt(screen);

  const commitPlacement = (point: Point) => {
    if (!placement) return;
    const from = objectPoint(sketch, placement.fromId);
    const to = objectPoint(sketch, placement.toId);
    if (from && to) onPlaceDimension(placement.kind, placement.fromId, placement.toId, dimensionOffset(placement.kind, from, to, point));
    setPlacement(null);
    setPlacementPoint(null);
  };

  const addOrSelectRouteObject = (id: string, screen: Point) => {
    if (tool === 'route') {
      onRouteObject(id);
      return;
    }
    if (tool === 'delete') {
      onDeleteObject(id);
      return;
    }
    if (tool.startsWith('dimension-') || tool.startsWith('constraint-')) {
      if (!pairStart) {
        setPairStart(id);
        onSelect(id);
        return;
      }
      if (pairStart === id) return;
      if (tool.startsWith('dimension-')) {
        setPlacement({ kind: tool.slice('dimension-'.length) as DimensionKind, fromId: pairStart, toId: id });
        setPlacementPoint(snappedWorldAt(screen));
      } else {
        onAddConstraint(tool.slice('constraint-'.length) as 'horizontal' | 'vertical', pairStart, id);
      }
      setPairStart(null);
      onSelect(id);
    }
  };

  const onObjectPointerDown = (event: ReactPointerEvent<SVGElement>, id: string) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    if (placement) {
      commitPlacement(objectPoint(sketch, id) ?? worldAt(eventPoint(event, svgRef.current!)));
      return;
    }
    if (tool !== 'select') {
      addOrSelectRouteObject(id, eventPoint(event, svgRef.current!));
      return;
    }
    onSelect(id);
    const object = sketch.pulleys.find((item) => item.id === id);
    if (object?.isOrigin) return;
    const screen = eventPoint(event, svgRef.current!);
    const point = objectPoint(sketch, id)!;
    const pointer = worldAt(screen);
    dragRef.current = { kind: 'drag', id, startScreen: screen, offset: { x: point.x - pointer.x, y: point.y - pointer.y }, started: false };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const onBackgroundPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const screen = eventPoint(event, svgRef.current!);
    const world = worldAt(screen);
    if (placement) {
      commitPlacement(snappedWorldAt(screen));
      return;
    }
    if (tool === 'add-pulley') {
      onAddPulleyAt(world);
      return;
    }
    if (tool === 'select') onSelect(null);
  };

  // The active tool resolves hits before lower SVG layers can consume the click.
  const onPointerDownCapture = (event: ReactPointerEvent<SVGSVGElement>) => {
    const screen = eventPoint(event, svgRef.current!);
    if (event.button === 1 || (event.button === 0 && (spaceDown.current || tool === 'pan'))) {
      event.stopPropagation();
      event.preventDefault();
      dragRef.current = { kind: 'pan' };
      lastScreenPoint.current = screen;
      svgRef.current?.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    if (tool === 'add-idler') {
      event.stopPropagation();
      const span = findBeltSpan(geometry.segments, screen, cameraRef.current, size);
      if (span) onAddIdlerOnSegment(span, worldAt(screen));
      else onNotice('Click a straight belt span to add a tensioner.');
      return;
    }
    if (placement) {
      event.stopPropagation();
      commitPlacement(snappedWorldAt(screen));
      return;
    }
    if (tool === 'add-pulley') {
      event.stopPropagation();
      const span = findBeltSpan(geometry.segments, screen, cameraRef.current, size);
      onAddPulleyAt(worldAt(screen), span ?? undefined);
      return;
    }
    if (tool.startsWith('dimension-') || tool.startsWith('constraint-')) {
      const target = event.target;
      if (target instanceof Element && target.closest('.dimension')) return;
      const center = nearestCenterAt(screen);
      if (center) { event.stopPropagation(); addOrSelectRouteObject(center.id, screen); }
    }
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const screen = eventPoint(event, svgRef.current!);
    const world = worldAt(screen);
    const nearest = nearestCenterAt(screen);
    setHoverCenterId((current) => current === nearest?.id ? current : nearest?.id ?? null);
    if (placement) setPlacementPoint(nearest?.point ?? world);
    if (coordinateRef.current) {
      const displayed = nearest?.point ?? world;
      coordinateRef.current.textContent = `X ${formatMm(displayed.x)}   Y ${formatMm(displayed.y)} mm`;
    }
    const drag = dragRef.current;
    if (drag?.kind === 'pan' && lastScreenPoint.current) {
      const delta = { x: screen.x - lastScreenPoint.current.x, y: screen.y - lastScreenPoint.current.y };
      changeCamera(panView(cameraRef.current, delta));
      lastScreenPoint.current = screen;
    } else if (drag?.kind === 'drag') {
      if (!drag.started && Math.hypot(screen.x - drag.startScreen.x, screen.y - drag.startScreen.y) < 3) return;
      if (!drag.started) { drag.started = true; onBeginDrag(drag.id); }
      onMoveObject(drag.id, { x: world.x + drag.offset.x, y: world.y + drag.offset.y });
    }
  };

  const finishPointer = () => {
    if (dragRef.current?.kind === 'drag' && dragRef.current.started) onEndDrag();
    dragRef.current = null;
    lastScreenPoint.current = null;
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (dragRef.current) return;
      const bounds = svg.getBoundingClientRect();
      const screen = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      const camera = zoomViewAt(cameraRef.current, size, screen, Math.exp(-event.deltaY * 0.001));
      cameraRef.current = camera;
      onViewChange(camera);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [size, onViewChange]);

  const visibleObjects = [
    ...sketch.pulleys.map((pulley) => ({
      ...pulley,
      kind: 'pulley' as const,
      radiusMm: pitchDiameter(pulley.profile, pulley.toothCount) / 2,
    })),
    ...sketch.idlers.map((idler) => ({ ...idler, kind: 'idler' as const, radiusMm: idler.diameterMm / 2 })),
  ];
  const originScreen = worldToScreen({ x: 0, y: 0 }, cameraRef.current, size);
  const screenObjects = visibleObjects.map((object) => ({
    ...object,
    center: worldToScreen(object, cameraRef.current, size),
    radius: object.radiusMm * cameraRef.current.zoom,
  }));

  const renderDimension = (dimension: Sketch['dimensions'][number], preview = false) => {
    const layout = dimensionGeometry(sketch, dimension);
    if (!layout) return null;
    const first = worldToScreen(layout.first, cameraRef.current, size);
    const second = worldToScreen(layout.second, cameraRef.current, size);
    const extensionA = worldToScreen(layout.firstExtension, cameraRef.current, size);
    const extensionB = worldToScreen(layout.secondExtension, cameraRef.current, size);
    const mid = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    let labelAngle = Math.atan2(second.y - first.y, second.x - first.x) * 180 / Math.PI;
    if (labelAngle > 90) labelAngle -= 180;
    if (labelAngle < -90) labelAngle += 180;
    const selected = selectedId === dimension.id;
    const label = `${formatMm(dimension.valueMm)} mm`;
    const labelWidth = label.length * 7.1 + 12;
    const editing = !preview && editingDimensionId === dimension.id;
    return <g
      key={preview ? 'dimension-preview' : dimension.id}
      className={`dimension${selected ? ' selected' : ''}${preview ? ' dimension-preview' : ''}`}
      data-dimension-id={preview ? undefined : dimension.id}
      onPointerDown={(event) => {
        if (preview || event.button !== 0) return;
        event.stopPropagation();
        if (tool === 'delete') onDeleteObject(dimension.id);
        else onSelect(dimension.id);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (preview) return;
        onSelect(dimension.id);
        setDimensionDraft(String(dimension.valueMm));
        setEditingDimensionId(dimension.id);
      }}
      role={preview ? undefined : 'button'}
      tabIndex={preview ? undefined : 0}
      aria-pressed={preview ? undefined : selected}
      aria-label={preview ? undefined : `${dimension.kind} dimension ${label}`}
      pointerEvents={preview ? 'none' : undefined}
    >
      <line x1={extensionA.x} y1={extensionA.y} x2={first.x} y2={first.y} className="dimension-extension" />
      <line x1={extensionB.x} y1={extensionB.y} x2={second.x} y2={second.y} className="dimension-extension" />
      <line x1={first.x} y1={first.y} x2={second.x} y2={second.y} className="dimension-hit-area" />
      <line x1={first.x} y1={first.y} x2={second.x} y2={second.y} className="dimension-line" markerStart="url(#dimension-arrow)" markerEnd="url(#dimension-arrow)" />
      {editing ? <foreignObject x={mid.x - 48} y={mid.y - 13} width="96" height="26" className="dimension-editor-foreign">
        <input
          className="dimension-inline-input"
          type="text"
          inputMode="decimal"
          autoFocus
          value={dimensionDraft}
          onChange={(event) => setDimensionDraft(event.target.value)}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onBlur={() => setEditingDimensionId(null)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') { setEditingDimensionId(null); onSelect(null); }
            if (event.key === 'Enter') {
              const value = dimensionDraft.trim() ? Number(dimensionDraft) : Number.NaN;
              if (Number.isFinite(value) && (dimension.kind !== 'aligned' || value >= 0)) onCommitDimension(dimension.id, value);
              setEditingDimensionId(null);
            }
          }}
          aria-label="Dimension value in millimeters"
        />
      </foreignObject> : <g transform={`translate(${mid.x} ${mid.y}) rotate(${labelAngle})`} className="dimension-value">
        <rect x={-labelWidth / 2} y="-12" width={labelWidth} height="20" rx="3" />
        <text textAnchor="middle" dominantBaseline="central">{label}</text>
      </g>}
    </g>;
  };

  const onBeltLinePointerDown = (event: ReactPointerEvent<SVGGElement>) => {
    if (placement) return;
    if (tool !== 'select' && tool !== 'delete') return;
    event.stopPropagation();
    if (tool === 'delete') onDeleteObject('BELT');
    else onSelect('BELT');
  };

  let previewDimension: SketchDimension | null = null;
  if (placement && placementPoint) {
    const from = objectPoint(sketch, placement.fromId);
    const to = objectPoint(sketch, placement.toId);
    if (from && to) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      previewDimension = {
        id: 'DIMENSION_PREVIEW',
        fromId: placement.fromId,
        toId: placement.toId,
        kind: placement.kind,
        valueMm: placement.kind === 'horizontal' ? dx : placement.kind === 'vertical' ? dy : Math.hypot(dx, dy),
        offsetMm: dimensionOffset(placement.kind, from, to, placementPoint),
      };
    }
  }

  return (
    <div className="sketch-frame" ref={frameRef}>
      <svg
        aria-label="Belt pulley sketch workspace"
        className={`sketch-svg sketch-tool-${tool}`}
        ref={svgRef}
        width={size.width}
        height={size.height}
        viewBox={`0 0 ${size.width} ${size.height}`}
        tabIndex={0}
        onPointerDownCapture={onPointerDownCapture}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHoverCenterId(null)}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onLostPointerCapture={finishPointer}
        onContextMenu={(event) => event.preventDefault()}
        onDoubleClick={() => setPairStart(null)}
      >
        <defs>
          <marker id="dimension-arrow" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 8 4 L 0 8 z" fill="context-stroke" />
          </marker>
          <marker id="axis-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 8 4 L 0 8" fill="none" stroke="context-stroke" />
          </marker>
        </defs>
        <rect x="0" y="0" width={size.width} height={size.height} fill="#0b0c0d" />
        <g className="sketch-grid" pointerEvents="none">
          <path d={grid.minor} className="grid-minor" />
          <path d={grid.major} className="grid-major" />
        </g>
        {originScreen.x >= 0 && originScreen.x <= size.width && (
          <g pointerEvents="none">
            <line x1={originScreen.x} x2={originScreen.x} y1={17} y2={size.height - 46} className="axis-line axis-y" markerStart="url(#axis-arrow)" markerEnd="url(#axis-arrow)" />
            <text x={originScreen.x + 8} y={18} className="axis-label">+Y</text>
            <text x={originScreen.x + 8} y={size.height - 43} className="axis-label">−Y</text>
          </g>
        )}
        {originScreen.y >= 0 && originScreen.y <= size.height && (
          <g pointerEvents="none">
            <line x1={17} x2={size.width - 17} y1={originScreen.y} y2={originScreen.y} className="axis-line axis-x" markerStart="url(#axis-arrow)" markerEnd="url(#axis-arrow)" />
            <text x={18} y={originScreen.y - 8} className="axis-label">−X</text>
            <text x={size.width - 19} y={originScreen.y - 8} className="axis-label" textAnchor="end">+X</text>
          </g>
        )}
        <circle cx={originScreen.x} cy={originScreen.y} r="3.5" className="origin-dot" pointerEvents="none" />
        <text x={originScreen.x + 9} y={originScreen.y - 8} className="origin-label" pointerEvents="none">0, 0</text>

        {geometry.valid && geometry.segments.map((segment, index) => {
          if (segment.kind === 'line') {
            const from = worldToScreen(segment.start, cameraRef.current, size);
            const to = worldToScreen(segment.end, cameraRef.current, size);
            return (
                <g key={`belt-line-${index}`} data-from-id={segment.fromId} data-to-id={segment.toId} className={`belt-segment${selectedId === 'BELT' ? ' selected' : ''}`} onPointerDown={onBeltLinePointerDown}>
                <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="belt-hit-area" />
                <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="belt-line" />
              </g>
            );
          }
          return (
            <g key={`belt-arc-${index}`} className={`belt-segment${selectedId === 'BELT' ? ' selected' : ''}`} onPointerDown={onBeltLinePointerDown}>
              <path d={arcSvgPath(segment, cameraRef.current, size)} className="belt-hit-area" />
              <path d={arcSvgPath(segment, cameraRef.current, size)} className="belt-line" />
            </g>
          );
        })}

        {screenObjects.map((object) => {
          const { center, radius } = object;
          const nearby = screenObjects
            .filter((other) => other.id !== object.id
              && Math.abs(other.center.x - center.x) < 48
              && Math.abs(other.center.y - center.y) < 44)
            .concat(object)
            .sort((first, second) => first.center.y - second.center.y);
          const stackIndex = nearby.length > 1
            ? nearby.findIndex((other) => other.id === object.id)
            : -1;
          const labelsAbove = stackIndex >= 0 && stackIndex % 2 === 0;
          const labelY = stackIndex < 0
            ? center.y - 5
            : labelsAbove ? center.y - radius - 16 : center.y + radius + 14;
          const sublabelY = stackIndex < 0
            ? center.y + 11
            : labelsAbove ? labelY + 12 : labelY + 13;
          const selected = selectedId === object.id;
          const pending = pairStart === object.id;
          const centerHover = hoverCenterId === object.id;
          const ring = object.kind === 'pulley' ? 'pulley' : 'idler';
          const title = object.kind === 'pulley'
            ? `${object.label} · ${object.toothCount}T · ${object.profile} · Ø ${formatMm(object.radiusMm * 2)} mm`
            : `${object.label} · smooth back idler · Ø ${formatMm(object.diameterMm)} mm`;
          const toothTickCount = object.kind === 'pulley' ? Math.min(36, Math.max(12, Math.round(object.toothCount))) : 0;
          return (
            <g
              key={object.id}
              className={`sketch-object ${ring}${selected ? ' selected' : ''}${pending ? ' pair-pending' : ''}${centerHover ? ' center-hover' : ''}`}
              data-object-id={object.id}
              onPointerDown={(event) => onObjectPointerDown(event, object.id)}
              role="button"
              aria-label={title}
            >
              <title>{title}</title>
              <circle cx={center.x} cy={center.y} r={Math.max(radius, 4)} className="object-body" />
              <circle cx={center.x} cy={center.y} r={Math.max(radius * 0.58, 3)} className="object-inner" />
              {object.kind === 'pulley' && Array.from({ length: toothTickCount }, (_, index) => {
                const angle = (index / toothTickCount) * Math.PI * 2;
                const outer = Math.max(radius - 2, 5);
                const inner = Math.max(radius - 5, 2);
                return (
                  <line
                    key={`${object.id}-tooth-${index}`}
                    x1={center.x + Math.cos(angle) * inner}
                    y1={center.y + Math.sin(angle) * inner}
                    x2={center.x + Math.cos(angle) * outer}
                    y2={center.y + Math.sin(angle) * outer}
                    className="pulley-tooth-tick"
                  />
                );
              })}
              <circle cx={center.x} cy={center.y} r={Math.max(radius, 14)} className="object-hit-area" />
              {centerHover && <circle cx={center.x} cy={center.y} r="7" className="object-center-snap-ring" pointerEvents="none" />}
              <circle cx={center.x} cy={center.y} r="2.5" className="object-center" />
              {object.kind === 'idler' && <text x={center.x} y={center.y + 3} textAnchor="middle" className="idler-back-label">BACK</text>}
              <text x={center.x + Math.max(radius, 7) + 8} y={labelY} className="object-label">
                {object.kind === 'pulley'
                  ? `${object.id}${object.isOrigin ? ' · ORIGIN' : ''}`
                  : `${object.label} · IDLER`}
              </text>
              <text x={center.x + Math.max(radius, 7) + 8} y={sublabelY} className="object-sublabel">
                {object.kind === 'pulley'
                  ? `${object.toothCount}T · Ø ${formatMm(object.radiusMm * 2)} mm`
                  : `Ø ${formatMm(object.diameterMm)} mm · smooth`}
              </text>
            </g>
          );
        })}
        {sketch.constraints.map((constraint) => {
          const first = objectPoint(sketch, constraint.firstId);
          const second = objectPoint(sketch, constraint.secondId);
          if (!first || !second) return null;
          const at = worldToScreen({ x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }, cameraRef.current, size);
          return <g key={constraint.id} data-constraint-id={constraint.id} className={`constraint${selectedId === constraint.id ? ' selected' : ''}`}
            role="button" aria-label={`${constraint.kind} constraint ${constraint.firstId} to ${constraint.secondId}`}
            onPointerDown={event => {
              if (event.button !== 0 || (tool !== 'select' && tool !== 'delete')) return;
              event.stopPropagation();
              if (tool === 'delete') onDeleteObject(constraint.id); else onSelect(constraint.id);
            }}>
            <rect x={at.x} y={at.y - 22} width="24" height="22" className="constraint-hit-area" />
            <text x={at.x + 7} y={at.y - 7} className="constraint-glyph">{constraint.kind === 'horizontal' ? 'H' : 'V'}</text>
          </g>;
        })}
        {sketch.dimensions.map((dimension) => renderDimension(dimension))}
        {previewDimension && renderDimension(previewDimension, true)}
      </svg>
      <div className="canvas-status">
        <span className="coordinate-readout" ref={coordinateRef}>X 0.00   Y 0.00 mm</span>
        {notice && <span className="interaction-notice" role="status">{notice}</span>}
      </div>
    </div>
  );
}
