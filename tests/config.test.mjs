import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freshConfig,DEFAULT,encode,decode,validate,selectLanguage} from '../demo/src/config.js';
import {words} from '../demo/src/i18n.js';
test('default is a clean URL; v1 round-trips every public setting',()=>{
  assert.equal(encode(DEFAULT),'');
  const c=freshConfig();
  Object.assign(c,{composition:'safe',motion:false,playing:false,time:27.99,reveal:.4,ink:'dark',inkStrength:.65,inkContour:false,cloudMotion:false,cloudStrength:1.3,sprayDistance:73,sprayCount:111,speed:3,push:1.45,lift:.25});
  for(const name of Object.keys(c.layers)) c.layers[name]=!c.layers[name];
  for(const name of Object.keys(c.inkLayers)) c.inkLayers[name]=false;
  c.clouds=[false,true,false,true,false,true];c.cloudStrengths=[0,.15,.45,.75,1.25,1.5];c.phases={'lower-left':-180,'lower-center':25,'lower-right':180};
  assert.deepEqual(decode(encode(c)).config,c);
});
test('untrusted input never escapes defaults or bounds',()=>{
  for(const hash of ['#u=%','#!bad','#u='+encodeURIComponent('{"v":2,"speed":3}'),'#u='+encodeURIComponent('null'),'#u='+ 'x'.repeat(12001)]) assert.deepEqual(decode(hash),{valid:false,config:freshConfig()});
  const c=validate({speed:4.5,time:Infinity,reveal:NaN,push:-1,lift:'1',motion:'false',layers:{hero:'false',unknown:true},cloudStrengths:[99,-1,null,'x'],phases:{'lower-left':181}});
  assert.deepEqual(c,DEFAULT);
  assert.equal(Object.prototype.polluted,undefined);
  assert.deepEqual(decode('#u='+encodeURIComponent('{"v":1,"__proto__":{"polluted":true},"layers":{"__proto__":{"polluted":true}}}')).config,DEFAULT);
});
test('unknown fields ignored and default objects cannot be mutated',()=>{
  const c=decode('#u='+encodeURIComponent('{"v":1,"speed":2,"future":true}')).config;
  assert.equal(c.speed,2);assert.equal(c.future,undefined);c.layers.hero=false;assert.equal(DEFAULT.layers.hero,true);
});
test('language selection is stable and all messages are trilingual',()=>{
  assert.equal(selectLanguage('ja',['zh-CN']),'ja');assert.equal(selectLanguage(null,['fr','zh-TW']),'zh');assert.equal(selectLanguage(null,['ko']),'en');
  for(const [key,values] of Object.entries(words)) assert(values.length===3&&values.every(x=>typeof x==='string'&&x.length>0),key);
});
