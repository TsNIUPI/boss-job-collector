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
 return {keyword,cities,interval:Math.max(60,Math.min(300,Number(raw.interval)||120)),stallLimit:Math.max(3,Math.min(10,Number(raw.stallLimit)||4))};
}
export function fresh(config){return {version:1,id:crypto.randomUUID(),config:configuration(config),status:'paused',cityIndex:0,phase:'setup',jobs:{},companies:{},cities:{},tabId:null,detailTab:null,stalls:0,logs:[],startedAt:null,updatedAt:Date.now(),reason:''};}
export function discover(s,jobs){
 const city=s.config.cities[s.cityIndex];let added=0;
 for(const job of jobs){let url;try{url=canonical(job.url,'job')}catch{continue}
  const key=city+'|'+url;if(s.jobs[key])continue;
  const entry={job:{...job,url,city},status:'pending',attempts:0,reason:''};
  if(!job.title||!new RegExp('^'+city+'(?:市)?(?:[·\\s]|$)').test(job.location||'')){entry.status='review';entry.reason='岗位名称或实际工作城市未唯一确认';}
  s.jobs[key]=entry;added++;
 }return added;
}
export function stats(s){
 const jobs=Object.values(s.jobs),saved=jobs.filter(j=>j.status==='saved'),review=jobs.filter(j=>j.status==='review');
 const city=s.config.cities[s.cityIndex]||s.currentCity||s.config.cities.at(-1)||'—',local=jobs.filter(j=>j.job.city===city);
 return {city,found:jobs.length,saved:saved.length,review:review.length,companies:new Set(saved.map(j=>j.row[5]||j.row[1])).size,localFound:local.length,localSaved:local.filter(j=>j.status==='saved').length,confirmed:!!(s.cities[city]?.endConfirmed||s.scans?.[city]?.end)};
}
export function finishCity(s,endConfirmed,reason=''){
 const city=s.config.cities[s.cityIndex];const jobs=Object.values(s.jobs).filter(j=>j.job.city===city);
 s.cities[city]={endConfirmed,complete:endConfirmed&&jobs.every(j=>j.status==='saved'),reason:reason||'已读取明确列表末尾'};
 s.cityIndex++;s.phase='setup';s.stalls=0;s.lastSignature='';
 if(s.cityIndex>=s.config.cities.length){const complete=s.config.cities.every(c=>s.cities[c]?.complete);s.status=complete?'complete':'incomplete';s.reason=complete?'全部所选城市已确认末尾，记录全部保存':'本轮结束，仍有未确认末尾的城市或待核查记录';}
}
export function commit(s,key,boss){
 if(!boss.name)throw Error('BOSS工商全称未展示');if(boss.credit&&!/^[A-Z0-9]{18}$/.test(boss.credit))throw Error('统一社会信用代码需核查');
 const e=s.jobs[key];e.row=[e.job.title,boss.name,boss.legal||'未展示',boss.capital||'未展示',boss.date||'未展示',boss.credit||'未展示',e.job.city];e.status='saved';e.reason='';
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
 s.currentCity=config.cities[s.cityIndex]||config.cities.at(-1);s.currentJob='';s.phase='setup';s.scans||={};
 if(s.scans[s.currentCity])s.scans[s.currentCity].stalls=0;
 return s;
}
export function restoreBackup(raw){
 if(raw?.version!==1||!raw.jobs||typeof raw.jobs!=='object')throw Error('这不是本插件的任务备份');
 const s=fresh(raw.config),entries=Object.entries(raw.jobs);if(entries.length>50000)throw Error('备份超过5万条，请拆分任务');
 for(const [key,e] of entries){
  const url=canonical(e.job?.url,'job');if(!CITIES.includes(e.job?.city)||key!==e.job.city+'|'+url)throw Error('备份岗位来源或地区无效');
  if(!['pending','saved','review'].includes(e.status))throw Error('备份状态无效');
  if(e.status==='saved'&&(!Array.isArray(e.row)||e.row.length!==7||e.row.some(v=>typeof v!=='string')||e.row[6]!==e.job.city))throw Error('备份结果列或地区无效');
  s.jobs[key]={job:{title:String(e.job.title||''),url,company_url:String(e.job.company_url||''),city:e.job.city,location:String(e.job.location||'')},status:e.status,row:e.row,reason:String(e.reason||''),attempts:0};
 }
 s.cityIndex=Number.isInteger(raw.cityIndex)&&raw.cityIndex>=0&&raw.cityIndex<s.config.cities.length?raw.cityIndex:0;
 s.cities={};s.phase='setup';s.reason='备份已恢复为暂停状态，请检查设置后继续';return s;
}
