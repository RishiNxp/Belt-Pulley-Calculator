import { useEffect, useState } from 'react';
import { calculateDrive } from '../drive';
import type { BeltGeometryResult, Sketch } from '../model';
import type { SketchAction } from '../state';

export default function DrivePanel({ sketch, geometry, onAction }: {
  sketch: Sketch; geometry: BeltGeometryResult; onAction: (action: SketchAction) => void;
}) {
  const closed = sketch.route.length >= 3 && sketch.route[0] === sketch.route.at(-1);
  const connected = closed ? sketch.pulleys.filter(pulley => sketch.route.includes(pulley.id)) : [];
  const driverId = connected.find(pulley => pulley.id === sketch.drive?.driverId)?.id ?? connected[0]?.id ?? '';
  const outputId = connected.find(pulley => pulley.id === sketch.drive?.outputId)?.id
    ?? connected.find(pulley => pulley.id !== driverId)?.id ?? '';
  const rpm = sketch.drive?.driverRpm ?? null;
  const [rpmDraft, setRpmDraft] = useState(rpm === null ? '' : String(rpm));
  useEffect(() => setRpmDraft(rpm === null ? '' : String(rpm)), [rpm]);
  const drive = calculateDrive(sketch, driverId, outputId, rpm);
  const commitRpm = () => {
    const value = rpmDraft.trim() ? Number(rpmDraft) : null;
    if (value !== null && (!Number.isFinite(value) || value < 0)) { setRpmDraft(rpm === null ? '' : String(rpm)); return; }
    onAction({ type: 'SET_DRIVE', changes: { driverRpm: value } });
  };
  return <section className="drive-panel panel-section" aria-label="Pulley drive ratio">
    <div className="panel-section-heading"><span className="eyebrow">DRIVE</span></div>
    {connected.length >= 2 ? <>
      <label className="drive-field"><span>Driver</span><select aria-label="Driver pulley" value={driverId}
        onChange={event => onAction({ type: 'SET_DRIVE', changes: { driverId: event.target.value } })}>
        {connected.map(pulley => <option key={pulley.id} value={pulley.id}>{pulley.id} · {pulley.toothCount}T</option>)}
      </select></label>
      <label className="drive-field"><span>Output</span><select aria-label="Output pulley" value={outputId}
        onChange={event => onAction({ type: 'SET_DRIVE', changes: { outputId: event.target.value } })}>
        {connected.map(pulley => <option key={pulley.id} value={pulley.id}>{pulley.id} · {pulley.toothCount}T</option>)}
      </select></label>
      <label className="drive-field"><span>Driver RPM</span><input type="text" inputMode="decimal" aria-label="Driver RPM"
        placeholder="Optional" value={rpmDraft} onChange={event => setRpmDraft(event.target.value)} onBlur={commitRpm}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
      {drive && <div className="calculation-values drive-values">
        <div className="drive-primary"><span title="Output teeth ÷ driver teeth">Reduction</span><b>{drive.reduction.toFixed(3)} : 1</b></div>
        <div><span>Output speed</span><b>{drive.speedMultiplier.toFixed(3)}×</b></div>
        <div><span>Ideal torque*</span><b>{drive.idealTorqueMultiplier.toFixed(3)}×</b></div>
        {drive.outputRpm !== null && <div className="drive-primary"><span>Output RPM</span><b>{drive.outputRpm.toLocaleString('en-US', { maximumFractionDigits: 2 })}</b></div>}
        {geometry.valid && !sketch.idlers.some(idler => sketch.route.includes(idler.id)) && <div className="drive-direction"><span>Rotation</span><b>Same direction</b></div>}
        <small>*Ideal, ignoring losses.</small>
      </div>}
    </> : <div className="empty-properties">Close a belt route to choose driver and output.</div>}
  </section>;
}
