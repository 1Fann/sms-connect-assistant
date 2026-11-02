import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseVCard} from '../src/dialer/vcard';
const card=(fields:string)=>'BEGIN:VCARD\r\nVERSION:3.0\r\n'+fields+'\r\nEND:VCARD\r\n';
test('Apple grouped phone properties, folded UTF-8 names and ignored private fields',()=>{
 const result=parseVCard(card('FN:演示\r\n 联系人\r\nitem1.TEL;type=CELL:+15550100\r\nTEL;TYPE="work:voice":5550101\r\nNOTE:private notes\r\nEMAIL:private@example.invalid\r\nPHOTO;ENCODING=b:AAAA'));
 assert.deepEqual(result.contacts,[{name:'演示联系人',numbers:['+15550100','5550101']}]);
 assert.equal(JSON.stringify(result).includes('private'),false);
});
test('escaped punctuation, structured names and RFC3966 extensions keep their digits',()=>{
 const result=parseVCard(card('FN:Demo\\, A\\; B\r\nTEL;VALUE=uri:tel:%2B15550100;ext=123')+card('N:Family;Given;;;\r\nTEL:5550100'));
 assert.deepEqual(result.contacts,[{name:'Demo, A; B',numbers:['+15550100;ext=123']},{name:'Family Given',numbers:['5550100']}]);
});
test('quoted-printable names and soft line breaks decode without corrupting Chinese',()=>{
 const result=parseVCard(card('FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=E6=BC=94=E7=A4=BA=\r\n=E8=81=94=E7=B3=BB=E4=BA=BA\r\nTEL:5550100'));
 assert.equal(result.contacts[0].name,'演示联系人');
});
test('deduplicates exact cards regardless of phone order, but preserves different names sharing a number',()=>{
 const result=parseVCard(card('FN:A\r\nTEL:555 0100\r\nTEL:5550101')+card('FN:A\r\nTEL:5550101\r\nTEL:5550100')+card('FN:B\r\nTEL:5550100'));
 assert.equal(result.contacts.length,2);assert.equal(result.duplicates,1);assert.equal(result.contacts[1].name,'B');
});
test('no-number and unfinished cards are skipped, invalid files and oversized input are rejected',()=>{
 const result=parseVCard(card('FN:No phone\r\nEMAIL:demo@example.invalid')+'BEGIN:VCARD\nFN:Unfinished\nTEL:5550100');
 assert.equal(result.contacts.length,0);assert.equal(result.skipped,2);
 assert.throws(()=>parseVCard('not a vCard'));assert.throws(()=>parseVCard('x'.repeat(10*1024*1024+1)));
});

test('structured Han names use family first rather than exported given-first FN',()=>{
 const result=parseVCard(card('N:张;三;;;\r\nFN:三张\r\nTEL:5550100')+card('N:欧阳;小明;;;\r\nFN:小明 欧阳\r\nTEL:5550101'));
 assert.deepEqual(result.contacts,[{name:'张三',previousName:'三张',numbers:['5550100']},{name:'欧阳小明',previousName:'小明 欧阳',numbers:['5550101']}]);
});
test('preserves custom labels, company names and Latin formatted names',()=>{
 const result=parseVCard(card('N:张;三;;;\r\nFN:张老师（家人）\r\nTEL:5550100')+card('N:Smith;Jane;;;\r\nFN:Jane Smith\r\nTEL:5550101')+card('N:张;三;;;\r\nFN:三张\r\nX-ABShowAs:COMPANY\r\nTEL:5550102'));
 assert.deepEqual(result.contacts.map(c=>c.name),['张老师（家人）','Jane Smith','三张']);
 assert.ok(result.contacts.every(c=>!c.previousName));
});
test('Han names without FN and correctly ordered FN do not lose structured components',()=>{
 const result=parseVCard(card('N:张;三;;;\r\nTEL:5550100')+card('N:张;三;;;\r\nFN:张三\r\nTEL:5550101')+card('N:;小明;;;\r\nFN:小明\r\nTEL:5550102'));
 assert.deepEqual(result.contacts.map(c=>c.name),['张三','张三','小明']);
 assert.equal(result.contacts[0].previousName,'张 三');
 assert.equal(result.contacts[1].previousName,undefined);
});
