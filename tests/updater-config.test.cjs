'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validate}=require('../core/services');
test('blank saved GitHub settings fall back to the Fox Launcher repository for update checks',()=>{
 const c=validate({github:{owner:'',repo:'',branch:'main'},supabase:{url:'',publishableKey:''}});
 assert.equal(c.github.owner,'timrid080-blip');
 assert.equal(c.github.repo,'fox-launcher');
});
