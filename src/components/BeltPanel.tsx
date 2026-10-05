import { useEffect, useState } from 'react';
import type { BeltGeometryResult, Sketch } from '../model';
import type { SketchAction } from '../state';

function signed(value: number, digits = 2): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
}

type BeltPanelProps = { sketch: Sketch; geometry: BeltGeometryResult; onAction: (action: SketchAction) => void };

export default function BeltPanel({ sketch, geometry, onAction }: BeltPanelProps) {
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

  return <section className="belt-panel panel-section" aria-label="Belt calculation">
    <div className="panel-section-heading">
      <span className="eyebrow">LIVE CALCULATION</span>
      <span className="panel-section-title">Belt size</span>
    </div>
    <label className="property-field profile-field">
      <span>Belt profile</span>
      <select value={sketch.profile} onChange={(event) => onAction({ type: 'SET_PROFILE', profile: event.target.value as Sketch['profile'] })}>
        <option value="GT2">GT2 · 2 mm pitch</option>
        <option value="GT3">GT3 · 3 mm pitch</option>
        <option value="HTD 5M">HTD 5M · 5 mm pitch</option>
      </select>
    </label>

    {geometry.valid ? <>
      <div className={`belt-size-result ${geometry.passesTolerance ? 'pass' : 'fail'}`}>
        <span className="eyebrow">NEAREST WHOLE TOOTH COUNT</span>
        <strong>{geometry.nearestTeeth}<small>T</small></strong>
        <div className="nominal-belt-length">Nominal length <b>{(geometry.nearestTeeth! * geometry.pitchMm).toFixed(2)} mm</b></div>
      </div>
      <div className={`tolerance-status ${geometry.passesTolerance ? 'pass' : 'fail'}`}>
        <span className="tolerance-led" />
        <div><b>{geometry.passesTolerance ? 'WITHIN TOLERANCE' : 'OUTSIDE TOLERANCE'}</b></div>
      </div>
      <div className="calculation-values">
        <div><span>Path length</span><b>{geometry.lengthMm!.toFixed(2)} mm</b></div>
        <div className="exact-tooth-count"><span>Exact tooth count</span><b>{geometry.exactTeeth!.toFixed(3)} T</b></div>
        <div><span>Length error · path − nominal</span><b>{signed(geometry.nearestLengthErrorMm!)} mm</b></div>
        <div><span>Tooth error · exact − whole</span><b>{signed(geometry.nearestToothError!, 3)} T</b></div>
      </div>
    </> : <div className="calculation-empty" role="status">
      <b>{sketch.pulleys.length < 2 ? 'Add two pulleys' : sketch.route.length < 3 ? 'Create a belt route' : 'Belt path unavailable'}</b>
      {geometry.diagnostic && <p>{geometry.diagnostic}</p>}
    </div>}

    <label className="tolerance-control" htmlFor="tolerance-input">
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
    </label>
  </section>;
}
