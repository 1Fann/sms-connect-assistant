import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAndroidContact,editAndroidContact,appendAndroidNumber,primarySource,writableContact} from '../src/dialer/androidContacts';
import type {Contact} from '../src/dialer/client';
const source={deviceId:'A',rawId:'7',revision:'v1',contactId:'8',name:'Android',numbers:['5550100'],readOnly:false};
const card:Contact={id:'native',deviceId:'A',name:'Android',numbers:['5550100','5550200'],revision:12,favorite:true,conflict:false,primaryRawId:'7',sources:[source,{...source,rawId:'9',numbers:['5550200'],readOnly:true}]};
test('creation explicitly binds a chosen Android device and never uses legacy targets',()=>{
 assert.throws(()=>createAndroidContact('','Name',['5550100']));
 assert.deepEqual(createAndroidContact('B',' Name ',[' 5550100 ','']),{destination:'android',deviceId:'B',name:'Name',numbers:['5550100']});
});
test('edits include aggregate/source revisions without an assistant overlay write',()=>{
 const body=editAndroidContact(card,source,{name:'New'});
 assert.deepEqual(body,{destination:'android',id:'native',revision:12,deviceId:'A',rawId:'7',sourceRevision:'v1',name:'New'});
 assert.equal('targets' in body,false);assert.equal('numbers' in body,false);
});
test('append preserves other Android sources and rejects exact normalized duplicates',()=>{
 const body=appendAndroidNumber(card,source,'5550300');
 assert.deepEqual(body.numbers,['5550100','5550300']);assert.equal('name' in body,false);
 assert.throws(()=>appendAndroidNumber(card,source,'555 0200'));
 assert.deepEqual(card.numbers,['5550100','5550200']);assert.equal(card.favorite,true);
});
test('readonly, stale and unbound sources cannot be used as write targets',()=>{
 assert.throws(()=>editAndroidContact(card,{...source,readOnly:true},{name:'X'}));
 assert.throws(()=>editAndroidContact(card,{...source,revision:'stale'},{name:'X'}));
 assert.equal(primarySource(card)?.rawId,'7');
 assert.equal(writableContact(card,[{deviceId:'A',name:'A',online:true,contactsWrite:false}]),false);
 assert.equal(writableContact(card,[{deviceId:'B',name:'B',online:true,contactsWrite:true}]),false);
 assert.equal(writableContact(card,[{deviceId:'A',name:'A',online:false,contactsWrite:true}]),true);
});
