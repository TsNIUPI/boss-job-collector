// Real dashboard + background integration. Only Chrome APIs are mocked.
// Fixtures are marked demo data; all network access is confined to localhost.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const playwrightModule=process.env.BOSS_PLAYWRIGHT_MODULE?pathToFileURL(process.env.BOSS_PLAYWRIGHT_MODULE).href:'playwright';
const {chromium}=await import(playwrightModule);

const dir=path.resolve(import.meta.dirname,'..');
const outputDir=path.resolve(process.env.BOSS_TEST_OUTPUT_DIR||path.join(dir,'test-artifacts'));await fs.mkdir(outputDir,{recursive:true});
const currentCompany={name:'演示视听文化传媒有限公司',legal:'演示法人',capital:'100万元',date:'2021-06-18',credit:''};
const archiveCompany={name:'演示星河运营科技有限公司',legal:'演示法人',capital:'200万元',date:'2020-03-09',credit:''};
function fixture(id,keyword,cities,company,count){
 const now=Date.now(),task={version:1,countingVersion:2,id,config:{keyword,cities,target:40,interval:60,stallLimit:4,varied:false},round:{id:'round-'+id,startedAt:now-60000},status:'paused',stopReason:'user',cityIndex:0,currentCity:cities[0],phase:'scan',jobs:{},companies:{},cities:{},scans:{},tabId:null,detailTab:null,stalls:0,logs:[],startedAt:now-60000,updatedAt:now,reason:'演示数据：已保存结果，断点保留',privateToken:'DEMO_TOKEN_MUST_NOT_BE_COPIED'};
 const companyUrl='https://www.zhipin.com/gongsi/'+id+'.html';task.companies[companyUrl]=company;
 for(let i=1;i<=count;i++){
  const city=cities.length>1?(i<=3?cities[0]:cities[1]):cities[0],title=(keyword==='视频剪辑'?'演示视频剪辑岗位':'演示跨境运营岗位')+String(i).padStart(3,'0'),url='https://www.zhipin.com/job_detail/'+id+'job'+i+'.html';
  task.jobs[city+'|'+url]={job:{title,url,company_url:companyUrl,city,location:city+'·演示地区'},status:'saved',attempts:0,reason:'',source:'page',savedAt:now-i*1000,row:[title,company.name,company.legal,company.capital,company.date,'未展示',city]};
 }
 return task;
}
const seed=fixture('current-53','视频剪辑',['北京'],currentCompany,53);
const archive=fixture('archive-5','跨境运营',['上海','杭州'],archiveCompany,5);archive.updatedAt-=86400000;
const stale=structuredClone(seed);stale.jobs=Object.fromEntries(Object.entries(stale.jobs).slice(0,1));stale.updatedAt-=3600000;
const server=http.createServer(async(req,res)=>{
 try{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/bridge.js'){
   res.setHeader('Content-Type','text/javascript');res.end("await import('./background.js'); await chrome.runtime.sendMessage({channel:'boss-dashboard',action:'state'}); await import('./dashboard.js'); globalThis.__bridgeReady=true;");return;
  }
  const file=path.resolve(dir,'.'+pathname);if(!file.startsWith(dir+path.sep))throw Error('Invalid local path');
  let body=await fs.readFile(file);if(file.endsWith('dashboard.html'))body=body.toString().replace('src="dashboard.js"','src="bridge.js"');
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html');res.end(body);
 }catch{res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true});
 const origin='http://127.0.0.1:'+server.address().port;
 if(process.env.BOSS_TEST_MOCK_CLIPBOARD!=='1')await context.grantPermissions(['clipboard-read','clipboard-write'],{origin});
 const page=await context.newPage(),errors=[],remoteRequests=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());if(url.origin===origin)return route.continue();remoteRequests.push(url.href);return route.abort();
 });
 await page.addInitScript(({seed,archive,stale,mockClipboard})=>{
  if(mockClipboard){let text='';Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{text=String(value);},readText:async()=>text}});}
  const clone=v=>structuredClone(v),stored={task:clone(seed),archive_other:clone(archive),archive_current_stale:clone(stale)},messageListeners=[],storageListeners=[],alarmListeners=[],alarms=new Map(),tabs=new Map();let nextId=1;
  const event=list=>({addListener:f=>list.push(f)});
  globalThis.__fixtureState=()=>clone(stored.task);
  globalThis.__fixtureStorage=()=>clone(stored);
  globalThis.chrome={
   runtime:{getURL:p=>location.origin+'/'+p,onMessage:event(messageListeners),onStartup:event([]),sendMessage:message=>new Promise((resolve,reject)=>{
    for(const listener of messageListeners)if(listener(clone(message),{url:location.href},v=>resolve(clone(v)))===true)return;reject(Error('No runtime message listener'));
   })},
   storage:{onChanged:event(storageListeners),local:{get:async key=>{
    if(key===null||key===undefined)return clone(stored);if(typeof key==='string')return clone({[key]:stored[key]});if(Array.isArray(key))return clone(Object.fromEntries(key.map(k=>[k,stored[k]])));return clone(Object.fromEntries(Object.entries(key).map(([k,v])=>[k,stored[k]??v])));
   },set:async values=>{
    const changes={};for(const [key,value] of Object.entries(values)){changes[key]={oldValue:clone(stored[key]),newValue:clone(value)};stored[key]=clone(value);}for(const listener of storageListeners)listener(clone(changes),'local');
   }}},
   action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{},onClicked:event([])},
   alarms:{onAlarm:event(alarmListeners),create:async(name,data)=>alarms.set(name,clone({name,...data})),clear:async name=>alarms.delete(name),get:async name=>clone(alarms.get(name))},
   tabs:{create:async data=>{const tab={id:nextId++,status:'complete',...data};tabs.set(tab.id,tab);return clone(tab);},get:async id=>{if(!tabs.has(id))throw Error('Tab not found');return clone(tabs.get(id));},update:async(id,data)=>{if(!tabs.has(id))throw Error('Tab not found');Object.assign(tabs.get(id),data);return clone(tabs.get(id));},remove:async id=>tabs.delete(id),query:async()=>clone([...tabs.values()]),reload:async()=>{},sendMessage:async()=>{throw Error('This history/countdown test must not access a BOSS page');}}
  };
 },{seed,archive,stale,mockClipboard:process.env.BOSS_TEST_MOCK_CLIPBOARD==='1'});
 await page.goto(origin+'/dashboard.html');await page.waitForFunction(()=>globalThis.__bridgeReady);
 await page.waitForFunction(()=>document.querySelector('#result-task').options.length===3);
 const state=()=>page.evaluate(()=>__fixtureState());
 const stable=async()=>{const s=await state();assert.equal(s.id,seed.id);assert.equal(s.round.id,seed.round.id);assert.equal(Object.values(s.jobs).filter(e=>e.status==='saved').length,53);};
 const waitRows=async n=>page.waitForFunction(n=>document.querySelectorAll('#results tr').length===n,n);
 const selectRange=async(value,count)=>{await page.locator('#result-task').selectOption(value);await page.waitForFunction(value=>document.querySelector('#result-task').value===value,value);await waitRows(count);};
 const clearSearch=async()=>{await page.locator('#result-search').fill('');};
 const assertXlsx=async(expected,title)=>{
  let download;try{[download]=await Promise.all([page.waitForEvent('download',{timeout:15000}),page.locator('#xlsx').click()]);}catch(error){console.error('Excel导出失败现场：',JSON.stringify({actionError:await page.locator('#action-error').innerText(),summary:await page.locator('#result-summary').innerText(),errors,remoteRequests}));throw error;}
  const bytes=await fs.readFile(await download.path());
  assert.match(download.suggestedFilename(),/跨境运营/,'Export filename must identify the viewed historical task');
  const parsed=await page.evaluate(async bytes=>{const zip=await JSZip.loadAsync(new Uint8Array(bytes)),xml=await zip.file('xl/worksheets/sheet1.xml').async('string'),doc=new DOMParser().parseFromString(xml,'text/xml');return {rows:doc.querySelectorAll('sheetData row').length,text:doc.documentElement.textContent};},[...bytes]);
  assert.equal(parsed.rows,expected+1,'Excel must contain every matching row plus its header');assert.match(parsed.text,/演示星河运营科技有限公司/);if(title)assert.ok(parsed.text.includes(title));
 };

 // Current 53 rows are fully accessible across two pages and by either search field.
 await waitRows(50);assert.equal(await page.locator('#saved').innerText(),'53');
 assert.match(await page.locator('#result-summary').innerText(),/范围总计 53/);
 assert.equal(await page.locator('#result-prev').isDisabled(),true);await page.locator('#result-next').click();await waitRows(3);assert.match(await page.locator('#result-page').innerText(),/2 \/ 2/);await page.locator('#result-prev').click();await waitRows(50);
 await page.locator('#result-search').fill('演示视频剪辑岗位053');await waitRows(1);assert.match(await page.locator('#results').innerText(),/岗位053/);
 await page.locator('#result-search').fill(currentCompany.name);await waitRows(50);assert.match(await page.locator('#result-summary').innerText(),/匹配 53/);await clearSearch();
 assert.equal(await page.locator('#result-task option[value="archive_current_stale"]').count(),0,'Current task must replace its stale archived snapshot in the catalog');

 // Real resume schedules a future tick. A visible countdown decreases without new requests.
 await page.locator('#resume').click();await page.waitForFunction(()=>__fixtureState().status==='running'&&__fixtureState().nextRunAt>Date.now());
 await page.waitForFunction(()=>/等待下一轮/.test(document.querySelector('#wait-title').textContent));
 const firstCountdown=parseInt(await page.locator('#wait-countdown').innerText(),10);assert.ok(firstCountdown>0&&firstCountdown<=60);
 await page.waitForTimeout(2200);const secondCountdown=parseInt(await page.locator('#wait-countdown').innerText(),10);assert.ok(secondCountdown<firstCountdown,'Countdown must decrease each second');await stable();

 // A draft slider edit cannot masquerade as the live running configuration.
 await page.locator('#interval').press('Home');for(let n=0;n<3;n++)await page.locator('#interval').press('ArrowRight');assert.equal(await page.locator('#interval').inputValue(),'13');assert.match(await page.locator('#active-pace').innerText(),/当前运行生效：基础 60 秒/);assert.equal((await state()).config.interval,60);assert.match(await page.locator('#wait-detail').innerText(),/本轮计划等待 60 秒（基础 60 秒）/);

 // History browsing is read-only even while collection is running; all = 53 + 5.
 await page.locator('#open-history').click();await page.waitForFunction(()=>document.querySelector('#result-task').value==='all'&&/范围总计 58/.test(document.querySelector('#result-summary').textContent));await waitRows(50);await stable();
 await selectRange('archive_other',5);assert.match(await page.locator('#result-summary').innerText(),/跨境运营.*范围总计 5/);assert.equal(await page.locator('#result-resume-task').isVisible(),true);assert.equal(await page.locator('#result-resume-task').isDisabled(),true);await stable();
 await page.waitForTimeout(5500);assert.equal(await page.locator('#result-task').inputValue(),'archive_other','The 5-second state refresh must not change the viewed task');await waitRows(5);await stable();
 await assertXlsx(5);
 await page.locator('#result-city').selectOption('杭州');await waitRows(2);assert.match(await page.locator('#result-summary').innerText(),/匹配 2/);
 await page.locator('#result-search').fill('演示跨境运营岗位005');await waitRows(1);await assertXlsx(1,'演示跨境运营岗位005');
 await clearSearch();await page.locator('#result-city').selectOption('');await waitRows(5);await stable();

 // Diagnostic output reports the live task, not the historical preview, without raw records.
 await page.locator('#diagnostics').click();await page.waitForFunction(()=>document.querySelector('#diagnostic-feedback').textContent.includes('已复制'));assert.equal(await page.locator('#diagnostics').innerText(),'复制运行诊断');assert.match(await page.locator('#diagnostic-feedback').innerText(),/Ctrl \+ V/);
 const copied=await page.evaluate(()=>navigator.clipboard.readText()),diagnostic=JSON.parse(copied),live=await state();
 assert.equal(diagnostic.status,'running');assert.equal(diagnostic.phase,live.phase);assert.equal(diagnostic.nextRunAt,new Date(live.nextRunAt).toISOString());assert.equal(diagnostic.totalSaved,53);assert.equal(diagnostic.roundSaved,0);
 for(const key of ['jobs','companies','token','privateToken','config'])assert.equal(Object.hasOwn(diagnostic,key),false,'Diagnostic must not include raw '+key);
 assert.doesNotMatch(copied,/DEMO_TOKEN|演示视听|演示星河|zhipin\.com|演示视频剪辑岗位/);

 // UI screenshots use demo records; the running task continues untouched in the background.
 await page.locator('#open-history').click();await page.waitForFunction(()=>document.querySelector('#result-task').value==='all'&&/范围总计 58/.test(document.querySelector('#result-summary').textContent));
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(outputDir,'BOSS采集插件_待验版_界面预览.png'),fullPage:true});
 for(const width of [800,390]){await page.setViewportSize({width,height:1100});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'UI must fit '+width+'px');if(width===390)await page.screenshot({path:path.join(outputDir,'BOSS采集插件_待验版_390.png'),fullPage:true});}
 await page.setViewportSize({width:1440,height:1100});await selectRange('archive_other',5);

 // Only the explicit restore action changes the active task, after a user pause.
 await page.locator('#pause').click();await page.waitForFunction(()=>__fixtureState().status==='paused');assert.equal(await page.locator('#wait-panel').getAttribute('data-state'),'paused');assert.match(await page.locator('#wait-detail').innerText(),/用户暂停.*断点/);assert.equal(await page.locator('#result-resume-task').isEnabled(),true);await stable();
 await page.locator('#result-resume-task').click();await page.waitForFunction(()=>__fixtureState().id==='archive-5');assert.equal(await page.locator('#result-task').inputValue(),'current');assert.equal((await state()).round.id,archive.round.id);assert.equal((await state()).status,'paused');await waitRows(5);
 const stored=await page.evaluate(()=>__fixtureStorage());assert.equal(Object.values(stored['archive_'+seed.id].jobs).filter(e=>e.status==='saved').length,53,'Restoring a historical task must archive all current results');
 assert.equal(await page.locator('#action-error').innerText(),'');assert.deepEqual(errors,[]);assert.deepEqual(remoteRequests,[]);
 console.log('工作台UI回归通过：真实模块导入；当前53+历史5=全部58且忽略陈旧快照；53条分页50/3；岗位/公司搜索及地区筛选；历史Excel导出5条及筛选后1条；运行中只读浏览历史、5秒轮询不切视图且活动任务/本轮ID不变；倒计时逐秒减少且显示当轮/基础等待；滑轨草稿13秒与运行生效60秒明确区分；诊断信息可复制且不含原始岗位/公司/Token；暂停后才可恢复历史任务；1440/800/390无横向溢出；无真实BOSS请求。');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
