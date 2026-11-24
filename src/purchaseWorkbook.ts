import ExcelJS from 'exceljs';
import { groupOrderItems, type OrderItem } from './order';

export async function purchaseWorkbook(items: OrderItem[]) {
  const book = new ExcelJS.Workbook();
  book.calcProperties.fullCalcOnLoad = true;
  const sheet = book.addWorksheet('Purchases', {views:[{state:'frozen', ySplit:3, showGridLines:false}]});
  const columns: [string,number][] = [
    ['Date ordered',16], ['Vendor',16], ['Part description',64], ['Item number',24], ['Product link',18],
    ['Units needed',14], ['Number to purchase',21], ['Cost per pack (USD)',22], ['Extended cost (USD)',23],
    ['Catalog stock',22], ['Order number',20], ['CAD components',42], ['Notes',45]
  ];
  sheet.columns = columns.map(([,width]) => ({width}));
  sheet.mergeCells('A1:M1');
  const title = sheet.getCell('A1');
  title.value = 'Pitch  /  Purchase sheet';
  title.font = {name:'Calibri', size:20, bold:true, color:{argb:'FFFFFFFF'}};
  title.fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FF222529'}};
  title.alignment = {vertical:'middle', indent:1};
  sheet.getRow(1).height = 42;
  sheet.mergeCells('A2:M2');
  const note = sheet.getCell('A2');
  note.value = 'Prices and stock reflect the offline catalog. Costs are in USD, before tax and shipping.';
  note.alignment = {vertical:'middle', indent:1};
  note.font = {size:11, color:{argb:'FF495563'}};
  sheet.getRow(2).height = 25;
  sheet.getRow(3).values = columns.map(([label]) => label);
  const money = '"$"#,##0.00';
  sheet.getColumn('A').numFmt = 'mmm d, yyyy';
  sheet.getColumn('H').numFmt = sheet.getColumn('I').numFmt = money;
  let subtotal = 0;
  for (const group of groupOrderItems(items)) {
    const r = group[0], p = r.product;
    const quantity = p ? Math.ceil(group.length / Number(p.name.match(/(\d+)\s*pack/i)?.[1] ?? 1)) : null;
    const row = sheet.addRow([null,p?.vendor,p?.name ?? [r.name,r.kind,r.spec,r.teeth && r.teeth+'T'].filter(Boolean).join(' · '),
      p?.sku,p && {text:'View product',hyperlink:p.url},group.length,quantity,p?.priceUsd,null,
      p?.stock ?? (r.status.startsWith('Sold out') ? 'Sold out' : 'Unverified'),null,
      group.map(x=>x.name+' ('+x.id+')').join(', '),p ? (p.priceUsd == null ? 'Price unverified' : '') : r.status]);
    const n = row.number;
    const cost = quantity != null && p?.priceUsd != null ? quantity*p.priceUsd : undefined;
    subtotal += cost ?? 0;
    row.getCell('I').value = {formula:'IF(COUNT(G'+n+':H'+n+')=2,G'+n+'*H'+n+',"")',result:cost ?? ''};
    row.eachCell({includeEmpty:true}, cell => {
      cell.fill = {type:'pattern',pattern:'solid',fgColor:{argb:n % 2 ? 'FFF1F4F7' : 'FFFFFFFF'}};
    });
    const stock = row.getCell('J');
    stock.font = {bold:true,color:{argb:stock.value === 'In stock' ? 'FF146844' : 'FF785A13'}};
    if (p) row.getCell('E').font = {color:{argb:'FF175CAA'},underline:true};
    if (row.getCell('J').value === 'Sold out') row.getCell('J').font = {bold:true,color:{argb:'FFB42318'}};
    row.alignment = {vertical:'middle',wrapText:true};
  }
  const last = sheet.rowCount;
  // Size for actual content, reserving space for the header filter arrows.
  for (const [key, cap] of [['B',24],['C',62],['D',32],['L',48],['M',46]] as const) {
    const column = sheet.getColumn(key);
    let width = column.header?.toString().length ?? 0;
    for (let n=3; n<=last; n++) {
      const text = sheet.getRow(n).getCell(key).text;
      for (const line of text.split(/\r?\n/)) width = Math.max(width, line.length + (n === 3 ? 5 : 3));
    }
    column.width = Math.min(cap, width);
  }
  for (let n=4; n<=last; n++) {
    const row = sheet.getRow(n);
    let lines = 1;
    for (const key of ['C','L','M']) {
      const width = (sheet.getColumn(key).width ?? 12) - 3;
      const wrapped = row.getCell(key).text.split(/\r?\n/).reduce((sum,line) =>
        sum + Math.max(1,Math.ceil(line.length / (width * 0.8))),0);
      lines = Math.max(lines,wrapped);
    }
    row.height = Math.min(409, 10 + 16*lines);
  }
  sheet.autoFilter = 'A3:M'+last;
  const total = sheet.addRow([]);
  sheet.mergeCells(total.number,3,total.number,8);
  total.height = 30;
  total.getCell('C').value = 'Subtotal of priced items (before tax and shipping)';
  total.getCell('I').value = last > 3 ? {formula:'SUM(I4:I'+last+')',result:subtotal} : 0;
  total.font = {bold:true};
  total.fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FFE2E8ED'}};
  const header = sheet.getRow(3);
  header.height = 26;
  header.font = {bold:true,color:{argb:'FFFFFFFF'}};
  header.fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FF8A2634'}};
  return book;
}
