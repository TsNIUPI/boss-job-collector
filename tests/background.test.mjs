import test from 'node:test';import assert from 'node:assert/strict';
import {roundCount,savedCount} from '../core.js';
const settle=async()=>{for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r));};
async function harness(gate=false,source=null){
 const stored={},events={message:[],alarm:[],startup:[],click:[]},tabs=new Map(),requests=[];let next=1,blocked=gate;
 const sample={title:'视频剪辑',url:'https://www.zhipin.com/job_detail/abc.html',company_url:'https://www.zhipin.com/gongsi/abc.html',location:'北京·朝阳'};
 globalThis.chrome={storage:{local:{get:async k=>k===null?structuredClone(stored):({[k]:stored[k]?structuredClone(stored[k]):undefined}),set:async data=>Object.assign(stored,structuredClone(data))}},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{},onClicked:{addListener:f=>events.click.push(f)}},alarms:{create:async()=>{},clear:async()=>{},get:async()=>null,onAlarm:{addListener:f=>events.alarm.push(f)}},runtime:{getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener:f=>events.message.push(f)},onStartup:{addListener:f=>events.startup.push(f)}},tabs:{
  create:async data=>{const t={id:next++,...data};tabs.set(t.id,t);return t;},get:async id=>{if(!tabs.has(id))throw Error('closed');return tabs.get(id);},remove:async id=>tabs.delete(id),update:async(id,data)=>{Object.assign(tabs.get(id),data);return tabs.get(id);},query:async()=>[],
  sendMessage:async(id,m)=>{requests.push(m.action);if(source&&['list','scroll'].includes(m.action)){const data=await source(m,stored);return data?.ok===false?data:{ok:true,data};}if(m.action==='city')return {ok:true,data:{city:m.city}};if(m.action==='list')return {ok:true,data:{cards:[sample],end:'没有更多',city:'北京'}};if(m.action==='company')return blocked?{ok:false,error:'网页要求验证或限制访问，请手动处理后继续'}:{ok:true,data:{name:'测试有限公司',credit:'91310120332335763Y'}};return {ok:true,data:{}};}
 }};
 await import('../background.js?test='+Math.random());await settle();
 const control=m=>new Promise(resolve=>events.message[0]({channel:'boss-dashboard',...m},{url:'chrome-extension://test/dashboard.html'},resolve));
 const tick=async()=>{if(stored.task)stored.task.nextRunAt=Date.now()-1;await events.alarm[0]({name:'boss-collector-tick'});await settle();};
 return {stored,tabs,events,requests,control,tick,unblock:()=>blocked=false};
}
test('service worker persists results and never closes the list tab',async()=>{const h=await harness();await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});await h.tick();await h.tick();assert.equal(Object.values(h.stored.task.jobs)[0].status,'saved');assert.equal(h.tabs.size,1);await h.tick();assert.equal(h.stored.task.status,'complete');});
test('verification pauses without losing job and resumes once resolved',async()=>{const h=await harness(true);await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});await h.tick();await h.tick();assert.equal(h.stored.task.status,'paused');assert.equal(Object.values(h.stored.task.jobs)[0].status,'pending');assert.equal(h.tabs.size,2);h.unblock();await h.control({action:'resume'});await h.tick();await h.tick();assert.equal(Object.values(h.stored.task.jobs)[0].status,'saved');assert.equal(h.tabs.size,1);});
test('running task cannot be overwritten by new config; pause keeps rows',async()=>{const h=await harness();await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});const r=await h.control({action:'new',config:{keyword:'运营',cities:['上海']}});assert.equal(r.ok,false);await h.control({action:'pause'});assert.equal(h.stored.task.status,'paused');assert.equal(h.stored.task.config.keyword,'剪辑');});
test('browser restart restores running checkpoint and leaves user-paused task paused',async()=>{const h=await harness();await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});h.events.startup[0]();await settle();assert.equal(h.stored.task.status,'running');assert.equal(h.stored.task.phase,'setup');await h.control({action:'pause'});h.events.startup[0]();await settle();assert.equal(h.stored.task.status,'paused');});
test('worker rehydration keeps saved state and remaining queue',async()=>{const h=await harness();await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});await h.tick();await h.tick();const before=structuredClone(h.stored.task);await import('../background.js?reload='+Math.random());await settle();assert.deepEqual(h.stored.task.jobs,before.jobs);assert.equal(h.stored.task.status,'running');});
test('history recovers the old keyword and its collected rows',async()=>{const h=await harness();await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});await h.tick();await h.tick();await h.control({action:'pause'});await h.control({action:'new',config:{keyword:'运营',cities:['上海']}});const r=await h.control({action:'archives'});assert.equal(r.archives.length,1);const restored=await h.control({action:'openArchive',key:r.archives[0].key});assert.equal(restored.task.config.keyword,'剪辑');assert.equal(Object.values(restored.task.jobs)[0].status,'saved');assert.equal(restored.task.status,'paused');});

