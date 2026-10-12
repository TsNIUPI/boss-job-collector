(() => {
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),P=globalThis.BossPage;
 function guard(){const msg=P.gate(document.body?.innerText||'',location.href);if(msg)throw Error(msg);}
 const cities=['全国','北京','上海','广州','深圳','杭州','天津','西安','苏州','武汉','厦门','长沙','成都','郑州','重庆'];
 function cityControl(){
  const known=[...document.querySelectorAll('[ka="switch_city_dialog_open"],.cur-city-label')].filter(P.visible);
  if(known.length===1)return known[0];
  // The site's city entry also appears as city + 工作区域. Locate the
  // smallest visible header control by its displayed text, not tracking tags.
  const leaves=[...document.querySelectorAll('span,a,div')].filter(e=>P.visible(e)&&!e.children.length&&cities.includes(e.innerText.trim()));
  const matches=leaves.filter(e=>{let p=e.parentElement;for(let n=0;n<3&&p;n++,p=p.parentElement){const text=p.innerText.trim();if(text.length<70&&text.includes('工作区域'))return true;}return false;});
  return matches.length===1?matches[0]:null;
 }
 function current(){
  const label=[...document.querySelectorAll('.cur-city-label')].find(P.visible),entry=label||cityControl();
  const text=entry?.innerText.trim()||'';return cities.find(c=>text===c||new RegExp('^'+c+'(?:市)?(?:\\s|工作区域|$)').test(text))||'';
 }
 function cityOptions(city){
  const lists=[...document.querySelectorAll('.city-list-hot')].filter(P.visible);
  if(lists.length){const options=lists.flatMap(e=>[...e.querySelectorAll('li,a,button,span')]).filter(e=>P.visible(e)&&e.innerText.trim()===city);return options.filter(e=>!options.some(other=>other!==e&&e.contains(other)));}
  const titles=[...document.querySelectorAll('*')].filter(e=>P.visible(e)&&!e.children.length&&e.innerText?.trim()==='请选择城市');
  if(titles.length!==1)return [];
  for(let root=titles[0].parentElement;root&&root!==document.body;root=root.parentElement){
   if(root.innerText.length>2000)break;
   const options=[...root.querySelectorAll('li,a,button,span,div')].filter(e=>P.visible(e)&&!e.children.length&&cities.includes(e.innerText.trim()));
   if(new Set(options.map(e=>e.innerText.trim())).size>=8)return options.filter(e=>e.innerText.trim()===city);
  }return [];
 }
 function scope(city,keyword){const q=new URL(location.href),actual=current(),query=q.searchParams.get('query')||'';if(q.pathname.replace(/\/$/,'')!=='/web/geek/jobs'||query!==keyword||actual!==city)throw Error('筛选需恢复：应为'+city+' / '+keyword+'，页面为'+(actual||'地区未加载')+' / '+(query||'关键词未加载'));}
 function snapshot(city){
  const cards=P.list(city),anchor=document.querySelector('.job-card-box');
  const root=anchor?.closest('.rec-job-list,.job-list-box,.job-list-container')||anchor?.parentElement;
  const end=root?[...root.parentElement.querySelectorAll('*')].filter(e=>P.visible(e)&&!e.children.length&&/^(没有更多(?:了|岗位)?|暂无更多(?:岗位)?|已到底|到底了)[！!。\s]*$/.test(e.innerText.trim())).map(e=>e.innerText.trim()).join('；'):'';
  return {cards,end,url:location.href,city:current()};
 }
 async function scrollList(city,keyword){
  const before=snapshot(city),known=new Set(before.cards.map(j=>j.url));
  const last=[...document.querySelectorAll('.job-card-box')].filter(P.visible).at(-1);
  if(!last)return {...before,scrolled:false,changed:false};
  let host=last.parentElement;
  while(host&&host!==document.body&&!(host.scrollHeight>host.clientHeight+2&&/auto|scroll/.test(getComputedStyle(host).overflowY)))host=host.parentElement;
  if(!host||host===document.body)host=document.scrollingElement;
  const top=host.scrollTop;
  last.scrollIntoView({block:'end',behavior:'instant'});
  host.scrollTop=host.scrollHeight;
  host.dispatchEvent(new Event('scroll',{bubbles:true}));
  if(host===document.scrollingElement)window.dispatchEvent(new Event('scroll'));
  for(let n=0;n<16;n++){
   await wait(500);guard();scope(city,keyword);
   const data=snapshot(city),changed=data.cards.some(j=>!known.has(j.url));
   if(changed||data.end)return {...data,changed,scrolled:host.scrollTop!==top};
  }
  return {...snapshot(city),changed:false,scrolled:host.scrollTop!==top};
 }
 async function act(m){
  guard();
  if(m.action==='ping')return {url:location.href,ready:document.readyState!=='loading'&&!!document.body};
  if(m.action==='city'){
   if(current()!==m.city){
    if(!cityOptions(m.city).length){
     let button=null;for(let n=0;n<12;n++){guard();button=cityControl();if(button)break;await wait(500);}
     if(!button)throw Error('城市按钮尚未识别，请刷新BOSS采集页后继续');button.click();await wait(700);
    }
    const choices=cityOptions(m.city);
    if(choices.length!==1)throw Error('城市选项未唯一定位：'+m.city);choices[0].click();
    for(let n=0;n<20;n++){await wait(500);guard();if(current()===m.city&&document.querySelector('.job-card-box'))break;}
   }
   scope(m.city,m.keyword);return {city:current(),url:location.href};
  }
  if(m.action==='list'){
   scope(m.city,m.keyword);return snapshot(m.city);
  }
  if(m.action==='scroll'){
   scope(m.city,m.keyword);return scrollList(m.city,m.keyword);
  }
  if(m.action==='company'){
   for(let i=0;i<12;i++){
    if(m.expectedUrl&&location.origin+location.pathname!==m.expectedUrl)throw Error('公司详情页地址发生变化，尚未保存该页信息');
    guard();const text=document.body?.innerText||'';
    if(/企业名称[：:]|公司全称[：:]/.test(text))return {...P.parseCompany(text),sourceUrl:location.origin+location.pathname};
    await wait(500);
   }throw Error('BOSS工商全称未展示，待核查');
  }
  throw Error('未知页面操作');
 }
 chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(m.channel!=='boss-collector')return;
  act(m).then(data=>reply({ok:true,data}),e=>reply({ok:false,error:e.message}));return true;
 });
})();
