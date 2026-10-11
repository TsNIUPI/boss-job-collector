import {fresh,canonical,configuration,discover,stats,commit,finishCity,restoreBackup,configureTask} from './core.js';
const ALARM='boss-collector-tick';let serial=Promise.resolve();
const exclusive=fn=>{const next=serial.then(fn);serial=next.catch(()=>{});return next;};
const load=async()=> (await chrome.storage.local.get('task')).task;
async function save(s){s.updatedAt=Date.now();await chrome.storage.local.set({task:s});const v=stats(s);await chrome.action.setBadgeText({text:s.status==='running'?String(v.saved):s.status==='complete'?'✓':s.status==='paused'?'停':'!'});await chrome.action.setBadgeBackgroundColor({color:s.status==='running'?'#187c72':'#a66416'});}
function log(s,text){s.logs.push({at:Date.now(),text});s.logs=s.logs.slice(-150);}
async function schedule(s){if(s.status==='running')await chrome.alarms.create(ALARM,{delayInMinutes:s.config.interval/60});}
async function pageMessage(id,message,timeout=18000){
 let timer;try{return await Promise.race([chrome.tabs.sendMessage(id,message),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('页面脚本响应超时')),timeout);})]);}finally{clearTimeout(timer);}
}
async function send(id,action,args={}){
 const stage={city:'切换城市',list:'读取岗位列表',scroll:'加载更多岗位',company:'读取公司详情'}[action]||action;let last='页面尚未加载',refreshed=false;
 for(let n=0;n<24;n++){
  const tab=await chrome.tabs.get(id).catch(()=>null);
  if(!tab){last='采集标签页已关闭';break;}
  if(tab.status==='loading'){
   // Fonts, ads or images may keep Chrome "loading" after the usable DOM is
   // ready. Probe our listener rather than waiting for unrelated resources.
   let probe;try{probe=await pageMessage(id,{channel:'boss-collector',action:'ping'},3000);}catch(e){if(e.message==='页面脚本响应超时'){last=e.message;break;}}
   if(!probe?.ok||!probe.data?.ready){last='页面仍在加载';await new Promise(r=>setTimeout(r,500));continue;}
  }
  let r;try{r=await pageMessage(id,{channel:'boss-collector',action,...args});}catch(e){
   last=String(e.message||e).replace(/https?:\/\/\S+/g,'[网页地址]').slice(0,200);
   if(last==='页面脚本响应超时')break;
   // Repair stale/discarded scripts only on our specific collection page,
   // once per attempt. Never reload login, challenge or unrelated pages.
   const u=new URL(tab.url||'https://www.zhipin.com/');
   const expected=action==='company'?/^\/gongsi\/[\w~.-]+\.html$/:/^\/web\/geek\/jobs\/?$/;
   if(!refreshed&&n>=5&&tab.status==='complete'&&u.origin==='https://www.zhipin.com'&&expected.test(u.pathname)&&/Receiving end does not exist|Could not establish connection|Extension context invalidated/i.test(last)){
    refreshed=true;await chrome.tabs.reload(id).catch(()=>{});
   }
   await new Promise(r=>setTimeout(r,500));continue;
  }
  if(!r?.ok)throw Error(r?.error||'页面没有返回有效数据');return r.data;
 }
 const error=Error('页面连接失败：'+stage+'暂未就绪');error.detail=stage+'；'+last;error.tabId=id;error.action=action;throw error;
}
async function recoverConnection(s,error){
 s.connectionRetries=(s.connectionRetries||0)+1;
 if(s.connectionRetries>3)return false;
 const company=error.action==='company',id=company?s.detailTab?.id:s.tabId;
 const tab=id?await chrome.tabs.get(id).catch(()=>null):null;
 const expected=company?s.detailTab?.url:null;
 if(tab){
  const u=new URL(tab.url||'https://www.zhipin.com/');
  const own=company?canonical(u.href,'company')===expected:u.origin==='https://www.zhipin.com'&&/^\/web\/geek\/jobs\/?$/.test(u.pathname);
  if(!own)return false;
  // Replace only the failed owned page in place; preserve queue and rows.
  await chrome.tabs.update(id,{url:company?expected:u.href,active:false});
 }
 if(company){if(!tab)s.detailTab=null;}
 else{s.phase='setup';if(!tab)s.tabId=null;}
 s.reason='正在自动恢复'+(company?'公司详情页':'岗位采集页')+'，断点已保留';
 log(s,s.reason+(error.detail?'；'+error.detail:''));await save(s);await schedule(s);return true;
}
async function listTab(s){
 if(s.tabId){const t=await chrome.tabs.get(s.tabId).catch(()=>null);if(t?.url?.startsWith('https://www.zhipin.com/web/geek/jobs'))return t;}
 // A dedicated inactive list prevents changing the user's existing BOSS filters.
 const t=await chrome.tabs.create({url:'https://www.zhipin.com/web/geek/jobs?query='+encodeURIComponent(s.config.keyword),active:false});s.tabId=t.id;s.phase='setup';await save(s);return t;
}
async function closeOwned(s){
 if(!s.detailTab)return;
 const {id,url}=s.detailTab,t=await chrome.tabs.get(id).catch(()=>null);
 if(t&&canonical(t.url,'company')!==url)throw Error('临时公司页地址发生变化，已保留页面，请检查后继续');
 if(t)await chrome.tabs.remove(id);s.detailTab=null;
}
async function step(){
 const s=await load();if(!s||s.status!=='running')return;
 const stepStarted=Date.now();let successfulWork=false;
 try{
  if(s.cityIndex>=s.config.cities.length)throw Error('城市队列已经结束');
  const city=s.config.cities[s.cityIndex],t=await listTab(s);s.currentCity=city;
  if(s.phase==='setup'){
   const u=new URL(t.url||'https://www.zhipin.com/web/geek/jobs');
   if(u.searchParams.get('query')!==s.config.keyword){u.searchParams.set('query',s.config.keyword);await chrome.tabs.update(t.id,{url:u.href});}
   await send(t.id,'city',{city,keyword:s.config.keyword});s.phase='scan';log(s,'开始采集 '+city+' / '+s.config.keyword);
  }else{
   // Read list scope on every step before processing the persisted queue.
   const data=await send(t.id,'list',{city,keyword:s.config.keyword});if(!data.cards.length&&!data.end)throw Error('当前列表为空，且未确认末尾；请检查页面');
   successfulWork=true;
   discover(s,data.cards);
   // Load one batch before collecting a company, instead of waiting for all 15
   // initial jobs. Persist first: a virtual list can replace its visible cards.
   s.scans||={};let scan=s.scans[city]||={end:'',stalls:0};
   if(data.end)scan.end=data.end;
   if(!scan.end&&scan.stalls<s.config.stallLimit){
    s.phase='loading';s.currentJob='';await save(s);
    const started=Date.now();
    // Load a small bounded group per wakeup. Persist each result before the
    // next scroll so virtualized cards and interruptions cannot drop rows.
    for(let batch=0;batch<3;batch++){
     const more=await send(t.id,'scroll',{city,keyword:s.config.keyword});
     const added=discover(s,more.cards||[]),changed=!!(added||more.changed);
     scan.stalls=changed?0:scan.stalls+1;if(more.end)scan.end=more.end;
     log(s,added?'已加载 '+city+' 新岗位 '+added+' 条':'等待新岗位 '+scan.stalls+'/'+s.config.stallLimit);
     await save(s);
     if(scan.end||!changed||Date.now()-started>=10000)break;
     await new Promise(r=>setTimeout(r,1000));
    }
   }
   // Reuse verified company data for all matching jobs without opening tabs.
   let reused=0;for(const [key,e] of Object.entries(s.jobs)){
    if(e.job.city!==city||e.status!=='pending'||reused>=100)continue;
    let url;try{url=canonical(e.job.company_url,'company');}catch{continue;}
    if(s.companies[url]){commit(s,key,s.companies[url]);reused++;}
   }if(reused){log(s,'复用公司信息，保存 '+reused+' 个岗位');await save(s);}
   for(let item=0;item<5;item++){
   if(item>0&&Date.now()-stepStarted>=18000)break;
   const pending=Object.entries(s.jobs).find(([k,e])=>e.job.city===city&&e.status==='pending');
   if(!pending&&item>0)break;
   if(pending){
    const [key,e]=pending;s.currentJob=e.job.title;s.currentKey=key;s.phase='collect';await save(s);
    let url;try{url=canonical(e.job.company_url,'company')}catch(err){e.status='review';e.reason='岗位没有可核验公司详情链接';log(s,e.job.title+'：'+e.reason);await save(s);await schedule(s);return;}
    let fetched=false;if(!s.companies[url]){
     fetched=true;
     if(s.detailTab&&!await chrome.tabs.get(s.detailTab.id).catch(()=>null))s.detailTab=null;
     if(s.detailTab&&s.detailTab.url!==url)await closeOwned(s);
     if(!s.detailTab){const detail=await chrome.tabs.create({url,active:false});s.detailTab={id:detail.id,url};await save(s);}
     try{s.companies[url]=await send(s.detailTab.id,'company');}
     catch(err){if(/工商全称未展示|信用代码需核查/.test(err.message)){e.status='review';e.reason=err.message;log(s,e.job.title+'：'+err.message);await closeOwned(s);await save(s);await schedule(s);return;}throw err;}
    }
    commit(s,key,s.companies[url]);log(s,'已保存：'+e.job.title+' / '+e.row[1]);await save(s);await closeOwned(s);s.phase='scan';
    if(fetched&&item<4)await new Promise(r=>setTimeout(r,1000));
   }else if(scan.end){
    const reviews=Object.values(s.jobs).filter(e=>e.job.city===city&&e.status==='review');
    if(reviews.length){s.status='paused';s.reason=city+'还有 '+reviews.length+' 条待核查，请点“重查未完成”';log(s,s.reason);await save(s);await chrome.alarms.clear(ALARM);return;}
    log(s,city+'已确认末尾：'+scan.end);finishCity(s,true);break;
   }
   else{
    if(scan.stalls>=s.config.stallLimit){s.status='paused';s.reason=city+'尚未确认列表末尾，请检查BOSS页面后点继续';log(s,s.reason);await save(s);await chrome.alarms.clear(ALARM);return;}
    else{s.phase='scan';}break;
   }
   }
  }
  if(successfulWork)s.connectionRetries=0;s.scopeRetries=0;s.reason='';await save(s);await schedule(s);
 }catch(e){
  if(/筛选需恢复|关键词或地区已变化/.test(e.message)&&((s.scopeRetries||0)<3)){
   s.scopeRetries=(s.scopeRetries||0)+1;s.phase='setup';s.reason='正在自动恢复 '+s.currentCity+' / '+s.config.keyword;
   log(s,s.reason+'；'+e.message);await save(s);await schedule(s);return;
  }
  if(/页面连接失败/.test(e.message)){
   try{if(await recoverConnection(s,e))return;}catch(recovery){log(s,'自动恢复未成功：'+recovery.message);}
  }
  s.status='paused';s.reason=e.message;log(s,'暂停：'+e.message);await save(s);await chrome.alarms.clear(ALARM);
 }
}
async function control(m){
 let s=await load();
 if(m.action==='state')return {task:s||null};
 if(m.action==='archives'){
  const all=await chrome.storage.local.get(null);
  return {archives:Object.entries(all).filter(([k])=>k.startsWith('archive_')).map(([key,t])=>({key,keyword:t.config.keyword,cities:t.config.cities.length,saved:Object.values(t.jobs).filter(e=>e.status==='saved').length,updatedAt:t.updatedAt}))};
 }
 if(m.action==='openArchive'){
  if(s?.status==='running')throw Error('请先暂停，再切换历史任务');
  if(!String(m.key).startsWith('archive_'))throw Error('历史任务键不正确');
  const old=(await chrome.storage.local.get(m.key))[m.key];if(!old)throw Error('历史任务不存在');
  if(s)await chrome.storage.local.set({['archive_'+s.id]:s});
  const restored=structuredClone(old);restored.status='paused';restored.reason='已打开历史任务，断点保留';restored.tabId=null;restored.detailTab=null;restored.phase='setup';
  if(restored.cityIndex>=restored.config.cities.length){restored.status=old.status;}
  await save(restored);return {task:restored};
 }
 if(m.action==='backupImport'){
  if(s?.status==='running')throw Error('请先暂停再导入备份');
  const restored=restoreBackup(m.backup);if(s)await chrome.storage.local.set({['archive_'+s.id]:s});
  await save(restored);return {task:restored};
 }
 if(m.action==='new'){
  if(s?.status==='running')throw Error('请先暂停当前任务，再建立新任务');
  if(s)await chrome.storage.local.set({['archive_'+s.id]:s});
  const all=await chrome.storage.local.get(null);
  s=configureTask(s,m.config,Object.entries(all).filter(([k])=>k.startsWith('archive_')).map(([,t])=>t));await save(s);return {task:s};
 }
 if(!s)throw Error('请先保存任务设置');
 if(m.action==='resume'){
  if(s.status==='running')return {task:s};
  if(['complete','incomplete'].includes(s.status))throw Error('本轮已结束，未完成城市请使用“重查未完成”');
  s.phase='setup';s.connectionRetries=0;s.scopeRetries=0;
  if(s.scans?.[s.config.cities[s.cityIndex]])s.scans[s.config.cities[s.cityIndex]].stalls=0;
  s.status='running';s.reason='';s.startedAt||=Date.now();log(s,'从 '+s.config.cities[s.cityIndex]+' 断点继续');await save(s);await schedule(s);return {task:s};
 }
 if(m.action==='pause'){s.status='paused';s.reason='用户暂停，断点已保留';await chrome.alarms.clear(ALARM);await save(s);return {task:s};}
 if(m.action==='retry'){
  if(s.status==='running')throw Error('请先暂停再重查');
  const incomplete=s.config.cities.filter(c=>!s.cities[c]?.complete);if(!incomplete.length)throw Error('所有城市均已完成，无待核查记录');
  s.config=configuration({...s.config,cities:incomplete});s.cityIndex=0;s.phase='setup';s.stalls=0;s.lastSignature='';s.scans={};
  for(const e of Object.values(s.jobs))if(e.status==='review'){e.status='pending';e.reason='';}
  s.status='paused';s.reason='已准备重新核查未完成城市，点击继续开始';await save(s);return {task:s};
 }
 throw Error('未知控制操作');
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
 if(sender.url&&!sender.url.startsWith(chrome.runtime.getURL('')))return;
 if(m?.channel!=='boss-dashboard')return;
 exclusive(()=>control(m)).then(data=>reply({ok:true,...data}),e=>reply({ok:false,error:e.message}));return true;
});
chrome.alarms.onAlarm.addListener(a=>{if(a.name===ALARM)return exclusive(step);});
chrome.action.onClicked.addListener(async()=>{const url=chrome.runtime.getURL('dashboard.html');const tabs=await chrome.tabs.query({url});if(tabs.length)await chrome.tabs.update(tabs[0].id,{active:true});else await chrome.tabs.create({url});});
chrome.runtime.onStartup.addListener(()=>exclusive(async()=>{const s=await load();await chrome.alarms.clear(ALARM);if(s?.status==='running'){s.phase='setup';s.tabId=null;s.detailTab=null;s.scopeRetries=0;s.connectionRetries=0;if(s.scans?.[s.config.cities[s.cityIndex]])s.scans[s.config.cities[s.cityIndex]].stalls=0;s.reason='正在恢复 '+s.config.cities[s.cityIndex]+' 断点';log(s,s.reason);await save(s);await schedule(s);}}));
// Worker suspension loses globals, never the persisted queue. Recreate a missing alarm.
exclusive(async()=>{
 const s=await load();if(!s)return;
 const all=await chrome.storage.local.get(null);let restored=0;
 for(const [name,old] of Object.entries(all)){
  if(!name.startsWith('archive_')||old?.config?.keyword!==s.config.keyword)continue;
  for(const [key,e] of Object.entries(old.jobs||{}))if(e.status==='saved'&&s.jobs[key]?.status!=='saved'){s.jobs[key]=structuredClone(e);restored++;}
  for(const [url,value] of Object.entries(old.companies||{}))s.companies[url]||=structuredClone(value);
 }
 if(restored){log(s,'恢复同关键词历史记录 '+restored+' 条');await save(s);}
 if(s.status==='running'&&!await chrome.alarms.get(ALARM))await schedule(s);
});
