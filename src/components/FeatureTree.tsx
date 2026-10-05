import type { Sketch } from '../model';

type FeatureTreeProps = {
  sketch: Sketch;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export default function FeatureTree({ sketch, selectedId, onSelect }: FeatureTreeProps) {
  const isClosed = sketch.route.length > 1 && sketch.route[0] === sketch.route.at(-1);
  const routeIds = isClosed ? sketch.route.slice(0, -1) : sketch.route;
  return (
    <aside className="feature-tree panel-column" aria-label="Sketch feature tree">
      <div className="panel-heading">
        <span className="eyebrow">DOCUMENT</span>
        <span className="tree-root-name"><i className="status-dot" /> SKETCH 01</span>
      </div>
      <div className="tree-section">
        <div className="tree-section-heading"><span>COMPONENTS</span><span>{sketch.pulleys.length + sketch.idlers.length}</span></div>
        <div className="tree-group-name">Pulleys <span>{sketch.pulleys.length}</span></div>
        {sketch.pulleys.map((pulley) => (
          <button
            type="button"
            key={pulley.id}
            className={`tree-row${selectedId === pulley.id ? ' selected' : ''}`}
            onClick={() => onSelect(pulley.id)}
          >
            <span className="tree-glyph pulley-glyph">◉</span>
            <span className="tree-row-text"><b>{pulley.id}</b><small>{pulley.toothCount}T · {pulley.profile}</small></span>
            {pulley.isOrigin && <span className="origin-chip">O</span>}
          </button>
        ))}
        <div className="tree-group-name tree-gap">Tensioners <span>{sketch.idlers.length}</span></div>
        {sketch.idlers.map((idler) => (
          <button
            type="button"
            key={idler.id}
            className={`tree-row${selectedId === idler.id ? ' selected' : ''}`}
            onClick={() => onSelect(idler.id)}
          >
            <span className="tree-glyph idler-glyph">◎</span>
            <span className="tree-row-text"><b>{idler.label}</b><small>Ø {idler.diameterMm.toFixed(2)} mm · smooth</small></span>
          </button>
        ))}
      </div>

      <div className="tree-section">
        <div className="tree-section-heading"><span>RELATIONS</span><span>{sketch.dimensions.length + sketch.constraints.length}</span></div>
        <div className="tree-group-name">Dimensions <span>{sketch.dimensions.length}</span></div>
        {sketch.dimensions.map((dimension) => (
          <button
            type="button"
            key={dimension.id}
            className={`tree-row compact-row${selectedId === dimension.id ? ' selected' : ''}`}
            onClick={() => onSelect(dimension.id)}
          >
            <span className="tree-glyph dimension-glyph">↔</span>
            <span className="tree-row-text"><b>{dimension.id}</b><small>{dimension.valueMm.toFixed(2)} mm</small></span>
          </button>
        ))}
        <div className="tree-group-name tree-gap">Constraints <span>{sketch.constraints.length}</span></div>
        {sketch.constraints.map((constraint) => (
          <button
            type="button"
            key={constraint.id}
            className={`tree-row compact-row${selectedId === constraint.id ? ' selected' : ''}`}
            onClick={() => onSelect(constraint.id)}
          >
            <span className="tree-glyph constraint-glyph-tree">{constraint.kind === 'horizontal' ? 'H' : 'V'}</span>
            <span className="tree-row-text"><b>{constraint.firstId} / {constraint.secondId}</b><small>{constraint.kind}</small></span>
          </button>
        ))}
      </div>

      <div className="tree-section route-section">
        <div className="tree-section-heading"><span>BELT ROUTE</span><span className={sketch.route.length > 1 && sketch.route[0] === sketch.route.at(-1) ? 'route-live' : ''}>
          {sketch.route.length > 1 && sketch.route[0] === sketch.route.at(-1) ? 'CLOSED' : sketch.route.length ? 'EDITING' : '—'}
        </span></div>
        <div className="route-tree-value">{routeIds.length ? routeIds.join('  →  ') : 'Select Create belt, then pick components.'}</div>
      </div>

      <div className="tree-footer"><span className="tree-footer-line" />MILLIMETERS <span>MM</span></div>
    </aside>
  );
}
