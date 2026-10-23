import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import {existsSync} from 'node:fs';
import type {QuoteDocument,ExportFormat} from '../../../../packages/contracts/src';

export const contentType=(format:ExportFormat)=>format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export function exportFilename(d:QuoteDocument,format:ExportFormat){
 const safe=(s:string)=>s.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g,'_').replace(/^\.+/,'').slice(0,80);
 return `${safe(d.hospitalName)}_${safe(d.quoteNo)}_V${d.versionNo}.${format}`;
}
function validate(d:QuoteDocument){
 if(d.schemaVersion!==1||!d.lines.length||d.lines.length>100)throw new Error('报价快照格式错误');
 for(const l of d.lines)if(l.name.length>100||l.spec.length>200||l.remark.length>500||l.unit!=='kg'||!['priced','missing'].includes(l.status)||l.status==='missing'&&(l.unitPrice!==null||l.amount!==null))throw new Error('报价明细格式错误');
}
export async function renderQuote(d:QuoteDocument,format:ExportFormat):Promise<Buffer>{validate(d);return format==='pdf'?pdf(d):xlsx(d);}
async function xlsx(d:QuoteDocument):Promise<Buffer>{
 const book=new ExcelJS.Workbook();book.creator=d.sellerName;book.created=new Date(d.quoteDate+'T00:00:00+08:00');
 const sheet=book.addWorksheet('报价单',{pageSetup:{paperSize:9,orientation:'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0}});
 sheet.columns=[{width:8},{width:24},{width:25},{width:16},{width:18},{width:20},{width:12},{width:28}];
 function full(text:string,size=11){const wrapped=text.split('\n').flatMap(p=>Array.from({length:Math.max(1,Math.ceil(p.length/50))},(_,i)=>p.slice(i*50,(i+1)*50)));let row:ExcelJS.Row;for(let i=0;i<wrapped.length;i+=18){row=sheet.addRow([wrapped.slice(i,i+18).join('\n')]);sheet.mergeCells(row.number,1,row.number,8);row.font={name:'微软雅黑',size};row.alignment={wrapText:true,vertical:'middle'};row.height=Math.max(23,Math.min(18,wrapped.length-i)*(size+7));}return row!;}
 full(d.sellerName,16);full('医院报价单',14);full('医院：'+d.hospitalName);
 full(`报价号：${d.quoteNo}  ·  V${d.versionNo}  ·  日期：${d.quoteDate}`);
 full(`销售：${d.salespersonName}  联系方式：${d.contact||'—'}`);
 full(d.validUntil?'有效至：'+d.validUntil+'（含当天）':'价格有效期：不适用（全部缺货）');
 const header=sheet.addRow(['序号','品名','规格','数量（kg）','单价（元/kg）','金额（元）','供货情况','备注']);header.height=30;header.font={name:'微软雅黑',bold:true,size:11};header.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFE9F0EF'}};header.alignment={vertical:'middle',wrapText:true};
 const first=header.number;
 const wrapCell=(value:string,capacity:number)=>value.split('\n').flatMap(paragraph=>{const lines:string[]=[];let current='',used=0;for(const ch of paragraph){const cost=ch.charCodeAt(0)>255?1:.5;if(used+cost>capacity&&current){lines.push(current);current='';used=0;}current+=ch;used+=cost;}lines.push(current);return lines;});
 for(const l of d.lines){const textColumns=[wrapCell(l.name,10),wrapCell(l.spec,11),wrapCell(l.remark,12)];const count=Math.max(...textColumns.map(c=>c.length));for(let offset=0;offset<count;offset+=18){const continued=offset>0,chunk=(i:number)=>textColumns[i]!.slice(offset,offset+18).join('\n'),n=Math.min(18,count-offset);
  const row=sheet.addRow([continued?`${l.position}（续）`:l.position,chunk(0),chunk(1),continued?null:Number(l.quantity),continued||l.unitPrice===null?null:Number(l.unitPrice),continued||l.amount===null?null:Number(l.amount),l.status==='missing'?'缺货':'可供货',chunk(2)]);row.font={name:'微软雅黑',size:11};row.alignment={vertical:'middle',wrapText:true};row.height=Math.max(29,n*18+10);for(let i=4;i<=6;i++){row.getCell(i).numFmt='0.00';row.getCell(i).alignment={horizontal:'right',vertical:'middle'};}
 }}

 full(d.total===null?'合计：不适用（全部缺货）':'合计（元）：'+d.total,12);full(d.taxNote);if(d.notes)full(d.notes);
 sheet.pageSetup.printTitlesRow=`1:${first}`;sheet.pageSetup.printArea=`A1:H${sheet.rowCount}`;
 sheet.headerFooter.oddFooter='&C第 &P 页 / 共 &N 页';sheet.views=[{state:'frozen',ySplit:first}];
 sheet.eachRow(row=>row.eachCell({includeEmpty:true},cell=>{cell.border={bottom:{style:'hair',color:{argb:'FFD2DBD9'}}};}));
 return Buffer.from(await book.xlsx.writeBuffer());
}
function font(){
 const path=process.env.EXPORT_FONT_PATH;
 if(path)return {path,family:process.env.EXPORT_FONT_FAMILY};
 if(process.env.NODE_ENV!=='production'&&process.platform==='darwin'&&existsSync('/System/Library/Fonts/STHeiti Light.ttc'))return {path:'/System/Library/Fonts/STHeiti Light.ttc',family:'STHeitiSC-Light'};
 throw new Error('请配置有授权的中文 EXPORT_FONT_PATH 和集合字体 EXPORT_FONT_FAMILY');
}
async function pdf(d:QuoteDocument):Promise<Buffer>{
 const doc=new PDFDocument({size:'A4',margins:{left:40,right:40,top:36,bottom:48},bufferPages:true,info:{Title:d.quoteNo+` V${d.versionNo}`,Author:d.sellerName}}),chunks:Buffer[]=[];
 const result=new Promise<Buffer>((resolve,reject)=>{doc.on('data',(b:Buffer)=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 // A registered CJK font is embedded in the output; never depend on the recipient's font installation.
 const f=font();doc.registerFont('cjk',f.path,f.family).font('cjk');
 const horizontal={vert:false,vrt2:false} as unknown as PDFKit.Mixins.TextOptions['features'];
 const left=40,width=515,bottom=774,cols=[24,79,79,64,69,74,45,81];let y=36;
 const text=(value:string,x:number,top:number,w:number,align:'left'|'right'|'center'='left')=>doc.text(value,x,top,{width:w,align,lineGap:2,features:horizontal});
 function heading(){y=36;doc.fontSize(16).fillColor('#173c38');text(d.sellerName,left,y,width);y=doc.y+8;doc.fontSize(13);text('医院报价单',left,y,width);y=doc.y+12;doc.fontSize(9).fillColor('#222222');for(const line of [`医院：${d.hospitalName}`,`报价号：${d.quoteNo}    V${d.versionNo}    日期：${d.quoteDate}`,`销售：${d.salespersonName}    联系方式：${d.contact||'—'}`,d.validUntil?`有效至：${d.validUntil}（含当天）`:'价格有效期：不适用（全部缺货）']){text(line,left,y,width);y=doc.y+5;}y+=7;tableHeader();}
 function tableHeader(){const labels=['序','品名','规格','数量 kg','元/kg','金额 元','供货','备注'];doc.rect(left,y,width,24).fill('#e9f0ef');doc.fillColor('#173c38').fontSize(9);let x=left;labels.forEach((label,i)=>{text(label,x+4,y+6,cols[i]!-8,i>=3&&i<=5?'right':'left');x+=cols[i]!;});y+=24;}
 function page(){doc.addPage();heading();}
 heading();
 // Split unusually long cells across pages while repeating table headers and retaining every character.
 const wrap=(value:string,w:number)=>{const rows:string[]=[];for(const paragraph of value.split('\n')){let line='';for(const ch of paragraph){if(line&&doc.widthOfString(line+ch,{features:horizontal})>w){rows.push(line);line=ch;}else line+=ch;}rows.push(line);}return rows;};
 for(const l of d.lines){doc.fontSize(9);let parts=[String(l.position),l.name,l.spec||'—',l.quantity,l.unitPrice||'—',l.amount||'—',l.status==='missing'?'缺货':'可供货',l.remark].map((v,i)=>wrap(v,cols[i]!-8));let continued=false;
  while(parts.some(p=>p.length)){const lineHeight=doc.currentLineHeight(true)+2;let available=Math.floor((bottom-y-14)/lineHeight);if(available<1){page();available=Math.floor((bottom-y-14)/lineHeight);}
   const remaining=Math.max(...parts.map(p=>p.length));if(remaining>available&&y>300&&remaining*lineHeight+14<bottom-260){page();available=Math.floor((bottom-y-14)/lineHeight);}
   const count=Math.min(remaining,available),height=Math.max(29,count*lineHeight+14);let x=left;doc.fillColor('#222222');
   parts.forEach((part,i)=>{let content=part.splice(0,count).join('\n');if(i===0&&continued&&!content)content='续';text(content,x+4,y+7,cols[i]!-8,i>=3&&i<=5?'right':'left');x+=cols[i]!;});
   doc.strokeColor('#d2dbd9').lineWidth(.4).moveTo(left,y+height).lineTo(left+width,y+height).stroke();y+=height;continued=true;if(parts.some(p=>p.length))page();
  }
 }

 const foot=[d.total===null?'合计：不适用（全部缺货）':'合计（元）：'+d.total,d.taxNote,...(d.notes?[d.notes]:[])];
 for(let i=0;i<foot.length;i++){doc.fontSize(i===0?12:9);const h=doc.heightOfString(foot[i]!,{width,lineGap:2,features:horizontal})+12;if(y+h>bottom)page();text(foot[i]!,left,y+10,width);y+=h;}
 const range=doc.bufferedPageRange();for(let p=0;p<range.count;p++){doc.switchToPage(range.start+p);doc.page.margins.bottom=0;doc.fontSize(8).fillColor('#687775');text(`${d.quoteNo} · V${d.versionNo}     第 ${p+1} 页 / 共 ${range.count} 页`,left,808,width,'center');}
 doc.end();return result;
}
