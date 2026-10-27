import assert from 'node:assert/strict';
import {test} from 'node:test';
import {formatBeijingTimestamp} from './index';

test('Beijing timestamp display converts explicit instants across midnight and year boundaries',()=>{
 for(const [value,expected] of [
  ['2026-10-26T16:41:00Z','2026-10-27 00:41:00 北京时间'],
  ['2026-10-27T00:41:00+08:00','2026-10-27 00:41:00 北京时间'],
  ['2026-10-26T09:41:00-07:00','2026-10-27 00:41:00 北京时间'],
  ['2026-12-31T16:00:00.123Z','2027-01-01 00:00:00 北京时间']
 ])assert.equal(formatBeijingTimestamp(value),expected);
});
test('Beijing timestamp display is independent of the host time zone',()=>{
 const previous=process.env.TZ;
 try{for(const zone of ['UTC','America/Los_Angeles','Asia/Tokyo']){process.env.TZ=zone;assert.equal(formatBeijingTimestamp('2026-10-26T16:41:00Z'),'2026-10-27 00:41:00 北京时间');}}
 finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
test('unknown, invalid and timezone-free timestamps display a safe unknown label',()=>{
 for(const value of [null,undefined,'','invalid','2026-10-27','2026-10-27T00:41:00',0,{},'+275760-09-13T00:00:00.000Z'])assert.equal(formatBeijingTimestamp(value),'时间未知',String(value));
});

test('impossible calendar dates are unknown rather than normalized into a different day',()=>{
 for(const value of ['2026-02-29T12:00:00Z','2026-02-30T12:00:00Z','2026-04-31T12:00:00+08:00'])assert.equal(formatBeijingTimestamp(value),'时间未知');
 assert.equal(formatBeijingTimestamp('2024-02-29T16:00:00Z'),'2024-03-01 00:00:00 北京时间');
});
