// Small deterministic PDF with an outline, internal destination and external link.
export function navigationPdf(){
 const stream=text=>`<< /Length ${text.length} >>\nstream\n${text}\nendstream`;
 const objects=[
 '<< /Type /Catalog /Pages 2 0 R /Outlines 9 0 R >>',
 '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
 '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R /Annots [8 0 R 11 0 R] >>',
 '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
 '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
 stream('BT /F1 20 Tf 50 730 Td (Navigation demo - page 1) Tj 0 -45 Td (Go to page 2) Tj 0 -45 Td (External link) Tj ET'),
 stream('BT /F1 20 Tf 50 730 Td (Destination - page 2) Tj ET'),
 '<< /Type /Annot /Subtype /Link /Rect [50 680 200 705] /Dest [4 0 R /Fit] /Border [0 0 0] >>',
 '<< /Type /Outlines /First 10 0 R /Last 10 0 R /Count 1 >>',
 '<< /Title (Destination) /Parent 9 0 R /Dest [4 0 R /Fit] >>',
 '<< /Type /Annot /Subtype /Link /Rect [50 635 200 660] /A << /S /URI /URI (https://example.com) >> /Border [0 0 0] >>'
 ];
 let pdf='%PDF-1.4\n',offsets=[0];objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});
 const start=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('');pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;return Buffer.from(pdf);
}
