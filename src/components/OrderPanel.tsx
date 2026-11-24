import { useMemo } from 'react';
import type { Sketch } from '../model';
import type { SketchAction } from '../state';
import { orderItems } from '../order';
import type { OrderItem } from '../order';

type Props = { sketch: Sketch; onAction: (action: SketchAction) => void };
function Choice({row,onAction}: {row: OrderItem} & Pick<Props,'onAction'>) {
  return <label className="pulley-context-field"><span>{row.kind} type</span>
    <select aria-label={row.name+' catalog type'} value={row.sku || ''} onChange={e => onAction({type:'SET_CATALOG_SKU',id:row.id,sku:e.target.value})}>
      <option value="">{row.product && !row.sku ? 'Auto · '+row.product.sku : 'Automatic lookup'}</option>
      {row.sku && row.sku !== 'custom' && !row.options.some(p=>p.sku===row.sku) && <option value={row.sku}>Previous selection · review</option>}
      {row.options.map(p=><option key={p.sku} value={p.sku}>{p.vendor} · {p.name} · {p.sku} · {p.stock}</option>)}
      <option value="custom">Custom · I’ll source this part</option>
    </select></label>;
}
export function CatalogField({sketch,id,onAction}: Props & {id:string}) {
  const row = orderItems(sketch).find(r=>r.id===id);
  return row ? <Choice row={row} onAction={onAction}/> : null;
}
export default function OrderPanel({sketch,onAction}: Props) {
  const rows = useMemo(()=>orderItems(sketch),[sketch]);
  async function download() {
    const { purchaseWorkbook } = await import('../purchaseWorkbook');
    const bytes = await (await purchaseWorkbook(rows)).xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    const a = document.createElement('a'); a.href=url; a.download='pitch-order-sheet.xlsx'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  return <details className="order-panel"><summary>Parts &amp; order sheet</summary>
    {['Categorized','Needs review'].map((heading,i)=>{
      const items = rows.filter(r=>Boolean(r.product || r.sku==='custom') === (i===0));
      return <section key={heading}><h4>{heading} ({items.length})</h4>{items.map(r=><div className="order-entry" key={r.kind+r.id}>
        <strong>{r.name} · {r.kind}</strong><small>{r.product ? r.product.vendor+' · '+r.product.sku+' · '+r.product.stock : r.status}</small>
        {['Pulley','Gear','Belt'].includes(r.kind) && <Choice row={r} onAction={onAction}/>}
      </div>)}</section>
    })}
    <button disabled={!rows.length} onClick={download}>Download order sheet (.xlsx)</button>
  </details>;
}
