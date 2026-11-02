import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planContactImport} from '../src/dialer/contactImportPlan';
import type {Contact} from '../src/dialer/client';
const input={name:'张三',previousName:'三张',numbers:['5550100','5550101']};
const old:Contact={id:'original',name:'三张',numbers:['555 0101','555-0100'],revision:7,favorite:true,conflict:false,sources:[]};
test('correct an exact old assistant card using its ID/revision and preserving original data',()=>{
 const plan=planContactImport([input],[old]);
 assert.deepEqual(plan.contacts,[]);assert.equal(plan.repairs.length,1);
 assert.deepEqual(plan.repairs[0],{id:'original',revision:7,name:'张三',previousName:'三张',numbers:old.numbers});
 assert.equal(old.name,'三张');assert.equal(old.favorite,true);
});
test('do not rename source-backed, ambiguous or duplicate corrected cards',()=>{
 for(const existing of [[{...old,sources:[{} as Contact['sources'][number]]}],[old,{...old,id:'other'}],[old,{...old,id:'corrected',name:'张三'}]]){
  const plan=planContactImport([input],existing);assert.equal(plan.review,1);assert.equal(plan.repairs.length,0);assert.equal(plan.contacts.length,0);
 }
});
test('do not overwrite user notes or match using just a number suffix',()=>{
 for(const existing of [[{...old,name:'自定义备注'}],[{...old,numbers:['015550100','5550101']}]]) {
  const plan=planContactImport([input],existing);assert.equal(plan.repairs.length,0);assert.equal(plan.contacts.length,1);
  assert.equal('previousName' in plan.contacts[0],false);
 }
});
test('ordinary imports and already corrected cards continue through duplicate-safe import API',()=>{
 assert.equal(planContactImport([input],[{...old,name:'张三'}]).contacts.length,1);
 assert.equal(planContactImport([{name:'Demo',numbers:['5550100']}],[]).contacts.length,1);
});
