import {useState} from 'react';
import catalog from '../orderCatalog.json';
import {calculateBeltGeometry, pitchDiameter, pitchForProfile} from '../geometry';
import {openBeltCenter} from '../engineering';
import {reduceSketch, type SketchAction} from '../state';
import type {Sketch} from '../model';

export default function FitBelt({sketch,onAction}:{sketch:Sketch;onAction:(a:SketchAction)=>void}) {
  const [sku,choose]=useState('');
  const [locked,lock]=useState('');
  const items=sketch.route.slice(0,-1).map(id=>sketch.pulleys.find(p=>p.id===id));
  if (!sketch.activeBeltId || items.length!==2 || sketch.route[0]!==sketch.route.at(-1) || !items[0] || !items[1]) return null;
  const [a,b]=[items[0],items[1]];
  const fixed=a.isOrigin?a:b.isOrigin?b:locked===b.id?b:a;
  const moving=fixed===a?b:a;
  const options=catalog.filter(p=>p.kind==='Belt' && p.spec===sketch.profile && p.available && p.stock!=='Sold out');
  const belt=options.find(p=>p.sku===sku);
  const distance=Math.hypot(moving.x-fixed.x,moving.y-fixed.y);
  const center=belt && openBeltCenter(pitchDiameter(sketch.profile,a.toothCount)/2,pitchDiameter(sketch.profile,b.toothCount)/2,belt.teeth*pitchForProfile(sketch.profile));
  const action:SketchAction|null=center && distance ? {type:'FIT_BELT',id:moving.id,x:fixed.x+(moving.x-fixed.x)*center/distance,y:fixed.y+(moving.y-fixed.y)*center/distance,beltId:sketch.activeBeltId,sku}:null;
  const preview=action && reduceSketch({present:sketch,past:[],future:[],activeEdit:null},action).present;
  const anchor=preview?.pulleys.find(p=>p.id===fixed.id);
  const length=preview && calculateBeltGeometry(preview).lengthMm;
  const feasible=anchor && Math.hypot(anchor.x-fixed.x,anchor.y-fixed.y)<1e-6 && length && belt && Math.abs(length-belt.teeth*pitchForProfile(sketch.profile))<1e-5;
  return <details><summary>Fit a catalog belt</summary>
    <label className="drive-field">Fixed axle<select value={fixed.id} disabled={a.isOrigin||b.isOrigin} onChange={e=>lock(e.target.value)}>{[a,b].map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
    <label className="drive-field">Catalog belt<select value={belt?.sku??''} onChange={e=>choose(e.target.value)}><option value="">Choose a belt</option>{options.map(p=><option key={p.sku} value={p.sku}>{p.teeth}T · {p.vendor} · {p.sku}</option>)}</select></label>
    {belt && <p>{feasible && center ? moving.label+' moves '+Math.abs(center-distance).toFixed(2)+' mm '+(center>=distance?'away from ':'toward ')+fixed.label+'.' : 'This belt cannot fit with the current axle positions and constraints.'}</p>}
    <button className="topbar-action" disabled={!action||!feasible} onClick={()=>action&&onAction(action)}>Apply fit</button>
  </details>;
}
