import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatPhone,identity} from '../src/phone';
test('中国号码国家码变体归并，服务号码保持原样',()=>{
 assert.equal(identity('+86 138 0013 8000'),identity('8613800138000'));
 assert.equal(identity('13800138000'),identity('+8613800138000'));
 for(const n of ['10010','106900123456','BANK','*123#']) assert.equal(formatPhone(n),n);
});
test('国际号码使用各自号码计划，保留所有数字',()=>{
 for(const n of ['+8613800138000','+16502530000','+442079460018','+33142345678','+819012345678','+85251234567','+886912345678','+41446681800','+390669820000']){
  const result=formatPhone(n);assert.equal(result.replace(/\D/g,''),n.replace(/\D/g,''));assert.ok(result.includes(' '));
 }
 assert.equal(formatPhone('13800138000'),'138 0013 8000');
 assert.equal(formatPhone('+41446681800'),'+41 44 668 18 00');
});
test('无国家码时必须使用明确地区，保留前导零',()=>{
 assert.equal(identity('02079460018','GB'),'+442079460018');
 assert.equal(formatPhone('02079460018','GB'),'020 7946 0018');
 assert.equal(formatPhone('0234567890','IT').replace(/\D/g,''),'0234567890');
});
