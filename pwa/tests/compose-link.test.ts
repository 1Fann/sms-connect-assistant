import {test} from 'node:test';
import assert from 'node:assert/strict';
import {messagesComposeLink,composeRecipient} from '../src/composeLink';
test('message entry stays on the configured host, targets Messages and keeps the recipient out of requests',()=>{
 const link=messagesComposeLink('+15550100','https://fixture.invalid:8444/phone/?private=unused');
 const url=new URL(link!);
 assert.equal(url.origin,'https://fixture.invalid:8443');assert.equal(url.pathname,'/');assert.equal(url.search,'');
 assert.equal(composeRecipient(url.hash),'+15550100');
});
test('compose links do not accept URLs, service-code injection, duplicate intents or malformed numbers',()=>{
 for(const raw of ['555?send=true','555#secret','tel:555','555@host','12'])assert.equal(messagesComposeLink(raw,'https://fixture.invalid'),undefined);
 for(const hash of ['#compose=555&conversation=999','#compose=abc','#compose=%2B%2B555'])assert.equal(composeRecipient(hash),null);
});