const jobs=(start,end)=>Array.from({length:end-start+1},(_,i)=>({title:'剪辑'+(start+i),url:'https://www.zhipin.com/job_detail/j'+(start+i)+'.html',company_url:'https://www.zhipin.com/gongsi/company.html',location:'北京·朝阳'}));
function history(s,start,end,city='北京'){
 for(const raw of jobs(start,end)){const job={...raw,city,location:city+'·示例区'};s.jobs[city+'|'+job.url]={job,status:'saved',row:[job.title,'历史公司','历史法人','未展示','未展示','未展示',city]};}
}
test('the reported 53 historic rows and target 40 can run and save exactly 40 new rows',async()=>{
 const h=await harness(false,async()=>({cards:jobs(1,120),end:'没有更多'}));await h.control({action:'new',config:{keyword:'剪辑',cities:['北京'],target:40}});
 history(h.stored.task,1,53);delete h.stored.task.countingVersion;h.stored.task.stopReason='target';h.stored.task.reason='旧累计53/40';
 await import('../background.js?migrate53='+Math.random());await settle();assert.equal(roundCount(h.stored.task),0);assert.equal(savedCount(h.stored.task),53);assert.notEqual(h.stored.task.stopReason,'target');
 const started=await h.control({action:'resume'});assert.equal(started.task.status,'running');await h.tick();await h.tick();
 assert.equal(savedCount(h.stored.task),93);assert.equal(roundCount(h.stored.task),40);assert.equal(h.stored.task.stopReason,'target');assert.equal(h.requests.filter(x=>x==='company').length,0);
 const before=h.requests.length;await h.tick();assert.equal(h.requests.length,before);
});
test('user pause, worker reload, and browser restart preserve the current round count',async()=>{
 let total=20;const h=await harness(false,async()=>({cards:jobs(1,total),end:'',changed:false}));await h.control({action:'new',config:{keyword:'剪辑',cities:['北京'],target:40}});await h.control({action:'resume'});await h.tick();await h.tick();
 const id=h.stored.task.round.id;assert.equal(roundCount(h.stored.task),20);await h.control({action:'pause'});await import('../background.js?roundRestore='+Math.random());await settle();assert.equal(roundCount(h.stored.task),20);
 await h.control({action:'resume'});h.events.startup[0]();await settle();assert.equal(h.stored.task.round.id,id);assert.equal(roundCount(h.stored.task),20);
 total=70;await h.tick();await h.tick();assert.equal(roundCount(h.stored.task),40);assert.equal(savedCount(h.stored.task),40);assert.equal(h.stored.task.stopReason,'target');
});
test('explicit next round continues pending jobs while duplicate old rows never count again',async()=>{
 const h=await harness(false,async()=>({cards:jobs(1,30),end:'没有更多'}));await h.control({action:'new',config:{keyword:'剪辑',cities:['北京'],target:10}});await h.control({action:'resume'});await h.tick();await h.tick();const oldId=h.stored.task.round.id;
 await h.control({action:'resume',newRound:true});assert.notEqual(h.stored.task.round.id,oldId);assert.equal(roundCount(h.stored.task),0);await h.tick();await h.tick();assert.equal(savedCount(h.stored.task),20);assert.equal(roundCount(h.stored.task),10);
});
test('a completed city can be rescanned for new rows without deleting history or resetting on an ordinary continue',async()=>{
 let total=3;const h=await harness(false,async()=>({cards:jobs(1,total),end:'没有更多'}));await h.control({action:'new',config:{keyword:'剪辑',cities:['北京'],target:10}});await h.control({action:'resume'});await h.tick();await h.tick();await h.tick();assert.equal(h.stored.task.status,'complete');
 total=8;const r=await h.control({action:'resume',newRound:true});assert.equal(r.task.status,'running');assert.equal(roundCount(r.task),0);assert.equal(savedCount(r.task),3);await h.tick();await h.tick();assert.equal(roundCount(h.stored.task),5);assert.equal(savedCount(h.stored.task),8);assert.equal(h.stored.task.status,'complete');
});
test('historic rows in other cities and an imported running round have independent quotas',async()=>{
 const h=await harness(false,async()=>({cards:jobs(1,20),end:'没有更多'}));await h.control({action:'new',config:{keyword:'剪辑',cities:['北京'],target:10}});history(h.stored.task,1,53,'上海');await h.control({action:'resume'});await h.tick();await h.tick();
 assert.equal(roundCount(h.stored.task),10);assert.equal(savedCount(h.stored.task),63);const backup=structuredClone(h.stored.task);await h.control({action:'backupImport',backup});assert.equal(roundCount(h.stored.task),10);assert.equal(savedCount(h.stored.task),63);assert.equal(h.stored.task.stopReason,'target');
});
test('cached rows stop exactly at the saved-job goal without opening company pages',async()=>{
 const h=await harness(false,async()=>({cards:jobs(1,30),end:'没有更多'}));await h.control({action:'new',config:{keyword:'剪辑',cities:['北京'],target:10}});
 h.stored.companyCache={'https://www.zhipin.com/gongsi/company.html':{name:'缓存公司'}};
 await h.control({action:'resume'});await h.tick();await h.tick();
 assert.equal(h.stored.task.status,'paused');assert.equal(h.stored.task.stopReason,'target');assert.equal(Object.values(h.stored.task.jobs).filter(e=>e.status==='saved').length,10);
 assert.equal(Object.values(h.stored.task.jobs).filter(e=>e.status==='pending').length,20);assert.equal(h.requests.filter(x=>x==='company').length,0);assert.ok(!h.stored.task.cities['北京']?.complete);
});
test('new company batch reuse also stops exactly at target and keeps remaining jobs pending',async()=>{
 const h=await harness(false,async()=>({cards:jobs(1,30),end:'没有更多'}));await h.control({action:'new',config:{keyword:'剪辑',cities:['北京'],target:10}});await h.control({action:'resume'});await h.tick();await h.tick();
 assert.equal(Object.values(h.stored.task.jobs).filter(e=>e.status==='saved').length,10);assert.equal(h.requests.filter(x=>x==='company').length,1);assert.equal(h.stored.task.stopReason,'target');assert.equal(h.tabs.size,1);
});
test('lowering below the current round count starts a new plan and historical rows stay intact',async()=>{
 const h=await harness(false,async()=>({cards:jobs(1,30),end:'没有更多'}));await h.control({action:'new',config:{keyword:'剪辑',cities:['北京'],target:15}});await h.control({action:'resume'});await h.tick();await h.tick();
 await h.control({action:'new',config:{keyword:'剪辑',cities:['北京'],target:10}});assert.equal(Object.values(h.stored.task.jobs).filter(e=>e.status==='saved').length,15);assert.equal(h.stored.task.round,null);
 await h.control({action:'resume'});await h.tick();await h.tick();assert.equal(Object.values(h.stored.task.jobs).filter(e=>e.status==='saved').length,25);assert.equal(h.stored.task.stopReason,'target');
 await h.control({action:'new',config:{keyword:'剪辑',cities:['北京'],target:20}});await h.control({action:'resume'});await h.tick();await h.tick();await h.tick();assert.equal(Object.values(h.stored.task.jobs).filter(e=>e.status==='saved').length,30);assert.equal(h.stored.task.status,'complete');
});
test('zero target does not create a page or request; target completion wins over elapsed rest',async()=>{
 const h=await harness();await h.control({action:'new',config:{keyword:'剪辑',cities:['北京'],target:0}});await h.control({action:'resume'});await h.tick();assert.equal(h.tabs.size,0);assert.equal(h.requests.length,0);assert.equal(h.stored.task.stopReason,'target');
 h.stored.pacingSession={startedAt:Date.now()-31*60*1000,companies:0,restUntil:0};h.stored.task.status='running';await h.tick();assert.equal(h.stored.task.stopReason,'target');assert.equal(h.stored.pacingSession.restUntil,0);
});
test('worker restoring historical rows cannot consume the running round goal',async()=>{
 const h=await harness();await h.control({action:'new',config:{keyword:'剪辑',cities:['北京'],target:1}});await h.control({action:'resume'});
 const job={...jobs(1,1)[0],city:'北京'};h.stored.archive_goal={config:{keyword:'剪辑'},jobs:{['北京|'+job.url]:{job,status:'saved',row:[job.title,'历史公司','','','','','北京']}},companies:{}};
 await import('../background.js?goal='+Math.random());await settle();assert.notEqual(h.stored.task.stopReason,'target');assert.equal(h.stored.task.status,'running');
 const before=h.requests.length;h.events.startup[0]();await settle();assert.equal(h.stored.task.status,'running');assert.equal(h.requests.length,before);
});
test('old backup rows stay separate from the new round and smaller lists can finish below target',async()=>{
 const h=await harness();await h.control({action:'new',config:{keyword:'剪辑',cities:['北京'],target:1}});const backup=structuredClone(h.stored.task),job={...jobs(1,1)[0],city:'北京'};
 backup.jobs['北京|'+job.url]={job,status:'saved',row:[job.title,'备份公司','','','','','北京']};await h.control({action:'backupImport',backup});assert.notEqual(h.stored.task.stopReason,'target');await h.control({action:'resume'});assert.equal(h.stored.task.status,'running');
 const small=await harness(false,async()=>({cards:jobs(1,3),end:'没有更多'}));await small.control({action:'new',config:{keyword:'剪辑',cities:['北京'],target:10}});await small.control({action:'resume'});await small.tick();await small.tick();await small.tick();assert.equal(small.stored.task.status,'complete');assert.equal(Object.values(small.stored.task.jobs).filter(e=>e.status==='saved').length,3);
});
test('early or stale alarms cannot run an extra step during a scheduled wait',async()=>{
 const h=await harness();await h.control({action:'new',config:{keyword:'剪辑',cities:['北京'],interval:10,varied:false}});let alarm;chrome.alarms.create=async(name,options)=>{alarm=options;};
 const before=Date.now();await h.control({action:'resume'});assert.ok(h.stored.task.nextRunAt>=before+10000);assert.ok(alarm.when>=before+30000);
 await h.events.alarm[0]({name:'boss-collector-tick'});assert.equal(h.requests.length,0);await h.control({action:'pause'});
});
test('saved company data is reused across different keywords without another company visit',async()=>{
 const h=await harness();await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});await h.tick();await h.tick();await h.tick();
 const before=h.requests.filter(x=>x==='company').length;await h.control({action:'new',config:{keyword:'运营',cities:['北京']}});
 assert.equal(Object.keys(h.stored.task.jobs).length,0);await h.control({action:'resume'});await h.tick();await h.tick();
 assert.equal(h.requests.filter(x=>x==='company').length,before);assert.equal(Object.values(h.stored.task.jobs)[0].source,'cache');assert.equal(h.stored.task.status,'complete');
});
test('company navigation during reading cannot save a wrong row or poison shared cache',async()=>{
 const h=await harness();const send=chrome.tabs.sendMessage;
 chrome.tabs.sendMessage=async(id,m)=>{const response=await send(id,m);if(m.action==='company')h.tabs.get(id).url='https://www.zhipin.com/gongsi/other.html';return response;};
 await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});await h.tick();await h.tick();
 assert.equal(h.stored.task.status,'paused');assert.match(h.stored.task.reason,/地址发生变化/);assert.equal(Object.values(h.stored.task.jobs)[0].status,'pending');assert.equal(Object.keys(h.stored.companyCache).length,0);
});
test('completed tasks keep the final completion reason',async()=>{
 const h=await harness();await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});await h.tick();await h.tick();await h.tick();assert.match(h.stored.task.reason,/全部所选城市/);
});
test('old saved rows rebuild company cache on worker reload even without a companies object',async()=>{
 const h=await harness();await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});
 const sample={...jobs(1,1)[0],city:'北京'};h.stored.archive_old={config:{keyword:'运营'},jobs:{legacy:{job:sample,status:'saved',row:[sample.title,'历史公司','历史法人','未展示','未展示','未展示','北京']}}};
 await import('../background.js?cache='+Math.random());await settle();assert.equal(h.stored.companyCache[sample.company_url].name,'历史公司');
 await h.control({action:'resume'});await h.tick();await h.tick();
 // The harness uses a different company URL; this must not match by name or job title.
 assert.equal(h.requests.filter(x=>x==='company').length,1);
});
test('backup import reconstructs cached company rows and saves new jobs without company requests',async()=>{
 const h=await harness(false,async()=>({cards:jobs(1,2),end:'没有更多'}));await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});
 const backup=structuredClone(h.stored.task),sample={...jobs(1,1)[0],city:'北京'};
 backup.jobs['北京|'+sample.url]={job:sample,status:'saved',row:[sample.title,'备份公司','张三','未展示','未展示','未展示','北京']};
 await h.control({action:'backupImport',backup});await h.control({action:'resume'});await h.tick();await h.tick();
 assert.equal(h.requests.filter(x=>x==='company').length,0);assert.equal(Object.values(h.stored.task.jobs).filter(e=>e.status==='saved').length,2);assert.equal(h.stored.task.status,'complete');
});
test('retry keeps wrong-city records in review without issuing a company request',async()=>{
 const h=await harness(false,async()=>({cards:jobs(1,1).map(j=>({...j,location:'上海·浦东'})),end:'没有更多'}));await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});
 await h.control({action:'resume'});await h.tick();await h.tick();await h.control({action:'retry'});await h.control({action:'resume'});await h.tick();await h.tick();
 assert.equal(h.requests.filter(x=>x==='company').length,0);assert.equal(Object.values(h.stored.task.jobs)[0].status,'review');assert.equal(h.stored.task.status,'paused');
});
test('resume clears a stale list-end marker so new pages cannot be declared complete',async()=>{
 const h=await harness(false,async()=>({cards:jobs(1,1),end:'',changed:false}));await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});
 h.stored.task.scans={北京:{end:'过去的末尾',stalls:0}};await h.control({action:'resume'});await h.tick();await h.tick();
 assert.equal(h.stored.task.scans['北京'].end,'');assert.equal(h.stored.task.status,'running');assert.match(h.stored.task.reason,/^$/);
});
test('scheduler persists the actual variable alarm time and keeps the base interval',async()=>{
 const h=await harness();let alarm;
 chrome.alarms.create=async(name,options)=>{alarm={name,...options};};
 await h.control({action:'new',config:{keyword:'剪辑',cities:['北京'],interval:60}});
 const before=Date.now();await h.control({action:'resume'});
 assert.equal(alarm.when,h.stored.task.nextRunAt);assert.ok(alarm.when>=before+60000);assert.ok(alarm.when<=Date.now()+100000);
 await h.control({action:'pause'});await h.control({action:'new',config:{keyword:'剪辑',cities:['北京'],interval:60,varied:false}});
 const fixedBefore=Date.now();await h.control({action:'resume'});assert.ok(alarm.when>=fixedBefore+60000&&alarm.when<=Date.now()+60000);
});
test('retry re-reads a previously missing company link and successfully saves the record',async()=>{
 let missing=true;const h=await harness(false,async()=>({cards:[{...jobs(1,1)[0],company_url:missing?'':jobs(1,1)[0].company_url}],end:'没有更多'}));
 await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});
 await h.tick();await h.tick();await h.tick();assert.equal(h.stored.task.status,'paused');
 missing=false;await h.control({action:'retry'});await h.control({action:'resume'});await h.tick();await h.tick();await h.tick();
 assert.equal(Object.values(h.stored.task.jobs)[0].status,'saved');assert.equal(h.stored.task.status,'complete');
});
test('usable page with background resources still loading can proceed immediately',async()=>{
 const h=await harness();const get=chrome.tabs.get,send=chrome.tabs.sendMessage;chrome.tabs.get=async id=>({...await get(id),status:'loading'});chrome.tabs.sendMessage=async(id,m)=>m.action==='ping'?{ok:true,data:{ready:true}}:send(id,m);
 await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});await h.tick();await h.tick();assert.equal(Object.values(h.stored.task.jobs)[0].status,'saved');
});
test('failed list reconnect navigates owned page then restores city without losing records',async()=>{
 let blocked=false;const h=await harness(false,async()=>blocked?{ok:false,error:'页面连接失败：读取岗位列表暂未就绪'}:{cards:jobs(1,1),end:''});
 await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});await h.tick();await h.tick();blocked=true;await h.tick();assert.equal(h.stored.task.phase,'setup');assert.equal(h.stored.task.status,'running');assert.equal(h.tabs.get(h.stored.task.tabId).active,false);blocked=false;await h.tick();await h.tick();assert.equal(Object.values(h.stored.task.jobs)[0].status,'saved');assert.equal(h.stored.task.connectionRetries,0);
});
test('loading page waits for readiness before attempting its message',async()=>{
 const h=await harness();const get=chrome.tabs.get,send=chrome.tabs.sendMessage;let waits=0,attempts=0;
 chrome.tabs.get=async id=>({...await get(id),status:waits++<2?'loading':'complete'});chrome.tabs.sendMessage=async(id,m)=>{if(m.action==='ping')return {ok:true,data:{ready:false}};attempts++;assert.ok(waits>=3);return send(id,m);};
 await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});await h.tick();assert.equal(h.stored.task.phase,'scan');assert.equal(attempts,1);
});
test('complete owned page with stale extension script reloads once then recovers',async()=>{
 const h=await harness();const get=chrome.tabs.get,send=chrome.tabs.sendMessage;let reloaded=0;
 chrome.tabs.get=async id=>({...await get(id),status:'complete'});chrome.tabs.reload=async()=>{reloaded++;};chrome.tabs.sendMessage=async(id,m)=>{if(!reloaded)throw Error('Could not establish connection. Receiving end does not exist.');return send(id,m);};
 await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});await h.tick();assert.equal(reloaded,1);assert.equal(h.stored.task.phase,'scan');assert.equal(h.stored.task.status,'running');
});
test('extension upgrade restores hidden historical Beijing rows without moving Shanghai checkpoint',async()=>{
 const h=await harness();await h.control({action:'new',config:{keyword:'剪辑',cities:['上海']}});
 const job={...jobs(1,1)[0],city:'北京'};h.stored.archive_legacy={config:{keyword:'剪辑',cities:['北京']},jobs:{['北京|'+job.url]:{job,status:'saved',row:[job.title,'北京公司','','','','','北京']}},companies:{}};
 await import('../background.js?upgrade='+Math.random());await settle();assert.equal(Object.values(h.stored.task.jobs)[0].row[6],'北京');assert.equal(h.stored.task.config.cities[0],'上海');assert.equal(h.stored.task.cityIndex,0);assert.equal(h.stored.task.status,'paused');
});
test('one new company per wakeup without dashboard or focused tabs',async()=>{
 const h=await harness(false,async()=>({cards:jobs(1,8).map((j,i)=>({...j,company_url:'https://www.zhipin.com/gongsi/c'+i+'.html'})),end:'没有更多'}));
 await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});await h.tick();await h.tick();
 assert.equal(h.requests.filter(x=>x==='company').length,1);assert.equal(Object.values(h.stored.task.jobs).filter(e=>e.status==='saved').length,1);assert.ok([...h.tabs.values()].every(t=>t.active===false));assert.equal(h.tabs.size,1);
});
test('company cache saves remaining jobs without repeat company requests; city settings retain Beijing rows',async()=>{
 const h=await harness(false,async()=>({cards:jobs(1,25),end:'没有更多'}));await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});await h.tick();await h.tick();await h.tick();
 assert.equal(h.requests.filter(x=>x==='company').length,1);assert.equal(Object.values(h.stored.task.jobs).filter(e=>e.status==='saved').length,25);
 const r=await h.control({action:'new',config:{keyword:'剪辑',cities:['上海']}});assert.equal(r.ok,true);assert.equal(Object.values(r.task.jobs).filter(e=>e.status==='saved').length,25);assert.equal(r.task.currentCity,'上海');
});
test('one wakeup loads one batch and preserves discovered rows',async()=>{
 let page=0;const h=await harness(false,async(m,stored)=>{
  if(m.action==='scroll'){assert.equal(Object.keys(stored.task.jobs).length,(page+1)*15);page++;}
  return {cards:jobs(page*15+1,page*15+15),changed:m.action==='scroll',end:page===3?'没有更多':''};
 });await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});await h.tick();await h.tick();
 assert.equal(page,1);assert.equal(Object.keys(h.stored.task.jobs).length,30);assert.equal(Object.values(h.stored.task.jobs).filter(e=>e.status==='saved').length,30);assert.equal(h.requests.filter(x=>x==='company').length,1);
});
test('replaying previously saved pages reaches new jobs without false loading stalls',async()=>{
 let page=0;const h=await harness(false,async m=>{if(m.action==='scroll')page++;return {cards:jobs(page*15+1,page*15+15),changed:m.action==='scroll',end:page>=5?'没有更多了':''};});
 await h.control({action:'new',config:{keyword:'剪辑',cities:['北京'],target:100}});
 const s=h.stored.task;for(const job of jobs(1,75))s.jobs['北京|'+job.url]={job:{...job,city:'北京'},status:'saved',row:[job.title,'公司','法人','100万','2020-01-01','91310120332335763Y','北京']};
 await h.control({action:'resume'});for(let i=0;i<7;i++)await h.tick();
 assert.equal(page,5);assert.equal(Object.keys(h.stored.task.jobs).length,90);assert.equal(h.stored.task.scans['北京'].stalls,0);assert.equal(h.stored.task.status,'complete');
});
test('missing owned list is recreated and configured before processing the checkpoint',async()=>{
 const h=await harness();await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});await h.tick();await h.tick();h.tabs.clear();await h.tick();
 assert.equal(h.stored.task.phase,'scan');assert.equal(h.stored.task.status,'running');assert.equal(Object.values(h.stored.task.jobs)[0].status,'saved');
});
test('scope mismatch restores setup automatically without losing saved records',async()=>{
 let wrong=true;const h=await harness(false,async()=>wrong?{ok:false,error:'筛选需恢复：应为北京 / 剪辑，页面为上海 / 剪辑'}:{cards:jobs(1,1),end:'没有更多'});
 await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});await h.tick();await h.tick();assert.equal(h.stored.task.status,'running');assert.equal(h.stored.task.phase,'setup');wrong=false;await h.tick();await h.tick();assert.equal(Object.values(h.stored.task.jobs)[0].status,'saved');
});
test('reviews at city end block advancement until that city is resolved',async()=>{
 const h=await harness(false,async()=>({cards:[{...jobs(1,1)[0],company_url:''}],end:'没有更多'}));await h.control({action:'new',config:{keyword:'剪辑',cities:['北京','上海']}});await h.control({action:'resume'});for(let i=0;i<3;i++)await h.tick();assert.equal(h.stored.task.status,'paused');assert.equal(h.stored.task.cityIndex,0);assert.equal(Object.values(h.stored.task.jobs)[0].status,'review');
});
test('temporary connection errors retry three rounds; recovery saves and repeated failure stops safely',async()=>{
 let fail=true;const h=await harness(false,async()=>fail?{ok:false,error:'页面连接失败，请刷新BOSS页后继续'}:{cards:jobs(1,1),end:'没有更多'});
 await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});await h.tick();
 await h.tick();assert.equal(h.stored.task.status,'running');assert.equal(h.stored.task.connectionRetries,1);
 fail=false;await h.tick();await h.tick();assert.equal(h.stored.task.connectionRetries,0);assert.equal(Object.values(h.stored.task.jobs)[0].status,'saved');
 fail=true;for(let i=0;i<3;i++){await h.tick();assert.equal(h.stored.task.status,'running');assert.equal(h.stored.task.connectionRetries,i+1);await h.tick();}await h.tick();assert.equal(h.stored.task.status,'paused');assert.equal(Object.values(h.stored.task.jobs)[0].status,'saved');
});
test('loads beyond first 15 before collecting and persists virtualized rows through resume',async()=>{
 let scrolled=false;
 const h=await harness(false,async(m,stored)=>{if(m.action==='scroll'){assert.equal(Object.keys(stored.task.jobs).length,15);scrolled=true;}return {cards:scrolled?jobs(16,30):jobs(1,15),end:scrolled?'没有更多了':''};});
 await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});await h.tick();await h.tick();
 assert.equal(Object.keys(h.stored.task.jobs).length,30);assert.equal(Object.values(h.stored.task.jobs).filter(j=>j.status==='saved').length,30);assert.equal(h.requests.filter(x=>x==='company').length,1);
 await h.control({action:'pause'});await h.control({action:'resume'});for(let i=0;i<31;i++)await h.tick();
 assert.equal(h.stored.task.status,'complete');assert.equal(Object.values(h.stored.task.jobs).filter(j=>j.status==='saved').length,30);
});
test('stalled loading still saves all discovered jobs without claiming complete',async()=>{
 let scrolls=0;const h=await harness(false,async m=>{if(m.action==='scroll')scrolls++;return {cards:jobs(1,15),end:''};});
 await h.control({action:'new',config:{keyword:'剪辑',cities:['北京'],stallLimit:3}});await h.control({action:'resume'});for(let i=0;i<17;i++)await h.tick();
 assert.equal(scrolls,3);assert.equal(h.stored.task.status,'paused');assert.equal(h.stored.task.cityIndex,0);assert.equal(Object.values(h.stored.task.jobs).filter(j=>j.status==='saved').length,15);assert.ok(!h.stored.task.cities['北京']?.endConfirmed);
});
test('confirmed end advances automatically to the next configured city',async()=>{
 const h=await harness(false,async m=>({cards:jobs(1,2).map(j=>({...j,location:m.city+'·城区'})),end:'没有更多了'}));
 await h.control({action:'new',config:{keyword:'剪辑',cities:['北京','上海']}});await h.control({action:'resume'});for(let i=0;i<8;i++)await h.tick();
 assert.equal(h.stored.task.status,'complete');assert.equal(Object.values(h.stored.task.jobs).filter(j=>j.status==='saved').length,4);assert.ok(h.stored.task.cities['上海'].complete);
});

