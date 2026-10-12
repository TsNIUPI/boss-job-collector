import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';
import {fresh,discover,commit,stats,finishCity,canonical,configuration,restoreBackup,exportedRows,configureTask,waitSeconds,nextPending,companyCache,companyData} from '../core.js';
import {csvText,xlsxBlob} from '../xlsx.js';
const config={keyword:'tiktok剪辑',cities:['北京','上海'],interval:30};
const job={title:'视频剪辑',url:'https://www.zhipin.com/job_detail/abc123.html?ka=x',company_url:'https://www.zhipin.com/gongsi/real.html',location:'北京·朝阳'};
test('slider configuration supports zero and clamps to 0–100 jobs and 10–100 seconds',()=>{
 assert.equal(configuration({...config,target:0}).target,0);assert.equal(configuration({...config,target:101}).target,100);assert.equal(configuration({...config,target:-1}).target,0);
 assert.equal(configuration({...config,interval:101}).interval,100);assert.equal(configuration({...config,interval:5}).interval,10);assert.equal(configuration(config).target,50);
 for(const interval of [10,15,60,99,100])for(const random of [0,0.5,0.999999]){const value=waitSeconds({interval,varied:true},()=>random);assert.ok(value>=interval&&value<=100);}
});
test('shared cache canonicalizes company links and restores saved rows without matching by company name',()=>{
 const a=fresh(config);discover(a,[job]);commit(a,Object.keys(a.jobs)[0],{name:'公司甲'});
 const cache=companyCache([a],{[job.company_url+'?ka=other']:{name:'公司甲',legal:'张三'},'https://evil.test/gongsi/real.html':{name:'公司甲'}});
 assert.equal(Object.keys(cache).length,1);assert.equal(cache[job.company_url].legal,'张三');
 assert.equal(cache['https://www.zhipin.com/gongsi/other.html'],undefined);
});
test('invalid cached fields are rejected and newest verified snapshot wins without mixing companies',()=>{
 assert.equal(companyData({name:'未展示'}),null);assert.equal(companyData({name:'法定代表人：张三'}),null);assert.equal(companyData({name:'公司甲',credit:'invalid'}),null);
 const cache=companyCache([{companies:{[job.company_url]:{name:'新公司',savedAt:200}}}],{[job.company_url]:{name:'旧公司',legal:'旧法人',savedAt:100}});
 assert.equal(cache[job.company_url].name,'新公司');assert.equal(cache[job.company_url].legal,'');
});
test('companies with missing credit codes count separately and reuse counters track cache saves',()=>{
 const s=fresh(config);discover(s,[job,{...job,url:job.url.replace('abc123','def456')}]);const keys=Object.keys(s.jobs);
 commit(s,keys[0],{name:'甲公司'});commit(s,keys[1],{name:'乙公司'},'cache');assert.equal(stats(s).companies,2);assert.equal(stats(s).reused,1);
});
test('commit refuses a wrong-city pending job even after manual retry',()=>{
 const s=fresh(config);discover(s,[{...job,location:'上海·浦东'}]);const key=Object.keys(s.jobs)[0];s.jobs[key].status='pending';
 assert.throws(()=>commit(s,key,{name:'公司'}),/实际工作城市/);assert.equal(exportedRows(s).length,0);
});
test('backup restores valid company data and retains completed cities while reopening earliest incomplete city',()=>{
 const s=fresh(config);discover(s,[job]);commit(s,Object.keys(s.jobs)[0],{name:'公司'});finishCity(s,true);
 const restored=restoreBackup(s);assert.equal(restored.companies[job.company_url].name,'公司');assert.equal(restored.cities['北京'].complete,true);assert.equal(restored.cityIndex,1);
 const raw=fresh(config);raw.cityIndex=1;const rewind=restoreBackup(raw);assert.equal(rewind.cityIndex,0);
});
test('missing company page fields cannot consume the next label as their value',async()=>{
 const ctx={URL};vm.createContext(ctx);vm.runInContext(await fs.readFile(new URL('../page-reader.js',import.meta.url),'utf8'),ctx);
 assert.throws(()=>ctx.BossPage.parseCompany('企业名称：\n法定代表人：张三'),/工商全称/);
 assert.throws(()=>ctx.BossPage.parseCompany('企业名称：暂无\n法定代表人：张三'),/工商全称/);
 const row=ctx.BossPage.parseCompany('企业名称：\n公司甲\n注册资本：\n成立时间：2020-01-01');assert.equal(row.name,'公司甲');assert.equal(row.capital,'');assert.equal(row.date,'2020-01-01');
});
test('variable waiting never shortens the configured interval and can be disabled',()=>{
 const c=configuration({...config,interval:60});
 assert.equal(waitSeconds(c,()=>0),60);assert.equal(waitSeconds(c,()=>0.5),80);assert.equal(waitSeconds(c,()=>1),100);
 assert.equal(waitSeconds({...c,varied:false},()=>0.9),60);
});
test('varied queue selection visits every pending local job once without touching saved or other cities',()=>{
 const s=fresh(config);discover(s,[job,{...job,url:job.url.replace('abc123','def456')},{...job,url:job.url.replace('abc123','ghi789')}]);
 const keys=Object.keys(s.jobs);s.jobs.other={job:{city:'上海'},status:'pending'};
 assert.equal(nextPending(s,()=>0.99)[0],keys[2]);
 const visited=[];while(nextPending(s,()=>0.5)){const [key]=nextPending(s,()=>0.5);visited.push(key);commit(s,key,{name:'测试公司'});}
 assert.equal(new Set(visited).size,3);assert.equal(s.jobs.other.status,'pending');
});
test('rescan repairs missing company links without corrupting saved rows or accepting wrong-city cards',()=>{
 const s=fresh(config);discover(s,[{...job,company_url:''}]);const key=Object.keys(s.jobs)[0];
 discover(s,[{...job,location:'上海·浦东'}]);assert.equal(s.jobs[key].job.company_url,'');
 discover(s,[job]);assert.equal(s.jobs[key].job.company_url,job.company_url);
 commit(s,key,{name:'已保存公司'});const before=structuredClone(s.jobs[key]);discover(s,[{...job,title:'不同岗位'}]);assert.deepEqual(s.jobs[key],before);
});
test('switching Beijing to Shanghai and back keeps unified rows and completed-city checkpoint',()=>{
 const beijing=fresh({...config,cities:['北京']});discover(beijing,[job]);commit(beijing,Object.keys(beijing.jobs)[0],{name:'北京公司'});finishCity(beijing,true);
 const shanghai=configureTask(beijing,{...config,cities:['上海']});assert.equal(exportedRows(shanghai)[0][6],'北京');assert.equal(shanghai.id,beijing.id);assert.equal(shanghai.currentCity,'上海');
 discover(shanghai,[{...job,location:'上海·浦东'}]);commit(shanghai,Object.keys(shanghai.jobs).find(k=>k.startsWith('上海|')),{name:'上海公司'});
 const again=configureTask(shanghai,{...config,cities:['北京']});assert.equal(exportedRows(again).length,2);assert.equal(again.status,'complete');assert.ok(again.cities['北京'].complete);
});
test('same-keyword historical tasks recover saved rows; other keywords stay separate',()=>{
 const old=fresh({...config,cities:['北京']});discover(old,[job]);commit(old,Object.keys(old.jobs)[0],{name:'历史北京公司'});
 const other=fresh({...config,keyword:'运营'});const recovered=configureTask(other,{...config,cities:['上海']},[old]);assert.equal(exportedRows(recovered).length,1);assert.equal(recovered.config.keyword,config.keyword);
 const independent=configureTask(old,{...config,keyword:'运营'},[old]);assert.equal(exportedRows(independent).length,0);
});
test('configuration excludes nationwide and clamps cadence',()=>{assert.throws(()=>configuration({...config,cities:['全国']}));assert.equal(configuration({...config,interval:1}).interval,10);assert.throws(()=>configuration({...config,keyword:''}));});
test('job URLs canonicalize and other domains are rejected',()=>{assert.equal(canonical(job.url,'job'),'https://www.zhipin.com/job_detail/abc123.html');assert.throws(()=>canonical('https://evil.test/job_detail/abc123.html','job'));assert.throws(()=>canonical('https://www.zhipin.com/web/geek/jobs','company'));});
test('same job deduplicates after checkpoint reload',()=>{let s=fresh(config);assert.equal(discover(s,[job]),1);s=JSON.parse(JSON.stringify(s));assert.equal(discover(s,[job]),0);assert.equal(stats(s).found,1);});
test('cross-city job location cannot be saved in selected city',()=>{const s=fresh(config);discover(s,[{...job,location:'上海·浦东'}]);assert.equal(Object.values(s.jobs)[0].status,'review');});
test('company cache keeps multiple jobs and distinct regions',()=>{const s=fresh(config);discover(s,[job,{...job,url:job.url.replace('abc123','def456')}]);for(const key of Object.keys(s.jobs))commit(s,key,{name:'测试有限公司',credit:'91310120332335763Y'});assert.equal(stats(s).saved,2);assert.equal(stats(s).companies,1);});
test('a stalled list never marks collection complete',()=>{const s=fresh({...config,cities:['北京']});finishCity(s,false,'末尾不明确');assert.equal(s.status,'incomplete');assert.equal(s.cities.北京.complete,false);});
test('explicit end with review records remains incomplete',()=>{const s=fresh({...config,cities:['北京']});discover(s,[{...job,location:''}]);finishCity(s,true);assert.equal(s.status,'incomplete');assert.equal(s.cities.北京.endConfirmed,true);});
test('all saved and end marker complete the selected city',()=>{const s=fresh({...config,cities:['北京']});discover(s,[job]);commit(s,Object.keys(s.jobs)[0],{name:'测试有限公司'});finishCity(s,true);assert.equal(s.status,'complete');});
test('malformed credit and missing company full name never commit',()=>{const s=fresh(config);discover(s,[job]);const k=Object.keys(s.jobs)[0];assert.throws(()=>commit(s,k,{name:'公司',credit:'123'}));assert.throws(()=>commit(s,k,{name:''}));assert.equal(exportedRows(s).length,0);});
test('backup import resets tabs and restores saved rows paused',()=>{const s=fresh(config);discover(s,[job]);commit(s,Object.keys(s.jobs)[0],{name:'测试有限公司'});s.status='running';s.tabId=999;const r=restoreBackup(JSON.parse(JSON.stringify(s)));assert.equal(r.status,'paused');assert.equal(r.tabId,null);assert.equal(stats(r).saved,1);});
test('backup rejects foreign URL and row layout tampering',()=>{const s=fresh(config);discover(s,[job]);commit(s,Object.keys(s.jobs)[0],{name:'测试有限公司'});Object.values(s.jobs)[0].row[6]='上海';assert.throws(()=>restoreBackup(s));});
test('CSV prevents formula execution and escapes quotes',()=>{const s=csvText([['=1+1','a"b','中文']]);assert.ok(s.includes("'=1+1"));assert.ok(s.includes('a""b'));});
test('page text parser and login/security gate',async()=>{const ctx={URL};vm.createContext(ctx);vm.runInContext(await fs.readFile(new URL('../page-reader.js',import.meta.url),'utf8'),ctx);const P=ctx.BossPage;assert.ok(P.gate('请完成安全验证','https://www.zhipin.com/gongsi/a.html'));assert.equal(P.gate('首页 登录 招聘信息','https://www.zhipin.com/gongsi/a.html'),'');const d=P.parseCompany('工商信息\n企业名称：\n测试有限公司\n法定代表人：张三\n注册资本：100万元\n成立时间：2020-01-01\n统一社会信用代码：91310120332335763Y');assert.equal(d.name,'测试有限公司');assert.equal(d.credit,'91310120332335763Y');assert.throws(()=>P.parseCompany('公司简称：测试'));});
test('manifest restricts host and forbids remote code',async()=>{const m=JSON.parse(await fs.readFile(new URL('../manifest.json',import.meta.url)));assert.deepEqual(m.host_permissions,['https://www.zhipin.com/*']);assert.equal(m.manifest_version,3);assert.ok(!m.permissions.includes('cookies'));assert.ok(m.content_security_policy.extension_pages.includes("script-src 'self'"));});

test('restricted account wording and recovery time are recognized without flagging normal job text',async()=>{const ctx={URL};vm.createContext(ctx);vm.runInContext(await fs.readFile(new URL('../page-reader.js',import.meta.url),'utf8'),ctx);const P=ctx.BossPage;const msg=P.gate('访问受限 您的账户存在异常行为，已暂时被限制访问！将于 2026-10-14 14:30 恢复正常','https://www.zhipin.com/web/geek/jobs');assert.match(msg,/平台限制访问/);assert.match(msg,/2026-10-14 14:30/);assert.match(P.gate('您的帐户存在异常行为','https://www.zhipin.com/web/geek/jobs'),/平台限制访问/);assert.equal(P.gate('岗位负责账户管理，薪资面议','https://www.zhipin.com/web/geek/jobs'),'');});
