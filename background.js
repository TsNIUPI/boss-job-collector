import {fresh,canonical,configuration,discover,stats,commit,finishCity,restoreBackup,configureTask,waitSeconds,nextPending,companyCache,companyData,goalReached,targetPause,migrateCounting,beginRound,roundCount} from './core.js';
const ALARM='boss-collector-tick';let serial=Promise.resolve(),shortTimer,browserStarting=false;
const exclusive=fn=>{const next=serial.then(fn);serial=next.catch(()=>{});return next;};
const load=async()=> (await chrome.storage.local.get('task')).task;
async function save(s){
 if(s.status!=='running'){clearTimeout(shortTimer);s.nextRunAt=null;s.waiting=false;await freezePacing();}
 s.updatedAt=Date.now();await chrome.storage.local.set({task:s});const v=stats(s);await chrome.action.setBadgeText({text:s.status==='running'?String(v.roundSaved):s.status==='complete'?'✓':s.status==='paused'?'停':'!'});await chrome.action.setBadgeBackgroundColor({color:s.status==='running'?'#187c72':'#a66416'});
}
function log(s,text){s.logs.push({at:Date.now(),text});s.logs=s.logs.slice(-150);}
async function migrateCache(s){
 const all=await chrome.storage.local.get(null);
 const tasks=[s,...Object.entries(all).filter(([key])=>key.startsWith('archive_')).map(([,value])=>value)];
 const cache=companyCache(tasks,all.companyCache);await chrome.storage.local.set({companyCache:cache});return cache;
}
function reuseCompanies(s,cache,city){
 let reused=0;
 for(const [key,e] of Object.entries(s.jobs)){
  if(goalReached(s))break;
  if(e.job.city!==city||e.status!=='pending')continue;
  let url;try{url=canonical(e.job.company_url,'company');}catch{continue;}
  const info=companyData(cache[url])||companyData(s.companies[url]);if(!info)continue;
  try{if(commit(s,key,info,'cache')){s.companies[url]=info;reused++;}}
  catch(error){e.status='review';e.reason=error.message;}
 }
 if(reused)log(s,'公司信息已保存：直接复用 '+reused+' 个岗位，无需再次打开公司页');
 return reused;
}
async function stopAtTarget(s){
 if(!targetPause(s))return false;
 clearTimeout(shortTimer);log(s,s.reason);await chrome.alarms.clear(ALARM);await save(s);return true;
}
async function tickDue(taskId,due){
 const current=await load();
 if(!current||current.status!=='running'||taskId&&current.id!==taskId||due&&current.nextRunAt!==due||current.nextRunAt>Date.now())return;
 return step();
}
async function armDue(s){
 clearTimeout(shortTimer);const now=Date.now(),remaining=s.nextRunAt-now,id=s.id,due=s.nextRunAt;
 // Recreating a wakeup must never move the persisted due time forward.
 // Unpacked extensions support sub-30-second alarms. Keep the user's exact
 // deadline; Chrome itself may still deliver late after sleep or throttling.
 await chrome.alarms.create(ALARM,{when:due});
 if(remaining<30000){shortTimer=setTimeout(()=>exclusive(()=>tickDue(id,due)).catch(()=>{}),Math.max(0,remaining));shortTimer?.unref?.();}
}
async function schedule(s){if(s.status==='running'){
 const delay=waitSeconds(s.config);s.nextRunAt=Date.now()+delay*1000;s.waiting=true;s.waitSeconds=delay;
 await save(s);await armDue(s);
}}
async function repairWakeup(s){
 if(s.status!=='running')return;
 if(Number.isFinite(s.nextRunAt)&&s.nextRunAt<=Date.now())return tickDue(s.id,s.nextRunAt);
 if(!Number.isFinite(s.nextRunAt))return schedule(s);
 if(!await chrome.alarms.get(ALARM))return armDue(s);
}
async function freezePacing(cutoff=Date.now()){
 const p=(await chrome.storage.local.get('pacingSession')).pacingSession;
 if(p?.version===2&&Number.isFinite(p.runningSince)){
  p.elapsedMs=(p.elapsedMs||0)+Math.max(0,cutoff-p.runningSince);p.runningSince=null;await chrome.storage.local.set({pacingSession:p});
 }
}
async function pacing(start=true){
 let p=(await chrome.storage.local.get('pacingSession')).pacingSession;const now=Date.now();
 if(!p||p.restUntil&&now>=p.restUntil)p={version:2,startedAt:now,companies:0,elapsedMs:0,runningSince:null,restUntil:0};
 if(p.version!==2)p={...p,version:2,elapsedMs:0,runningSince:null,startedAt:now};
 if(p.restUntil&&now<p.restUntil)throw Error('采集休息中，'+new Date(p.restUntil).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+'后可手动继续，断点已保留');
 const elapsed=(p.elapsedMs||0)+(Number.isFinite(p.runningSince)?Math.max(0,now-p.runningSince):0);
 if(elapsed>=30*60*1000){p.elapsedMs=elapsed;p.runningSince=null;p.restUntil=now+60*60*1000;await chrome.storage.local.set({pacingSession:p});throw Error('累计运行已达30分钟，休息至 '+new Date(p.restUntil).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+'，之后手动继续；暂停时间不计入运行时长');}
 if(start&&!Number.isFinite(p.runningSince))p.runningSince=now;
 await chrome.storage.local.set({pacingSession:p});
 return p;
}
async function pageMessage(id,message,timeout=18000){
 let timer;try{return await Promise.race([chrome.tabs.sendMessage(id,message),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('页面脚本响应超时')),timeout);})]);}finally{clearTimeout(timer);}
}
function companyPageState(tab,expectedUrl){
 const matches=value=>{try{return canonical(value,'company')===expectedUrl;}catch{return false;}};
 // Tab.url is the last committed document. A newly created tab can still have
 // an empty/about:blank URL while pendingUrl already identifies our company.
 // A pending destination elsewhere must never inherit the old page's identity.
 if(tab?.pendingUrl&&!matches(tab.pendingUrl))return 'changed';
 if(matches(tab?.url))return 'ready';
 if((!tab?.url||tab.url==='about:blank')&&matches(tab?.pendingUrl))return 'pending';
 // Before Chrome exposes pendingUrl, a new owned tab can be blank. This is
 // only permission to wait, never permission to read, close or reload it.
 if(tab&&(!tab.url||tab.url==='about:blank')&&!tab.pendingUrl)return 'unknown';
 return 'changed';
}
async function send(id,action,args={}){
 const verifyCompany=async tab=>{
  if(action!=='company'||!args.expectedUrl)return true;
  const state=companyPageState(tab||await chrome.tabs.get(id).catch(()=>null),args.expectedUrl);
  if(state==='changed')throw Error('公司详情页地址发生变化，尚未保存该页信息，请检查页面后继续');
  return state==='ready';
 };
 const stage={city:'切换城市',list:'读取岗位列表',scroll:'加载更多岗位',company:'读取公司详情'}[action]||action;let last='页面尚未加载',refreshed=false;
 for(let n=0;n<24;n++){
  const tab=await chrome.tabs.get(id).catch(()=>null);
  if(!tab){last='采集标签页已关闭';break;}
  if(!await verifyCompany(tab)){last='公司页正在打开，等待目标地址加载';await new Promise(r=>setTimeout(r,500));continue;}
  if(tab.status==='loading'){
   // Fonts, ads or images may keep Chrome "loading" after the usable DOM is
   // ready. Probe our listener rather than waiting for unrelated resources.
   let probe;try{probe=await pageMessage(id,{channel:'boss-collector',action:'ping'},3000);}catch(e){if(e.message==='页面脚本响应超时'){last=e.message;break;}}
   if(probe?.ok===false&&probe.error)throw Error(probe.error);
   if(!probe?.ok||!probe.data?.ready){last='页面仍在加载';await new Promise(r=>setTimeout(r,500));continue;}
  }
  if(action==='company'&&!await verifyCompany()){last='公司页正在重新加载';await new Promise(r=>setTimeout(r,500));continue;}
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
  if(!r?.ok)throw Error(r?.error||'页面没有返回有效数据');
  if(!await verifyCompany()){last='公司页正在重新加载，尚未保存';await new Promise(r=>setTimeout(r,500));continue;}
  if(action==='company'&&r.data?.sourceUrl&&r.data.sourceUrl!==args.expectedUrl)throw Error('公司信息来源链接不一致，尚未保存该页信息');
  return r.data;
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
  const own=company?['ready','pending'].includes(companyPageState(tab,expected)):u.origin==='https://www.zhipin.com'&&/^\/web\/geek\/jobs\/?$/.test(u.pathname);
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
 const isList=value=>{try{const u=new URL(value);return u.origin==='https://www.zhipin.com'&&/^\/web\/geek\/jobs\/?$/.test(u.pathname);}catch{return false;}};
 if(s.tabId){const t=await chrome.tabs.get(s.tabId).catch(()=>null);if(t&&(isList(t.url)||isList(t.pendingUrl)))return t;}
 // A dedicated inactive list prevents changing the user's existing BOSS filters.
 const t=await chrome.tabs.create({url:'https://www.zhipin.com/web/geek/jobs?query='+encodeURIComponent(s.config.keyword),active:false});s.tabId=t.id;s.phase='setup';await save(s);return t;
}
async function closeOwned(s){
 if(!s.detailTab)return;
 const {id,url}=s.detailTab,t=await chrome.tabs.get(id).catch(()=>null);
 if(t&&companyPageState(t,url)!=='ready')throw Error('临时公司页地址发生变化或仍在加载，已保留页面，请检查后继续');
 if(t)await chrome.tabs.remove(id);s.detailTab=null;
}
async function step(){
 const s=await load();if(!s||s.status!=='running')return;
 const restriction=(await chrome.storage.local.get('platformRestriction')).platformRestriction;
 if(restriction){s.status='paused';s.reason=restriction.reason;await save(s);await chrome.alarms.clear(ALARM);return;}
 const stepStarted=Date.now();let successfulWork=false;
 s.waiting=false;s.nextRunAt=null;s.lastStepAt=stepStarted;
 try{
  s.config=configuration(s.config);if(await stopAtTarget(s))return;await pacing();
  if(s.cityIndex>=s.config.cities.length)throw Error('城市队列已经结束');
  const city=s.config.cities[s.cityIndex],t=await listTab(s);s.currentCity=city;
  const cache=(await chrome.storage.local.get('companyCache')).companyCache||{};
  if(s.phase==='setup'){
   s.scans||={};s.scans[city]={end:'',stalls:0,seen:[]};
   const u=new URL(t.url||'https://www.zhipin.com/web/geek/jobs');
   if(u.searchParams.get('query')!==s.config.keyword){u.searchParams.set('query',s.config.keyword);await chrome.tabs.update(t.id,{url:u.href});}
   await send(t.id,'city',{city,keyword:s.config.keyword});s.phase='scan';log(s,'开始采集 '+city+' / '+s.config.keyword);
  }else{
   // Read list scope on every step before processing the persisted queue.
   const data=await send(t.id,'list',{city,keyword:s.config.keyword});
   if(!data.cards.length&&!data.end){
    s.emptyListRetries=(s.emptyListRetries||0)+1;
    if(s.emptyListRetries<=3){s.reason='列表暂未显示岗位，保留断点等待重新读取（'+s.emptyListRetries+'/3）';log(s,s.reason);await schedule(s);return;}
    throw Error('连续3次等待后列表仍为空，尚未确认末尾。断点已保留，请检查BOSS采集页后继续。');
   }
   s.emptyListRetries=0;
   successfulWork=true;
   const listedAdded=discover(s,data.cards);
   // Load one batch before collecting a company, instead of waiting for all 15
   // initial jobs. Persist first: a virtual list can replace its visible cards.
   s.scans||={};let scan=s.scans[city]||={end:'',stalls:0};
   if(listedAdded)scan.stalls=0;
   if(data.end)scan.end=data.end;
   if(!scan.end&&scan.stalls<s.config.stallLimit){
    s.phase='loading';s.currentJob='';await save(s);
    const started=Date.now();
    // Load a small bounded group per wakeup. Persist each result before the
    // next scroll so virtualized cards and interruptions cannot drop rows.
    for(let batch=0;batch<1;batch++){
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
   if(reuseCompanies(s,cache,city))await save(s);
   if(await stopAtTarget(s))return;
   for(let item=0;item<5;item++){
   if(await stopAtTarget(s))return;
   if(item>0&&Date.now()-stepStarted>=18000)break;
   const pending=nextPending(s);
   if(!pending&&item>0)break;
   if(pending){
    const [key,e]=pending;s.currentJob=e.job.title;s.currentKey=key;s.phase='collect';await save(s);
    if(!e.job.title||!new RegExp('^'+city+'(?:市)?(?:[·\\s]|$)').test(e.job.location||'')){
     e.status='review';e.reason='岗位名称或实际工作城市未唯一确认';log(s,e.reason);await save(s);await schedule(s);return;
    }
    let url;try{url=canonical(e.job.company_url,'company')}catch(err){e.status='review';e.reason='岗位没有可核验公司详情链接';log(s,e.job.title+'：'+e.reason);await save(s);await schedule(s);return;}
    let info=companyData(cache[url])||companyData(s.companies[url]);
    let fetched=false;if(!info){
     fetched=true;const pace=await pacing();pace.companies++;await chrome.storage.local.set({pacingSession:pace});
     if(s.detailTab&&!await chrome.tabs.get(s.detailTab.id).catch(()=>null))s.detailTab=null;
     if(s.detailTab&&s.detailTab.url!==url)await closeOwned(s);
     if(!s.detailTab){const detail=await chrome.tabs.create({url,active:false});s.detailTab={id:detail.id,url};await save(s);}
     try{
      info=companyData(await send(s.detailTab.id,'company',{expectedUrl:url}));if(!info)throw Error('BOSS工商全称未展示或信用代码需核查');
      info.savedAt=Date.now();s.companies[url]=info;cache[url]=info;
      await chrome.storage.local.set({companyCache:cache});
     }
     catch(err){if(/工商全称未展示|信用代码需核查/.test(err.message)){e.status='review';e.reason=err.message;log(s,e.job.title+'：'+err.message);await closeOwned(s);await save(s);await schedule(s);return;}throw err;}
    }
    s.companies[url]=info;commit(s,key,info,fetched?'page':'cache');log(s,'已保存：'+e.job.title+' / '+e.row[1]);
    reuseCompanies(s,cache,city);await save(s);await closeOwned(s);s.phase='scan';
    if(await stopAtTarget(s))return;
    if(fetched)break;
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
  if(successfulWork)s.connectionRetries=0;s.scopeRetries=0;if(s.status==='running')s.reason='';await save(s);await schedule(s);
 }catch(e){
  if(/平台限制访问/.test(e.message)){
   const time=e.message.match(/恢复时间：(\d{4}-\d{1,2}-\d{1,2}) (\d{1,2}:\d{2})/);
   const until=time?Date.parse(time[1]+'T'+time[2].padStart(5,'0')+':00+08:00'):null;
   await chrome.storage.local.set({platformRestriction:{reason:e.message,until:Number.isFinite(until)?until:null,detectedAt:Date.now()}});
  }
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
 if(m.action==='state'){
  if(s?.status==='running'){await repairWakeup(s);s=await load();}
  return {task:s||null};
 }
 if(m.action==='archives'){
  const all=await chrome.storage.local.get(null);
  return {archives:Object.entries(all).filter(([k])=>k.startsWith('archive_')).map(([key,t])=>({key,keyword:t.config.keyword,cities:t.config.cities.length,saved:Object.values(t.jobs).filter(e=>e.status==='saved').length,updatedAt:t.updatedAt}))};
 }
 if(m.action==='resultsCatalog'||m.action==='results'){
  const all=await chrome.storage.local.get(null),byId=new Map();
  if(s)byId.set(s.id,{key:'current',task:s,current:true});
  for(const [key,value] of Object.entries(all)){
   if(!key.startsWith('archive_')||!value?.id||!value?.config?.keyword||!value.jobs||byId.has(value.id))continue;
   byId.set(value.id,{key,task:value,current:false});
  }
  const entries=[...byId.values()].sort((a,b)=>Number(b.current)-Number(a.current)||(b.task.updatedAt||0)-(a.task.updatedAt||0));
  const catalog=entries.map(({key,task,current})=>({key,id:task.id,keyword:task.config.keyword,saved:Object.values(task.jobs).filter(e=>e.status==='saved').length,updatedAt:task.updatedAt,current}));
  if(m.action==='resultsCatalog')return {catalog};
  if(m.key==='all'){
   const jobs={};
   for(const {task} of entries)for(const [key,value] of Object.entries(task.jobs))if(value.status==='saved'&&!jobs[key])jobs[key]=structuredClone(value);
   return {resultTask:{id:'all-results',config:{keyword:'全部已保存结果'},jobs,updatedAt:Math.max(0,...entries.map(e=>e.task.updatedAt||0))},catalog};
  }
  const entry=entries.find(e=>e.key===(m.key||'current'));
  if(!entry)throw Error('没有找到该任务的已保存结果，请刷新历史列表后重试');
  return {resultTask:entry.task,catalog};
 }
 if(m.action==='openArchive'){
  if(s?.status==='running')throw Error('请先暂停，再切换历史任务');
  if(!String(m.key).startsWith('archive_'))throw Error('历史任务键不正确');
  const old=(await chrome.storage.local.get(m.key))[m.key];if(!old)throw Error('历史任务不存在');
  if(old.id===s?.id)return {task:s};
  if(s)await chrome.storage.local.set({['archive_'+s.id]:s});
  const restored=structuredClone(old);restored.status='paused';restored.reason='已打开历史任务，断点保留';restored.tabId=null;restored.detailTab=null;restored.phase='setup';
  if(restored.cityIndex>=restored.config.cities.length&&old.status==='complete'){restored.status='complete';}
  migrateCounting(restored);
  restored.config=configuration(restored.config);targetPause(restored);
  await migrateCache(restored);await save(restored);return {task:restored};
 }
 if(m.action==='backupImport'){
  if(s?.status==='running')throw Error('请先暂停再导入备份');
  const restored=restoreBackup(m.backup);if(s)await chrome.storage.local.set({['archive_'+s.id]:s});
  await migrateCache(restored);await save(restored);return {task:restored};
 }
 if(m.action==='new'){
  if(s?.status==='running')throw Error('请先暂停当前任务，再建立新任务');
  if(s)await chrome.storage.local.set({['archive_'+s.id]:s});
  const all=await chrome.storage.local.get(null);
  s=configureTask(s,m.config,Object.entries(all).filter(([k])=>k.startsWith('archive_')).map(([,t])=>t));await migrateCache(s);await save(s);return {task:s};
 }
 if(!s)throw Error('请先保存任务设置');
 if(m.action==='clearRestriction'){
  const restriction=(await chrome.storage.local.get('platformRestriction')).platformRestriction;
  if(restriction?.until&&Date.now()<restriction.until)throw Error(restriction.reason);
  await chrome.storage.local.set({platformRestriction:null});s.status='paused';s.reason='已确认限制解除，点击继续恢复断点';await save(s);return {task:s};
 }
 if(m.action==='resume'){
  s.config=configuration(s.config);
  migrateCounting(s);
  if(s.status==='running')return {task:s};
  if(s.config.target===0){await stopAtTarget(s);return {task:s};}
  const restart=m.newRound===true||!s.round?.id;
  if(!restart&&await stopAtTarget(s))return {task:s};
  const restriction=(await chrome.storage.local.get('platformRestriction')).platformRestriction;
  if(restriction){
   if(!restriction.until||Date.now()<restriction.until)throw Error(restriction.reason);
   // Expiry permits only an explicit user resume. No automatic restart.
   await chrome.storage.local.set({platformRestriction:null});
  }
  if(['complete','incomplete'].includes(s.status)&&!restart)throw Error('本轮已结束，请点击“开始新一轮”重新检查列表，历史记录会保留。');
  await pacing();s.config=configuration(s.config);
  if(restart)beginRound(s,['complete','incomplete'].includes(s.status));
  s.phase='setup';s.connectionRetries=0;s.scopeRetries=0;s.emptyListRetries=0;
  if(s.scans?.[s.config.cities[s.cityIndex]])s.scans[s.config.cities[s.cityIndex]].stalls=0;
  s.status='running';s.stopReason='';s.reason='';s.startedAt||=Date.now();log(s,(restart?'开始新一轮，目标 '+s.config.target+' 个；':'继续本轮，已新增 '+roundCount(s)+' 个；')+'当前城市 '+s.config.cities[s.cityIndex]);await save(s);await schedule(s);return {task:s};
 }
 if(m.action==='pause'){clearTimeout(shortTimer);s.status='paused';s.stopReason='user';s.nextRunAt=null;s.reason='用户暂停，断点已保留';await chrome.alarms.clear(ALARM);await save(s);return {task:s};}
 if(m.action==='retry'){
  if(s.status==='running')throw Error('请先暂停再重查');
  const incomplete=s.config.cities.filter(c=>!s.cities[c]?.complete);if(!incomplete.length)throw Error('所有城市均已完成，无待核查记录');
  s.cityIndex=s.config.cities.indexOf(incomplete[0]);s.currentCity=incomplete[0];s.currentJob='';s.phase='setup';s.stalls=0;s.lastSignature='';s.scans={};s.emptyListRetries=0;
  for(const e of Object.values(s.jobs))if(e.status==='review'&&e.job.title&&new RegExp('^'+e.job.city+'(?:市)?(?:[·\\s]|$)').test(e.job.location||'')){e.status='pending';e.reason='';}
  s.status='paused';s.reason='已准备重新核查未完成城市，点击继续开始';await save(s);return {task:s};
 }
 throw Error('未知控制操作');
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
 if(sender.url&&!sender.url.startsWith(chrome.runtime.getURL('')))return;
 if(m?.channel!=='boss-dashboard')return;
 exclusive(()=>control(m)).then(data=>reply({ok:true,...data}),e=>reply({ok:false,error:e.message}));return true;
});
chrome.alarms.onAlarm.addListener(a=>{if(a.name===ALARM)return exclusive(()=>tickDue());});
chrome.action.onClicked.addListener(async()=>{const url=chrome.runtime.getURL('dashboard.html');const tabs=await chrome.tabs.query({url});if(tabs.length)await chrome.tabs.update(tabs[0].id,{active:true});else await chrome.tabs.create({url});});
chrome.runtime.onStartup.addListener(()=>{browserStarting=true;return exclusive(async()=>{
 const s=await load();await chrome.alarms.clear(ALARM);
 if(s)await freezePacing(s.updatedAt||Date.now());
 if(s&&migrateCounting(s)){await save(s);return;}
 if(s?.status==='running'){
  s.config=configuration(s.config);if(await stopAtTarget(s))return;
  s.phase='setup';s.tabId=null;s.detailTab=null;s.scopeRetries=0;s.connectionRetries=0;
  if(s.scans?.[s.config.cities[s.cityIndex]])s.scans[s.config.cities[s.cityIndex]].stalls=0;
  s.reason='正在恢复 '+s.config.cities[s.cityIndex]+' 断点';log(s,s.reason);await save(s);await repairWakeup(s);
 }
}).finally(()=>{browserStarting=false;});});
// Worker suspension loses globals, never the persisted queue. Recreate a missing alarm.
exclusive(async()=>{
 const s=await load();if(!s)return;
 const migrated=migrateCounting(s);
 const all=await chrome.storage.local.get(null);let restored=0;
 for(const [name,old] of Object.entries(all)){
  if(!name.startsWith('archive_')||old?.config?.keyword!==s.config.keyword)continue;
  for(const [key,e] of Object.entries(old.jobs||{}))if(e.status==='saved'&&s.jobs[key]?.status!=='saved'){s.jobs[key]=structuredClone(e);restored++;}
 }
 await migrateCache(s);
 s.config=configuration(s.config);if(await stopAtTarget(s))return;
 if(restored||migrated){if(restored)log(s,'恢复同关键词历史记录 '+restored+' 条（不计入本轮新增）');await save(s);}
 if(s.status==='running'&&!browserStarting)await repairWakeup(s);
});