test('platform restriction survives new tasks, blocks retry and leaves stored rows intact',async()=>{const h=await harness(false,async()=>({ok:false,error:'平台限制访问，已停止采集，请勿刷新或重试；恢复时间：2099-10-14 14:30'}));await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});await h.tick();await h.tick();assert.equal(h.stored.task.status,'paused');assert.ok(h.stored.platformRestriction.until>Date.now());const before=h.requests.length;assert.equal((await h.control({action:'resume'})).ok,false);assert.equal((await h.control({action:'clearRestriction'})).ok,false);await h.control({action:'new',config:{keyword:'运营',cities:['上海']}});assert.equal((await h.control({action:'resume'})).ok,false);await h.tick();assert.equal(h.requests.length,before);});
test('undated platform restriction needs explicit clearance and never auto resumes',async()=>{const h=await harness();await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});h.stored.platformRestriction={reason:'平台限制访问，请按页面提示处理',until:null};assert.equal((await h.control({action:'resume'})).ok,false);assert.equal((await h.control({action:'clearRestriction'})).ok,true);assert.equal(h.stored.task.status,'paused');assert.equal(h.stored.platformRestriction,null);assert.equal((await h.control({action:'resume'})).ok,true);});

test('loading probe restriction halts immediately without page reload or recovery',async()=>{const h=await harness();await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});await h.tick();for(const t of h.tabs.values())t.status='loading';let navigated=0;chrome.tabs.update=async()=>{navigated++;};chrome.tabs.sendMessage=async()=>({ok:false,error:'平台限制访问；恢复时间：2099-10-14 14:30'});await h.tick();assert.equal(h.stored.task.status,'paused');assert.ok(h.stored.platformRestriction);assert.equal(navigated,0);assert.equal(h.stored.task.connectionRetries,0);});

