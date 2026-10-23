import test from 'node:test';
import assert from 'node:assert/strict';
import {takeLinkToken} from './link';
import {restoreSubmission} from './pending';
test('capability is removed from address before the caller can exchange it',()=>{
 let stripped=false;
 const token=takeLinkToken('#token=secret%2Bvalue',()=>{stripped=true;});
 assert.equal(stripped,true);
 assert.equal(token,'secret+value');
});
test('refresh without a fragment does not fabricate a supplier capability',()=>{
 assert.equal(takeLinkToken('',()=>assert.fail('no fragment to remove')),null);
});
test('supplier refresh restores the same submission key and complete quoted body',()=>{
 const value=JSON.stringify({key:'same-key',body:{validUntil:'2026-10-22',lines:[{purchaseLineId:'line-1',status:'quoted',unitPrice:'12.30'}]}});
 assert.deepEqual(restoreSubmission(value),JSON.parse(value));
 assert.deepEqual(restoreSubmission('legacy-key'),{key:'legacy-key'});
});
