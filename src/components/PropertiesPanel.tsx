import { useEffect, useState } from 'react';
import type { Sketch } from '../model';
import type { SketchAction } from '../state';
import { hasOtherPulleyOnBeltAxle } from '../transmission';
import Icon from './Icon';

export function NumberField({ label, value, unit, disabled, step = '0.01', min, onChange }: {
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

type PropertiesPanelProps = { sketch: Sketch; selectedId: string | null; onAction: (action: SketchAction) => void; onDelete: (id: string) => void; onSelect: (id: string) => void; onStartAxleStage: (id: string) => void; onAddCoaxialPulley: (id: string) => void };

export default function PropertiesPanel({ sketch, selectedId, onAction, onDelete, onSelect, onStartAxleStage, onAddCoaxialPulley }: PropertiesPanelProps) {
  const pulley = sketch.pulleys.find((item) => item.id === selectedId);
  const pulleyBeltId = pulley ? sketch.transmission?.belts.find(belt => belt.route.includes(pulley.id))?.id ?? '' : '';
  const idler = sketch.idlers.find((item) => item.id === selectedId);
  const idlerBelt = idler
    ? sketch.transmission?.belts.find(belt => belt.id === idler.beltId || belt.route.includes(idler.id))
    : undefined;
  const dimension = sketch.dimensions.find((item) => item.id === selectedId);
  const constraint = sketch.constraints.find((item) => item.id === selectedId);
  const gear = sketch.transmission?.gears.find((item) => item.id === selectedId);
  const selectedComponentId = pulley?.id ?? idler?.id ?? gear?.id;
  const selectedGearAxleId = gear?.axleId;
  const axle = sketch.transmission?.axles.find(item => selectedComponentId && (item.componentIds.includes(selectedComponentId) || item.id === selectedGearAxleId));
  const stack = axle ? [
    ...sketch.pulleys.filter(item => axle.componentIds.includes(item.id)).map(item => ({ id: item.id, name: item.label, kind: 'Pulley' })),
    ...sketch.idlers.filter(item => axle.componentIds.includes(item.id)).map(item => ({ id: item.id, name: item.label, kind: 'Tensioner' })),
    ...(sketch.transmission?.gears.filter(item => item.axleId === axle.id) ?? []).map(item => ({ id: item.id, name: item.name, kind: 'Gear' })),
  ] : [];

  return <section className="properties-panel panel-section" aria-label="Selected object properties">
    <div className="panel-section-heading"><span className="panel-section-title">Properties</span></div>
    {pulley && <div key={pulley.id}>
      <div className="selection-heading">
        <span className="selection-marker pulley-marker"><Icon name="pulley" size={18} /></span>
        <div><b>{pulley.isOrigin ? 'Fixed origin' : (pulley.id === sketch.drive?.driverId ? 'Driver pulley' : 'Toothed pulley')}</b><small>{pulley.id === sketch.drive?.driverId ? 'Driver · ' : ''}{pulley.id}</small></div>
      </div>
      <label className="property-field"><span>Name</span><input aria-label="Pulley name" value={pulley.label} onChange={e => onAction({ type: 'SET_LABEL', id: pulley.id, label: e.target.value })} /></label>
      <label className="property-field"><span>Belt membership</span><select aria-label="Pulley belt membership" value={pulleyBeltId}
        onChange={event => onAction({ type: 'SET_PULLEY_BELT', id: pulley.id, beltId: event.target.value || null })}>
        <option value="">No belt</option>
        {(sketch.transmission?.belts ?? []).map((belt, index) => <option key={belt.id} value={belt.id} disabled={hasOtherPulleyOnBeltAxle(sketch, pulley.id, belt.id)}>Belt {index + 1} · {belt.profile}</option>)}
      </select></label>
      {sketch.route.includes(pulley.id) && <label className="property-field"><span>Active belt profile</span><select aria-label="Active belt profile" value={sketch.profile} onChange={event => onAction({ type: 'SET_BELT_PROFILE', profile: event.target.value as Sketch['profile'] })}><option>GT2</option><option>GT2 3mm</option><option>GT3</option><option>HTD 5M</option></select></label>}
      <button className="inspector-action" type="button" onClick={() => onAddCoaxialPulley(pulley.id)}><Icon name="plus" size={15} />Add pulley to this axle</button>
      <button className="inspector-action" type="button" onClick={() => onStartAxleStage(pulley.id)}><Icon name="belt" size={15} />Start a belt from this axle</button>
      <button className="inspector-action" type="button" onClick={() => {
        const next = Math.max(0, ...(sketch.transmission?.gears ?? []).map(item => Number(item.id.replace(/^\D+/, '')) || 0)) + 1;
        const axleId = sketch.transmission?.axles.find(axle => axle.componentIds.includes(pulley.id))?.id ?? `AX-${pulley.id}`;
        onAction({ type: 'ADD_GEAR', hostId: pulley.id, x: pulley.x, y: pulley.y, gear: { id: `G${next}`, name: `Gear ${next}`, axleId, plane: 0, toothCount: 24, moduleMm: 0.8, pressureAngleDeg: 20, boreMm: 8 } });
      }}><Icon name="gear" size={15} />Add gear to this axle</button>
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
        <span className="selection-marker idler-marker"><Icon name="tensioner" size={18} /></span>
        <div><b>{idler.label}</b><small>{idlerBelt ? `Locked to ${idlerBelt.id}` : 'Free tensioner'}</small></div>
      </div>
      <label className="property-field"><span>Name</span><input aria-label="Tensioner name" value={idler.label} onChange={e => onAction({ type: 'SET_LABEL', id: idler.id, label: e.target.value })} /></label>
      <label className="property-field"><span>Tension side</span><select aria-label="Tension side" value={idler.tensionSide ?? 'outside'} onChange={event => onAction({ type: 'UPDATE_IDLER', id: idler.id, changes: { tensionSide: event.target.value as 'inside' | 'outside' } })}>
        <option value="outside">Outside · push belt outward</option>
        <option value="inside">Inside · expand belt path</option>
      </select></label>
      {idlerBelt && <div className="idler-attachment-status" role="status">Locked to {idlerBelt.id}; right-click to unlock</div>}
      <NumberField label="Tensioner diameter" value={idler.diameterMm} unit="mm" min={0.01}
        onChange={(value) => onAction({ type: 'UPDATE_IDLER', id: idler.id, changes: { diameterMm: Math.max(0.01, value) } })} />
      <div className="property-grid">
        <NumberField label="Center X" value={idler.x} unit="mm"
          onChange={(value) => onAction({ type: 'MOVE_OBJECT', id: idler.id, x: value, y: idler.y })} />
        <NumberField label="Center Y" value={idler.y} unit="mm"
          onChange={(value) => onAction({ type: 'MOVE_OBJECT', id: idler.id, x: idler.x, y: value })} />
      </div>
      <button className="danger-button" type="button" onClick={() => onDelete(idler.id)}>Delete tensioner <kbd>Del</kbd></button>
    </div>}
    {gear && <div key={gear.id}>
      <div className="selection-heading"><span className="selection-marker pulley-marker"><Icon name="gear" size={18} /></span><div><b>{gear.name}</b><small>MOD {gear.moduleMm} · {gear.pressureAngleDeg}°</small></div></div>
      <div className="calculation-values"><div><span>Teeth</span><b>{gear.toothCount}T</b></div><div><span>Pitch diameter</span><b>{(gear.moduleMm * gear.toothCount).toFixed(2)} mm</b></div><div><span>Bore</span><b>{gear.boreMm} mm</b></div><div><span>Axle</span><b>{gear.axleId}</b></div></div>
      <NumberField label="Gear module" unit="mm" value={gear.moduleMm} min={Number.MIN_VALUE} onChange={moduleMm => onAction({type:"SET_GEAR_MODULE", id:gear.id, moduleMm})} />
      <label className="property-field"><span>Tooth count</span><input aria-label="Gear tooth count" type="number" min="1" step="1" value={gear.toothCount} onChange={event => onAction({ type: 'UPDATE_GEAR', id: gear.id, toothCount: Number(event.target.value) })} /></label>
      <p>Drag this gear near another gear and release to mesh their pitch circles.</p>
    </div>}
    {stack.length > 0 && <div className="axle-stack" aria-label="Axle stack"><b>On this axle</b>{stack.map(member => {
      const beltId = sketch.transmission?.belts.find(belt => belt.route.includes(member.id))?.id ?? '';
      return <div className="axle-stack-member" key={member.id}>
        <button type="button" className="topbar-action" aria-pressed={member.id === selectedId} aria-label={`Select ${member.kind.toLowerCase()} ${member.name} ${member.id}`} onClick={() => onSelect(member.id)}>
          <span className="axle-stack-name">{member.name}</span><small>{member.kind} · {member.id}</small>
        </button>
        {member.kind === 'Pulley' && <select aria-label={`Belt for ${member.name}`} value={beltId}
          onChange={event => onAction({ type: 'SET_PULLEY_BELT', id: member.id, beltId: event.target.value || null })}>
          <option value="">No belt</option>
          {(sketch.transmission?.belts ?? []).map((belt, index) => <option key={belt.id} value={belt.id} disabled={hasOtherPulleyOnBeltAxle(sketch, member.id, belt.id)}>Belt {index + 1} · {belt.profile}</option>)}
        </select>}
      </div>;
    })}</div>}
    {dimension && <>
      <div className="selection-heading"><span className="selection-marker dimension-marker"><Icon name="ruler" size={17} /></span><div><b>{dimension.id}</b><small>{dimension.kind} dimension</small></div></div>
      <div className="property-note">Double-click the canvas value to edit.</div>
      <button className="danger-button" type="button" onClick={() => onAction({ type: 'REMOVE_DIMENSION', id: dimension.id })}>Remove dimension</button>
    </>}
    {constraint && <>
      <div className="selection-heading"><span className="selection-marker constraint-marker">{constraint.kind === 'horizontal' ? 'H' : 'V'}</span><div><b>{constraint.kind} constraint</b><small>{constraint.firstId} · {constraint.secondId}</small></div></div>
      <button className="danger-button" type="button" onClick={() => onAction({ type: 'REMOVE_CONSTRAINT', id: constraint.id })}>Remove constraint</button>
    </>}
    {selectedId === 'BELT' && <div><h3>Belt components</h3>{Array.from(new Set(sketch.route)).map(id => {
      const part = [...sketch.pulleys, ...sketch.idlers].find(item => item.id === id);
      return part && <button className="inspector-action" key={id} onClick={() => onSelect(id)}>{part.label} · {'toothCount' in part ? part.toothCount + 'T pulley' : 'Tensioner'}</button>;
    })}</div>}
    {selectedId === 'BELT' && <div className="selection-heading"><b>Belt route</b><button className="danger-button" type="button" onClick={() => onDelete('BELT')}>Delete belt <kbd>Del</kbd></button></div>}
    {!pulley && !idler && !gear && !dimension && !constraint && selectedId !== 'BELT' && <div className="empty-properties">
      <b>Nothing selected</b><p>Select a pulley, tensioner, gear, or dimension on the canvas to edit its properties.</p>
    </div>}
  </section>;
}
