import { purchaseWorkbook } from './purchaseWorkbook';
import ExcelJS from 'exceljs';
import { expect, it } from 'vitest';
import { createEmptySketch } from './demo';
import { orderItems } from './order';
import { DEFAULT_GOBILDA_GEAR } from './transmission';

it('matches module and bore and flags incompatible saved choices', () => {
  const s = createEmptySketch();
  const g = {...DEFAULT_GOBILDA_GEAR, id:'G1', name:'Pinion', axleId:'A1', plane:0};
  s.transmission!.gears.push(g);
  const p = orderItems(s)[0].product!;
  expect(p.name).toMatch(/8mm REX/);
  s.transmission!.gears[0] = {...g, catalogSku:p.sku, moduleMm:1};
  expect(orderItems(s)[0].product).toBeUndefined();
});
it('aggregates two-pack pulleys, escapes spreadsheet formulas, and retains unresolved rows', async () => {
  const s = createEmptySketch();
  for (const id of ['P1','P2','P3']) s.pulleys.push({id,label:'=cmd',profile:'GT2',toothCount:25,x:0,y:0,isOrigin:false});
  s.transmission!.belts.push({id:'B1',route:[],profile:'GT2',toothCounts:{}});
  const rows = orderItems(s);
  expect(rows[0].product?.vendor).toBe('SWYFT');
  const book = await purchaseWorkbook(rows);
  const copy = new ExcelJS.Workbook();
  await copy.xlsx.load(await book.xlsx.writeBuffer());
  const sheet = copy.worksheets[0];
  expect(sheet.getCell('G4').value).toBe(2);
  expect(sheet.getCell('I4').result).toBe(6.98);
  expect(sheet.getCell('L4').type).toBe(ExcelJS.ValueType.String);
  expect(sheet.getCell('E4').hyperlink).toContain('swyftrobotics.com');
  expect(sheet.getCell('L5').text).toContain('B1');
  expect(rows.at(-1)?.product).toBeUndefined();
});
it('prioritizes goBILDA and requires a choice when multiple bores fit the tooth count', () => {
  const s = createEmptySketch();
  s.pulleys.push({id:'P1',label:'Motor',profile:'GT2',toothCount:20,x:0,y:0,isOrigin:false});
  const row = orderItems(s)[0];
  expect(row.options[0].vendor).toBe('goBILDA');
  expect(row.options.at(-1)?.vendor).toBe('SWYFT');
  expect(row.status).toBe('Choose a variant');
});
it('keeps the selected sold-out SKU and shows its stock in Excel', async () => {
  const s = createEmptySketch();
  s.pulleys.push({id:'P1',label:'Motor',profile:'GT2',toothCount:20,x:0,y:0,isOrigin:true,catalogSku:'3422-4008-0020'});
  const sheet = (await purchaseWorkbook(orderItems(s))).worksheets[0];
  expect(sheet.getCell('J4').text).toBe('Sold out');
  expect(sheet.getCell('D4').text).toBe('3422-4008-0020');
});
