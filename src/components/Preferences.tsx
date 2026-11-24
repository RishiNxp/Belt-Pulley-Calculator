import { useEffect, useRef } from 'react';
import type { SketchTool } from '../model';

export const defaults = {select:'v', 'add-pulley':'p','add-gear':'g','add-idler':'t',route:'b','dimension-horizontal':'x','dimension-vertical':'y','dimension-aligned':'d','constraint-horizontal':'h','constraint-vertical':'l',delete:'e'} satisfies Partial<Record<SketchTool,string>>;
export type Bindings = typeof defaults;
export const labels: Record<keyof Bindings,string> = {select:'Select','add-pulley':'Add pulley','add-gear':'Add gear','add-idler':'Add tensioner',route:'Create belt','dimension-horizontal':'Horizontal dimension','dimension-vertical':'Vertical dimension','dimension-aligned':'Center distance','constraint-horizontal':'Horizontal alignment','constraint-vertical':'Vertical alignment',delete:'Delete tool'};
export function Preferences({binds,setBinds,light,setLight,close}:{binds:Bindings;setBinds:(v:Bindings)=>void;light:boolean;setLight:(v:boolean)=>void;close:()=>void}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{ref.current?.showModal()},[]);
  return <dialog ref={ref} className="prefs" onCancel={close}><header><h2>Settings</h2><button onClick={close} aria-label="Close settings">×</button></header>
    <label>Appearance<select value={light?'light':'dark'} onChange={e=>setLight(e.target.value==='light')}><option value="dark">Dark</option><option value="light">Light</option></select></label>
    <h3>Tool shortcuts</h3>
    {(Object.keys(labels) as (keyof Bindings)[]).map(k=><label key={k}>{labels[k]}<select value={binds[k]} onChange={e=>setBinds({...binds,[k]:e.target.value})}>{[...'abcdefghijklmnopqrstuvwxyz0123456789'].map(ch=><option key={ch} disabled={ch!==binds[k] && Object.values(binds).includes(ch)} value={ch}>{ch.toUpperCase()}</option>)}</select></label>)}
    <p>Space to pan · Enter to close a belt · Escape to cancel · Delete to remove selection · Ctrl/⌘ Z to undo</p><button onClick={()=>setBinds({...defaults})}>Restore default shortcuts</button></dialog>
}
