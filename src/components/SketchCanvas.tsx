import { CatalogField } from './OrderPanel';
import { NumberField } from './PropertiesPanel';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { beltWinding, calculateBeltGeometry, pitchDiameter } from '../geometry';
import type {
  ArcSegment,
  BeltGeometryResult,
  LineSegment,
  Point,
  TensionSide,
  Sketch,
  SketchDimension,
  SketchTool,
} from '../model';
import { createTensionerOnSpan, findBeltSpan, removeIdlerFromBeltRoute, tensionSideForApproach } from '../tensioner';
import {
  fitViewportToObjects,
  panView,
  screenToWorld,
  worldToScreen,
  zoomViewAt,
} from '../viewport';
import type { Camera, ViewportSize } from '../viewport';
import { insertRouteMember, snapDraggedGear, type SketchAction } from '../state';
import { hasOtherPulleyOnBeltAxle, sketchForBeltStage } from '../transmission';
import Icon from './Icon';
import type { IconName } from './Icon';

type DimensionKind = 'horizontal' | 'vertical' | 'aligned';
type DragState = { kind: 'drag'; id: string; startScreen: Point; startPoint: Point; offset: Point; started: boolean; lockedBeltId?: string; stackIds?: string[]; startClient?: Point } | { kind: 'pan' } | null;
type DimensionPlacement = { kind: DimensionKind; fromId: string; toId: string };
type PulleyStackChoice = { ids: string[]; position: Point; screen: Point; tool: SketchTool; edit?: boolean };

const GRID_TOOL_GROUPS: Array<{ title: string; tools: Array<{ tool: SketchTool; icon: IconName; label: string }> }> = [
  { title: 'Sketch', tools: [
    { tool: 'select', icon: 'pointer', label: 'Select' },
    { tool: 'pan', icon: 'pan', label: 'Pan' },
    { tool: 'add-pulley', icon: 'pulley', label: 'Add pulley' },
    { tool: 'add-idler', icon: 'tensioner', label: 'Add tensioner' },
    { tool: 'route', icon: 'belt', label: 'Create belt' },
  ] },
  { title: 'Dimensions', tools: [
    { tool: 'dimension-horizontal', icon: 'horizontal', label: 'Horizontal dimension' },
    { tool: 'dimension-vertical', icon: 'vertical', label: 'Vertical dimension' },
    { tool: 'dimension-aligned', icon: 'ruler', label: 'Center distance' },
  ] },
  { title: 'Constraints and editing', tools: [
    { tool: 'constraint-horizontal', icon: 'horizontal', label: 'Horizontal constraint' },
    { tool: 'constraint-vertical', icon: 'vertical', label: 'Vertical constraint' },
    { tool: 'delete', icon: 'trash', label: 'Delete geometry' },
  ] },
];

