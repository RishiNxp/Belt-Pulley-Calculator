import { useEffect, useMemo, useRef, useState } from 'react';
import { createEmptySketch } from './demo';
import BeltPanel from './components/BeltPanel';
import DrivePanel from './components/DrivePanel';
import PropertiesPanel from './components/PropertiesPanel';
import OrderPanel from './components/OrderPanel';
import SketchCanvas from './components/SketchCanvas';
import { Preferences, defaults, type Bindings } from './components/Preferences';
import Toolbar from './components/Toolbar';
import WelcomePage from './components/WelcomePage';
import Icon from './components/Icon';
import { calculateBeltGeometry } from './geometry';
import { parseSketchJson } from './persistence';
import type { BeltGeometryResult, HistoryState, LineSegment, Point, Sketch, SketchDimension, SketchTool } from './model';
import { createTensionerOnSpan, removeIdlerFromBeltRoute, tensionSideForApproach } from './tensioner';
import { createPulleyOnSpan } from './pulleyPlacement';
import { reduceSketch } from './state';
import type { SketchAction } from './state';
import type { Camera } from './viewport';
import { DEFAULT_GOBILDA_GEAR, sketchForBeltStage } from './transmission';

type DimensionKind = SketchDimension['kind'];
type GuidanceAction = 'first-pulley' | 'add-pulley' | 'route' | null;

function hasSketchContent(sketch: Sketch): boolean {
  return sketch.pulleys.length > 0 || sketch.idlers.length > 0 || sketch.route.length > 0
    || sketch.dimensions.length > 0 || sketch.constraints.length > 0
    || (sketch.transmission?.gears.length ?? 0) > 0 || (sketch.transmission?.belts.length ?? 0) > 0;
}

const guideTopics = [
  ['Build a shared axle', 'Right-click a pulley and add a pulley or gear to its axle. Right-click the stack to see its side view. Choose a row to edit that part’s name or size. Moving or dimensioning a pulley moves the shared center.'],
  ['Route separate belts', 'Choose Create belt. Click each pulley in order and press Enter. On a shared axle, choose the pulley for that belt from the picker, even when a gear covers it. Repeat for a second belt.'],
  ['Read a belt', 'Click a belt line to see its tooth count at the top of the sidebar and its component list below. Use Belt size to switch belts. Use a pulley’s Belt membership field to change which belt it belongs to.'],
  ['Position a tensioner', 'Place a tensioner on the grid, then drag it to the belt span you want and release. Right-click to change its diameter or inside/outside tension. Unlock and detach it before dragging it onto another belt.'],
  ['Mesh and orbit gears', 'Place two gears on separate axles. Set matching modules, then drag one toward the other. Release when both pitch circles turn green. Drag either gear to orbit its mate. Right-click to unlock. Changing a meshed gear’s module releases its connections.'],
  ['Set a dimension', 'In More tools, choose horizontal, vertical, or center distance. Click two centers and click again to place the measurement. Double-click its value, type a distance, and press Enter. Right-click the dimension to delete it.'],
  ['Compare a drive train', 'Open Drivetrain · RPM and motion below the canvas. Choose the train, driving component, and driven output. Read the ratio and rotation direction, or enter driver RPM for output speed. Separate trains work independently of the origin.'],
  ['Navigate and save', 'Use Home to fit the whole layout. Right-click the grid for tools and Undo. Refresh restores your layout in this browser. Save file keeps a copy you can open later. Clear plane starts an empty layout.'],
];
function layoutGuidance(sketch: Sketch, routeClosed: boolean, tool: SketchTool, geometry: BeltGeometryResult): {
  title: string;
  body: string;
  action: GuidanceAction;
  actionLabel: string | null;
} {
  if (sketch.pulleys.length === 0) {
    return {
      title: 'Start your layout',
      body: 'Add your first pulley at the origin, or choose Add gear and click the grid to begin a gear train. Use Next for axle, belt, and gear instructions.',
      action: 'first-pulley',
      actionLabel: 'Add first pulley',
    };
  }
  if (routeClosed && geometry.valid) {
    return {
      title: 'Layout ready',
      body: 'Read belt size in the sidebar and drive results in the board below the canvas.',
      action: null,
      actionLabel: null,
    };
  }
  if (routeClosed) {
    return {
      title: 'Check the belt route',
      body: geometry.diagnostic ?? 'Check pulley positions and the belt route, then try again.',
      action: null,
      actionLabel: null,
    };
  }
  if (sketch.pulleys.length === 1) {
    return {
      title: 'Add another pulley',
      body: 'Choose Add pulley, then click where its center should sit.',
      action: 'add-pulley',
      actionLabel: 'Add pulley',
    };
  }
  if (sketch.route.length > 0) {
    return {
      title: 'Finish the belt route',
      body: sketch.route.length === 1
        ? `Select one more pulley in belt order, then press Enter to finish.`
        : `Select the remaining pulleys in order, then press Enter to finish.`,
      action: tool === 'route' ? null : 'route',
      actionLabel: tool === 'route' ? null : 'Resume belt',
    };
  }
  return {
    title: tool === 'route' ? 'Choose your belt path' : 'Create the belt route',
    body: 'Select pulleys in the order the belt follows, then press Enter to finish.',
    action: tool === 'route' ? null : 'route',
    actionLabel: tool === 'route' ? null : 'Create belt',
  };
}

