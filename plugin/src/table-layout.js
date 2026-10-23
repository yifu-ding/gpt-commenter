// Share column proportions between a full reading table and independent Edit rows.
export function tableColumnWidths(rows){
 const columns=Math.max(0,...rows.map(row=>row.length));
 const weights=Array.from({length:columns},(_,index)=>Math.max(6,Math.min(60,Math.max(...rows.map(row=>[...(row[index]||'')].reduce((sum,char)=>sum+(char.codePointAt(0)>255?2:1),0))))));
 const total=weights.reduce((sum,width)=>sum+width,0);
 return weights.map(width=>100*width/total);
}
export const tableCellText=node=>node.value??(node.children||[]).map(tableCellText).join('');
export function applyTableColumns(table,rows){
 table.querySelector('colgroup')?.remove();const group=table.ownerDocument.createElement('colgroup');
 for(const width of tableColumnWidths(rows)){const col=table.ownerDocument.createElement('col');col.style.width=`${width}%`;group.append(col);}table.prepend(group);
}