type SketchCanvasProps = {
  motion: Record<string,number>;
  sketch: Sketch;
  geometry: BeltGeometryResult;
  selectedId: string | null;
  tool: SketchTool;
  fitRequest: number;
  notice: string | null;
  onNotice: (notice: string | null) => void;
  onViewChange: (view: Camera) => void;
  onSelect: (id: string | null) => void;
  onAddPulleyAt: (point: Point, span?: LineSegment, beltId?: string) => void;
  onAddCoaxialPulley: (id: string) => void;
  onAction: (action: SketchAction) => void;
  onToolChange: (tool: SketchTool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onShortcuts: () => void;
  onFit: () => void;
  onReset: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onAddGear: (hostId?: string, point?: Point) => void;
  onAddFreeIdler: (point: Point) => void;
  onAddIdlerOnSegment: (beltId: string, span: LineSegment, point: Point) => void;
  onLatchIdlerOnSpan: (id: string, beltId: string, span: LineSegment, point: Point) => boolean;
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
  if (idler) return idler;
  const gear = sketch.transmission?.gears.find(item => item.id === id);
  return gear ? sketch.transmission?.axles.find(axle => axle.id === gear.axleId) : undefined;
}

function pulleyStack(sketch: Sketch, id: string) {
  const pulley = sketch.pulleys.find(item => item.id === id);
  if (!pulley) return [];
  const axle = sketch.transmission?.axles.find(item => item.componentIds.includes(id));
  const axlePulleys = sketch.pulleys.filter(item => axle?.componentIds.includes(item.id));
  if (axlePulleys.length > 1) return axlePulleys;
  return sketch.pulleys.filter(item => item.x === pulley.x && item.y === pulley.y);
}

function idlerBeltId(sketch: Sketch, idler: Sketch['idlers'][number]): string | null {
  if (idler.beltId !== undefined) return idler.beltId;
  return sketch.transmission?.belts.find(belt => belt.route.includes(idler.id))?.id
    ?? (sketch.route.includes(idler.id) ? sketch.activeBeltId ?? null : null);
}

function idlerIsLocked(sketch: Sketch, idler: Sketch['idlers'][number]): boolean {
  return idler.locked ?? idlerBeltId(sketch, idler) !== null;
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

function eventPoint(event: { clientX: number; clientY: number }, svg: SVGSVGElement): Point {
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
    onAddCoaxialPulley,
    onAction,
    onToolChange,
    onUndo,
    onRedo,
    onShortcuts, onFit,
    onReset,
    canUndo,
    canRedo,
    onAddGear,
    onAddFreeIdler,
    onAddIdlerOnSegment,
    onLatchIdlerOnSpan,
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
  const pulleyMenuRef = useRef<HTMLDivElement>(null);
  const idlerMenuRef = useRef<HTMLDivElement>(null);
  const stackPickerRef = useRef<HTMLDivElement>(null);
  const gridMenuRef = useRef<HTMLDivElement>(null);
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
  const [contextPulleyId, setContextPulleyId] = useState<string | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<Point | null>(null);
  const [contextNameDraft, setContextNameDraft] = useState('');
  const [contextTeethDraft, setContextTeethDraft] = useState('');
  const [contextIdlerId, setContextIdlerId] = useState<string | null>(null);
  const [contextIdlerNameDraft, setContextIdlerNameDraft] = useState('');
  const [contextIdlerDiameterDraft, setContextIdlerDiameterDraft] = useState('');
  const [snapSpan,setSnapSpan] = useState<LineSegment|null>(null);
  const [stackChoice, setStackChoice] = useState<PulleyStackChoice | null>(null);
  const [menuPart, setMenuPart] = useState<string | null>(null);
  const [gridMenuPosition, setGridMenuPosition] = useState<Point | null>(null);

  const contextPulley = sketch.pulleys.find(pulley => pulley.id === contextPulleyId);
  const contextIdler = sketch.idlers.find(idler => idler.id === contextIdlerId);
  const contextIdlerBelt = contextIdler
    ? sketch.transmission?.belts.find(belt => belt.id === contextIdler.beltId || belt.route.includes(contextIdler.id))
    : undefined;

  useEffect(() => {
    if (!contextPulleyId && !contextIdlerId && !stackChoice && !gridMenuPosition) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (contextPulleyId && !pulleyMenuRef.current?.contains(target)) setContextPulleyId(null);
      if (contextIdlerId && !idlerMenuRef.current?.contains(target)) setContextIdlerId(null);
      if (stackChoice && !stackPickerRef.current?.contains(target)) setStackChoice(null);
      if (gridMenuPosition && !gridMenuRef.current?.contains(target)) setGridMenuPosition(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setContextPulleyId(null);
      setContextIdlerId(null);
      setStackChoice(null);
      setGridMenuPosition(null);
      svgRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOutside, true);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [contextPulleyId, contextIdlerId, stackChoice, gridMenuPosition]);

  useLayoutEffect(() => {
    if (!gridMenuPosition) return;
    const frame = frameRef.current?.getBoundingClientRect();
    const menu = gridMenuRef.current?.getBoundingClientRect();
    if (!frame || !menu) return;
    const position = {
      x: Math.max(frame.left + 8, Math.min(gridMenuPosition.x, frame.right - menu.width - 8)),
      y: Math.max(frame.top + 8, Math.min(gridMenuPosition.y, frame.bottom - menu.height - 8)),
    };
    if (Math.abs(position.x - gridMenuPosition.x) > 1 || Math.abs(position.y - gridMenuPosition.y) > 1) setGridMenuPosition(position);
  }, [gridMenuPosition, size]);

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
      ...(sketch.transmission?.gears ?? []).flatMap(gear => {
        const axle = sketch.transmission?.axles.find(item => item.id === gear.axleId);
        return axle ? [{ x: axle.x, y: axle.y, radiusMm: gear.moduleMm * gear.toothCount / 2 }] : [];
      }),
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
      ...(sketch.transmission?.gears ?? []).map(gear => Math.max(`${gear.name} · ${gear.toothCount}T`.length * 6, `Ø ${formatMm(gear.moduleMm * gear.toothCount)} mm · gear`.length * 5.4)),
    ];
    const rightPadding = Math.max(112, Math.ceil(Math.max(...labelWidths, 0)) + 24);
    const view = fitViewportToObjects(objects, size, { top: 56, right: rightPadding, bottom: 56, left: 56 });
    cameraRef.current = view;
    onViewChange(view);
  }, [fitRequest, onViewChange, size, sketch.pulleys, sketch.idlers, sketch.dimensions, sketch.transmission]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && target.isContentEditable)) return;
      if (event.code === 'Space') {
        if (target instanceof HTMLElement
          && target.closest('button, summary, a[href], [role="button"], [role="checkbox"], [role="radio"], [role="switch"]')) return;
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

  const nearestCenterAt = (screen: Point, preferredKind?: 'pulley' | 'idler' | 'gear'): { id: string; point: Point } | null => {
    let nearest: { id: string; point: Point; distance: number } | null = null;
    const objects: Array<{ id: string; point: Point }> = [
      ...(preferredKind === undefined || preferredKind === 'pulley' ? sketch.pulleys.map(item => ({ id: item.id, point: item })) : []),
      ...(preferredKind === undefined || preferredKind === 'idler' ? sketch.idlers.map(item => ({ id: item.id, point: item })) : []),
      ...(preferredKind === undefined || preferredKind === 'gear' ? sketch.transmission?.gears.flatMap(gear => {
        const point = objectPoint(sketch, gear.id);
        return point ? [{ id: gear.id, point }] : [];
      }) ?? [] : []),
    ];
    for (const object of objects) {
      const center = worldToScreen(object.point, cameraRef.current, size);
      const distance = Math.hypot(center.x - screen.x, center.y - screen.y);
      if (distance <= 12 && (!nearest || distance < nearest.distance)) nearest = { id: object.id, point: object.point, distance };
    }
    return nearest;
  };

  const nearestBeltSpanAt = (screen: Point, onlyBeltId?: string, skipIdlerId?: string): { beltId: string; span: LineSegment } | null => {
    let nearest: { beltId: string; span: LineSegment; distance: number } | null = null;
    for (const belt of sketch.transmission?.belts ?? []) {
      if (onlyBeltId && belt.id !== onlyBeltId) continue;
      const stageSketch = sketchForBeltStage(sketch, belt);
      if (skipIdlerId) stageSketch.route = removeIdlerFromBeltRoute(stageSketch, stageSketch.route, skipIdlerId);
      const stageGeometry = belt.id === sketch.activeBeltId && !skipIdlerId
        ? geometry
        : calculateBeltGeometry(stageSketch);
      const idler = sketch.idlers.find(item => item.id === skipIdlerId);
      const pulley=sketch.pulleys.find(p=>p.id===skipIdlerId);
      if(pulley && (pulley.profile!==belt.profile || sketch.transmission?.belts.some(b=>b.route.includes(pulley.id)) || hasOtherPulleyOnBeltAxle(sketch,pulley.id,belt.id))) continue;
      const radius = (idler?.diameterMm ?? (pulley ? pitchDiameter(pulley.profile,pulley.toothCount) : 0)) * cameraRef.current.zoom / 2;
      const span = findBeltSpan(stageGeometry.segments, screen, cameraRef.current, size, radius + 12);
      if (!span) continue;
      if (pulley) {
        const route=insertRouteMember(stageSketch.route,span.fromId,span.toId,pulley.id);
        if (!route || !calculateBeltGeometry({...stageSketch,route,pulleys:stageSketch.pulleys.map(p=>p.id===pulley.id?{...p,...worldAt(screen)}:p)}).valid) continue;
      }
      if (idler && !idlerIsLocked(sketch,idler) && !createTensionerOnSpan(stageSketch,span,worldAt(screen),idler.id,tensionSideForApproach(stageSketch,span,worldAt(screen)),idler.diameterMm)) continue;
      const start = worldToScreen(span.start, cameraRef.current, size);
      const end = worldToScreen(span.end, cameraRef.current, size);
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const t = Math.max(0, Math.min(1, ((screen.x - start.x) * dx + (screen.y - start.y) * dy) / (dx * dx + dy * dy || 1)));
      const distance = Math.hypot(screen.x - (start.x + t * dx), screen.y - (start.y + t * dy));
      if (!nearest || distance < nearest.distance || (distance === nearest.distance && belt.id === sketch.activeBeltId)) {
        nearest = { beltId: belt.id, span, distance };
      }
    }
    return nearest ? { beltId: nearest.beltId, span: nearest.span } : null;
  };

  const snappedWorldAt = (screen: Point): Point => nearestCenterAt(screen)?.point ?? worldAt(screen);

  const kindForObject = (id: string): 'pulley' | 'idler' | 'gear' => sketch.pulleys.some(item => item.id === id)
    ? 'pulley'
    : sketch.idlers.some(item => item.id === id) ? 'idler' : 'gear';

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
    const pointerScreen = eventPoint(event, svgRef.current!);
    const targetId = nearestCenterAt(pointerScreen, kindForObject(id))?.id ?? id;
    if (placement) {
      commitPlacement(objectPoint(sketch, targetId) ?? worldAt(pointerScreen));
      return;
    }
    if (tool !== 'select') {
      const stack = pulleyStack(sketch, targetId);
      const toolNeedsMember = tool === 'route' || tool === 'delete' || tool.startsWith('dimension-') || tool.startsWith('constraint-');
      if (toolNeedsMember && stack.length > 1) {
        onSelect(targetId);
        setStackChoice({ ids: stack.map(pulley => pulley.id), position: { x: event.clientX, y: event.clientY }, screen: pointerScreen, tool });
        return;
      }
      onSelect(targetId);
      addOrSelectRouteObject(targetId, pointerScreen);
      return;
    }
    onSelect(targetId);
    const object = sketch.pulleys.find((item) => item.id === targetId);
    const stack = pulleyStack(sketch, targetId);
    if (object?.isOrigin) {
      if (stack.length > 1) setStackChoice({ ids: stack.map(pulley => pulley.id), position: { x: event.clientX, y: event.clientY }, screen: pointerScreen, tool: 'select' });
      return;
    }
    const point = objectPoint(sketch, targetId)!;
    const idler = sketch.idlers.find(item => item.id === targetId);
    const lockedBeltId = idler && idlerIsLocked(sketch, idler) ? idlerBeltId(sketch, idler) : null;
    const pointer = worldAt(pointerScreen);
    dragRef.current = {
      kind: 'drag', id: targetId, startScreen: pointerScreen, startPoint: point, offset: { x: point.x - pointer.x, y: point.y - pointer.y }, started: false,
      ...(lockedBeltId ? { lockedBeltId } : {}),
      ...(stack.length > 1 ? { stackIds: stack.map(pulley => pulley.id), startClient: { x: event.clientX, y: event.clientY } } : {}),
    };
    // Capture only once the pointer actually drags, preserving native double-click targets.
  };

  const showPulleyContextMenu = (id: string, x: number, y: number) => {
    const pulley = sketch.pulleys.find(item => item.id === id);
    if (!pulley) return;
    onSelect(id);
    setContextPulleyId(id);
    setContextIdlerId(null);
    setContextMenuPosition({ x, y });
    setContextNameDraft(pulley.label);
    setContextTeethDraft(String(pulley.toothCount));
    setStackChoice(null);
    setGridMenuPosition(null);
  };

  const showIdlerContextMenu = (id: string, x: number, y: number) => {
    const idler = sketch.idlers.find(item => item.id === id);
    if (!idler) return;
    onSelect(id);
    setContextIdlerId(id);
    setContextPulleyId(null);
    setContextMenuPosition({ x, y });
    setContextIdlerNameDraft(idler.label);
    setContextIdlerDiameterDraft(String(idler.diameterMm));
    setStackChoice(null);
    setGridMenuPosition(null);
  };

  const chooseStackMember = (id: string) => {
    if (!stackChoice) return;
    onSelect(id);
    if (stackChoice.edit && sketch.transmission?.gears.some(g => g.id === id)) {
      setStackChoice(null); setMenuPart(id); setGridMenuPosition(stackChoice.position); return;
    }
    if (stackChoice.edit) { showPulleyContextMenu(id, stackChoice.position.x, stackChoice.position.y); return; }
    if (stackChoice.tool !== 'select') addOrSelectRouteObject(id, stackChoice.screen);
    setStackChoice(null);
  };

  const onGridContextMenu = (event: ReactMouseEvent<SVGSVGElement>) => {
    event.preventDefault();
    const target = event.target;
    if (target instanceof Element && target.closest('.sketch-object, .dimension, .constraint, .belt-segment')) return;
    setContextPulleyId(null);
    setContextIdlerId(null);
    setStackChoice(null);
    setMenuPart(null);
    setGridMenuPosition({ x: event.clientX, y: event.clientY });
  };

  const onObjectContextMenu = (event: ReactMouseEvent<SVGElement>, id: string) => {
    event.preventDefault();
    event.stopPropagation();
    const screen = eventPoint(event, svgRef.current!);
    const targetId = nearestCenterAt(screen, kindForObject(id))?.id ?? id;
    if (sketch.idlers.some(item => item.id === targetId)) showIdlerContextMenu(targetId, event.clientX, event.clientY);
    else {
      const axle = sketch.transmission?.axles.find(a => a.componentIds.includes(targetId));
      const stack = axle ? axle.componentIds.map(id => ({ id })).reverse() : pulleyStack(sketch, targetId);
      if (stack.length > 1) {
        setContextPulleyId(null);
        setStackChoice({ ids: stack.map(item => item.id), position: { x: event.clientX, y: event.clientY }, screen, tool: 'select', edit: true });
      } else if (kindForObject(targetId) === 'gear') {
        onSelect(targetId); setMenuPart(targetId); setGridMenuPosition({ x: event.clientX, y: event.clientY });
      } else showPulleyContextMenu(targetId, event.clientX, event.clientY);
    }
  };

  const onObjectKeyDown = (event: ReactKeyboardEvent<SVGGElement>, id: string) => {
    if (tool === 'route' && event.key === 'Enter') return;
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const bounds = event.currentTarget.getBoundingClientRect();
      if (sketch.idlers.some(item => item.id === id)) showIdlerContextMenu(id, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      else showPulleyContextMenu(id, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(id);
      const stack = pulleyStack(sketch, id);
      if (stack.length > 1) setStackChoice({ ids: stack.map(pulley => pulley.id), position: { x: event.currentTarget.getBoundingClientRect().right, y: event.currentTarget.getBoundingClientRect().top }, screen: { x: 0, y: 0 }, tool: 'select' });
    }
  };

  const commitContextName = () => {
    if (!contextPulley || contextNameDraft === contextPulley.label) return;
    onAction({ type: 'SET_LABEL', id: contextPulley.id, label: contextNameDraft.trim() || contextPulley.id });
  };

  const commitContextTeeth = () => {
    if (!contextPulley) return;
    const toothCount = Number(contextTeethDraft);
    if (!Number.isInteger(toothCount) || toothCount < 1) {
      setContextTeethDraft(String(contextPulley.toothCount));
      return;
    }
    if (toothCount !== contextPulley.toothCount) {
      onAction({ type: 'UPDATE_PULLEY', id: contextPulley.id, changes: { toothCount } });
    }
  };

  const commitContextIdlerName = () => {
    if (!contextIdler || contextIdlerNameDraft === contextIdler.label) return;
    onAction({ type: 'SET_LABEL', id: contextIdler.id, label: contextIdlerNameDraft.trim() || contextIdler.id });
  };

  const commitContextIdlerDiameter = () => {
    if (!contextIdler) return;
    const diameterMm = Number(contextIdlerDiameterDraft);
    if (!Number.isFinite(diameterMm) || diameterMm <= 0) {
      setContextIdlerDiameterDraft(String(contextIdler.diameterMm));
      return;
    }
    if (diameterMm !== contextIdler.diameterMm) onAction({ type: 'UPDATE_IDLER', id: contextIdler.id, changes: { diameterMm } });
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
    if (event.ctrlKey && event.button === 0) { event.stopPropagation(); return; }
    if (event.button === 1 || (event.button === 0 && (spaceDown.current || tool === 'pan'))) {
      event.stopPropagation();
      event.preventDefault();
      dragRef.current = { kind: 'pan' };
      lastScreenPoint.current = screen;
      svgRef.current?.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    if (tool === 'add-gear') {
      event.stopPropagation();
      const host = event.target instanceof Element ? event.target.closest('.pulley,.gear')?.getAttribute('data-object-id') : null;
      onAddGear(host ?? undefined, worldAt(screen)); onToolChange('select'); return;
    }
    if (tool === 'route') {
      const target = event.target;
      const group = target instanceof Element ? target.closest<SVGGElement>('.sketch-object[data-object-id]') : null;
      const objectId = group?.getAttribute('data-object-id');
      if (!objectId) return;
      event.preventDefault();
      event.stopPropagation();
      const targetId = nearestCenterAt(screen, kindForObject(objectId))?.id ?? objectId;
      const gear = sketch.transmission?.gears.find(item => item.id === targetId);
      const axle = gear && sketch.transmission?.axles.find(item => item.id === gear.axleId);
      const stack = axle ? sketch.pulleys.filter(p => axle.componentIds.includes(p.id)) : pulleyStack(sketch, targetId);
      if (gear && !stack.length) return;
      onSelect(stack[0]?.id ?? targetId);
      if (stack.length > 1 || gear) {
        setStackChoice({ ids: stack.map(pulley => pulley.id), position: { x: event.clientX, y: event.clientY }, screen, tool: 'route' });
      } else {
        onRouteObject(targetId);
      }
      return;
    }
    if (tool === 'add-idler') {
      event.stopPropagation();
      const target = nearestBeltSpanAt(screen);
      if (target) onAddIdlerOnSegment(target.beltId, target.span, worldAt(screen));
      else if (event.target instanceof Element && event.target.closest('.sketch-object')) {
        onNotice('Click open grid to place a free tensioner, or click a belt line to attach it.');
      } else {
        onNotice(null);
        onAddFreeIdler(worldAt(screen));
      }
      return;
    }
    if (placement) {
      event.stopPropagation();
      commitPlacement(snappedWorldAt(screen));
      return;
    }
    if (tool === 'add-pulley') {
      event.stopPropagation();
      const target = nearestBeltSpanAt(screen);
      onAddPulleyAt(worldAt(screen), target?.span, target?.beltId);
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
      if (!drag.started) { drag.started = true; svgRef.current?.setPointerCapture(event.pointerId); onBeginDrag(drag.id); }
      onMoveObject(drag.id, { x: world.x + drag.offset.x, y: world.y + drag.offset.y });
      const freePulley = sketch.pulleys.find(p=>p.id===drag.id) && !sketch.transmission?.belts.some(b=>b.route.includes(drag.id));
      if (freePulley || (!drag.lockedBeltId && sketch.idlers.some(idler => idler.id === drag.id))) {
        const target = nearestBeltSpanAt({ x: screen.x + drag.offset.x * cameraRef.current.zoom, y: screen.y - drag.offset.y * cameraRef.current.zoom }, drag.lockedBeltId, drag.id);
        setSnapSpan(target?.span ?? null);
        if (target) {
          const index = (sketch.transmission?.belts.findIndex(belt => belt.id === target.beltId) ?? -1) + 1;
          onNotice(`Release to attach to Belt ${Math.max(1, index)}.`);
        } else if (notice?.startsWith('Release to attach to Belt ')) onNotice(null);
      }
    }
  };

  const finishPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    setSnapSpan(null);
    if (drag?.kind === 'drag' && drag.started) {
      const idler = sketch.idlers.find(item => item.id === drag.id);
      if (!idler && event.type==='pointerup' && sketch.pulleys.some(p=>p.id===drag.id)) {
        const p = sketch.pulleys.find(p=>p.id===drag.id)!;
        const target = nearestBeltSpanAt(worldToScreen(p,cameraRef.current,size),undefined,p.id);
        if(target) onAction({type:'LATCH_PULLEY',id:p.id,beltId:target.beltId,fromId:target.span.fromId,toId:target.span.toId});
        onNotice(null);
      }
      if (idler && event.type === 'pointerup') {
        const screen = eventPoint(event, svgRef.current!);
        const target = nearestBeltSpanAt({ x: screen.x + drag.offset.x * cameraRef.current.zoom, y: screen.y - drag.offset.y * cameraRef.current.zoom }, drag.lockedBeltId, drag.id);
        const route = sketch.transmission?.belts.find(belt => belt.id === drag.lockedBeltId)?.route;
        const index = route?.indexOf(idler.id) ?? -1;
        const sameSpan = route && index > 0 && target && route[index - 1] === target.span.fromId && route[index + 1] === target.span.toId;
        if (target && !sameSpan) {
          const attached = onLatchIdlerOnSpan(idler.id, target.beltId, target.span, { x: idler.x, y: idler.y });
          if (!attached) {
            if (drag.lockedBeltId) onMoveObject(idler.id, drag.startPoint);
            onNotice('No clearance to attach this tensioner here. Try another belt span or a smaller diameter.');
          }
          else onNotice(null);
        } else if (drag.lockedBeltId) {
          const belt = sketch.transmission?.belts.find(b=>b.id===drag.lockedBeltId);
          if (belt) {
            const solved=calculateBeltGeometry(sketchForBeltStage(sketch,belt));
            const contribution=solved.idlerContributions.find(i=>i.idlerId===idler.id);
            const baseline=sketchForBeltStage(sketch,{...belt,route:removeIdlerFromBeltRoute(sketch,belt.route,idler.id)});
            const span=calculateBeltGeometry(baseline).segments.find((s):s is LineSegment=>s.kind==='line' && s.fromId===route?.[index-1] && s.toId===route?.[index+1]);
            let clear=false;
            if(span){
              const dx=span.end.x-span.start.x,dy=span.end.y-span.start.y;
              const signed=(dx*(idler.y-span.start.y)-dy*(idler.x-span.start.x))/Math.hypot(dx,dy);
              clear=signed*(-beltWinding(baseline))*(idler.tensionSide==='inside'?-1:1)>=idler.diameterMm/2;
            }
            if (clear || !solved.valid || (contribution && contribution.lengthMm<=1e-6)) onAction({type:'UNLATCH_IDLER',id:idler.id});
          }
          onNotice(null);
        } else if (notice?.startsWith('Release to attach to Belt ')) onNotice(null);
      } else if (idler && (event.type === 'pointercancel' || event.type === 'lostpointercapture')) {
        onMoveObject(idler.id, drag.startPoint);
        onNotice(drag.lockedBeltId ? `Still locked to ${drag.lockedBeltId}; right-click to unlock it.` : null);
      }
      onEndDrag();
    }
    else if (event.type === 'pointerup' && drag?.kind === 'drag' && drag.stackIds && drag.startClient) {
      setStackChoice({ ids: drag.stackIds, position: drag.startClient, screen: drag.startScreen, tool: 'select' });
    }
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
      const camera = zoomViewAt(cameraRef.current, size, screen, Math.exp(-Math.max(-120,Math.min(120,event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1))) * (event.ctrlKey ? 0.022 : 0.004)));
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
    ...(sketch.transmission?.gears ?? []).flatMap(gear => {
      const axle = sketch.transmission?.axles.find(item => item.id === gear.axleId);
      return axle ? [{ id: gear.id, label: gear.name, toothCount: gear.toothCount, profile: 'GT2' as const, x: axle.x, y: axle.y, isOrigin: false, diameterMm: gear.moduleMm * gear.toothCount, kind: 'gear' as const, radiusMm: gear.moduleMm * gear.toothCount / 2 }] : [];
    }),
  ];
  const originScreen = worldToScreen({ x: 0, y: 0 }, cameraRef.current, size);
  const drag = dragRef.current;
  const preview = drag?.kind === 'drag' && drag.started ? snapDraggedGear(sketch, drag.id) : sketch;
  const meshPreview = preview !== sketch ? preview.transmission?.meshes.at(-1) : undefined;
  const isStacked = (id: string) => sketch.transmission?.axles.some(axle => axle.componentIds.includes(id) && axle.componentIds.length > 1);
  const screenObjects = visibleObjects.map((object) => ({
    ...object,
    center: worldToScreen(object, cameraRef.current, size),
    radius: object.radiusMm * cameraRef.current.zoom,
  })).sort((a, b) => {
    const depth = (id: string) => sketch.transmission?.axles.find(axle => axle.componentIds.includes(id))?.componentIds.indexOf(id) ?? 0;
    return depth(a.id) - depth(b.id);
  });
  const backgroundStages = (sketch.transmission?.belts ?? []).filter(stage => stage.id !== sketch.activeBeltId && stage.route.length >= 3 && stage.route[0] === stage.route.at(-1)).map(stage => {
    const stageSketch = { ...sketch, route: stage.route, profile: stage.profile, pulleys: sketch.pulleys.map(pulley => ({ ...pulley, profile: stage.profile })) };
    return { id: stage.id, geometry: calculateBeltGeometry(stageSketch) };
  });

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
      onContextMenu={event => {
        if (preview) return;
        event.preventDefault(); event.stopPropagation(); onSelect(dimension.id);
        setMenuPart(dimension.id); setGridMenuPosition({ x: event.clientX, y: event.clientY });
      }}
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
          onFocus={(event) => event.currentTarget.select()}
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

  const placedLabels: { left: number; top: number; right: number; bottom: number }[] = [];
  const labelLayer: React.ReactNode[] = [];
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
        onContextMenu={onGridContextMenu}
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
        <rect x="0" y="0" width={size.width} height={size.height} fill="#0b0c0d" pointerEvents="none" />
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
        {!sketch.pulleys.some((pulley) => pulley.isOrigin) &&
          <text x={originScreen.x + 9} y={originScreen.y - 8} className="origin-label" pointerEvents="none">0, 0</text>}

        {backgroundStages.flatMap(stage => stage.geometry.valid ? stage.geometry.segments.map((segment, index) => {
          const selectStage = (event: ReactPointerEvent<SVGElement>) => {
            if (tool !== "select" || event.button !== 0) return;
            event.stopPropagation();
            onAction({ type: "SET_ACTIVE_BELT", id: stage.id });
            onSelect("BELT");
          };
          if (segment.kind === 'line') {
            const from = worldToScreen(segment.start, cameraRef.current, size);
            const to = worldToScreen(segment.end, cameraRef.current, size);
            return <g key={stage.id + index} onPointerDown={selectStage}>
              {tool === 'select' && <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="belt-hit-area" />}
              <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="belt-line belt-line-background" />
            </g>;
          }
          return <g key={stage.id + index} onPointerDown={selectStage}>
            {tool === 'select' && <path d={arcSvgPath(segment, cameraRef.current, size)} className="belt-hit-area" />}
            <path d={arcSvgPath(segment, cameraRef.current, size)} className="belt-line belt-line-background" />
          </g>;
        }) : [])}
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
            .sort((first, second) => first.center.y - second.center.y || first.id.localeCompare(second.id));
          const clusterIndex = nearby.findIndex((other) => other.id === object.id);
          const clusterCenterY = nearby.reduce((total, item) => total + item.center.y, 0) / nearby.length;
          let labelY = nearby.length > 1
            ? clusterCenterY + (clusterIndex - (nearby.length - 1) / 2) * 34
            : center.y - 5;

          const selected = selectedId === object.id;
          const isDriver = object.kind === 'pulley' && sketch.drive?.driverId === object.id;
          const routeMember = tool === 'route' && sketch.route.includes(object.id);
          const idler = object.kind === 'idler' ? sketch.idlers.find(item => item.id === object.id) : undefined;
          const latched = idler ? idlerIsLocked(sketch, idler) : false;
          const pending = pairStart === object.id;
          const centerHover = hoverCenterId === object.id;
          const ring = object.kind === 'idler' ? 'idler' : object.kind;
          const title = object.kind !== 'idler'
            ? `${isDriver ? 'Driver pulley · ' : ''}${object.label} · ${object.toothCount}T · ${object.profile} · Ø ${formatMm(object.radiusMm * 2)} mm`
            : `${object.label} · ${object.tensionSide ?? 'outside'} tensioner · Ø ${formatMm(object.diameterMm)} mm · ${latched ? 'locked' : 'free'}`;
          const labelSuffix = object.kind === 'idler'
            ? ' · IDLER'
            : object.isOrigin && !object.label.toUpperCase().endsWith('ORIGIN') ? ' · ORIGIN' : '';
          const fullVisibleLabel = `${object.label}${labelSuffix}`;
          const labelOffset = Math.max(7, ...nearby.map(item => item.radius)) + 8;
          const maxLabelWidth = Math.min(340, size.width * 0.42);
          let labelOnLeft = center.x + labelOffset + maxLabelWidth > size.width - 12;
          let labelX = center.x + (labelOnLeft ? -labelOffset : labelOffset);
          const availableLabelWidth = Math.max(56, labelOnLeft ? labelX - 12 : size.width - labelX - 12);
          const maxLabelCharacters = Math.max(8, Math.min(42, Math.floor(Math.min(maxLabelWidth, availableLabelWidth) / 7)));
          const visibleLabel = fullVisibleLabel.length > maxLabelCharacters
            ? `${object.label.slice(0, Math.max(1, maxLabelCharacters - labelSuffix.length - 1)).trimEnd()}…${labelSuffix}`
            : fullVisibleLabel;
          const width = Math.max(visibleLabel.length * 8, object.kind === 'idler' ? 170 : 110);
          const preferredSide = labelOnLeft;
          search: for (let row = 0; row <= Math.ceil(size.height / 14); row++) {
            const y = labelY + (row % 2 ? -1 : 1) * Math.ceil(row / 2) * 28;
            for (const left of [preferredSide, !preferredSide]) {
              const x = center.x + (left ? -labelOffset : labelOffset);
              const box = { left: left ? x - width : x, right: left ? x : x + width, top: y - 14, bottom: y + 16 };
              if (box.left < 0 || box.right > size.width || box.top < 0 || box.bottom > size.height) continue;
              if (screenObjects.some(o => Math.hypot(Math.max(box.left-o.center.x, 0, o.center.x-box.right), Math.max(box.top-o.center.y, 0, o.center.y-box.bottom)) < o.radius + 4)) continue;
              if (placedLabels.some(b => b.left < box.right && b.right > box.left && b.top < box.bottom && b.bottom > box.top)) continue;
              placedLabels.push(box); labelY = y; labelX = x; labelOnLeft = left; break search;
            }
          }
          const sublabelY = labelY + 12;
          labelLayer.push(<g key={object.id} className={ring} pointerEvents="none">              <text x={labelX} y={labelY} textAnchor={labelOnLeft ? 'end' : 'start'} className="object-label">
                {visibleLabel}
              </text>
              <text x={labelX} y={sublabelY} textAnchor={labelOnLeft ? 'end' : 'start'} className="object-sublabel">
                {object.kind !== 'idler'
                  ? `${object.toothCount}T · Ø ${formatMm(object.radiusMm * 2)} mm`
                  : `Ø ${formatMm(object.diameterMm)} mm · ${object.tensionSide ?? 'outside'} · ${latched ? 'locked' : 'free'}`}
              </text></g>);
          const toothTickCount = object.kind !== 'idler' ? Math.min(48, Math.max(12, Math.round(object.toothCount))) : 0;
          return (
            <g
              key={object.id}
              className={`sketch-object ${ring}${isDriver ? ' driver' : ''}${latched ? ' latched' : ''}${selected ? ' selected' : ''}${routeMember ? ' route-member' : ''}${pending ? ' pair-pending' : ''}${centerHover ? ' center-hover' : ''}`}
              data-object-id={object.id}
              onPointerDown={(event) => onObjectPointerDown(event, object.id)}
              onDoubleClick={event=>onObjectContextMenu(event,object.id)} onContextMenu={event => onObjectContextMenu(event, object.id)}
              onKeyDown={event => onObjectKeyDown(event, object.id)}
              tabIndex={0}
              role="button"
              aria-label={title}
            >
              <title>{title}</title>
              {object.kind === 'gear' ? <>
                <polygon className="object-body" points={Array.from({ length: object.toothCount * 4 }, (_, i) => {
                  const angle = (i + 0.5) * Math.PI / (object.toothCount * 2);
                  const r = radius * (1 + (i % 4 === 1 || i % 4 === 2 ? 2 : -2.5) / Math.max(4, object.toothCount));
                  return [center.x + r * Math.cos(angle), center.y + r * Math.sin(angle)].join(',');
                }).join(' ')} />
                <circle cx={center.x} cy={center.y} r={radius} fill="none" className={meshPreview && [meshPreview.gearAId,meshPreview.gearBId].includes(object.id) ? "snap-glow" : ""} stroke={meshPreview && [meshPreview.gearAId, meshPreview.gearBId].includes(object.id) ? "#56e68d" : "#e77f89"} strokeDasharray="7 3 1 3" />
              </> : <circle cx={center.x} cy={center.y} r={Math.max(radius, 4)} className="object-body" />}
              <circle cx={center.x} cy={center.y} r={Math.max(radius * 0.58, 3)} className="object-inner" />
              {isDriver && <path d={`M ${center.x - 4} ${center.y - 2} L ${center.x + 4} ${center.y} L ${center.x - 4} ${center.y + 2} Z`} className="driver-mark" aria-hidden="true" />}
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
              {nearby.length > 1 && <path d={`M ${center.x + (labelOnLeft ? -radius : radius)} ${center.y} L ${center.x + (labelOnLeft ? -radius - 4 : radius + 4)} ${center.y} L ${labelX + (labelOnLeft ? 4 : -4)} ${labelY - 3}`} className="stack-label-leader" />}
              {object.kind === 'idler' && <text x={center.x} y={center.y + 3} textAnchor="middle" className="idler-back-label">BACK</text>}

            </g>
          );
        })}
        {labelLayer}
        {[...backgroundStages, { id: sketch.activeBeltId, geometry }].map(stage => {
          if (!stage.geometry.valid) return null;
          const span = stage.geometry.segments.filter(segment => segment.kind === 'line').sort((a,b) => b.lengthMm - a.lengthMm)[0];
          if (!span) return null;
          const mid = worldToScreen({ x: (span.start.x + span.end.x) / 2, y: (span.start.y + span.end.y) / 2 }, cameraRef.current, size);
          let angle = Math.atan2(span.start.y - span.end.y, span.end.x - span.start.x) * 180 / Math.PI;
          if (angle > 90) angle -= 180;
          if (angle < -90) angle += 180;
          return <text key={stage.id} className="object-label" transform={`translate(${mid.x} ${mid.y}) rotate(${angle})`} y={-6} textAnchor="middle">{stage.geometry.nearestTeeth}T</text>;
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
        {snapSpan && (()=>{const a=worldToScreen(snapSpan.start,cameraRef.current,size),b=worldToScreen(snapSpan.end,cameraRef.current,size);return <line className="snap-glow" x1={a.x} y1={a.y} x2={b.x} y2={b.y} pointerEvents="none"/>})()}
        {screenObjects.map(object=>{
          const rpm=props.motion[object.id];
          if (!rpm) return null;
          const fastest=Math.max(60,...Object.values(props.motion).map(Math.abs));
          return <g key={object.id} pointerEvents="none" transform={`translate(${object.center.x} ${object.center.y})`}>
            <g style={{animation:`pitch-spin ${fastest/Math.abs(rpm)}s linear infinite ${rpm<0?'reverse':'normal'}`}}>
              <circle cx={object.radius*.7} cy="0" r="3" fill="#ffd166" stroke="#241e18"/>
            </g>
          </g>;
        })}
        {previewDimension && renderDimension(previewDimension, true)}
      </svg>
      {contextPulley && contextMenuPosition && <div
        ref={pulleyMenuRef}
        className="pulley-context-menu"
        role="group"
        aria-label={`${contextPulley.label} pulley actions`}
        onContextMenu={event => event.preventDefault()}
        style={{
          left: Math.max(8, Math.min(contextMenuPosition.x, window.innerWidth - 308)),
          top: Math.max(8, Math.min(contextMenuPosition.y, window.innerHeight - 390)),
        }}
      >
        <div className="pulley-context-heading">
          <strong>{contextPulley.label}</strong>
          <button type="button" aria-label="Close pulley options" onClick={() => setContextPulleyId(null)}><Icon name="close" size={15} /></button>
        </div>
        <CatalogField sketch={sketch} id={contextPulley.id} onAction={onAction}/>
        <label className="pulley-context-field">
          <span>Name</span>
          <input aria-label="Context pulley name" value={contextNameDraft} autoFocus
            onChange={event => setContextNameDraft(event.target.value)}
            onBlur={commitContextName}
            onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
        </label>
        <label className="pulley-context-field">
          <span>Tooth count</span>
          <div><input aria-label="Context pulley tooth count" type="number" min="1" step="1" value={contextTeethDraft}
            onChange={event => setContextTeethDraft(event.target.value)}
            onBlur={commitContextTeeth}
            onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /><small>teeth</small></div>
        </label>
        <label className="pulley-context-field">
          <span>Belt membership</span>
          <select aria-label="Context pulley belt membership" value={sketch.transmission?.belts.find(belt => belt.route.includes(contextPulley.id))?.id ?? ''}
            onChange={event => onAction({ type: 'SET_PULLEY_BELT', id: contextPulley.id, beltId: event.target.value || null })}>
            <option value="">No belt</option>
            {(sketch.transmission?.belts ?? []).map((belt, index) => <option key={belt.id} value={belt.id} disabled={hasOtherPulleyOnBeltAxle(sketch, contextPulley.id, belt.id)}>Belt {index + 1} · {belt.profile}</option>)}
          </select>
        </label>
        {!isStacked(contextPulley.id) && <><button className="pulley-context-action" onClick={() => { onAddGear(contextPulley.id); setContextPulleyId(null); }}>Add gear to this axle</button>
        <button className="pulley-context-action" type="button" onClick={() => {
          onAddCoaxialPulley(contextPulley.id);
          setContextPulleyId(null);
        }}>Add another pulley on this axle</button></>}
        <button className="pulley-context-action destructive" type="button" onClick={() => {
          onDeleteObject(contextPulley.id);
          setContextPulleyId(null);
        }}>Delete pulley</button>
      </div>}
      {contextIdler && contextMenuPosition && <div
        ref={idlerMenuRef}
        className="idler-context-menu"
        role="group"
        aria-label={`${contextIdler.label} tensioner actions`}
        onContextMenu={event => event.preventDefault()}
        style={{
          left: Math.max(8, Math.min(contextMenuPosition.x, window.innerWidth - 308)),
          top: Math.max(8, Math.min(contextMenuPosition.y, window.innerHeight - 360)),
        }}
      >
        <div className="pulley-context-heading">
          <strong>{contextIdler.label}</strong>
          <button type="button" aria-label="Close tensioner options" onClick={() => setContextIdlerId(null)}><Icon name="close" size={15} /></button>
        </div>
        <label className="pulley-context-field">
          <span>Name</span>
          <input aria-label="Context tensioner name" value={contextIdlerNameDraft} autoFocus
            onChange={event => setContextIdlerNameDraft(event.target.value)}
            onBlur={commitContextIdlerName}
            onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
        </label>
        <label className="pulley-context-field">
          <span>Diameter</span>
          <div><input aria-label="Context tensioner diameter" type="number" min="0.1" step="0.1" value={contextIdlerDiameterDraft}
            onChange={event => setContextIdlerDiameterDraft(event.target.value)}
            onBlur={commitContextIdlerDiameter}
            onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /><small>mm</small></div>
        </label>
        <label className="pulley-context-field">
          <span>Tension side</span>
          <select aria-label="Context tension side" value={contextIdler.tensionSide ?? 'outside'} onChange={event => onAction({ type: 'UPDATE_IDLER', id: contextIdler.id, changes: { tensionSide: event.target.value as TensionSide } })}>
            <option value="outside">Outside · push belt outward</option>
            <option value="inside">Inside · expand belt path</option>
          </select>
        </label>
        {sketch.pulleys.some(pulley => pulley.isOrigin) && <button type="button" className="pulley-context-action" onClick={() => {
          const origin = sketch.pulleys.find(pulley => pulley.isOrigin)!;
          onPlaceDimension('aligned', origin.id, contextIdler.id, 12);
          setContextIdlerId(null);
        }}>Dimension to origin</button>}
        {contextIdlerBelt && <div className="idler-attachment-status" role="status">Locked to {contextIdlerBelt.id}. Right-click to detach.</div>}
        {contextIdlerBelt && <button className="pulley-context-action" type="button" onClick={() => {
          onAction({ type: 'UNLATCH_IDLER', id: contextIdler.id });
          setContextIdlerId(null);
        }}><Icon name="unlock" size={15} />Unlock and detach</button>}
        <button className="pulley-context-action destructive" type="button" onClick={() => {
          onDeleteObject(contextIdler.id);
          setContextIdlerId(null);
        }}>Delete tensioner</button>
      </div>}
      {stackChoice && <div
        ref={stackPickerRef}
        className="pulley-stack-picker"
        role="group"
        aria-label="Choose a pulley on this axle"
        style={{
          left: Math.max(8, Math.min(stackChoice.position.x, window.innerWidth - 292)),
          top: Math.max(8, Math.min(stackChoice.position.y, window.innerHeight - 260)),
        }}
      >
        <div className="pulley-context-heading">
          <strong>{stackChoice.edit ? "Axle side view · top to bottom" : "Choose a pulley"}</strong>
          <button type="button" aria-label="Close pulley choices" onClick={() => setStackChoice(null)}><Icon name="close" size={15} /></button>
        </div>
        {stackChoice.edit && <>
          <button className="pulley-context-action" onClick={() => { onAddGear(stackChoice.ids[0]); setStackChoice(null); }}>Add gear to axle</button>
          <button className="pulley-context-action" onClick={() => { onAddCoaxialPulley(stackChoice.ids[0]!); setStackChoice(null); }}>Add pulley to axle</button>
        </>}
        {stackChoice.ids.map(id => {
          const gear = sketch.transmission?.gears.find(g => g.id === id);
          const pulley = sketch.pulleys.find(item => item.id === id) ?? (gear && { ...gear, label: gear.name, profile: 'Gear' });
          if (!pulley) return null;
          const belt = sketch.transmission?.belts.find(item => item.route.includes(id));
          return <button key={id} type="button" className="pulley-stack-choice"
            draggable={stackChoice.edit} title={stackChoice.edit ? 'Drag to change stack order, or click to edit' : undefined}
            onDragStart={event => event.dataTransfer.setData('application/x-pitch-part', id)}
            onDragOver={event => { if (stackChoice.edit) event.preventDefault(); }}
            onDrop={event => {
              event.preventDefault();
              const source = event.dataTransfer.getData('application/x-pitch-part');
              if (!stackChoice.edit || !stackChoice.ids.includes(source)) return;
              onAction({type:'REORDER_AXLE', id:source, target:id});
              const ids = stackChoice.ids.filter(member => member !== source);
              ids.splice(stackChoice.ids.indexOf(id), 0, source);
              setStackChoice({...stackChoice, ids});
            }}
            aria-label={`${pulley.label}, ${pulley.id}, ${pulley.toothCount} teeth, ${pulley.profile}, ${belt?.id ?? 'No belt'}`}
            aria-pressed={selectedId === id} onClick={() => chooseStackMember(id)}>
            {stackChoice.edit && <svg width="80" height="20" aria-hidden="true"><path d="M40 0v20" stroke="#888" strokeWidth="5"/><rect x={40 - Math.min(37, 8 + pulley.toothCount / 2)} y="5" width={2 * Math.min(37, 8 + pulley.toothCount / 2)} height="10" rx="2" fill={gear ? '#dc4b55' : '#83919e'}/>{Array.from({length:Math.min(15,Math.ceil(pulley.toothCount/3))},(_,i)=><path key={i} d={`M${40+(i/(Math.min(15,Math.ceil(pulley.toothCount/3))-1||1)-0.5)*Math.min(70,14+pulley.toothCount)} 5v10`} stroke="#303137" strokeWidth="2"/>)}</svg>}
            <span>{pulley.label}</span>
            <small>{pulley.label !== pulley.id ? `${pulley.id} · ` : ''}{pulley.toothCount}T · {pulley.profile} · {belt?.id ?? 'No belt'}</small>
          </button>;
        })}
      </div>}
      {gridMenuPosition && menuPart && <div ref={gridMenuRef} className="pulley-context-menu" style={{left:gridMenuPosition.x,top:gridMenuPosition.y}}>
        <div className="pulley-context-heading"><strong>{sketch.transmission?.gears.find(g => g.id === menuPart)?.name ?? "Dimension"}</strong><button aria-label="Close options" onClick={() => setGridMenuPosition(null)}><Icon name="close" size={15}/></button></div>
        {sketch.transmission?.gears.filter(g => g.id === menuPart).map(g => <div key={g.id} style={{display:"grid",gap:9}}><NumberField label="Gear bore" unit="mm" value={g.boreMm} min={Number.MIN_VALUE} onChange={value=>onAction({type:"SET_GEAR_BORE",id:g.id,value})}/><CatalogField sketch={sketch} id={g.id} onAction={onAction}/><button className="pulley-context-action" onClick={() => {onToolChange("add-gear");setGridMenuPosition(null)}}>Place another gear</button><label className="pulley-context-field"><span>Name</span><input value={g.name} onChange={e => onAction({type:"SET_LABEL",id:g.id,label:e.target.value})}/></label><NumberField label="Gear module" unit="mm" value={g.moduleMm} min={Number.MIN_VALUE} onChange={moduleMm => onAction({type:"SET_GEAR_MODULE",id:g.id,moduleMm})}/><label className="pulley-context-field"><span>Teeth</span><input type="number" min="1" value={g.toothCount} onChange={e => onAction({type:"UPDATE_GEAR",id:g.id,toothCount:Number(e.target.value)})}/></label>{sketch.transmission?.meshes.some(m => m.gearAId === g.id || m.gearBId === g.id) && <button className="pulley-context-action" onClick={() => {onAction({type:"UNLOCK_GEAR",id:g.id});setGridMenuPosition(null)}}>Unlock gear</button>}{!isStacked(g.id) && <><button className="pulley-context-action" onClick={() => {onAddGear(g.id);setGridMenuPosition(null)}}>Add gear to axle</button><button className="pulley-context-action" onClick={() => {onAddCoaxialPulley(g.id);setGridMenuPosition(null)}}>Add pulley to axle</button></>}</div>)}
        <button className="pulley-context-action destructive" onClick={() => {onAction(sketch.dimensions.some(d => d.id === menuPart) ? {type:"REMOVE_DIMENSION",id:menuPart} : {type:"DELETE_OBJECT",id:menuPart});setGridMenuPosition(null)}}>Delete {sketch.dimensions.some(d => d.id === menuPart) ? "dimension" : "gear"}</button></div>}
      {gridMenuPosition && !menuPart && <div
        ref={gridMenuRef}
        className="grid-context-menu"
        role="group"
        aria-label="Sketch tools and view actions"
        onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}
        style={{
          left: Math.max(8, Math.min(gridMenuPosition.x, window.innerWidth - 320)),
          top: Math.max(8, Math.min(gridMenuPosition.y, window.innerHeight - 540)),
          maxHeight: `${Math.max(120, (frameRef.current?.clientHeight ?? window.innerHeight) - 16)}px`,
        }}
      >
        <div className="pulley-context-heading">
          <strong>Sketch tools</strong><button onClick={()=>{setGridMenuPosition(null);onShortcuts()}}>Shortcuts</button>
          <button type="button" aria-label="Close tool menu" onClick={() => setGridMenuPosition(null)}><Icon name="close" size={15} /></button>
        </div>
        <button className="grid-context-action" type="button" onClick={() => { onToolChange('add-gear'); setGridMenuPosition(null); }}><span><Icon name="gear" size={16} /></span>Add gear</button>
        {GRID_TOOL_GROUPS.map(group => <section className="grid-tool-group" key={group.title}>
          <h3>{group.title}</h3>
          <div>
            {group.tools.map(item => <button key={item.tool} type="button" className="grid-tool-option" aria-pressed={tool === item.tool}
              onClick={() => { onToolChange(tool === item.tool ? 'select' : item.tool); setGridMenuPosition(null); }}>
              <span aria-hidden="true"><Icon name={item.icon} size={16} /></span>{item.label}
            </button>)}
          </div>
        </section>)}
        <section className="grid-tool-group">
          <h3>View and history</h3>
          <div>
            <button type="button" className="grid-tool-option" onClick={() => { onFit(); setGridMenuPosition(null); }}><span><Icon name="home" size={16} /></span>Home · fit all</button>
            <button type="button" className="grid-tool-option" onClick={() => { onReset(); setGridMenuPosition(null); }}><span><Icon name="reset" size={16} /></span>Reset view</button>
            <button type="button" className="grid-tool-option" disabled={!canUndo} onClick={() => { onUndo(); setGridMenuPosition(null); }}><span><Icon name="undo" size={16} /></span>Undo</button>
            <button type="button" className="grid-tool-option" disabled={!canRedo} onClick={() => { onRedo(); setGridMenuPosition(null); }}><span><Icon name="redo" size={16} /></span>Redo</button>
          </div>
        </section>
      </div>}
      <div className="canvas-status">
        <span className="coordinate-readout" ref={coordinateRef}>X 0.00   Y 0.00 mm</span>
        {notice && <span className="interaction-notice" role="status">{notice}</span>}
      </div>
    </div>
  );
}