function nextId(prefix: string, sketch: Sketch): string {
  const ids = [...sketch.pulleys, ...sketch.idlers, ...sketch.dimensions, ...sketch.constraints]
    .map((item) => Number(item.id.replace(/^\D+/, '')))
    .filter(Number.isFinite);
  return `${prefix}${Math.max(0, ...ids) + 1}`;
}

function findObject(sketch: Sketch, id: string): Point | undefined {
  return sketch.pulleys.find((item) => item.id === id) ?? sketch.idlers.find((item) => item.id === id) ?? sketch.transmission?.axles.find(axle => axle.componentIds.includes(id));
}

function initialDimensionValue(sketch: Sketch, kind: DimensionKind, fromId: string, toId: string): number {
  const first = findObject(sketch, fromId);
  const second = findObject(sketch, toId);
  if (!first || !second) return 0;
  if (kind === 'horizontal') return second.x - first.x;
  if (kind === 'vertical') return second.y - first.y;
  return Math.hypot(second.x - first.x, second.y - first.y);
}

declare const __PITCH_REVISION__: string;
function restoreLayout(): Sketch | null {
  try {
    const saved = JSON.parse(localStorage.getItem('pitch.session') ?? 'null');
    if (!saved?.sketch) return null;
    const restored = parseSketchJson(JSON.stringify(saved.sketch));
    if (saved.revision !== __PITCH_REVISION__) {
      try { localStorage.setItem('pitch.session.beforeUpgrade', JSON.stringify(saved)); } catch { /* A full store still permits read-only recovery. */ }
    }
    return restored;
  } catch { return null; }
}

