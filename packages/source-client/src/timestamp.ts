/** Format an explicit instant for display; persisted timestamps and business DATE values stay unchanged. */
export function formatBeijingTimestamp(value:unknown):string{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return '时间未知';
 const calendar=new Date(value.slice(0,10)+'T00:00:00Z');
 if(!Number.isFinite(calendar.getTime())||calendar.toISOString().slice(0,10)!==value.slice(0,10))return '时间未知';
 const instant=Date.parse(value),display=new Date(instant+8*3600000);
 if(!Number.isFinite(display.getTime()))return '时间未知';
 return display.toISOString().slice(0,19).replace('T',' ')+' 北京时间';
}