test('20 company visits no longer stop a task; time-based rest still persists across task switches',async()=>{
 const h=await harness(false,async()=>({cards:jobs(1,2).map((j,i)=>({...j,company_url:'https://www.zhipin.com/gongsi/c'+i+'.html'})),end:'没有更多'}));await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});await h.tick();
 h.stored.pacingSession.companies=20;await h.tick();assert.equal(h.stored.task.status,'running');assert.equal(h.stored.pacingSession.companies,21);
 h.stored.pacingSession.startedAt=Date.now()-31*60*1000;const before=h.requests.length;await h.tick();assert.equal(h.stored.task.status,'paused');assert.equal(h.requests.length,before);assert.ok(h.stored.pacingSession.restUntil>Date.now());
 await h.control({action:'new',config:{keyword:'运营',cities:['上海']}});assert.equal((await h.control({action:'resume'})).ok,false);h.events.startup[0]();await settle();assert.equal(h.stored.task.status,'paused');
});
test('elapsed session budget pauses before navigation; rest expiry requires explicit resume',async()=>{const h=await harness();await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});h.stored.pacingSession.startedAt=Date.now()-31*60*1000;await h.tick();assert.equal(h.stored.task.status,'paused');assert.equal(h.tabs.size,0);h.stored.pacingSession.restUntil=Date.now()-1;await h.tick();assert.equal(h.stored.task.status,'paused');assert.equal((await h.control({action:'resume'})).ok,true);assert.equal(h.stored.pacingSession.companies,0);assert.equal(h.stored.pacingSession.restUntil,0);});