export default function App() {
  const [settings,setSettings] = useState(false);
  const [motion,setMotion]=useState<Record<string,number>>({});
  const [collapsed,setCollapsed] = useState(false);
  const [light,setLight] = useState(()=>localStorage.getItem('pitch.theme')==='light');
  const [binds,setBinds] = useState<Bindings>(()=>{try{return {...defaults,...JSON.parse(localStorage.getItem('pitch.keys')||'{}')}}catch{return defaults}});
  useEffect(()=>{document.documentElement.dataset.theme=light?'light':'dark';localStorage.setItem('pitch.theme',light?'light':'dark')},[light]);
  useEffect(()=>{localStorage.setItem('pitch.keys',JSON.stringify(binds))},[binds]);
  const [restored] = useState(restoreLayout);
  const [history, setHistory] = useState<HistoryState>(() => ({
    past: [], present: restored ?? createEmptySketch(), future: [], activeEdit: null,
  }));
  const sketch = history.present;
  const [page, setPage] = useState<'welcome' | 'calculator'>(restored && location.protocol !== 'belt-pulley:' ? 'calculator' : 'welcome');
  useEffect(() => {
    if (page !== 'calculator') return;
    try { localStorage.setItem('pitch.session', JSON.stringify({ revision: __PITCH_REVISION__, sketch })); }
    catch { /* File export remains available when browser storage is full. */ }
  }, [page, sketch]);
  const [showTips, setShowTips] = useState(!restored);
  const [guidePage, setGuidePage] = useState(0);
  const [confirmNewLayout, setConfirmNewLayout] = useState(false);
  const [pendingImport, setPendingImport] = useState<Sketch | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<SketchTool>('select');
  const [fitRequest, setFitRequest] = useState(0);
  const [interactionNotice, setInteractionNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const geometry: BeltGeometryResult = useMemo(() => calculateBeltGeometry(sketch), [sketch]);

  useEffect(() => {
    const ids = new Set([
      ...sketch.pulleys.map((item) => item.id),
      ...sketch.idlers.map((item) => item.id),
      ...(sketch.transmission?.gears.map(item => item.id) ?? []),
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

  const addPulleyAt = (point: Point, span?: LineSegment, beltId?: string) => {
    const id = nextId('P', sketch);
    const belt = sketch.transmission?.belts.find(b=>b.id===beltId);
    const pulley = span ? createPulleyOnSpan(belt ? sketchForBeltStage(sketch,belt) : sketch, span, point, id)
      : { id, label: id, toothCount: 20, profile: sketch.profile, ...point, isOrigin: false };
    if (!pulley) {
      setInteractionNotice('No clearance for a 20T pulley here. Choose a longer belt span or move nearby pulleys.');
      return;
    }
    if (belt && belt.id!==sketch.activeBeltId) dispatch({type:'SET_ACTIVE_BELT',id:belt.id});
    dispatch({ type: 'ADD_PULLEY', pulley, ...(span ? { segment: { fromId: span.fromId, toId: span.toId } } : {}) });
    setSelectedId(id);
    if (span) setTool('select');
  };

  const addGear = (hostId?: string, point?: Point) => {
    const next = Math.max(0, ...(sketch.transmission?.gears ?? []).map(gear => Number(gear.id.replace(/^\D+/, '')) || 0)) + 1;
    const host = hostId ? sketch.pulleys.find(item => item.id === hostId) : undefined;
    const axleId = hostId ? sketch.transmission?.axles.find(axle => axle.componentIds.includes(hostId))?.id ?? `AX-${hostId}` : `AX-G${next}`;
    const gear = { id: `G${next}`, name: `Gear ${next}`, axleId, plane: 0, ...DEFAULT_GOBILDA_GEAR };
    dispatch({ type: 'ADD_GEAR', gear, hostId, x: host?.x ?? point?.x ?? sketch.view.centerX, y: host?.y ?? point?.y ?? sketch.view.centerY });
    setSelectedId(gear.id);
  };

  const addCoaxialPulley = (hostId: string) => {
    const host = sketch.pulleys.find(item => item.id === hostId) ?? sketch.transmission?.axles.find(a => a.componentIds.includes(hostId));
    if (!host) return;
    const id = nextId('P', sketch);
    dispatch({ type: 'ADD_COAXIAL_PULLEY', hostId, pulley: {
      id, label: id, toothCount: 16, profile: sketch.profile, x: host.x, y: host.y, isOrigin: false,
    } });
    setSelectedId(id);
  };

  const startAxleStage = (hostId: string) => {
    const host = sketch.pulleys.find(item => item.id === hostId);
    if (!host) return;
    const pulleyNumber = Math.max(0, ...sketch.pulleys.map(item => Number(item.id.replace(/^\D+/, '')) || 0)) + 1;
    const stageNumber = Math.max(0, ...(sketch.transmission?.belts ?? []).map(item => Number(item.id.replace(/^\D+/, '')) || 0)) + 1;
    const id = `P${pulleyNumber}`;
    dispatch({ type: 'ADD_COAXIAL_PULLEY', hostId, pulley: { id, label: id, toothCount: 16, profile: sketch.profile, x: host.x, y: host.y, isOrigin: false } });
    dispatch({ type: 'ADD_BELT_STAGE', id: `B${stageNumber}` });
    dispatch({ type: 'ROUTE_CLICK', objectId: id });
    setSelectedId(id);
    setTool('route');
  };

  const addFreeIdler = (point: Point) => {
    const id = nextId('T', sketch);
    dispatch({ type: 'ADD_IDLER', idler: { id, label: id, diameterMm: 30, x: point.x, y: point.y, beltId: null, locked: false, tensionSide: 'outside' } });
    setSelectedId(id);
    setTool('select');
  };

  const addIdlerOnSegment = (beltId: string, span: LineSegment, point: Point) => {
    const id = nextId('T', sketch);
    const belt = sketch.transmission?.belts.find(item => item.id === beltId);
    const stageSketch = belt ? sketchForBeltStage(sketch, belt) : sketch;
    const idler = createTensionerOnSpan(stageSketch, span, point, id, tensionSideForApproach(stageSketch, span, point));
    if (!idler) {
      setInteractionNotice('No clearance for a tensioner on this span. Choose another straight span.');
      return;
    }
    dispatch({
      type: 'ADD_IDLER', idler, beltId, segment: { fromId: span.fromId, toId: span.toId },
    });
    setSelectedId(id);
    setTool('select');
  };

  const latchIdlerOnSegment = (idlerId: string, beltId: string, span: LineSegment, point: Point): boolean => {
    const idler = sketch.idlers.find(item => item.id === idlerId);
    const belt = sketch.transmission?.belts.find(item => item.id === beltId);
    if (!idler || !belt) return false;
    const route = removeIdlerFromBeltRoute(sketch, belt.route, idlerId);
    const stageSketch = sketchForBeltStage(sketch, { ...belt, route });
    const snapped = createTensionerOnSpan(stageSketch, span, point, idlerId, tensionSideForApproach(stageSketch, span, point), idler.diameterMm);
    if (!snapped) return false;
    dispatch({ type: 'LATCH_IDLER', id: idlerId, beltId, tensionSide: snapped.tensionSide, fromId: span.fromId, toId: span.toId, point: { x: snapped.x, y: snapped.y } });
    return true;
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

  const toggleTips = () => {
    setGuidePage(0);
    setShowTips(visible => !visible);
  };

  const startNewLayout = () => {
    dispatch({ type: 'NEW_SKETCH' });
    setSelectedId(null);
    setTool('select');
    setShowTips(false);
    setPage('calculator');
    setConfirmNewLayout(false);
  };

  const [entering,setEntering] = useState(false);
  useEffect(()=>{
    if (!entering) return;
    const timer = window.setTimeout(()=>setEntering(false),800);
    return ()=>window.clearTimeout(timer);
  },[entering]);
  const enterCalculator = () => {
    setEntering(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    setGuidePage(0);
    setShowTips(!hasSketchContent(sketch));
    setPage('calculator');
  };

  const requestNewLayout = () => {
    if (hasSketchContent(sketch)) setConfirmNewLayout(true);
    else startNewLayout();
  };

  const fitView = () => setFitRequest((value) => value + 1);
  const saveFile = () => {
    const blob = new Blob([JSON.stringify({ version: 1, sketch }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'belt-layout.json'; anchor.click();
    URL.revokeObjectURL(url);
  };
  const openFile = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = parseSketchJson(await file.text());
      setShowTips(false);
      setPage('calculator');
      if (hasSketchContent(sketch)) setPendingImport(parsed);
      else { setHistory(current => reduceSketch(current, { type: 'LOAD_SKETCH', sketch: parsed })); setSelectedId(null); setTool('select'); }
    }
    catch (error) {
      setInteractionNotice(error instanceof Error ? error.message : 'Could not open this sketch file.');
      setShowTips(false);
      setPage('calculator');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  const confirmImport = () => {
    if (!pendingImport) return;
    setHistory(current => reduceSketch(current, { type: 'LOAD_SKETCH', sketch: pendingImport }));
    setPendingImport(null); setConfirmNewLayout(false); setSelectedId(null); setTool('select'); setShowTips(false); setPage('calculator');
  };
  const resetView = () => dispatch({ type: 'SET_VIEW', view: { centerX: 0, centerY: 0, zoom: 1 } });

  useEffect(() => {
    if (page !== 'calculator' || settings) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const editingText = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
      if (editingText) return;
      if (event.key === 'Enter' && tool === 'route' && sketch.route.length >= 2 && sketch.route[0] !== sketch.route.at(-1)
        && !(target instanceof Element && target.closest('.pulley-stack-picker, input, select'))) {
        event.preventDefault();
        dispatch({ type: 'ROUTE_CLICK', objectId: sketch.route[0]! });
        setTool('select');
        return;
      }
      if (event.key === 'Escape') {
        setConfirmNewLayout(false);
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
      const match = Object.entries(binds).find(([,key])=>key===event.key.toLowerCase());
      if (match) { event.preventDefault(); setTool(match[0] as SketchTool); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [page, selectedId, sketch, tool, binds, settings]);

  const routeClosed = sketch.route.length >= 3 && sketch.route[0] === sketch.route.at(-1);
  const guidance = layoutGuidance(sketch, routeClosed, tool, geometry);

  const runGuidanceAction = (action: GuidanceAction) => {
    if (action === 'first-pulley') addPulleyAt({ x: 0, y: 0 });
    else if (action === 'add-pulley' || action === 'route') {
      setTool(action);
      setInteractionNotice(null);
    }
  };

  return <>
    <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={event => void openFile(event.target.files?.[0])} />
    {(page === 'welcome' || entering) && <div className={'welcome-shell'+(entering?' layout-handoff':'')} inert={entering}
      onAnimationEnd={event=>{if(event.target===event.currentTarget && event.animationName==='welcome-release')setEntering(false)}}>
      <WelcomePage onStart={enterCalculator} onOpenFile={()=>fileInputRef.current?.click()}/>
    </div>}
    {page === 'calculator' && <div className="app-shell" inert={entering} onKeyDown={event => {
      const field = event.target;
      if (event.key === 'Enter' && !event.nativeEvent.isComposing && (field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) {
        event.stopPropagation();
        field.blur();
      }
    }}>
      <header className="topbar">
        <button className="brand" aria-label="Return to Pitch home" onClick={()=>setPage("welcome")}>
          <div className="brand-mark"><img className="pitch-logo" src="./pitch-logo.png" alt="" /></div>
          <div className="brand-name"><b>Pitch</b><small>ROBOTICS DRIVE LAYOUT</small></div>
        </button>
        <div className="topbar-spacer" />
        <div className="topbar-controls"><button className="topbar-action" onClick={()=>setSettings(true)}>Settings</button>

          <button className="topbar-action" type="button" onClick={() => fileInputRef.current?.click()}><Icon name="folder" size={15} />Open file</button>
          <button className="topbar-action" type="button" onClick={saveFile}><Icon name="save" size={15} />Save file</button>
          {!showTips && <button className="topbar-action" type="button" onClick={toggleTips}>
            <Icon name="info" size={15} />Show tips
          </button>}
          {confirmNewLayout || pendingImport ? (
            <div className="new-layout-confirmation" role="group" aria-label="Confirm replacing the current sketch">
              <span>{pendingImport ? "Replace the current sketch?" : "Clear everything on the plane?"}</span>
              <button className="topbar-action" type="button" onClick={() => { setConfirmNewLayout(false); setPendingImport(null); }}>Cancel</button>
              <button className="topbar-action primary" type="button" onClick={pendingImport ? confirmImport : startNewLayout}><Icon name="check" size={15} />{pendingImport ? "Replace sketch" : "Clear plane"}</button>
            </div>
          ) : (
            <button className="topbar-action primary" type="button" onClick={requestNewLayout}><Icon name="trash" size={15} />Clear plane</button>
          )}
        </div>
      </header>

      {settings && <Preferences binds={binds} setBinds={setBinds} light={light} setLight={setLight} close={()=>setSettings(false)}/>}
      <Toolbar binds={binds}
        tool={tool}
        canUndo={history.past.length > 0 || history.activeEdit !== null}
        canRedo={history.future.length > 0}
        onToolChange={(next) => { setTool(next); setInteractionNotice(null); }}
        onUndo={() => { dispatch({ type: 'UNDO' }); setSelectedId(null); }}
        onRedo={() => { dispatch({ type: 'REDO' }); setSelectedId(null); }}
        onFit={fitView}
        onReset={resetView}
      />

      <main className={"workspace-shell"+(collapsed?" collapsed":"")}>
        <aside className="inspector-panel" aria-label="Design properties">
          <div className="pinned-belt-teeth"><span>Belt teeth{sketch.activeBeltId ? ' · ' + sketch.activeBeltId : ''}</span><strong>{geometry.valid && sketch.activeBeltId ? geometry.nearestTeeth + 'T' : '—'}</strong></div>
          <PropertiesPanel sketch={sketch} selectedId={selectedId} onAction={dispatch} onDelete={deleteSelection} onSelect={setSelectedId} onStartAxleStage={startAxleStage} onAddCoaxialPulley={addCoaxialPulley} />
          <BeltPanel sketch={sketch} geometry={geometry} onAction={action => {
            dispatch(action);
            if (action.type === 'SET_ACTIVE_BELT') {
              setTool('select');
              setSelectedId(action.id ? 'BELT' : null);
            } else if (action.type === 'ADD_BELT_STAGE') setTool('route');
          }} />
          <OrderPanel sketch={sketch} onAction={dispatch} />

        </aside>
        <section className="center-workspace" aria-label="Sketch canvas">
          <div className="workspace-subbar"><button aria-label={collapsed?"Show properties":"Hide properties"} aria-expanded={!collapsed} onClick={()=>setCollapsed(!collapsed)}>{collapsed?"+":"−"}</button>
            <span className="view-chip">2D SKETCH</span><span className="subbar-divider" /><span className="subbar-value">XY PLANE</span>
            <div className={`workspace-status${routeClosed && !geometry.valid ? ' invalid' : ''}`}><i />{routeClosed ? geometry.valid ? 'BELT ROUTE CLOSED' : 'INVALID BELT GEOMETRY' : 'SKETCH EDITING'}</div>
          </div>
          <SketchCanvas motion={motion} onShortcuts={()=>setSettings(true)}
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
            onAddCoaxialPulley={addCoaxialPulley}
            onAction={dispatch}
            onToolChange={(next) => { setTool(next); setInteractionNotice(null); }}
            onUndo={() => { dispatch({ type: 'UNDO' }); setSelectedId(null); }}
            onRedo={() => { dispatch({ type: 'REDO' }); setSelectedId(null); }}
            onFit={fitView}
            onReset={resetView}
            canUndo={history.past.length > 0 || history.activeEdit !== null}
            canRedo={history.future.length > 0}
            onAddGear={addGear}
            onAddFreeIdler={addFreeIdler}
            onAddIdlerOnSegment={addIdlerOnSegment}
            onLatchIdlerOnSpan={latchIdlerOnSegment}
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
          {showTips && <section className={`layout-guide${sketch.pulleys.length === 0 ? ' first-run-guide' : ''}`} aria-label="How to build a layout" aria-live="polite">
            <div className="layout-guide-copy">
              <h2>{guidePage ? guideTopics[guidePage - 1]![0] : guidance.title}</h2>
              <p>{guidePage ? guideTopics[guidePage - 1]![1] : guidance.body}</p>
            </div>
            <div className="layout-guide-actions">
              {guidePage === 0 && guidance.action && guidance.actionLabel && <button className="guide-action" type="button" onClick={() => runGuidanceAction(guidance.action)}>
                {guidance.actionLabel}
              </button>}
              {guidePage > 0 && <button className="guide-dismiss" onClick={() => setGuidePage(guidePage - 1)}>Back</button>}
              {guidePage < guideTopics.length && <button className="guide-action" onClick={() => setGuidePage(guidePage + 1)}>Next</button>}
              <button className="guide-dismiss" type="button" onClick={toggleTips}>{guidePage === guideTopics.length ? "Done" : "Skip tips"}</button>
            </div>
          </section>}
          <details className="rpm-board">
            <summary>Drivetrain · RPM and motion</summary>
          <DrivePanel onMotion={setMotion} sketch={sketch} geometry={geometry} onAction={dispatch} />
          </details>
        </section>
      </main>
    </div>}
  </>;
}
