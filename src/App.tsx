import { useEffect, useMemo, useRef, useState } from 'react';
import BeltPanel from './components/BeltPanel';
import DrivePanel from './components/DrivePanel';
import PropertiesPanel from './components/PropertiesPanel';
import SketchCanvas from './components/SketchCanvas';
import Toolbar from './components/Toolbar';
import { calculateBeltGeometry } from './geometry';
import { loadSketch, saveSketch } from './persistence';
import type { BeltGeometryResult, HistoryState, LineSegment, Point, Sketch, SketchDimension, SketchTool } from './model';
import { createTensionerOnSpan } from './tensioner';
import { createPulleyOnSpan } from './pulleyPlacement';
import { reduceSketch } from './state';
import type { SketchAction } from './state';
import type { Camera } from './viewport';

type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
type DimensionKind = SketchDimension['kind'];

function safeStorage(): StoragePort {
  try {
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem: () => undefined };
  }
}

function nextId(prefix: string, sketch: Sketch): string {
  const ids = [...sketch.pulleys, ...sketch.idlers, ...sketch.dimensions, ...sketch.constraints]
    .map((item) => Number(item.id.replace(/^\D+/, '')))
    .filter(Number.isFinite);
  return `${prefix}${Math.max(0, ...ids) + 1}`;
}

function findObject(sketch: Sketch, id: string): Point | undefined {
  return sketch.pulleys.find((item) => item.id === id) ?? sketch.idlers.find((item) => item.id === id);
}

