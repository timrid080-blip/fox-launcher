'use strict';
const path=require('path');const {readJson,writeJson}=require('./util');
class Playtime{
 constructor(root,cloud,emit){this.file=path.join(root,'playtime.json');this.cloud=cloud;this.emit=emit;this.active=new Map();this.queue=Promise.resolve();this.timer=setInterval(()=>this.tick().catch(()=>{}),30000);this.timer.unref();}
 async start(id){this.active.set(id,{last:performance.now(),session:null});try{const r=await this.cloud.action('start',{instance:id});const row=this.active.get(id);if(row)row.session=r.session;}catch{} }
 tick(endId){const run=async()=>{const state=await readJson(this.file,{instances:{},achievements:[]});for(const [id,row] of this.active){const now=performance.now(),ms=Math.max(0,Math.min(75000,now-row.last));row.last=now;state.instances[id]=(state.instances[id]||0)+ms;if(row.session){try{const s=await this.cloud.action(id===endId?'end':'beat',{session:row.session});this.emit('cloud',s);}catch(e){this.emit('cloud-warning',e.message);}}if(id===endId)this.active.delete(id);}const total=Object.values(state.instances).reduce((a,b)=>a+b,0),max=Math.max(0,...Object.values(state.instances));for(const [code,pass] of [['gamer',total>=3600000],['addict',max>=36000000]])if(pass&&!state.achievements.includes(code)){state.achievements.push(code);this.emit('achievement',{code});}await writeJson(this.file,state);return state;};this.queue=this.queue.catch(()=>{}).then(run);return this.queue;}
 async state(){return readJson(this.file,{instances:{},achievements:[]});}
}
module.exports={Playtime};
