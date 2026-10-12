import {CITIES,HEADERS,stats,exportedRows,configuration} from './core.js';
import {xlsxBlob,csvText} from './xlsx.js';
const $=id=>document.getElementById(id);let task=null,draftDirty=false;
const restrictionButton=document.createElement('button');restrictionButton.textContent='我已确认限制解除';restrictionButton.hidden=true;$('reason').after(restrictionButton);
restrictionButton.onclick=async()=>{if(!confirm('请仅在平台提示的恢复时间已到、且你确认可正常访问BOSS后操作。确认解除限制？'))return;try{const r=await command('clearRestriction');draw(r.task);}catch(e){errors(e);}};
for(const city of CITIES){const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.value=city;box.checked=city==='北京';label.append(box,document.createTextNode(city));$('cities').append(label);}
$('all').onclick=()=>document.querySelectorAll('#cities input').forEach(b=>b.checked=true);
$('none').onclick=()=>document.querySelectorAll('#cities input').forEach(b=>b.checked=false);
const config=()=>({keyword:$('keyword').value,cities:[...document.querySelectorAll('#cities input:checked')].map(b=>b.value),target:$('target').value,interval:$('interval').value,stallLimit:$('stall').value,varied:$('varied').checked});
function sliderLabels(){
 const target=Number($('target').value),base=Number($('interval').value);
 $('target-value').textContent=String(target);$('interval-value').textContent=String(base);
 $('target-help').textContent=target===0?'0表示不启动采集；已有保存记录会保留。':task?`本任务已保存 ${stats(task).saved} 个；达到 ${target} 个后自动暂停。已有记录会保留。`:'按全部所选城市累计计算；只有保存成功的岗位计入目标。';
 const upper=Math.min(100,base*2-1);
 $('interval-help').textContent=$('varied').checked?`每轮实际等待 ${base===upper?base:base+'–'+upper} 秒，访问顺序变化。`:`每轮固定等待 ${base} 秒。`;
 for(const id of ['target','interval']){const input=$(id);input.style.setProperty('--range-progress',100*(input.value-input.min)/(input.max-input.min)+'%');}
 if(task&&task.status!=='running')$('resume').disabled=['complete','incomplete'].includes(task.status)||(!draftDirty&&task.stopReason==='target');
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
 const r=await command('resume');draw(r.task);
}catch(e){errors(e);}};
for(const [id,action] of [['pause','pause'],['retry','retry']])$(id).onclick=async()=>{try{$('action-error').textContent='';const r=await command(action);draw(r.task);}catch(e){errors(e);}};
$('new').onclick=async()=>{try{
 if(task&&task.config.keyword!==config().keyword&&Object.keys(task.jobs).length&&!confirm('更换关键词会切换任务，原记录保留在历史任务。继续？'))return;
 await saveSettings();$('action-error').textContent='';
}catch(e){errors(e);}};
$('history').onclick=async()=>{try{const r=await command('archives');$('history-list').replaceChildren();$('history-list').hidden=false;
 for(const t of r.archives){const b=document.createElement('button');b.textContent=`${t.keyword} · ${t.cities}城 · ${t.saved}条 · ${new Date(t.updatedAt).toLocaleDateString()}`;b.onclick=async()=>{try{const result=await command('openArchive',{key:t.key});draw(result.task);$('history-list').hidden=true;}catch(e){errors(e);}};$('history-list').append(b);}
 if(!r.archives.length)$('history-list').textContent='还没有历史任务。';
}catch(e){errors(e);}};
function cell(text){const td=document.createElement('td');td.textContent=String(text??'');return td;}
function results(){const filter=$('result-city').value;const rows=task?exportedRows(task).filter(row=>!filter||row[6]===filter):[];$('results').replaceChildren();$('results-empty').hidden=rows.length>0;for(const row of rows.slice(-50)){const tr=document.createElement('tr');row.forEach(v=>tr.append(cell(v)));$('results').append(tr);}}
$('result-city').onchange=results;
function draw(s,syncSettings=false){
 if(!s)return;const changed=task?.id!==s.id||syncSettings;task=s;
 if(changed){draftDirty=false;$('keyword').value=s.config.keyword;$('target').value=configuration(s.config).target;$('interval').value=s.config.interval;$('stall').value=s.config.stallLimit;$('varied').checked=s.config.varied!==false;document.querySelectorAll('#cities input').forEach(b=>b.checked=s.config.cities.includes(b.value));}
 const v=stats(s),names={running:'正在采集',paused:'已暂停',complete:'全部完成',incomplete:'扫描结束，待补查'};
 $('status').textContent=s.stopReason==='target'?(configuration(s.config).target===0?'未启动':'目标已达成'):names[s.status]||s.status;$('status').dataset.state=s.stopReason==='target'?'target':s.status;$('task-title').textContent=s.config.keyword+' · '+s.config.cities.length+' 个城市';
 const target=configuration(s.config).target;
 $('goal-progress').value=target>0?Math.min(100,100*v.saved/target):0;$('goal-summary').textContent='已保存 '+v.saved+' / '+target+' 个岗位';$('goal-limit').textContent='目标 '+target+' 个岗位';
 $('goal-hint').textContent=target===0?'数量为0，当前不会采集。调高数量即可开始。':s.status==='complete'?`所选城市已采集完，共保存 ${v.saved} 个岗位。`:s.stopReason==='target'?'目标已达成，可以导出结果；提高目标后可继续。':`还需保存 ${Math.max(0,target-v.saved)} 个岗位；成功复用公司信息同样计入。`;
 $('run-feedback').textContent=draftDirty?(s.status==='running'?'新设置尚未应用。请先暂停，再保存设置。':'新设置尚未应用。点击“开始采集”会先保存设置。'):s.status==='running'?'正在按目标采集。已有公司资料会直接复用；需要验证时会暂停并提示。':s.reason||'设置已保存，点击“开始采集”即可运行。';
 $('step').textContent=s.status==='complete'?'采集已结束，可以导出全部已保存结果。':s.status!=='running'?'断点已保存，可以导出结果或继续采集。':s.phase==='loading'?'正在加载更多岗位…':s.phase==='collect'&&s.currentJob?'正在读取公司信息：'+s.currentJob:s.phase==='setup'?'正在准备城市与岗位列表…':'本轮已保存，等待继续采集。';
 if(s.status==='running'&&s.nextRunAt>Date.now())$('step').textContent+=' · 下轮约 '+new Date(s.nextRunAt).toLocaleTimeString();
 for(const k of ['saved','companies','found','review'])$(k).textContent=v[k];
 $('city').textContent='当前地区：'+(s.currentCity||v.city);$('updated').textContent='更新于 '+new Date(s.updatedAt).toLocaleTimeString();
 $('progress').value=100*v.localSaved/Math.max(1,v.localFound);
 $('local').textContent=`本城已保存 ${v.localSaved} / 已发现 ${v.localFound} 条 · 总数：${v.confirmed?v.localFound:'加载中'} · 本任务复用信息保存 ${v.reused} 个岗位`;
 $('reason').textContent=s.reason;$('reason').style.display=s.reason?'block':'none';
 restrictionButton.hidden=s.status!=='paused'||!String(s.reason).includes('平台限制访问');
 $('city-status').replaceChildren();for(const c of s.config.cities){const span=document.createElement('span'),entry=s.cities[c];span.textContent=c+' · '+(entry?.complete?'完成':entry?'待补查':c===s.currentCity?(s.status==='running'?'采集中':'已暂停'):'等待');span.className=entry?.complete?'done':entry?'missing':'';$('city-status').append(span);}
 const filter=$('result-city').value;$('result-city').replaceChildren(new Option('全部地区',''));for(const c of [...new Set(exportedRows(s).map(row=>row[6]))])$('result-city').append(new Option(c,c));$('result-city').value=[...$('result-city').options].some(o=>o.value===filter)?filter:'';results();
 $('logs').replaceChildren();const reviews=Object.values(s.jobs).filter(e=>e.status==='review');
 for(const e of reviews){const div=document.createElement('div');div.className='warning';div.textContent='待核查：'+e.job.city+' / '+e.job.title+' — '+e.reason;$('logs').append(div);}
 for(const e of s.logs.slice(-35).reverse()){const div=document.createElement('div');div.textContent=new Date(e.at).toLocaleTimeString()+'  '+e.text;$('logs').append(div);}
 $('resume').disabled=s.status==='running'||['complete','incomplete'].includes(s.status)||(!draftDirty&&s.stopReason==='target');$('resume').textContent=s.status==='running'?'正在采集…':s.startedAt?'继续采集':'开始采集';$('pause').disabled=s.status!=='running';$('retry').disabled=s.status==='running'||s.stopReason==='target';$('new').disabled=s.status==='running';
 const overdue=Date.now()-Math.max(s.updatedAt,s.nextRunAt||0);if(s.status==='running'&&overdue>180000){$('reason').style.display='block';$('reason').textContent='已超过预计执行时间3分钟，请检查Chrome是否休眠、页面是否出现验证或连接问题。断点仍保留。';}
 sliderLabels();
}
async function getState(){const r=await command('state');draw(r.task);return r.task;}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
const filename=()=> 'BOSS企业信息_'+(task?.config.keyword||'采集')+'_'+new Date().toISOString().slice(0,10);
$('restore').onclick=()=> $('restore-file').click();
$('restore-file').onchange=async()=>{try{const file=$('restore-file').files[0];if(!file)return;if(file.size>20*1024*1024)throw Error('备份文件超过20MB');if(!confirm('导入备份会切换当前任务，原任务将留存备份。是否继续？'))return;const r=await command('backupImport',{backup:JSON.parse(await file.text())});draw(r.task);}catch(e){errors(e);}finally{$('restore-file').value='';}};
$('xlsx').onclick=async()=>{try{const s=await getState();if(!s)throw Error('还没有采集任务');download(await xlsxBlob([HEADERS,...exportedRows(s)]),filename()+'.xlsx');}catch(e){errors(e);}};
$('csv').onclick=async()=>{try{const s=await getState();if(!s)throw Error('还没有采集任务');download(new Blob([csvText([HEADERS,...exportedRows(s)])],{type:'text/csv;charset=utf-8'}),filename()+'.csv');}catch(e){errors(e);}};
$('backup').onclick=async()=>{try{const s=await getState();if(!s)throw Error('还没有任务');download(new Blob([JSON.stringify(s,null,2)],{type:'application/json'}),filename()+'_断点备份.json');}catch(e){errors(e);}};
getState().catch(errors);chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.task)draw(changes.task.newValue);});setInterval(()=>getState().catch(errors),5000);
