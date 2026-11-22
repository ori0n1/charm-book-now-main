import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

// Hashes of the read-only active catalog snapshot, captured under the
// authenticated role with RLS on and BYPASSRLS off on 2026-11-22.
const expected={
  refund_requests:'c380cfea8cf404dd3839c3b4731e12d3cc59b8fa98171a1c620b5c67ce673cf9',
  whatsapp_message_logs:'b57cd56dfae9b253047b03208bf21f6e38c5ce8ed496f6c36cf16cb08b65116b',
  resolve_studio_local_datetime:'a83e2ae4e8381f4635592a3b48ae2ef6a55666f32e5be9abfd7b322e83e97fca',
};
function stable(value){
  if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort()
    .map((key)=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const hash=(value)=>createHash('sha256').update(stable(value)).digest('hex');
const snapshot=JSON.parse(readFileSync(
  'tmp/agenda-stage2-rls-qa/three-qa-snapshot.json','utf8'));
assert.equal(snapshot.tables.length,2);
assert.equal(snapshot.functions.length,1);
assert.equal(createHash('sha256').update(snapshot.refund_trigger_function).digest('hex'),
  '1d11c5a1d8c1875cceab92e1f7e69edb9555e959e1483e23d0600742f7cfa66b');
const actual=Object.fromEntries([
  ...snapshot.tables.map((table)=>[table.name,hash({...table,indexes:[...table.indexes].sort()})]),
  ['resolve_studio_local_datetime',hash(snapshot.functions[0])],
]);
const differences=Object.keys(expected).filter((name)=>actual[name]!==expected[name]);
console.log(JSON.stringify({compared:Object.keys(expected),matched:3-differences.length,
  differences,actual}));
if(differences.length)process.exitCode=1;
