import {test} from 'node:test';
import assert from 'node:assert/strict';
import {contactSection,sectionContacts} from '../src/dialer/contactSections';
test('contact index supports Chinese pinyin, Latin initials and fallback scripts without changing identity',()=>{
 for(const [name,section] of [['张三','Z'],['李四','L'],['陈五','C'],['孙六','S'],['alice','A'],[' Bob','B'],['5550100','#'],['','#'],['あおい','#']])assert.equal(contactSection(name),section);
 const rows=[{id:'z',name:'张三'},{id:'a',name:'Alice'},{id:'l',name:'李四'}];
 assert.deepEqual(sectionContacts(rows).map(([key])=>key),['A','L','Z']);
 assert.equal(rows[0].id,'z');assert.equal(sectionContacts(rows)[2][1][0],rows[0]);
});
