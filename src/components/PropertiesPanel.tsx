import { useEffect, useState } from 'react';
import type { Sketch } from '../model';
import type { SketchAction } from '../state';

function NumberField({ label, value, unit, disabled, step = '0.01', min, onChange }: {
  label: string;
  value: number;
  unit?: string;
  disabled?: boolean;
  step?: string;
  min?: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = draft.trim() ? Number(draft) : Number.NaN;
    if (!Number.isFinite(parsed) || (min !== undefined && parsed < min) || (step === '1' && !Number.isInteger(parsed))) setDraft(String(value));
    else {
      if (parsed !== value) onChange(parsed);
      // The relation solver may keep the original coordinate or reject the edit.
      // Display the committed prop; an accepted change refreshes it on render.
      setDraft(String(value));
    }
  };
  return <label className="property-field">
    <span>{label}</span>
    <div className="property-input-wrap">
      <input type="text" inputMode={step === '1' ? 'numeric' : 'decimal'} value={draft} disabled={disabled}
        onChange={(event) => setDraft(event.target.value)} onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} aria-label={label} />
      {unit && <small>{unit}</small>}
    </div>
  </label>;
}

type PropertiesPanelProps = { sketch: Sketch; selectedId: string | null; onAction: (action: SketchAction) => void; onDelete: (id: string) => void };

export default function PropertiesPanel({ sketch, selectedId, onAction, onDelete }: PropertiesPanelProps) {
  const pulley = sketch.pulleys.find((item) => item.id === selectedId);
  const idler = sketch.idlers.find((item) => item.id === selectedId);
  const dimension = sketch.dimensions.find((item) => item.id === selectedId);
  const constraint = sketch.constraints.find((item) => item.id === selectedId);

  return <section className="properties-panel panel-section" aria-label="Selected object properties">
    <div className="panel-section-heading"><span className="eyebrow">SELECTION</span><span className="panel-section-title">Properties</span></div>
    {pulley && <div key={pulley.id}>
      <div className="selection-heading">
        <span className="selection-marker pulley-marker">◉</span>
        <div><b>{pulley.id}</b><small>{pulley.isOrigin ? 'Fixed origin' : 'Toothed pulley'}</small></div>
      </div>
      <NumberField label="Tooth count" value={pulley.toothCount} step="1" min={1}
        onChange={(value) => onAction({ type: 'UPDATE_PULLEY', id: pulley.id, changes: { toothCount: value } })} />
      <div className="property-grid">
        <NumberField label="Center X" value={pulley.x} unit="mm" disabled={pulley.isOrigin}
          onChange={(value) => onAction({ type: 'MOVE_OBJECT', id: pulley.id, x: value, y: pulley.y })} />
        <NumberField label="Center Y" value={pulley.y} unit="mm" disabled={pulley.isOrigin}
          onChange={(value) => onAction({ type: 'MOVE_OBJECT', id: pulley.id, x: pulley.x, y: value })} />
      </div>
      <button className="danger-button" type="button" onClick={() => onDelete(pulley.id)}>Delete pulley <kbd>Del</kbd></button>
    </div>}
    {idler && <div key={idler.id}>
      <div className="selection-heading">
        <span className="selection-marker idler-marker">◎</span>
        <div><b>{idler.id}</b><small>Smooth back tensioner</small></div>
      </div>
      <NumberField label="Idler diameter" value={idler.diameterMm} unit="mm" min={0.01}
        onChange={(value) => onAction({ type: 'UPDATE_IDLER', id: idler.id, changes: { diameterMm: Math.max(0.01, value) } })} />
      <div className="property-grid">
        <NumberField label="Center X" value={idler.x} unit="mm"
          onChange={(value) => onAction({ type: 'MOVE_OBJECT', id: idler.id, x: value, y: idler.y })} />
        <NumberField label="Center Y" value={idler.y} unit="mm"
          onChange={(value) => onAction({ type: 'MOVE_OBJECT', id: idler.id, x: idler.x, y: value })} />
      </div>
      <button className="danger-button" type="button" onClick={() => onDelete(idler.id)}>Delete tensioner <kbd>Del</kbd></button>
    </div>}
    {dimension && <>
      <div className="selection-heading"><span className="selection-marker dimension-marker">↔</span><div><b>{dimension.id}</b><small>{dimension.kind} dimension</small></div></div>
      <div className="property-note">Double-click the canvas value to edit.</div>
      <button className="danger-button" type="button" onClick={() => onAction({ type: 'REMOVE_DIMENSION', id: dimension.id })}>Remove dimension</button>
    </>}
    {constraint && <>
      <div className="selection-heading"><span className="selection-marker constraint-marker">{constraint.kind === 'horizontal' ? 'H' : 'V'}</span><div><b>{constraint.kind} constraint</b><small>{constraint.firstId} · {constraint.secondId}</small></div></div>
      <button className="danger-button" type="button" onClick={() => onAction({ type: 'REMOVE_CONSTRAINT', id: constraint.id })}>Remove constraint</button>
    </>}
    {selectedId === 'BELT' && <div className="selection-heading"><b>Belt route</b><button className="danger-button" type="button" onClick={() => onDelete('BELT')}>Delete belt <kbd>Del</kbd></button></div>}
    {!pulley && !idler && !dimension && !constraint && selectedId !== 'BELT' && <div className="empty-properties">Select geometry in the sketch.</div>}
  </section>;
}
