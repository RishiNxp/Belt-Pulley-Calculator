import { useEffect, useState } from 'react';

import {operatingEstimate} from '../engineering';
import type { BeltGeometryResult, Sketch } from '../model';
import type { SketchAction } from '../state';
import { calculateTransmissionSpeeds, migrateLegacyTransmission } from '../transmission';

export default function DrivePanel({ sketch, onAction, onMotion }: {
  onMotion:(rpm:Record<string,number>)=>void; sketch: Sketch; geometry: BeltGeometryResult; onAction: (action: SketchAction) => void;
}) {
  const transmission = sketch.transmission ?? migrateLegacyTransmission(sketch);
  const parts = [...sketch.pulleys, ...transmission.gears.map(g => ({ id: g.id, label: g.name, toothCount: g.toothCount }))];
  const remaining = new Set(parts.map(p => p.id));
  const trains: (typeof parts)[] = [];
  for (const part of parts) {
    if (!remaining.has(part.id)) continue;
    const { speeds } = calculateTransmissionSpeeds(transmission, part.id, 1);
    const members = parts.filter(p => p.id in speeds);
    for (const member of members) remaining.delete(member.id);
    if (members.length >= 2) trains.push(members);
  }
  const connected = trains.find(train => train.some(p => p.id === sketch.drive?.driverId)) ?? trains[0] ?? [];
  const driverId = connected.find(p => p.id === sketch.drive?.driverId)?.id ?? connected[0]?.id ?? '';
  const outputId = connected.find(p => p.id === sketch.drive?.outputId)?.id ?? connected.at(-1)?.id ?? '';
  const rpm = sketch.drive?.driverRpm ?? null;
  const [rpmDraft, setRpmDraft] = useState(rpm === null ? '' : String(rpm));
  useEffect(() => setRpmDraft(rpm === null ? '' : String(rpm)), [rpm]);
  const { speeds, conflict } = calculateTransmissionSpeeds(transmission, driverId, 1);
  const multiplier = speeds[outputId];
  const outputRpm = rpm !== null && multiplier !== undefined ? rpm * multiplier : null;
  const [playing,play]=useState(false);
  const torque=sketch.drive?.torque ?? '0.5';
  const setTorque=(value:string)=>onAction({type:'SET_DRIVE',changes:{torque:value}});
  const efficiency=sketch.drive?.efficiency ?? '90';
  const setEfficiency=(value:string)=>onAction({type:'SET_DRIVE',changes:{efficiency:value}});
  const diameter=sketch.drive?.diameter ?? '96';
  const setDiameter=(value:string)=>onAction({type:'SET_DRIVE',changes:{diameter:value}});
  const motor=sketch.drive?.motor ?? 'Custom';
  const setMotor=(value:string)=>onAction({type:'SET_DRIVE',changes:{motor:value}});
  const signature=JSON.stringify(!conflict && rpm && connected.length ? Object.fromEntries(Object.entries(speeds).map(([id,n])=>[id,n*rpm])) : {});
  useEffect(()=>{onMotion(playing ? JSON.parse(signature) : {});return ()=>onMotion({});},[signature,playing,onMotion]);
  const estimate=rpm!==null && multiplier!==undefined && torque.trim() && efficiency.trim() && diameter.trim() ? operatingEstimate(rpm,multiplier,+torque,+efficiency,+diameter) : null;
  const commitRpm = () => {
    const value = rpmDraft.trim() ? Number(rpmDraft) : null;
    if (value !== null && (!Number.isFinite(value) || value < 0)) { setRpmDraft(rpm === null ? '' : String(rpm)); return; }
    onAction({ type: 'SET_DRIVE', changes: { driverRpm: value } });
  };
  return <section className="drive-panel panel-section" aria-label="Drivetrain controls">
    {connected.length >= 2 ? <>
      <label className="drive-field"><span>Train</span><select value={connected[0]!.id} onChange={e => { const train = trains.find(t => t[0]!.id === e.target.value)!; onAction({type:"SET_DRIVE", changes:{driverId:train[0]!.id, outputId:train.at(-1)!.id}}); }}>{trains.map((t,i) => <option key={t[0]!.id} value={t[0]!.id}>Train {i+1} · {t[0]!.label}</option>)}</select></label>
      <label className="drive-field"><span>Driver</span><select aria-label="Driving component" value={driverId}
        onChange={event => onAction({ type: 'SET_DRIVE', changes: { driverId: event.target.value } })}>
        {connected.map(pulley => <option key={pulley.id} value={pulley.id}>{pulley.label} · {pulley.toothCount}T</option>)}
      </select></label>
      <label className="drive-field"><span>Driven output</span><select aria-label="Driven component" value={outputId}
        onChange={event => onAction({ type: 'SET_DRIVE', changes: { outputId: event.target.value } })}>
        {connected.map(pulley => <option key={pulley.id} value={pulley.id}>{pulley.label} · {pulley.toothCount}T</option>)}
      </select></label>
      <label className="drive-field">Motor operating point<select value={motor} onChange={e=>{
        const name=e.target.value;setMotor(name);
        if(name!=='Custom'){setTorque(name==='High speed example'?'0.1':'1');onAction({type:'SET_DRIVE',changes:{driverRpm:name==='High speed example'?3000:300}});}
      }}>{['Custom','High speed example','Geared motor example'].map(name=><option key={name}>{name}</option>)}</select></label>
      <label className="drive-field"><span>Driver RPM</span><input type="text" inputMode="decimal" aria-label="Driver RPM"
        placeholder="Optional" value={rpmDraft} onChange={event => {setMotor('Custom');setRpmDraft(event.target.value)}} onBlur={commitRpm}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
      <button className="topbar-action" disabled={!rpm||!!conflict} onClick={()=>play(!playing)}>{playing?'Stop motion':'Play motion'}</button>
      {playing && !conflict && rpm!==null && <div className="calculation-values"><small>Relative motion · positive RPM turns clockwise</small>{connected.map(p=><div key={p.id}>{p.label} · {(speeds[p.id]! * rpm).toFixed(1)} RPM {speeds[p.id]!<0?'↺':'↻'}</div>)}</div>}
      {conflict && <p role="status">{conflict}</p>}
      {!conflict && multiplier !== undefined && <div className="calculation-values drive-values">
        <div className="drive-primary"><span title="Driver speed ÷ output speed">Reduction</span><b>{(1 / Math.abs(multiplier)).toFixed(3)} : 1</b></div>
        {outputRpm !== null && outputRpm !== undefined && <div className="drive-primary"><span>Output RPM</span><b>{outputRpm.toLocaleString('en-US', { maximumFractionDigits: 2 })}</b></div>}
        {<div className="drive-direction"><span>Rotation</span><b>{multiplier < 0 ? 'Opposite direction' : 'Same direction'}</b></div>}
      </div>}
      <details><summary>Wheel speed and shaft torque</summary>
        {([[ 'Motor torque (N·m)',torque,setTorque],['Train efficiency (%)',efficiency,setEfficiency],['Wheel diameter (mm)',diameter,setDiameter]] as const).map(([label,value,set])=><label className="drive-field" key={label}>{label}<input type="number" value={value} onChange={e=>{set(e.target.value);if(label.startsWith('Motor'))setMotor('Custom');}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></label>)}
        {estimate && !conflict ? <p>Output torque <b>{estimate.torque.toFixed(2)} N·m</b><br/>Ground speed <b>{estimate.speed.toFixed(2)} m/s</b></p>:<p>Enter a valid motor operating point and wheel size.</p>}
        <small>Use motor speed and torque at the same load. Assumes one output, whole-train efficiency and no wheel slip.</small>
      </details>
    </> : <div className="empty-properties">Mesh two gears or close a belt to calculate a train ratio.</div>}
  </section>;
}
