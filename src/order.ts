import catalog from './orderCatalog.json';
import { calculateBeltGeometry } from './geometry';
import type { Sketch } from './model';
import { migrateLegacyTransmission, sketchForBeltStage } from './transmission';

export type Product = typeof catalog[number];
export type OrderItem = {
  id: string; name: string; kind: string; spec: string; teeth?: number; sku?: string;
  options: Product[]; product?: Product; status: string;
};

function gearBore(name: string) {
  if (name.includes('1/8" Bore')) return 3.175;
  return Number(name.match(/(\d+(?:\.\d+)?)mm[^()]*Bore/i)?.[1]);
}

export function orderItems(sketch: Sketch): OrderItem[] {
  const tr = sketch.transmission ?? migrateLegacyTransmission(sketch);
  const rows: OrderItem[] = [];
  function part(id: string, name: string, kind: string, spec: string, teeth?: number, sku?: string, issue?: string, bore?: number) {
    const options = issue ? [] : catalog.filter(p => p.kind === kind && p.teeth === teeth && p.spec === spec && (p.available || p.stock === "Sold out")
      && (kind === "Belt" || p.vendor !== "WCP")
      && (bore === undefined || gearBore(p.name) === bore));
    const available = options.filter(p => p.stock !== "Sold out");
    const pool = available.length ? available : options;
    const preferred = pool.filter(p => p.vendor === pool[0]?.vendor);
    const product = sku ? options.find(p => p.sku === sku) : preferred.length === 1 ? preferred[0] : undefined;
    const status = issue ?? (sku === 'custom' ? 'Custom · source separately' : product ? product.stock === 'Sold out' ? 'Sold out' : 'Catalog match' :
      sku ? 'Review previous selection' : options.length ? (available.length ? 'Choose a variant' : 'Sold out · choose a variant') : 'No catalog match · confirm custom');
    rows.push({id, name, kind, spec, teeth, sku, options, product, status});
  }
  for (const p of sketch.pulleys) part(p.id, p.label, 'Pulley', p.profile, p.toothCount, p.catalogSku);
  for (const g of tr.gears) part(g.id, g.name, 'Gear', String(g.moduleMm), g.toothCount, g.catalogSku, g.pressureAngleDeg === 20 ? undefined : 'Verify pressure angle and source separately', g.boreMm);
  for (const b of tr.belts) {
    const result = calculateBeltGeometry(sketchForBeltStage(sketch,b));
    part(b.id,b.id,'Belt',b.profile,result.nearestTeeth ?? undefined,b.catalogSku,
      !result.valid ? result.diagnostic ?? 'Incomplete belt' : !result.passesTolerance ? 'Length outside design tolerance' : undefined);
  }
  for (const i of sketch.idlers) part(i.id,i.label,'Tensioner',i.diameterMm+' mm',undefined,undefined,'Source separately');
  for (const a of tr.axles) part(a.id,a.id,'Axle',a.componentIds.join(', '),undefined,undefined,'Confirm shaft dimensions and source separately');
  return rows;
}

export function groupOrderItems(rows: OrderItem[]) {
  const groups = new Map<string, OrderItem[]>();
  for (const row of rows) {
    const key = row.product?.sku ?? row.kind+'/'+row.id;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}
