/* Only displayed page text and links; no network requests or hidden API data. */
globalThis.BossPage={
 gate(text,url){
  if(/访问受限|账[号户]存在异常|帐[号户]存在异常|暂时被限制访问|暂时无法访问此页面/.test(text)){
   const time=text.match(/(\d{4}-\d{1,2}-\d{1,2})\s*(\d{1,2}:\d{2})\s*恢复/);
   return '平台限制访问，已停止采集，请勿刷新或重试'+(time?'；恢复时间：'+time[1]+' '+time[2]:'；请按页面提示处理后再继续');
  }
  if(/\/login|\/passport/.test(new URL(url).pathname)||/登录后查看更多|请先登录后/.test(text))return '需要登录，请在原页面登录后再继续';
  if(/安全验证|访问过于频繁|请完成.{0,8}验证|账号存在异常|请求过于频繁/.test(text))return '网页要求验证或限制访问，请手动处理后继续';
  return '';
 },
 parseCompany(text){
  const lines=String(text).split(/\r?\n/).map(v=>v.trim()),labels={name:'企业名称|公司全称',legal:'法定代表人',capital:'注册资本|注册资金',date:'成立时间|成立日期',credit:'统一社会信用代码'};
  const anyLabel=new RegExp('^(?:'+Object.values(labels).join('|')+')[：:]');
  const fields={};for(const [key,names] of Object.entries(labels)){
   fields[key]='';const re=new RegExp('^(?:'+names+')[：:][ \\t]*(.*)$');
   for(let i=0;i<lines.length;i++){
    const match=lines[i].match(re);if(!match)continue;
    let value=match[1].trim();
    if(!value){let n=i+1;while(n<lines.length&&!lines[n])n++;if(n<lines.length&&!anyLabel.test(lines[n]))value=lines[n];}
    if(!anyLabel.test(value)&&!['未展示','—','-','暂无'].includes(value))fields[key]=value;
    break;
   }
  }
  if(!fields.name)throw Error('BOSS工商全称未展示，待核查');
  if(fields.credit&&['未展示','—','-','暂无'].includes(fields.credit))fields.credit='';
  if(fields.credit&&!/^[A-Z0-9]{18}$/.test(fields.credit))throw Error('统一社会信用代码需核查');
  return fields;
 },
 visible(el){return !!el?.getClientRects().length;},
 list(city){
  return [...document.querySelectorAll('.job-card-box')].filter(this.visible).map(e=>{
   const a=e.querySelector('a.job-name'),c=[...e.querySelectorAll('a[href]')].find(n=>n.href.includes('/gongsi/'));
   return {title:a?.innerText.trim()||'',url:a?.href||'',company_url:c?.href||'',location:e.innerText.split('\n').map(t=>t.trim()).find(t=>new RegExp('^'+city+'(?:市)?(?:[·\\s]|$)').test(t))||''};
  }).filter(j=>j.url);
 }
};
