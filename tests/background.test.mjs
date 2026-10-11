import test from 'node:test';import assert from 'node:assert/strict';
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
 const tick=async()=>{await events.alarm[0]({name:'boss-collector-tick'});await settle();};
 return {stored,tabs,events,requests,control,tick,unblock:()=>blocked=false};
}
test('service worker persists results and never closes the list tab',async()=>{const h=await harness();await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});await h.tick();await h.tick();assert.equal(Object.values(h.stored.task.jobs)[0].status,'saved');assert.equal(h.tabs.size,1);await h.tick();assert.equal(h.stored.task.status,'complete');});
test('verification pauses without losing job and resumes once resolved',async()=>{const h=await harness(true);await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});await h.tick();await h.tick();assert.equal(h.stored.task.status,'paused');assert.equal(Object.values(h.stored.task.jobs)[0].status,'pending');assert.equal(h.tabs.size,2);h.unblock();await h.control({action:'resume'});await h.tick();await h.tick();assert.equal(Object.values(h.stored.task.jobs)[0].status,'saved');assert.equal(h.tabs.size,1);});
test('running task cannot be overwritten by new config; pause keeps rows',async()=>{const h=await harness();await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});const r=await h.control({action:'new',config:{keyword:'运营',cities:['上海']}});assert.equal(r.ok,false);await h.control({action:'pause'});assert.equal(h.stored.task.status,'paused');assert.equal(h.stored.task.config.keyword,'剪辑');});
test('browser restart restores running checkpoint and leaves user-paused task paused',async()=>{const h=await harness();await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});h.events.startup[0]();await settle();assert.equal(h.stored.task.status,'running');assert.equal(h.stored.task.phase,'setup');await h.control({action:'pause'});h.events.startup[0]();await settle();assert.equal(h.stored.task.status,'paused');});
test('worker rehydration keeps saved state and remaining queue',async()=>{const h=await harness();await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});await h.tick();await h.tick();const before=structuredClone(h.stored.task);await import('../background.js?reload='+Math.random());await settle();assert.deepEqual(h.stored.task.jobs,before.jobs);assert.equal(h.stored.task.status,'running');});
test('history recovers the old keyword and its collected rows',async()=>{const h=await harness();await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});await h.tick();await h.tick();await h.control({action:'pause'});await h.control({action:'new',config:{keyword:'运营',cities:['上海']}});const r=await h.control({action:'archives'});assert.equal(r.archives.length,1);const restored=await h.control({action:'openArchive',key:r.archives[0].key});assert.equal(restored.task.config.keyword,'剪辑');assert.equal(Object.values(restored.task.jobs)[0].status,'saved');assert.equal(restored.task.status,'paused');});

const jobs=(start,end)=>Array.from({length:end-start+1},(_,i)=>({title:'剪辑'+(start+i),url:'https://www.zhipin.com/job_detail/j'+(start+i)+'.html',company_url:'https://www.zhipin.com/gongsi/company.html',location:'北京·朝阳'}));
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
test('five distinct companies processed sequentially per wakeup, without dashboard or focused tabs',async()=>{
 const h=await harness(false,async()=>({cards:jobs(1,8).map((j,i)=>({...j,company_url:'https://www.zhipin.com/gongsi/c'+i+'.html'})),end:'没有更多'}));
 await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});await h.tick();await h.tick();
 assert.equal(h.requests.filter(x=>x==='company').length,5);assert.equal(Object.values(h.stored.task.jobs).filter(e=>e.status==='saved').length,5);assert.ok([...h.tabs.values()].every(t=>t.active===false));assert.equal(h.tabs.size,1);
});
test('company cache saves remaining jobs without repeat company requests; city settings retain Beijing rows',async()=>{
 const h=await harness(false,async()=>({cards:jobs(1,25),end:'没有更多'}));await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});await h.tick();await h.tick();await h.tick();
 assert.equal(h.requests.filter(x=>x==='company').length,1);assert.equal(Object.values(h.stored.task.jobs).filter(e=>e.status==='saved').length,25);
 const r=await h.control({action:'new',config:{keyword:'剪辑',cities:['上海']}});assert.equal(r.ok,true);assert.equal(Object.values(r.task.jobs).filter(e=>e.status==='saved').length,25);assert.equal(r.task.currentCity,'上海');
});
test('one wakeup loads three batches and checkpoints each before next scroll',async()=>{
 let page=0;const h=await harness(false,async(m,stored)=>{
  if(m.action==='scroll'){assert.equal(Object.keys(stored.task.jobs).length,(page+1)*15);page++;}
  return {cards:jobs(page*15+1,page*15+15),changed:m.action==='scroll',end:page===3?'没有更多':''};
 });await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});await h.control({action:'resume'});await h.tick();await h.tick();
 assert.equal(page,3);assert.equal(Object.keys(h.stored.task.jobs).length,60);assert.equal(Object.values(h.stored.task.jobs).filter(e=>e.status==='saved').length,5);
});
test('replaying previously saved pages reaches new jobs without false loading stalls',async()=>{
 let page=0;const h=await harness(false,async m=>{if(m.action==='scroll')page++;return {cards:jobs(page*15+1,page*15+15),changed:m.action==='scroll',end:page>=5?'没有更多了':''};});
 await h.control({action:'new',config:{keyword:'剪辑',cities:['北京']}});
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
 assert.equal(Object.keys(h.stored.task.jobs).length,30);assert.equal(Object.values(h.stored.task.jobs).filter(j=>j.status==='saved').length,5);
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
