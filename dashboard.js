import {CITIES,HEADERS,stats,exportedRows} from './core.js';
import {xlsxBlob,csvText} from './xlsx.js';
const $=id=>document.getElementById(id);let task=null;
for(const city of CITIES){const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.value=city;box.checked=city==='北京';label.append(box,document.createTextNode(city));$('cities').append(label);}
$('all').onclick=()=>document.querySelectorAll('#cities input').forEach(b=>b.checked=true);
$('none').onclick=()=>document.querySelectorAll('#cities input').forEach(b=>b.checked=false);
const config=()=>({keyword:$('keyword').value,cities:[...document.querySelectorAll('#cities input:checked')].map(b=>b.value),interval:$('interval').value,stallLimit:$('stall').value});
async function command(action,args={}){const r=await chrome.runtime.sendMessage({channel:'boss-dashboard',action,...args});if(!r?.ok)throw Error(r?.error||'插件没有响应，请重新打开工作台');return r;}
function errors(e){$('action-error').textContent=e.message;}
for(const [id,action] of [['resume','resume'],['pause','pause'],['retry','retry']])$(id).onclick=async()=>{try{$('action-error').textContent='';const r=await command(action);draw(r.task);}catch(e){errors(e);}};
$('new').onclick=async()=>{try{
 if(task&&task.config.keyword!==config().keyword&&Object.keys(task.jobs).length&&!confirm('更换关键词会切换任务，原记录保留在历史任务。继续？'))return;
 const r=await command('new',{config:config()});$('action-error').textContent='';draw(r.task);
}catch(e){errors(e);}};
$('history').onclick=async()=>{try{const r=await command('archives');$('history-list').replaceChildren();$('history-list').hidden=false;
 for(const t of r.archives){const b=document.createElement('button');b.textContent=`${t.keyword} · ${t.cities}城 · ${t.saved}条 · ${new Date(t.updatedAt).toLocaleDateString()}`;b.onclick=async()=>{try{const result=await command('openArchive',{key:t.key});draw(result.task);$('history-list').hidden=true;}catch(e){errors(e);}};$('history-list').append(b);}
 if(!r.archives.length)$('history-list').textContent='还没有历史任务。';
}catch(e){errors(e);}};
function cell(text){const td=document.createElement('td');td.textContent=String(text??'');return td;}
function results(){const filter=$('result-city').value;const rows=exportedRows(task).filter(row=>!filter||row[6]===filter);$('results').replaceChildren();for(const row of rows.slice(-50)){const tr=document.createElement('tr');row.forEach(v=>tr.append(cell(v)));$('results').append(tr);}}
$('result-city').onchange=results;
function draw(s){
 if(!s)return;const changed=task?.id!==s.id;task=s;
 if(changed){$('keyword').value=s.config.keyword;$('interval').value=s.config.interval;$('stall').value=s.config.stallLimit;document.querySelectorAll('#cities input').forEach(b=>b.checked=s.config.cities.includes(b.value));}
 const v=stats(s),names={running:'正在采集',paused:'已暂停',complete:'全部完成',incomplete:'扫描结束，待补查'};
 $('status').textContent=names[s.status]||s.status;$('task-title').textContent=s.config.keyword+' · '+s.config.cities.length+' 个城市';
 $('step').textContent=s.phase==='loading'?'正在加载更多岗位…':s.currentJob?'当前岗位：'+s.currentJob:'等待列表加载';
 for(const k of ['saved','companies','found','review'])$(k).textContent=v[k];
 $('city').textContent='当前地区：'+(s.currentCity||v.city);$('updated').textContent='更新于 '+new Date(s.updatedAt).toLocaleTimeString();
 $('progress').value=100*v.localSaved/Math.max(1,v.localFound);
 $('local').textContent=`本城已保存 ${v.localSaved} / 已发现 ${v.localFound} 条 · 总数：${v.confirmed?v.localFound:'加载中'}`;
 $('reason').textContent=s.reason;$('reason').style.display=s.reason?'block':'none';
 $('city-status').replaceChildren();for(const c of s.config.cities){const span=document.createElement('span'),entry=s.cities[c];span.textContent=c+' · '+(entry?.complete?'完成':entry?'待补查':c===s.currentCity?'采集中':'等待');span.className=entry?.complete?'done':entry?'missing':'';$('city-status').append(span);}
 const filter=$('result-city').value;$('result-city').replaceChildren(new Option('全部地区',''));for(const c of [...new Set(exportedRows(s).map(row=>row[6]))])$('result-city').append(new Option(c,c));$('result-city').value=[...$('result-city').options].some(o=>o.value===filter)?filter:'';results();
 $('logs').replaceChildren();const reviews=Object.values(s.jobs).filter(e=>e.status==='review');
 for(const e of reviews){const div=document.createElement('div');div.className='warning';div.textContent='待核查：'+e.job.city+' / '+e.job.title+' — '+e.reason;$('logs').append(div);}
 for(const e of s.logs.slice(-35).reverse()){const div=document.createElement('div');div.textContent=new Date(e.at).toLocaleTimeString()+'  '+e.text;$('logs').append(div);}
 $('resume').disabled=s.status==='running'||['complete','incomplete'].includes(s.status);$('pause').disabled=s.status!=='running';$('retry').disabled=s.status==='running';$('new').disabled=s.status==='running';
 const age=Date.now()-s.updatedAt;if(s.status==='running'&&age>180000){$('reason').style.display='block';$('reason').textContent='已超过3分钟未更新，请检查Chrome是否休眠、页面是否出现验证或连接问题。断点仍保留。';}
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
