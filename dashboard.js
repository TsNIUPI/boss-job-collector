import {CITIES,HEADERS,stats,exportedRows,configuration} from './core.js';
import {xlsxBlob,csvText} from './xlsx.js';
const $=id=>document.getElementById(id);let task=null,draftDirty=false,viewTask=null,resultKey='current',resultPage=0,catalog=[],resultRequest=0;
const restrictionButton=document.createElement('button');restrictionButton.textContent='我已确认限制解除';restrictionButton.hidden=true;$('reason').after(restrictionButton);
restrictionButton.onclick=async()=>{if(!confirm('请仅在平台提示的恢复时间已到、且你确认可正常访问BOSS后操作。确认解除限制？'))return;try{const r=await command('clearRestriction');draw(r.task);}catch(e){errors(e);}};
for(const city of CITIES){const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.value=city;box.checked=city==='北京';label.append(box,document.createTextNode(city));$('cities').append(label);}
$('all').onclick=()=>document.querySelectorAll('#cities input').forEach(b=>b.checked=true);
$('none').onclick=()=>document.querySelectorAll('#cities input').forEach(b=>b.checked=false);
const config=()=>({keyword:$('keyword').value,cities:[...document.querySelectorAll('#cities input:checked')].map(b=>b.value),target:$('target').value,interval:$('interval').value,stallLimit:$('stall').value,varied:$('varied').checked});
function sliderLabels(){
 const target=Number($('target').value),base=Number($('interval').value);
 $('target-value').textContent=String(target);$('interval-value').textContent=String(base);
 $('target-help').textContent=target===0?'0表示不启动采集；历史记录保留。':`本轮新增保存 ${target} 个后暂停；历史记录不占本轮额度。此数是设置目标，不是网站岗位总数。`;
 const upper=Math.min(100,base*2-1);
 $('interval-help').textContent=$('varied').checked?`每轮实际等待 ${base===upper?base:base+'–'+upper} 秒，访问顺序变化。`:`每轮固定等待 ${base} 秒。`;
 for(const id of ['target','interval']){const input=$(id);input.style.setProperty('--range-progress',100*(input.value-input.min)/(input.max-input.min)+'%');}
 if(task&&task.status!=='running')$('resume').disabled=target===0;
}
function draftChanged(){draftDirty=true;sliderLabels();$('run-feedback').textContent=task?.status==='running'?'新设置还未应用。请先暂停，再保存设置。':'设置已调整。点击“开始采集”会自动保存并使用新设置。';}
for(const id of ['keyword','target','interval','varied','stall'])$(id).addEventListener('input',draftChanged);
$('cities').addEventListener('change',draftChanged);
$('all').addEventListener('click',draftChanged);$('none').addEventListener('click',draftChanged);
sliderLabels();
async function command(action,args={}){const r=await chrome.runtime.sendMessage({channel:'boss-dashboard',action,...args});if(!r?.ok)throw Error(r?.error||'插件没有响应，请重新打开工作台');return r;}
function errors(e){$('action-error').textContent=e.message;}
async function saveSettings(){const r=await command('new',{config:config()});draftDirty=false;draw(r.task,true);return r.task;}
$('resume').onclick=async()=>{try{
 $('action-error').textContent='';if(!task||draftDirty)await saveSettings();
 const r=await command('resume',{newRound:!!task&&(['complete','incomplete'].includes(task.status)||task.stopReason==='target')&&configuration(task.config).target>0});draw(r.task);
}catch(e){errors(e);}};
for(const [id,action] of [['pause','pause'],['retry','retry']])$(id).onclick=async()=>{try{$('action-error').textContent='';const r=await command(action);draw(r.task);}catch(e){errors(e);}};
$('new').onclick=async()=>{try{
 if(task&&task.config.keyword!==config().keyword&&Object.keys(task.jobs).length&&!confirm('更换关键词会切换任务，原记录保留在历史任务。继续？'))return;
 await saveSettings();$('action-error').textContent='';
}catch(e){errors(e);}};
function focusResults(){$('saved-results').scrollIntoView({behavior:'smooth',block:'start'});$('saved-results').focus({preventScroll:true});}
async function browseHistory(){try{await refreshCatalog();await loadResults('all');focusResults();}catch(e){errors(e);}}
$('history').onclick=browseHistory;$('open-history').onclick=browseHistory;$('open-results').onclick=()=>{focusResults();refreshCatalog().catch(errors);};
function catalogOptions(){
 $('result-task').replaceChildren(new Option('当前任务'+(task?' · '+task.config.keyword+' · '+stats(task).saved+'条':'（尚未创建）'),'current'),new Option('全部已保存结果（含历史）','all'));
 for(const entry of catalog.filter(e=>!e.current&&e.id!==task?.id))$('result-task').append(new Option(entry.keyword+' · '+entry.saved+'条 · '+new Date(entry.updatedAt).toLocaleDateString(),entry.key));
 if(![...$('result-task').options].some(o=>o.value===resultKey))resultKey='current';$('result-task').value=resultKey;
}
async function refreshCatalog(){const r=await command('resultsCatalog');catalog=r.catalog;catalogOptions();}
async function loadResults(key=resultKey,reset=true){
 const request=++resultRequest;const r=await command('results',{key});if(request!==resultRequest)return;
 resultKey=key;viewTask=r.resultTask;catalog=r.catalog;catalogOptions();if(reset)resultPage=0;resultCities();results();
}
$('result-task').onchange=()=>loadResults($('result-task').value).catch(errors);
$('result-search').oninput=()=>{resultPage=0;results();};
$('result-prev').onclick=()=>{resultPage=Math.max(0,resultPage-1);results();};$('result-next').onclick=()=>{resultPage++;results();};
$('result-resume-task').onclick=async()=>{try{const r=await command('openArchive',{key:resultKey});resultKey='current';viewTask=null;draw(r.task,true);await refreshCatalog();$('run-feedback').textContent='已恢复该任务，检查设置后点击开始或继续采集。';}catch(e){errors(e);}};
function resultCities(){const selected=$('result-city').value;$('result-city').replaceChildren(new Option('全部地区',''));for(const city of [...new Set(exportedRows(resultKey==='current'?task||{jobs:{}}:viewTask||{jobs:{}}).map(r=>r[6]))])$('result-city').append(new Option(city,city));$('result-city').value=[...$('result-city').options].some(o=>o.value===selected)?selected:'';}
function matchingRows(){const s=resultKey==='current'?task:viewTask;const q=$('result-search').value.trim().toLocaleLowerCase(),city=$('result-city').value;return s?exportedRows(s).filter(row=>(!city||row[6]===city)&&(!q||(row[0]+' '+row[1]).toLocaleLowerCase().includes(q))):[];}
function cell(text){const td=document.createElement('td');td.textContent=String(text??'');return td;}
function results(){
 const rows=matchingRows(),s=resultKey==='current'?task:viewTask,total=s?exportedRows(s).length:0,pages=Math.max(1,Math.ceil(rows.length/50));resultPage=Math.max(0,Math.min(resultPage,pages-1));
 $('results').replaceChildren();$('results-empty').hidden=rows.length>0;for(const row of rows.slice(resultPage*50,(resultPage+1)*50)){const tr=document.createElement('tr');row.forEach(v=>tr.append(cell(v)));$('results').append(tr);}
 $('result-summary').textContent='查看：'+(s?.config.keyword||'当前任务')+' · 匹配 '+rows.length+' / 范围总计 '+total+' 条 · 导出包含全部 '+rows.length+' 条匹配结果';
 $('result-page').textContent='第 '+(resultPage+1)+' / '+pages+' 页';$('result-prev').disabled=resultPage===0;$('result-next').disabled=resultPage>=pages-1;
 $('result-resume-task').hidden=['current','all'].includes(resultKey);$('result-resume-task').disabled=task?.status==='running';$('result-resume-task').title=task?.status==='running'?'请先暂停当前采集，再恢复历史任务':'';
}
$('result-city').onchange=()=>{resultPage=0;results();};
function waitStatus(){
 const panel=$('wait-panel');panel.dataset.state=task?.status||'paused';
 if(!task){$('wait-title').textContent='等待开始';$('wait-countdown').textContent='—';$('wait-detail').textContent='设置数量和城市，点击开始采集。历史结果可在右上角直接查看。';return;}
 if(task.status!=='running'){$('wait-title').textContent=task.status==='complete'?'已确认列表结束':task.config.target===0?'尚未启动：目标为0':task.stopReason==='target'?'本轮目标已达成':'采集已暂停';$('wait-countdown').textContent=task.status==='complete'?'已结束':'已暂停';$('wait-detail').textContent=task.reason||'断点和结果已保留，可以继续采集。';return;}
 const remaining=Math.ceil(((task.nextRunAt||0)-Date.now())/1000);
 if(task.nextRunAt&&remaining>0){panel.dataset.state='waiting';$('wait-title').textContent='正在运行 · 等待下一轮';$('wait-countdown').textContent=remaining+' 秒';$('wait-detail').textContent=(task.reason?task.reason+'；':'')+'等待结束自动继续，无需反复点击开始。预计 '+new Date(task.nextRunAt).toLocaleTimeString()+' 执行。';}
 else{$('wait-title').textContent=task.waiting?'已到时间 · 正在唤醒后台':'正在采集';$('wait-countdown').textContent=task.waiting?'准备继续':'处理中';$('wait-detail').textContent=task.phase==='collect'?'正在读取公司展示的信息，完成后自动保存并安排下一轮。':task.phase==='loading'?'正在滚动加载更多岗位，已发现的记录会保留。':'正在检查岗位列表与采集队列。';}
}
$('diagnostics').onclick=async()=>{try{
 const s=await getState(),v=s?stats(s):null;
 const diagnostic={version:'2.0.2',capturedAt:new Date().toISOString(),status:s?.status||'none',phase:s?.phase,reason:s?.reason,target:s?.config.target,interval:s?.config.interval,waiting:s?.waiting,nextRunAt:s?.nextRunAt?new Date(s.nextRunAt).toISOString():null,lastStepAt:s?.lastStepAt?new Date(s.lastStepAt).toISOString():null,roundSaved:v?.roundSaved,totalSaved:v?.saved,pending:s?Object.values(s.jobs).filter(e=>e.status==='pending').length:0,review:v?.review,emptyListRetries:s?.emptyListRetries||0,connectionRetries:s?.connectionRetries||0};
 await navigator.clipboard.writeText(JSON.stringify(diagnostic,null,2));$('diagnostics').textContent='已复制，可粘贴给我排查';
}catch(e){errors(e);}};
function draw(s,syncSettings=false){
 if(!s)return;const changed=task?.id!==s.id||syncSettings;task=s;
 if(changed){draftDirty=false;$('keyword').value=s.config.keyword;$('target').value=configuration(s.config).target;$('interval').value=s.config.interval;$('stall').value=s.config.stallLimit;$('varied').checked=s.config.varied!==false;document.querySelectorAll('#cities input').forEach(b=>b.checked=s.config.cities.includes(b.value));}
 const v=stats(s),names={running:'正在采集',paused:'已暂停',complete:'全部完成',incomplete:'扫描结束，待补查'};
 $('status').textContent=s.stopReason==='target'?(configuration(s.config).target===0?'未启动':'目标已达成'):names[s.status]||s.status;$('status').dataset.state=s.stopReason==='target'?'target':s.status;$('task-title').textContent=s.config.keyword+' · '+s.config.cities.length+' 个城市';
 const target=configuration(s.config).target;
 $('goal-progress').value=target>0?Math.min(100,100*v.roundSaved/target):0;$('goal-summary').textContent='本轮新增保存 '+v.roundSaved+' 个岗位';$('goal-limit').textContent='本轮目标 '+target+' 个（设置值）';
 $('goal-hint').textContent=target===0?'数量为0，当前不会采集。调高数量即可开始。':s.status==='complete'?`本轮已采完所选列表，实际新增 ${v.roundSaved} 个；历史累计 ${v.saved} 个。列表可少于目标。`:s.stopReason==='target'?`本轮目标已达成；历史累计 ${v.saved} 个。可导出结果，或点击开始新一轮。`:`本轮还需新增 ${Math.max(0,target-v.roundSaved)} 个；历史累计 ${v.saved} 个，历史记录不占本轮额度。`;
 $('run-feedback').textContent=draftDirty?(s.status==='running'?'新设置尚未应用。请先暂停，再保存设置。':'新设置尚未应用。点击“开始采集”会先保存设置。'):s.reason|| (s.status==='running'?'正在按目标采集。等待时看下方倒计时；历史结果可从右上角打开。':'设置已保存，点击“开始采集”即可运行。');
 $('step').textContent=s.status==='complete'?'列表已检查完，可导出结果或开始新一轮。':s.status!=='running'?'历史记录保留，开始或继续时只计本轮新增。':s.phase==='loading'?'正在加载更多岗位…':s.phase==='collect'&&s.currentJob?'正在读取公司信息：'+s.currentJob:s.phase==='setup'?'正在准备城市与岗位列表…':'本轮已保存，等待继续采集。';
 if(s.status==='running'&&s.nextRunAt>Date.now())$('step').textContent+=' · 下轮约 '+new Date(s.nextRunAt).toLocaleTimeString();
 for(const k of ['saved','companies','found','review'])$(k).textContent=v[k];
 $('city').textContent='当前地区：'+(s.currentCity||v.city);$('updated').textContent='更新于 '+new Date(s.updatedAt).toLocaleTimeString();
 const observed=new Set(s.scans?.[v.city]?.seen||[]),observedSaved=Object.entries(s.jobs).filter(([key,e])=>observed.has(key)&&e.status==='saved').length;
 $('progress').value=100*observedSaved/Math.max(1,v.localObserved);
 $('local').textContent=`本次列表已发现 ${v.localObserved} 个 · ${v.confirmed?'已确认当前页面列表末尾':'仍在加载，尚不能确认总数'} · 本城历史保存 ${v.localSaved} 个 · 历史复用保存 ${v.reused} 个`;
 $('reason').textContent=s.reason;$('reason').style.display=s.reason?'block':'none';
 restrictionButton.hidden=s.status!=='paused'||!String(s.reason).includes('平台限制访问');
 $('city-status').replaceChildren();for(const c of s.config.cities){const span=document.createElement('span'),entry=s.cities[c];span.textContent=c+' · '+(entry?.complete?'完成':entry?'待补查':c===s.currentCity?(s.status==='running'?'采集中':'已暂停'):'等待');span.className=entry?.complete?'done':entry?'missing':'';$('city-status').append(span);}
 if(resultKey==='current')resultCities();catalogOptions();results();
 $('logs').replaceChildren();const reviews=Object.values(s.jobs).filter(e=>e.status==='review');
 for(const e of reviews){const div=document.createElement('div');div.className='warning';div.textContent='待核查：'+e.job.city+' / '+e.job.title+' — '+e.reason;$('logs').append(div);}
 for(const e of s.logs.slice(-35).reverse()){const div=document.createElement('div');div.textContent=new Date(e.at).toLocaleTimeString()+'  '+e.text;$('logs').append(div);}
 $('resume').disabled=s.status==='running'||target===0;$('resume').textContent=s.status==='running'?'正在采集…':['complete','incomplete'].includes(s.status)||s.stopReason==='target'&&target>0?'开始新一轮':s.round?.id?'继续本轮':'开始采集';$('pause').disabled=s.status!=='running';$('retry').disabled=s.status==='running';$('new').disabled=s.status==='running';
 const overdue=Date.now()-Math.max(s.updatedAt,s.nextRunAt||0);if(s.status==='running'&&overdue>180000){$('reason').style.display='block';$('reason').textContent='已超过预计执行时间3分钟，请检查Chrome是否休眠、页面是否出现验证或连接问题。断点仍保留。';}
 sliderLabels();waitStatus();
}
async function getState(){const r=await command('state');draw(r.task);return r.task;}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
const filename=(s=resultKey==='current'?task:viewTask)=> 'BOSS企业信息_'+String(s?.config.keyword||'采集').replace(/[\\/:*?"<>|]/g,'_')+'_'+new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
$('restore').onclick=()=> $('restore-file').click();
$('restore-file').onchange=async()=>{try{const file=$('restore-file').files[0];if(!file)return;if(file.size>20*1024*1024)throw Error('备份文件超过20MB');if(!confirm('导入备份会切换当前任务，原任务将留存备份。是否继续？'))return;const r=await command('backupImport',{backup:JSON.parse(await file.text())});draw(r.task);}catch(e){errors(e);}finally{$('restore-file').value='';}};
$('xlsx').onclick=async()=>{try{await getState();await loadResults(resultKey,false);const rows=matchingRows();if(!rows.length)throw Error('当前范围没有匹配结果，请切换历史或清空搜索');download(await xlsxBlob([HEADERS,...rows]),filename()+'.xlsx');}catch(e){errors(e);}};
$('csv').onclick=async()=>{try{await getState();await loadResults(resultKey,false);const rows=matchingRows();if(!rows.length)throw Error('当前范围没有匹配结果，请切换历史或清空搜索');download(new Blob([csvText([HEADERS,...rows])],{type:'text/csv;charset=utf-8'}),filename()+'.csv');}catch(e){errors(e);}};
$('backup').onclick=async()=>{try{const s=await getState();if(!s)throw Error('还没有任务');download(new Blob([JSON.stringify(s,null,2)],{type:'application/json'}),filename(s)+'_当前采集任务备份.json');}catch(e){errors(e);}};
getState().then(()=>refreshCatalog()).catch(errors);waitStatus();
chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local')return;if(changes.task){draw(changes.task.newValue);if(resultKey!=='current')loadResults(resultKey,false).catch(errors);}if(Object.keys(changes).some(k=>k.startsWith('archive_')))refreshCatalog().catch(errors);});
setInterval(()=>getState().then(()=>refreshCatalog()).catch(errors),5000);setInterval(waitStatus,1000);
