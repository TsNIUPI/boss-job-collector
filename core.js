export const CITIES=['北京','上海','广州','深圳','杭州','天津','西安','苏州','武汉','厦门','长沙','成都','郑州','重庆'];
export const HEADERS=['公司岗位名称','公司全称','法定代表人','注册资金','成立日期','统一社会信用代码','地区'];
export function canonical(url,kind){
 const u=new URL(url);if(u.origin!=='https://www.zhipin.com')throw Error('来源不是BOSS HTTPS页面');
 const re=kind==='company'?/^\/gongsi\/[\w~.-]+\.html$/:/^\/job_detail\/[\w~.-]+\.html$/;
 if(!re.test(u.pathname))throw Error('岗位/公司链接格式未通过核对');return u.origin+u.pathname;
}
export function configuration(raw){
 const keyword=String(raw.keyword||'').trim();if(!keyword||keyword.length>80)throw Error('请输入1—80字的岗位关键词');
 const cities=[...new Set(raw.cities||[])];if(!cities.length||cities.some(c=>!CITIES.includes(c)))throw Error('至少选择一个支持的城市');
 const target=raw.target===undefined?50:Number(raw.target),interval=Number(raw.interval);
 return {keyword,cities,target:Number.isFinite(target)?Math.max(0,Math.min(100,Math.round(target))):50,interval:Number.isFinite(interval)&&interval>0?Math.max(10,Math.min(100,Math.round(interval))):60,stallLimit:Math.max(3,Math.min(10,Number(raw.stallLimit)||4)),varied:raw.varied!==false};
}
export const savedCount=s=>Object.values(s.jobs||{}).filter(e=>e.status==='saved').length;
export const goalReached=s=>savedCount(s)>=configuration(s.config).target;
export function targetPause(s){
 if(!goalReached(s)||s.status==='complete')return false;
 s.status='paused';s.stopReason='target';s.nextRunAt=null;
 s.reason=configuration(s.config).target===0?'目标设为0个，当前不会启动采集。请选择1–100个岗位后开始，已有记录会保留。':'已达到岗位目标：累计保存 '+savedCount(s)+' / '+configuration(s.config).target+' 个岗位。可以导出结果；提高目标并保存设置后可继续。';return true;
}
export function waitSeconds(config,random=Math.random){
 const base=Math.max(10,Math.min(100,Math.round(Number(config.interval)||60)));
 const width=Math.min(base,101-base);
 return config.varied===false?base:base+Math.floor(Math.max(0,Math.min(0.999999,random()))*width);
}
export function nextPending(s,random=Math.random){
 const city=s.config.cities[s.cityIndex],queue=Object.entries(s.jobs).filter(([,e])=>e.job.city===city&&e.status==='pending');
 if(!queue.length)return undefined;
 return queue[s.config.varied===false?0:Math.floor(Math.max(0,Math.min(0.999999,random()))*queue.length)];
}
const meaningful=v=>typeof v==='string'&&!['','未展示','—','-','暂无'].includes(v.trim())?v.trim():'';
export function companyData(raw){
 if(!raw||typeof raw!=='object')return null;
 const data={};for(const k of ['name','legal','capital','date','credit'])data[k]=meaningful(raw[k]);
 const label=/^(?:企业名称|公司全称|法定代表人|注册资本|注册资金|成立时间|成立日期|统一社会信用代码)[：:]/;
 for(const k of Object.keys(data))if(label.test(data[k]))data[k]='';
 if(!data.name||(data.credit&&!/^[A-Z0-9]{18}$/.test(data.credit)))return null;
 if(Number.isFinite(raw.savedAt)&&raw.savedAt>0)data.savedAt=raw.savedAt;
 return data;
}
export function companyCache(tasks,existing={}){
 const result={};
 const add=(rawUrl,raw)=>{
  let url;try{url=canonical(rawUrl,'company');}catch{return;}
  const value=companyData(raw);if(!value)return;
  const old=result[url],score=v=>['name','legal','capital','date','credit'].filter(k=>v[k]).length;
  if(!old||(value.savedAt||0)>(old.savedAt||0)||((value.savedAt||0)===(old.savedAt||0)&&score(value)>score(old)))result[url]=value;
 };
 for(const [url,value] of Object.entries(existing||{}))add(url,value);
 for(const task of tasks.filter(Boolean)){
  for(const [url,value] of Object.entries(task.companies||{}))add(url,value);
  for(const entry of Object.values(task.jobs||{})){
   if(entry.status!=='saved'||!Array.isArray(entry.row)||entry.row.length!==7)continue;
   const [,name,legal,capital,date,credit]=entry.row;
   add(entry.job?.company_url,{name,legal,capital,date,credit});
  }
 }
 return result;
}
export function fresh(config){return {version:1,id:crypto.randomUUID(),config:configuration(config),status:'paused',cityIndex:0,phase:'setup',jobs:{},companies:{},cities:{},tabId:null,detailTab:null,stalls:0,logs:[],startedAt:null,updatedAt:Date.now(),reason:''};}
export function discover(s,jobs){
 const city=s.config.cities[s.cityIndex];let added=0;
 for(const job of jobs){let url;try{url=canonical(job.url,'job')}catch{continue}
  const key=city+'|'+url;
  if(s.jobs[key]){
   const old=s.jobs[key];
   // Preserve saved rows; refresh pending/review metadata only from a verified local card.
   if(old.status!=='saved'&&job.title&&new RegExp('^'+city+'(?:市)?(?:[·\\s]|$)').test(job.location||'')){
    old.job={...old.job,...job,url,city,company_url:job.company_url||old.job.company_url};
    let linked=false;try{canonical(old.job.company_url,'company');linked=true;}catch{}
    if(old.status==='review'&&(/岗位名称或实际工作城市/.test(old.reason||'')||linked&&/公司详情链接/.test(old.reason||''))){old.status='pending';old.reason='';}
   }
   continue;
  }
  const entry={job:{...job,url,city},status:'pending',attempts:0,reason:''};
  if(!job.title||!new RegExp('^'+city+'(?:市)?(?:[·\\s]|$)').test(job.location||'')){entry.status='review';entry.reason='岗位名称或实际工作城市未唯一确认';}
  s.jobs[key]=entry;added++;
 }return added;
}
export function stats(s){
 const jobs=Object.values(s.jobs),saved=jobs.filter(j=>j.status==='saved'),review=jobs.filter(j=>j.status==='review');
 const city=s.config.cities[s.cityIndex]||s.currentCity||s.config.cities.at(-1)||'—',local=jobs.filter(j=>j.job.city===city);
 return {city,found:jobs.length,saved:saved.length,review:review.length,companies:new Set(saved.map(j=>meaningful(j.row[5])||j.row[1])).size,reused:saved.filter(j=>j.source==='cache').length,localFound:local.length,localSaved:local.filter(j=>j.status==='saved').length,confirmed:!!(s.cities[city]?.endConfirmed||s.scans?.[city]?.end)};
}
export function finishCity(s,endConfirmed,reason=''){
 const city=s.config.cities[s.cityIndex];const jobs=Object.values(s.jobs).filter(j=>j.job.city===city);
 s.cities[city]={endConfirmed,complete:endConfirmed&&jobs.every(j=>j.status==='saved'),reason:reason||'已读取明确列表末尾'};
 s.cityIndex++;s.phase='setup';s.stalls=0;s.lastSignature='';
 while(s.cityIndex<s.config.cities.length&&s.cities[s.config.cities[s.cityIndex]]?.complete)s.cityIndex++;
 if(s.cityIndex>=s.config.cities.length){const complete=s.config.cities.every(c=>s.cities[c]?.complete);s.status=complete?'complete':'incomplete';s.reason=complete?'全部所选城市已确认末尾，记录全部保存':'本轮结束，仍有未确认末尾的城市或待核查记录';}
}
export function commit(s,key,boss,source='page'){
 if(!boss.name)throw Error('BOSS工商全称未展示');if(boss.credit&&!/^[A-Z0-9]{18}$/.test(boss.credit))throw Error('统一社会信用代码需核查');
 const e=s.jobs[key];
 if(!e?.job.title||!new RegExp('^'+e.job.city+'(?:市)?(?:[·\\s]|$)').test(e.job.location||''))throw Error('岗位名称或实际工作城市未唯一确认');
 if(e.status==='saved'||goalReached(s))return false;
 e.row=[e.job.title,boss.name,boss.legal||'未展示',boss.capital||'未展示',boss.date||'未展示',boss.credit||'未展示',e.job.city];e.status='saved';e.reason='';e.source=source;
 return true;
}
export function exportedRows(s){return Object.values(s.jobs).filter(j=>j.status==='saved').map(j=>j.row);}
export function configureTask(previous,raw,archives=[]){
 const config=configuration(raw),s=previous?.config.keyword===config.keyword?structuredClone(previous):fresh(config);
 s.config=config;
 for(const old of archives.filter(t=>t?.config?.keyword===config.keyword)){
  for(const [key,e] of Object.entries(old.jobs||{})){
   if(!s.jobs[key]||(e.status==='saved'&&s.jobs[key].status!=='saved'))s.jobs[key]=structuredClone(e);
  }
  for(const [city,value] of Object.entries(old.cities||{}))if(value.complete&&!s.cities[city]?.complete)s.cities[city]=structuredClone(value);
  for(const [url,value] of Object.entries(old.companies||{}))s.companies[url]||=structuredClone(value);
 }
 s.cityIndex=config.cities.findIndex(city=>!s.cities[city]?.complete);
 if(s.cityIndex<0){s.cityIndex=config.cities.length;s.status='complete';s.reason='所选城市已完成，已有记录保留';}
 else{s.status='paused';s.reason='设置已保存，已有记录保留';}
 s.stopReason='';s.nextRunAt=null;s.currentCity=config.cities[s.cityIndex]||config.cities.at(-1);s.currentJob='';s.phase='setup';s.scans||={};
 if(s.scans[s.currentCity])s.scans[s.currentCity].stalls=0;
 targetPause(s);
 return s;
}
export function restoreBackup(raw){
 if(raw?.version!==1||!raw.jobs||typeof raw.jobs!=='object')throw Error('这不是本插件的任务备份');
 const s=fresh(raw.config),entries=Object.entries(raw.jobs);if(entries.length>50000)throw Error('备份超过5万条，请拆分任务');
 for(const [key,e] of entries){
  const url=canonical(e.job?.url,'job');if(!CITIES.includes(e.job?.city)||key!==e.job.city+'|'+url)throw Error('备份岗位来源或地区无效');
  if(!['pending','saved','review'].includes(e.status))throw Error('备份状态无效');
  if(e.status==='saved'&&(!Array.isArray(e.row)||e.row.length!==7||e.row.some(v=>typeof v!=='string')||e.row[6]!==e.job.city))throw Error('备份结果列或地区无效');
  s.jobs[key]={job:{title:String(e.job.title||''),url,company_url:String(e.job.company_url||''),city:e.job.city,location:String(e.job.location||'')},status:e.status,row:e.row,reason:String(e.reason||''),attempts:0,source:e.source==='cache'?'cache':'page'};
 }
 s.companies=companyCache([s,{companies:raw.companies}]);s.cities={};
 for(const city of s.config.cities){
  if(raw.cities?.[city]?.complete&&raw.cities[city].endConfirmed&&Object.values(s.jobs).filter(e=>e.job.city===city).every(e=>e.status==='saved'))s.cities[city]={complete:true,endConfirmed:true,reason:'备份中已确认完成'};
 }
 s.cityIndex=s.config.cities.findIndex(city=>!s.cities[city]?.complete);
 if(s.cityIndex<0){s.cityIndex=s.config.cities.length;s.status='complete';}
 s.currentCity=s.config.cities[s.cityIndex]||s.config.cities.at(-1);s.phase='setup';s.reason='备份已恢复，已保存公司信息与完成城市保留';targetPause(s);return s;
}
