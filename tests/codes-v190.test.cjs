'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
test('1.9 code registry migration has owner-only RPC, unique codes and bounded discount/commission',()=>{
 const sql=fs.readFileSync(path.join(root,'backend/migrate-1.9.sql'),'utf8');
 assert.match(sql,/create table if not exists public\.fox_codes/);
 assert.match(sql,/fox_codes_code_lower_unique/);
 assert.match(sql,/public\.fox_admins where id=actor/);
 assert.match(sql,/discount_percent between 0 and 90/);
 assert.match(sql,/commission_percent between 0 and 30/);
 assert.match(sql,/revoke all on function public\.fox_owner_codes\(text,jsonb\) from public,anon/);
 assert.match(sql,/grant execute on function public\.fox_owner_codes\(text,jsonb\) to authenticated/);
});