function initialDimensionValue(sketch: Sketch, kind: DimensionKind, fromId: string, toId: string): number {
  const first = findObject(sketch, fromId);
  const second = findObject(sketch, toId);
  if (!first || !second) return 0;
  if (kind === 'horizontal') return second.x - first.x;
  if (kind === 'vertical') return second.y - first.y;
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export default function App() {
  const storageRef = useRef<StoragePort | null>(null);
  if (!storageRef.current) storageRef.current = safeStorage();
  const storage = storageRef.current;
  const [history, setHistory] = useState<HistoryState>(() => ({
    past: [], present: loadSketch(storage), future: [], activeEdit: null,
  }));
  const sketch = history.present;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<SketchTool>('select');
  const [fitRequest, setFitRequest] = useState(0);
  const [interactionNotice, setInteractionNotice] = useState<string | null>(null);
  const geometry: BeltGeometryResult = useMemo(() => calculateBeltGeometry(sketch), [sketch]);

  useEffect(() => {
    const timer = window.setTimeout(() => saveSketch(storage, sketch), 120);
    return () => window.clearTimeout(timer);
  }, [sketch, storage]);

  useEffect(() => {
    const ids = new Set([
      ...sketch.pulleys.map((item) => item.id),
      ...sketch.idlers.map((item) => item.id),
      ...sketch.dimensions.map((item) => item.id),
      ...sketch.constraints.map((item) => item.id),
      ...(sketch.route.length ? ['BELT'] : []),
    ]);
    if (selectedId && !ids.has(selectedId)) setSelectedId(null);
  }, [selectedId, sketch]);

  const dispatch = (action: SketchAction) => {
    setInteractionNotice(null);
    setHistory((current) => reduceSketch(current, action));
  };

  const addPulleyAt = (point: Point, span?: LineSegment) => {
    const id = nextId('P', sketch);
    const pulley = span ? createPulleyOnSpan(sketch, span, point, id)
      : { id, label: id, toothCount: 20, profile: sketch.profile, ...point, isOrigin: false };
    if (!pulley) {
      setInteractionNotice('No clearance for a 20T pulley here. Choose a longer belt span or move nearby pulleys.');
      return;
    }
    dispatch({ type: 'ADD_PULLEY', pulley, ...(span ? { segment: { fromId: span.fromId, toId: span.toId } } : {}) });
    setSelectedId(id);
    if (span) setTool('select');
  };

  const addIdlerOnSegment = (span: LineSegment, point: Point) => {
    const id = nextId('T', sketch);
    const idler = createTensionerOnSpan(sketch, span, point, id);
    if (!idler) {
      setInteractionNotice('No clearance for a tensioner on this span. Choose another straight span.');
      return;
    }
    dispatch({
      type: 'ADD_IDLER', idler, segment: { fromId: span.fromId, toId: span.toId },
    });
    setSelectedId(id);
    setTool('select');
  };

  const deleteSelection = (id: string) => {
    if (id === 'BELT') {
      dispatch({ type: 'CLEAR_ROUTE' });
    } else if (sketch.pulleys.some((item) => item.id === id) || sketch.idlers.some((item) => item.id === id)) {
      dispatch({ type: 'DELETE_OBJECT', id });
    } else if (sketch.dimensions.some((item) => item.id === id)) {
      dispatch({ type: 'REMOVE_DIMENSION', id });
    } else if (sketch.constraints.some((item) => item.id === id)) {
      dispatch({ type: 'REMOVE_CONSTRAINT', id });
    }
    setSelectedId(null);
  };

  const applyConstraint = (kind: 'horizontal' | 'vertical', firstId: string, secondId: string) => {
    dispatch({ type: 'ADD_CONSTRAINT', constraint: { id: nextId('C', sketch), firstId, secondId, kind } });
    setTool('select');
  };

  const placeDimension = (kind: DimensionKind, fromId: string, toId: string, offsetMm: number) => {
    const id = nextId('D', sketch);
    dispatch({
      type: 'ADD_DIMENSION',
      dimension: { id, fromId, toId, kind, valueMm: initialDimensionValue(sketch, kind, fromId, toId), offsetMm },
    });
    setSelectedId(id);
    setTool('select');
  };

  const commitDimension = (id: string, valueMm: number) => {
    if (!Number.isFinite(valueMm)) return;
    dispatch({ type: 'SET_DIMENSION_VALUE', id, valueMm });
    setSelectedId(id);
  };

  const fitView = () => setFitRequest((value) => value + 1);
  const resetView = () => dispatch({ type: 'SET_VIEW', view: { centerX: 0, centerY: 0, zoom: 1 } });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const editingText = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
      if (editingText) return;
      if (event.key === 'Escape') {
        setTool('select');
        setSelectedId(null);
        setInteractionNotice(null);
        setHistory(current => current.activeEdit ? reduceSketch(current, { type: 'UNDO' }) : { ...current, notice: null });
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        setHistory((current) => reduceSketch(current, { type: event.shiftKey ? 'REDO' : 'UNDO' }));
        setSelectedId(null);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        setHistory((current) => reduceSketch(current, { type: 'REDO' }));
        setSelectedId(null);
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault();
        deleteSelection(selectedId);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.toLowerCase() === 'v') setTool('select');
      if (event.key.toLowerCase() === 'x') setTool('dimension-horizontal');
      if (event.key.toLowerCase() === 'y') setTool('dimension-vertical');
      if (event.key.toLowerCase() === 'd') setTool('dimension-aligned');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, sketch, tool]);

  const routeClosed = sketch.route.length >= 3 && sketch.route[0] === sketch.route.at(-1);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">BP</div>
          <div className="brand-name"><b>Belt Pulley Calculator</b><small>MECHANICAL DESIGN</small></div>
        </div>
      </header>

      <Toolbar
        tool={tool}
        canUndo={history.past.length > 0 || history.activeEdit !== null}
        canRedo={history.future.length > 0}
        onToolChange={(next) => { setTool(next); setInteractionNotice(null); }}
        onUndo={() => { dispatch({ type: 'UNDO' }); setSelectedId(null); }}
        onRedo={() => { dispatch({ type: 'REDO' }); setSelectedId(null); }}
        onFit={fitView}
        onReset={resetView}
      />

      <main className="workspace-shell">
        <section className="center-workspace" aria-label="Sketch canvas">
          <div className="workspace-subbar">
            <span className="view-chip">2D SKETCH</span><span className="subbar-divider" /><span className="subbar-value">XY PLANE</span>
            <div className={`workspace-status${routeClosed && !geometry.valid ? ' invalid' : ''}`}><i />{routeClosed ? geometry.valid ? 'BELT ROUTE CLOSED' : 'INVALID BELT GEOMETRY' : 'SKETCH EDITING'}</div>
          </div>
          <SketchCanvas
            sketch={sketch}
            geometry={geometry}
            selectedId={selectedId}
            tool={tool}
            fitRequest={fitRequest}
            notice={interactionNotice ?? history.notice ?? null}
            onNotice={setInteractionNotice}
            onViewChange={(view: Camera) => dispatch({ type: 'SET_VIEW', view })}
            onSelect={setSelectedId}
            onAddPulleyAt={addPulleyAt}
            onAddIdlerOnSegment={addIdlerOnSegment}
            onDeleteObject={deleteSelection}
            onMoveObject={(id, point) => dispatch({ type: 'MOVE_OBJECT', id, ...point })}
            onBeginDrag={(id) => dispatch({ type: 'BEGIN_DRAG', id })}
            onEndDrag={() => dispatch({ type: 'END_DRAG' })}
            onRouteObject={(objectId) => {
              dispatch({ type: 'ROUTE_CLICK', objectId });
              if (!routeClosed && sketch.route.length >= 2 && objectId === sketch.route[0]) setTool('select');
            }}
            onPlaceDimension={placeDimension}
            onAddConstraint={applyConstraint}
            onCommitDimension={commitDimension}
          />
        </section>
        <aside className="inspector-panel" aria-label="Design inspector">
          <PropertiesPanel sketch={sketch} selectedId={selectedId} onAction={dispatch} onDelete={deleteSelection} />
          <BeltPanel sketch={sketch} geometry={geometry} onAction={dispatch} />
          <DrivePanel sketch={sketch} geometry={geometry} onAction={dispatch} />
        </aside>
      </main>
    </div>
  );
}
