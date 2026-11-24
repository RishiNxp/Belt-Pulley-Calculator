import FitBelt from './FitBelt';
import { useEffect, useState } from 'react';
import type { BeltGeometryResult, Sketch } from '../model';
import type { SketchAction } from '../state';

type BeltPanelProps = { sketch: Sketch; geometry: BeltGeometryResult; onAction: (action: SketchAction) => void };

export default function BeltPanel({ sketch, geometry, onAction }: BeltPanelProps) {
  const teeth = geometry.nearestTeeth;
  const [toleranceDraft, setToleranceDraft] = useState(String(sketch.toleranceTeeth));
  useEffect(() => setToleranceDraft(String(sketch.toleranceTeeth)), [sketch.toleranceTeeth]);

  const commitTolerance = () => {
    const value = toleranceDraft.trim() ? Number(toleranceDraft) : Number.NaN;
    if (!Number.isFinite(value) || value < 0) {
      setToleranceDraft(String(sketch.toleranceTeeth));
      return;
    }
    onAction({ type: 'SET_TOLERANCE', value });
    setToleranceDraft(String(value));
  };

  const hasBelts = (sketch.transmission?.belts.length ?? 0) > 0;
  const hasActiveBelt = sketch.activeBeltId != null;
  const emptyHint = sketch.pulleys.length < 2
    ? 'Add at least two pulleys to calculate a belt length.'
    : !hasActiveBelt
      ? 'Select a belt or start another belt to edit its route.'
    : sketch.route.length === 0
      ? 'Choose Create belt, select pulleys in belt order, then select the first pulley again to finish.'
      : sketch.route.length === 1
        ? `Select one more pulley, then select ${sketch.route[0]} again to close the route.`
        : sketch.route.length < 3
          ? `Select the remaining pulleys in order, then select ${sketch.route[0]} again to close the route.`
      : geometry.diagnostic ?? 'Check the route and pulley positions, then try closing the belt again.';

  return <section className="belt-panel panel-section" aria-label="Belt calculation">
    <div className="panel-section-heading"><span className="panel-section-title">Belt size</span></div>
    {sketch.transmission && hasBelts && <div className="stage-controls" aria-label="Belt stages">
      <button type="button" aria-pressed={!hasActiveBelt}
        className="topbar-action" onClick={() => onAction({ type: 'SET_ACTIVE_BELT', id: null })}>No belt</button>
      {sketch.transmission.belts.map((belt, index) => <button key={belt.id} type="button" aria-pressed={sketch.activeBeltId === belt.id}
        className="topbar-action" onClick={() => onAction({ type: 'SET_ACTIVE_BELT', id: belt.id })}>Belt {index + 1} · {belt.profile}</button>)}
      <button type="button" className="topbar-action" onClick={() => onAction({ type: 'ADD_BELT_STAGE', id: `B${sketch.transmission!.belts.length + 1}` })}>Start another belt</button>
    </div>}
    {hasActiveBelt && <label className="property-field profile-field">
      <span>Belt profile</span>
      <select value={sketch.profile} onChange={(event) => onAction({ type: 'SET_BELT_PROFILE', profile: event.target.value as Sketch['profile'] })}>
        <option value="GT2">GT2 · 2 mm pitch</option>
        <option value="GT2 3mm">GT2 · 3 mm pitch</option>
        <option value="GT3">GT3 · 3 mm pitch</option>
        <option value="HTD 5M">HTD 5M · 5 mm pitch</option>
      </select>
    </label>}

    {geometry.valid && hasActiveBelt ? <>
      <div className={`belt-size-result ${geometry.passesTolerance ? 'pass' : 'fail'}`}>
        <span className="eyebrow">NEAREST WHOLE TOOTH COUNT</span>
        <strong>{teeth ?? '—'}<small>T</small></strong>
        <div className="nominal-belt-length">Nominal length <b>{teeth == null ? '—' : (teeth * geometry.pitchMm).toFixed(2)} mm</b></div>
      </div>
      <div className={`tolerance-status ${geometry.passesTolerance ? 'pass' : 'fail'}`}>
        <span className="tolerance-led" />
        <div><b>{geometry.passesTolerance ? 'WITHIN TOLERANCE' : 'OUTSIDE TOLERANCE'}</b></div>
      </div>
    </> : <div className="calculation-empty" role="status">
      <b>{sketch.pulleys.length < 2 ? 'No belt yet' : !hasActiveBelt ? 'No belt selected' : sketch.route.length < 3 ? 'Create a belt route' : 'Belt path unavailable'}</b>
      <p>{emptyHint}</p>
    </div>}

    {geometry.valid && hasActiveBelt && <label className="tolerance-control" htmlFor="tolerance-input">
      <span>Tooth tolerance</span>
      <span className="tolerance-input-wrap">±<input
        id="tolerance-input"
        type="text"
        inputMode="decimal"
        value={toleranceDraft}
        onChange={(event) => setToleranceDraft(event.target.value)}
        onBlur={commitTolerance}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        aria-label="Tooth tolerance"
      />T</span>
    </label>}
    <FitBelt sketch={sketch} onAction={onAction}/>
  </section>;
}
