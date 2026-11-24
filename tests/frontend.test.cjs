// Render and export smoke tests. These do not replace a real browser layout check.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function app() {
 const nodes = new Map();
 const handlers = new Map();
 const node = () => ({innerHTML:'',textContent:'',style:{},childNodes:[],isConnected:true,
  append(){},remove(){},focus(){},hasChildNodes(){return !!this.innerHTML;},querySelector(){return null;}});
 for(const id of ['#root','#content','#results','#overlay-root','#toast-root'])nodes.set(id,node());
 const context = vm.createContext({console,Blob,URL,Intl,Date,crypto:require('node:crypto').webcrypto,setTimeout:()=>1,clearTimeout(){},requestAnimationFrame(){},
  fetch:async()=>({ok:true,json:async()=>({initialized:false,authenticated:false,csrf:'',writerPaymentsSupported:true})}),
  document:{querySelector:selector=>nodes.get(selector)||null,addEventListener(type,handler){if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(handler);},createElement:node,body:node(),activeElement:null},
  window:{addEventListener(){}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/business.js'),'utf8'),context);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/files.js'),'utf8'),context);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/ledger.js'),'utf8'),context);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/app.js'),'utf8'),context);
 return {context,nodes,handlers,run:code=>vm.runInContext(code,context)};
}

function seed(run) {
 run(`state.papers=Array.from({length:10},(_,i)=>({
  id:'paper-'+i,code:'LW-2026-'+i,title:i===0?'复杂系统研究 <script>alert(1)</script>':'论文 '+i,
  authors:'作者甲',customer:'客户乙',writer:'写作者丙',journal:'期刊丁',status:i===9?'已发表':'待投稿',
  submissionSystem:'投稿系统',submissionUrl:'https://example.com',submissionAccount:'private-account',
  boundEmail:'private@example.com',boundPhone:'13800000000',hasPassword:true,notes:'=DANGEROUS()',
  submittedAt:today(),followUpAt:today(),contractCents:800010,writerFeeCents:300020,
  receivedCents:200001,paidCents:100002,receivableCents:600009,payableCents:200018,netCents:99999,
  contractReceivedCents:200001,writerPaidCents:100002,otherIncomeCents:0,otherExpenseCents:0,
  customerId:'customer-1',writingStatus:'写作中',writingStartAt:today(),writingDueAt:today(),writingDeliveredAt:'',writingDays:0,writingOverdue:false,
  writerDepositCents:100000,writerBalanceCents:200020,outgoing_depositCents:100002,outgoing_balanceCents:0,
  publishedJournals:[],published:false,activeSubmissionId:'',submissions:[],
  createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),version:1,
  history:[],transactions:[{id:'tx-'+i,type:'incoming_deposit',amountCents:200001,date:today(),
  method:'银行转账',note:'正常备注',createdAt:new Date().toISOString()}]
 }));`);
}

test('anonymous visits start at login and every authenticated view renders',async()=>{
 const {run,nodes}=app();await new Promise(resolve=>setImmediate(resolve));
 assert.match(nodes.get('#root').innerHTML,/登录系统/);
 assert.match(nodes.get('#root').innerHTML,/name="username"/);
 assert.match(nodes.get('#root').innerHTML,/autocomplete="username"/);
 run("state.authMode='register';renderAuth()");assert.match(nodes.get('#root').innerHTML,/注册并创建工作台/);
 run("state.initialized=true;state.authMode='login';renderAuth();");
 assert.match(nodes.get('#root').innerHTML,/name="username"/);
 assert.match(nodes.get('#root').innerHTML,/账号与密码/);
 seed(run);
 for(const view of ['records','customers','papers','submissions','followups','finance','settings']){
  run(`state.view='${view}';state.tab='all';renderShell();`);
  assert.ok(nodes.get('#content').innerHTML.length>1000);
 }
});

test('paper table escapes user text, paginates and queries account information',()=>{
 const {run,nodes}=app();seed(run);run('renderShell()');
 const html=nodes.get('#results').innerHTML;
 assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
 assert.ok(!html.includes('<script>alert(1)</script>'));
 assert.match(html,/共 10 条记录/);assert.match(html,/显示 1–8 条/);
 run('state.page=2;renderPaperResults()');assert.match(nodes.get('#results').innerHTML,/显示 9–10 条/);
 run("state.search='private-account';state.page=1");assert.equal(run('filteredPapers().length'),10);
 run("state.search='找不到的词'");assert.equal(run('filteredPapers().length'),0);
 run("state.search='';state.tab='due'");assert.equal(run('filteredPapers().length'),9);
 run("state.tab='finished'");assert.equal(run('filteredPapers().length'),1);
});

test('financial filters and exports preserve categories and omit credential columns',async()=>{
 const {run}=app();seed(run);run("state.view='finance';state.financeType='incoming'");
 assert.equal(run('filteredTransactions().length'),10);
 run("state.financeType='outgoing'");assert.equal(run('filteredTransactions().length'),0);
 run("state.financeType='all';globalThis.exported=null;download=(name,blob)=>{globalThis.exported={name,blob};};exportFinance();");
 let exported=run('globalThis.exported');let text=await exported.blob.text();
 assert.match(text,/收取定金/);assert.match(text,/2000.01/);assert.ok(!text.includes('private-account'));
 run("state.view='records';exportPapers()");exported=run('globalThis.exported');text=await exported.blob.text();
 for(const secret of ['private-account','private@example.com','13800000000'])assert.ok(!text.includes(secret));
 assert.match(text,/已收定金/);assert.match(text,/已付尾款/);
 assert.ok(text.includes("'=DANGEROUS()"));
});

async function clickAction(handlers,dataset) {
 const button={dataset,disabled:false,isConnected:true};
 await Promise.all(handlers.get('click').map(fn=>fn({target:{closest:()=>button}})));
}

test('finance defaults to per-paper sources even when pending amounts have no actual transactions',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seed(run);
 run(`state.papers=state.papers.slice(0,3).map((p,i)=>({...p,transactions:[],
  contractCents:[2600000,2400000,1600000][i],writerFeeCents:[1800000,1500000,1000000][i],
  receivableCents:[2600000,2400000,1600000][i],payableCents:[1800000,1500000,1000000][i],
  receivedCents:0,paidCents:0,contractReceivedCents:0,writerPaidCents:0,netCents:0}));
  state.financeType='incoming';state.search='隐藏记录';state.from='2026-01-01';state.page=4;`);
 await clickAction(handlers,{action:'navigate',view:'finance'});
 assert.equal(run('state.financeType'),'balances');
 assert.equal(run('allTransactions().length'),0);
 const content=nodes.get('#content').innerHTML,html=nodes.get('#results').innerHTML;
 for(const amount of ['66,000.00','43,000.00']){
  assert.ok(content.includes(amount));assert.ok(html.includes(amount));
 }
 for(const amount of ['26,000.00','24,000.00','16,000.00','18,000.00','15,000.00','10,000.00'])assert.ok(html.includes(amount));
 assert.match(html,/已收 ¥0.00/);assert.match(html,/已付 ¥0.00/);
 assert.match(html,/data-action="detail-finance" data-id="paper-0"/);
 assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
 assert.ok(!html.includes('还没有收支流水'));
 assert.ok(!content.includes('id="from-filter"'));
 assert.match(content,/导出应收应付/);
 assert.match(content,/费用约定不会自动生成实际流水/);
 await clickAction(handlers,{action:'finance-tab',type:'all'});
 assert.match(nodes.get('#results').innerHTML,/实际收付款需进入论文详情逐笔登记/);
 assert.match(nodes.get('#results').innerHTML,/data-type="balances"/);
 run("api=async(url)=>url==='/api/papers'?state.papers:state.customers");
 await run("finishSave(state.papers[0],'保存成功')");
 assert.equal(run('state.financeType'),'balances');
 assert.match(nodes.get('#results').innerHTML,/class="finance-balances"/);
});

test('finance summary links clear filters and show the actual payments behind each total',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seed(run);
 run(`state.view='finance';state.papers=state.papers.slice(0,1);
  state.papers[0].transactions.push({id:'expense',type:'outgoing_other',amountCents:30004,
   date:'2026-01-01',createdAt:'2026-01-01T12:00:00Z',method:'微信',note:'期刊费用'});
  Object.assign(state.papers[0],{paidCents:30004,otherExpenseCents:30004,netCents:169997});
  state.search='隐藏记录';state.from='2999-01-01';state.to='2999-12-31';state.page=5;`);
 await clickAction(handlers,{action:'finance-source',type:'outgoing'});
 assert.equal(run('state.search'),'');assert.equal(run('state.from'),'');assert.equal(run('state.to'),'');
 assert.equal(run('state.page'),1);assert.equal(run('state.financeType'),'outgoing');
 assert.match(nodes.get('#results').innerHTML,/期刊费用/);
 assert.match(nodes.get('#results').innerHTML,/−¥300.04/);
 assert.ok(!nodes.get('#results').innerHTML.includes('收取定金'));
 assert.match(nodes.get('#content').innerHTML,/id="from-filter"/);
 await clickAction(handlers,{action:'finance-source',type:'incoming'});
 assert.match(nodes.get('#results').innerHTML,/\+¥2,000.01/);
 assert.ok(!nodes.get('#results').innerHTML.includes('期刊费用'));
 await clickAction(handlers,{action:'finance-source',type:'all'});
 assert.equal(run('filteredTransactions().length'),2);
 await Promise.all(handlers.get('change').map(fn=>fn({target:{id:'to-filter',value:'2026-01-01'}})));
 assert.equal(run('filteredTransactions().length'),1);
 await clickAction(handlers,{action:'finance-tab',type:'balances'});
 assert.equal(run('state.to'),'');assert.equal(run('state.from'),'');
 assert.match(nodes.get('#results').innerHTML,/class="finance-balances"/);
 run('api=async()=>state.papers[0]');
 await clickAction(handlers,{action:'detail-finance',id:'paper-0'});
 assert.equal(run('state.drawer.tab'),'finance');
 assert.match(nodes.get('#overlay-root').innerHTML,/data-action="add-transaction"[^>]*>[\s\S]*新增<\/button>/);
});

test('balance sources use contract payments, show half service and overpayments, and export current search only',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seed(run);
 run(`state.view='finance';state.papers=state.papers.slice(0,3);
  Object.assign(state.papers[0],{receivedCents:250004,paidCents:130006,netCents:119998,otherIncomeCents:50003,otherExpenseCents:30004});
  Object.assign(state.papers[1],{serviceType:'half',writer:'',writerFeeCents:0,writerPaidCents:0,payableCents:0,paidCents:0,netCents:200001});
  Object.assign(state.papers[2],{contractReceivedCents:900000,writerPaidCents:400000,receivableCents:0,payableCents:0,receivedCents:900000,paidCents:400000,netCents:500000});renderFinance();`);
 const html=nodes.get('#results').innerHTML;
 assert.match(html,/已收 ¥2,000.01/);assert.ok(!html.includes('已收 ¥2,500.04'));
 assert.match(html,/已付 ¥1,000.02/);assert.ok(!html.includes('已付 ¥1,300.06'));
 assert.match(html,/¥6,000.09/);assert.match(html,/¥2,000.18/);
 assert.match(html,/无需写作稿酬/);assert.match(html,/已收超过约定，请核对/);assert.match(html,/已付超过约定，请核对/);
 await Promise.all(handlers.get('input').map(fn=>fn({target:{id:'search',value:' LW-2026-0 '}})));
 assert.equal(run('filteredFinancePapers().length'),1);
 assert.ok(!nodes.get('#results').innerHTML.includes('LW-2026-1'));
 // Global summary cards still include all papers while the table/export use the search.
 assert.match(nodes.get('#content').innerHTML,/¥6,000.03/);
 run('download=(name,blob)=>{globalThis.exported={name,blob};};exportFinance()');
 const exported=run('globalThis.exported'),csv=await exported.blob.text();
 assert.match(exported.name,/^应收应付-/);
 assert.match(csv,/已收定金及尾款（元）/);assert.match(csv,/待付稿酬（元）/);
 assert.match(csv,/"8000.1","2000.01","6000.09","3000.2","1000.02","2000.18"/);
 assert.ok(csv.includes('LW-2026-0'));assert.ok(!csv.includes('LW-2026-1'));
 for(const secret of ['private-account','private@example.com','13800000000'])assert.ok(!csv.includes(secret));
 run("state.search='找不到的词';renderFinanceResults()");assert.match(nodes.get('#results').innerHTML,/没有找到符合条件的记录/);
 await clickAction(handlers,{action:'clear-filters'});assert.equal(run('filteredFinancePapers().length'),3);
 run('state.papers=[];renderFinanceResults()');assert.match(nodes.get('#results').innerHTML,/还没有论文记录/);
});

test('balance sources paginate all papers and sum the whole filtered list',async()=>{
 const {run,nodes}=app();await new Promise(resolve=>setImmediate(resolve));seed(run);
 run("state.view='finance';renderFinance()");
 assert.match(nodes.get('#results').innerHTML,/显示 1–8 条/);
 assert.match(nodes.get('#results').innerHTML,/待收款 ¥60,000.90/);
 assert.ok(!nodes.get('#results').innerHTML.includes('data-id="paper-9"'));
 run('state.page=2;renderFinanceResults()');
 assert.match(nodes.get('#results').innerHTML,/显示 9–10 条/);
 assert.match(nodes.get('#results').innerHTML,/data-id="paper-9"/);
});

test('details mask password and editing does not prefill a saved password',()=>{
 const {run}=app();seed(run);
 assert.match(run('basicDetail(state.papers[0])'),/••••••••••/);
 assert.match(run('basicDetail(state.papers[0])'),/显示/);
 assert.match(run('financeDetail(state.papers[0])'),/6,000.09/);
 run('state.papers[0].receivedCents=250004;state.papers[0].paidCents=130006;state.papers[0].otherIncomeCents=50003;state.papers[0].otherExpenseCents=30004;');
 const detail=run('financeDetail(state.papers[0])');
 assert.ok(detail.includes('<strong>¥2,000.01</strong>'));
 assert.ok(detail.includes('<strong>¥1,000.02</strong>'));
 assert.ok(detail.includes('其他收入：¥500.03'));
 assert.ok(detail.includes('其他支出：¥300.04'));
 assert.equal(run("csvCell('=SUM(A1:A2)')"),'"\'=SUM(A1:A2)"');
 assert.equal(run("csvCell('普通文字')"),'"普通文字"');
});

function seedBusiness(run) {
 seed(run);
 run(`state.customers=[{id:'customer-1',name:'客户乙',phone:'13800000003',email:'customer-private@example.com',wechat:'client-wx',organization:'研究所',address:'',notes:'',status:'合作中',version:1,paperCount:10,publishedPaperCount:1,publishedJournals:['已发表期刊'],contractCents:8000100,receivedCents:2000010,receivableCents:6000090}];
 for(const p of state.papers)p.submissions=[{id:'submission-'+p.id,title:'投稿题目 '+p.title,journal:'投稿期刊',status:'审稿中',submittedAt:today(),endedAt:'',publishedAt:'',durationDays:45,hasPassword:true,submissionAccount:'private-account',submissionSystem:'期刊系统',boundEmail:'private@example.com',boundPhone:'13800000000',submissionUrl:'https://example.com',notes:'',version:1,createdAt:p.createdAt,updatedAt:p.updatedAt}];
 state.papers[0].submissions[0].status='已发表';state.papers[0].submissions[0].publishedAt=today();`);
}

test('closing a full or half paper editor returns directly to the list without saving or terminating service',async()=>{
 for(const serviceType of ['full','half'])for(const origin of ['list','detail']){
  const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
  run(`state.view='papers';state.papers[0].serviceType='${serviceType}';renderShell();
   globalThis.originalPapers=JSON.stringify(state.papers);globalThis.calls=[];
   api=async(url,options={})=>{calls.push({url,...options});return state.papers[0];};`);
  if(origin==='detail')run("state.drawer={kind:'detail',paper:state.papers[0],tab:'basic'};renderDetail()");
  const list=nodes.get('#results').innerHTML;
  await clickAction(handlers,origin==='list'?{action:'edit-paper',id:'paper-0'}:{action:'edit-paper'});
  assert.equal(run('state.drawer.kind'),'edit');
  const html=nodes.get('#overlay-root').innerHTML;
  assert.match(html,/<footer[\s\S]*data-action="close"[^>]*>关闭<\/button>/);
  await clickAction(handlers,{action:'close'});
  assert.equal(nodes.get('#overlay-root').innerHTML,'');assert.equal(run('state.drawer'),null);
  assert.equal(run('state.modal'),null);assert.equal(run('document.body.style.overflow'),'');
  assert.equal(nodes.get('#results').innerHTML,list);
  assert.equal(run('JSON.stringify(state.papers)'),run('originalPapers'));
  assert.equal(run('calls.filter(call=>call.method).length'),0);
 }
});

test('paper close controls dismiss details and financial forms without triggering termination or saving',async()=>{
 for(const screen of ['basic','submissions','files','finance','history','transaction','publication-fee','termination']){
  const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
  run(`state.terminationSupported=true;state.drawer={kind:'detail',paper:state.papers[0],tab:'basic'};
   globalThis.originalPapers=JSON.stringify(state.papers);globalThis.calls=[];api=async(...args)=>{calls.push(args);};`);
  if(screen==='transaction')run('transactionForm()');
  else if(screen==='publication-fee')run('publicationFeeEditor()');
  else if(screen==='termination')run('openTerminationForm()');
  else run(`state.drawer.tab='${screen}';renderDetail()`);
  const html=nodes.get('#overlay-root').innerHTML;
  assert.match(html,/<header[\s\S]*?data-action="close" aria-label="关闭"/);
  if(['basic','submissions','files','finance','history'].includes(screen)){
   const footer=html.slice(html.lastIndexOf('<footer'));
   assert.match(footer,/data-action="close"[^>]*>关闭<\/button>/);
   assert.ok(!footer.includes('data-action="terminate-service"'));
  }
  await clickAction(handlers,{action:'close'});
  assert.equal(nodes.get('#overlay-root').innerHTML,'');assert.equal(run('state.drawer'),null);
  assert.equal(run('state.modal'),null);assert.equal(run('calls.length'),0);
  assert.equal(run('JSON.stringify(state.papers)'),run('originalPapers'));
 }
});

test('overview includes a future follow-up even when no record is due or within seven days',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`const scheduled=new Date();scheduled.setDate(scheduled.getDate()+20);
  globalThis.futureDate=scheduled.getFullYear()+'-'+String(scheduled.getMonth()+1).padStart(2,'0')+'-'+String(scheduled.getDate()).padStart(2,'0');
  state.papers=[{...state.papers[0],title:'未来跟进记录',followUpAt:futureDate,status:'待投稿'}];state.view='records';renderShell();`);
 const overview=nodes.get('#content').innerHTML;
 assert.match(overview,/近期需关注 <small>1 项/);assert.match(overview,/reminder-title[^>]*>未来跟进记录/);
 assert.ok(overview.includes(run("dateLabel(futureDate)+' 跟进'")));assert.ok(!overview.includes('暂无跟进计划'));
 assert.ok(!nodes.get('#root').innerHTML.includes('class="nav-count"'));
 assert.equal(run('state.papers.filter(due).length'),0);assert.equal(run('upcoming().length'),0);
 await clickAction(handlers,{action:'navigate',view:'followups'});
 assert.equal(run('filteredPapers().length'),1);assert.match(nodes.get('#results').innerHTML,/未来跟进记录/);
 assert.match(nodes.get('#content').innerHTML,/全部计划<span class="count">1/);
 await clickAction(handlers,{action:'tab',tab:'due'});
 assert.equal(run('filteredPapers().length'),0);
});

test('overview and follow-up tabs share dates, exclusions and nearest-plan ordering',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`globalThis.offsetDate=days=>{const date=new Date();date.setDate(date.getDate()+days);return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');};
  state.papers=state.papers.slice(0,8).map((p,i)=>({...p,title:'跟进记录-'+i,status:'待投稿',followUpAt:[offsetDate(8),offsetDate(-2),today(),offsetDate(1),offsetDate(7),today(),today(),''][i]}));
  state.papers[5].status='已发表';state.papers[6].status='已撤稿';state.view='records';renderShell();`);
 const overview=run('overviewPanels()');
 assert.match(overview,/近期需关注 <small>5 项/);assert.equal((overview.match(/class="reminder-title|paper-title reminder-title/g)||[]).length,3);
 const ids=[...overview.matchAll(/class="paper-title reminder-title" data-action="detail" data-id="([^"]+)"/g)].map(match=>match[1]);
 assert.deepEqual(ids,['paper-1','paper-2','paper-3']);assert.match(overview,/已逾期/);assert.match(overview,/今天跟进/);
 for(const title of ['跟进记录-5','跟进记录-6','跟进记录-7'])assert.ok(!overview.includes(title));
 run("state.search='干扰筛选';state.status='已发表';state.from='2999-01-01';state.page=3;");
 await clickAction(handlers,{action:'navigate',view:'followups'});
 assert.equal(run('filteredPapers().length'),5);assert.equal(run('state.tab'),'all');assert.equal(run('state.search'),'');
 const summary=run('followUpStats()');
 for(const [label,count] of [['全部计划',5],['已逾期',1],['今天跟进',1],['未来 7 天',2]])assert.match(summary,new RegExp('class="stat-label">'+label+'[\\s\\S]*?class="stat-value ">'+count+'<span'));
 for(const label of ['论文总数','累计已收款','累计已付款'])assert.ok(!summary.includes(label));
 assert.ok(!nodes.get('#root').innerHTML.includes('class="nav-count"'));
 assert.equal(run("filteredPapers().map(p=>p.id).join(',')"),'paper-1,paper-2,paper-3,paper-4,paper-0');
 await clickAction(handlers,{action:'tab',tab:'due'});assert.equal(run('filteredPapers().length'),2);
 await clickAction(handlers,{action:'tab',tab:'upcoming'});assert.equal(run('filteredPapers().length'),2);
 assert.ok(!nodes.get('#results').innerHTML.includes('data-id="paper-0"'));
 run("api=async()=>state.papers[3]");await clickAction(handlers,{action:'detail',id:'paper-3'});
 assert.equal(run('state.drawer.paper.id'),'paper-3');
});

test('refreshing changed follow-up dates keeps the overview count and list synchronized',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run("state.papers=[{...state.papers[0],followUpAt:'',status:'待投稿'}];state.view='records';renderShell();globalThis.serverPapers=state.papers;api=async(url)=>url==='/api/papers'?serverPapers:state.customers;");
 assert.match(run('overviewPanels()'),/暂无跟进计划/);
 run("serverPapers=[{...serverPapers[0],followUpAt:today()}]");await run('loadPapers()');
 assert.match(run('overviewPanels()'),/近期需关注 <small>1 项/);assert.match(run('overviewPanels()'),/今天跟进/);
 await clickAction(handlers,{action:'navigate',view:'followups'});assert.equal(run('filteredPapers().length'),1);
 run("serverPapers=[{...serverPapers[0],followUpAt:''}]");await run('loadPapers()');
 assert.equal(run('filteredPapers().length'),0);assert.match(nodes.get('#results').innerHTML,/暂无跟进计划/);
 await clickAction(handlers,{action:'navigate',view:'records'});assert.match(run('overviewPanels()'),/近期需关注 <small>0 项/);
});

test('all query tables number the filtered result continuously across pages',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`state.customers=Array.from({length:10},(_,i)=>({...state.customers[0],id:'customer-'+i,name:'客户 '+i}));`);
 const numbers=()=>[...nodes.get('#results').innerHTML.matchAll(/<td class="sequence-cell">(\d+)<\/td>/g)].map(match=>Number(match[1]));
 for(const [view,financeType] of [['records','balances'],['papers','balances'],['customers','balances'],['submissions','balances'],['followups','balances'],['finance','balances'],['finance','all'],['finance','incoming']]){
  run(`state.view='${view}';state.financeType='${financeType}';state.tab='all';resetFilters();renderShell()`);
  const count=run(view==='followups'?'filteredPapers().length':'10');
  assert.match(nodes.get('#results').innerHTML,/<th class="sequence-cell" scope="col">序号<\/th>/);
  assert.deepEqual(numbers(),[1,2,3,4,5,6,7,8],view+' '+financeType);
  await clickAction(handlers,{action:'page',page:'2'});
  assert.deepEqual(numbers(),Array.from({length:count-8},(_,i)=>9+i),view+' second page');
  await Promise.all(handlers.get('input').map(fn=>fn({target:{id:'search',value:view==='customers'?'客户 0':'LW-2026-0'}})));
  assert.equal(run('state.page'),1);assert.deepEqual(numbers(),[1],view+' filtered result');
  await Promise.all(handlers.get('input').map(fn=>fn({target:{id:'search',value:'不存在的结果'}})));
  assert.deepEqual(numbers(),[],view+' empty result');
 }
 run("state.papers[0].transactions[0].type='outgoing_other';state.view='finance';state.financeType='outgoing';resetFilters();renderShell()");
 assert.deepEqual(numbers(),[1]);
});

test('all CSV exports include filtered row numbers without replacing existing identifiers',async()=>{
 const {run}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run("download=(name,blob)=>{globalThis.exported={name,blob};};state.page=2;");
 for(const [setup,exporter,id] of [
  ["state.view='records'",'exportPapers','LW-2026-0'],
  ["state.view='papers'",'exportManagedPapers','LW-2026-0'],
  ["state.view='submissions'",'exportSubmissions','LW-2026-0'],
  ["state.view='customers'",'exportCustomers','客户乙'],
  ["state.view='finance';state.financeType='balances'",'exportFinance','LW-2026-0'],
  ["state.view='finance';state.financeType='all'",'exportFinance','LW-2026-0'],
 ]){
  run(`state.search='';${setup};${exporter}()`);
  let csv=await run('exported.blob').text();
  let rows=csv.trim().replace(/^\uFEFF/,'').split('\r\n');
  assert.match(rows[0],/^"序号",/);
  assert.ok(csv.includes(id),exporter+' retains identifying columns');
  rows.slice(1).forEach((row,index)=>assert.ok(row.startsWith('"'+(index+1)+'",'),exporter+' sequence'));
  run(`state.search='${id}';${exporter}()`);
  csv=await run('exported.blob').text();rows=csv.trim().replace(/^\uFEFF/,'').split('\r\n');
  assert.equal(rows.length,2,exporter+' filtered export');assert.match(rows[1],/^"1",/);
 }
});

test('action labels stay concise while full, half and related record actions remain available',async()=>{
 const {run,nodes}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);run('state.papers.forEach(p=>p.transactions=[])');
 const labels=html=>[...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(match=>({
  action:match[1].match(/data-action="([^"]+)"/)?.[1],text:match[2].replace(/<[^>]*>/g,'').trim()
 }));
 const label=(html,action)=>labels(html).filter(button=>button.action===action).map(button=>button.text);
 run("state.view='papers';renderShell()");
 assert.deepEqual(label(nodes.get('#content').innerHTML,'new-paper'),['新增（半包）']);
 assert.deepEqual(label(nodes.get('#content').innerHTML,'new-writing'),['新增（全包）']);
 for(const [action,text] of [['edit-paper','编辑'],['delete-paper','删除'],['detail-finance','收支'],['resubmit-paper','改投']]){
  const values=label(nodes.get('#results').innerHTML,action);assert.equal(values.length,8);assert.ok(values.every(value=>value===text));
 }
 run("state.papers[0].submissions=[];renderManagedPaperResults()");
 assert.ok(label(nodes.get('#results').innerHTML,'new-submission').includes('关联期刊'));
 run("state.view='customers';renderShell()");
 assert.deepEqual(label(nodes.get('#content').innerHTML,'new-customer'),['新增']);
 assert.deepEqual(label(nodes.get('#results').innerHTML,'customer-detail'),['客户乙','详情']);
 run("state.drawer={kind:'customer-detail',customer:{...state.customers[0],paperCount:0,papers:[]}};renderCustomerDetail()");
 assert.deepEqual(label(nodes.get('#overlay-root').innerHTML,'edit-customer'),['编辑']);
 assert.deepEqual(label(nodes.get('#overlay-root').innerHTML,'delete-customer'),['删除']);
 run("state.view='submissions';resetFilters();renderShell()");
 assert.deepEqual(label(nodes.get('#content').innerHTML,'new-submission'),['新增']);
 for(const [action,text] of [['edit-submission','编辑'],['delete-submission','删除'],['resubmit-paper','改投'],['submission-detail','详情']]){
  assert.ok(label(nodes.get('#results').innerHTML,action).includes(text));
 }
 for(const command of ['openEditor()','openWritingEditor()','openCustomerEditor()','openSubmissionEditor()']){
  run(command);assert.match(nodes.get('#overlay-root').innerHTML,/type="submit">[\s\S]*保存<\/button>/);
 }
});

test('business filters keep writing tasks and multiple submissions linked by identity',()=>{
 const {run,nodes}=app();seedBusiness(run);
 run("state.view='papers';state.tab='active';renderShell()");
 assert.match(nodes.get('#results').innerHTML,/定金/);
 assert.equal(run('filteredManagedPapers().length'),10);
 run("state.customerId='missing'");assert.equal(run('filteredManagedPapers().length'),0);
 run("state.customerId='customer-1';state.view='submissions';state.tab='long';renderShell()");
 assert.equal(run('filteredSubmissions().length'),9);
 assert.match(nodes.get('#results').innerHTML,/45 天/);
 run("state.search='private@example.com'");assert.equal(run('filteredSubmissions().length'),9);
 run("state.view='customers';state.status='';state.search='client-wx';renderShell()");
 assert.equal(run('filteredCustomers().length'),1);
 assert.match(nodes.get('#results').innerHTML,/已发表期刊/);
});

test('customer types have visible counts and combine category, status and referrer searches',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`state.customers=['同行','终端客户（自主开发）','他人介绍',''].map((customerType,i)=>({...state.customers[0],
  id:'type-'+i,name:'分类客户'+i,customerType,referrer:i===2?'介绍人甲':'',status:i===2?'已归档':'合作中'}));
  state.view='customers';state.tab='all';renderShell();`);
 const content=nodes.get('#content').innerHTML,rows=nodes.get('#results').innerHTML;
 for(const label of ['同行','终端客户（自主开发）','他人推荐','未分类']){
  assert.ok(content.includes(label));assert.ok(rows.includes(label));
 }
 for(const [tab,index] of [['同行',0],['终端客户（自主开发）',1],['他人介绍',2],['unclassified',3]]){
  run('state.page=9');await clickAction(handlers,{action:'tab',tab});
  assert.equal(run('state.page'),1);assert.equal(run('filteredCustomers().length'),1);
  assert.equal(run('filteredCustomers()[0].id'),'type-'+index);
  assert.match(nodes.get('#results').innerHTML,new RegExp('分类客户'+index));
 }
 run("state.tab='他人介绍';state.status='已归档';state.search='介绍人甲';renderContent()");
 assert.equal(run('filteredCustomers().length'),1);
 run("state.status='合作中'");assert.equal(run('filteredCustomers().length'),0);
 run("state.tab='all';state.status='';state.search='终端客户'");assert.equal(run('filteredCustomers()[0].id'),'type-1');
 assert.match(run("customerOptions('type-0')"),/分类客户0 · 同行/);
});

test('customer forms require an explicit type and preserve classification and referrer on submit',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run('openCustomerEditor()');
 let html=nodes.get('#overlay-root').innerHTML;
 assert.match(html,/name="customerType"[^>]*required/);
 assert.match(html,/<option value="" selected>请选择客户类型<\/option>/);
 for(const label of ['同行','终端客户（自主开发）','他人介绍'])assert.ok(html.includes(`value="${label}"`));
 run("Object.assign(state.customers[0],{customerType:'他人介绍',referrer:'介绍人 <script>bad()</script>'});openCustomerEditor(state.customers[0]);");
 html=nodes.get('#overlay-root').innerHTML;assert.match(html,/value="他人介绍" selected>他人推荐<\/option>/);
 assert.match(html,/介绍人 &lt;script&gt;bad\(\)&lt;\/script&gt;/);assert.ok(!html.includes('<script>bad()'));
 run("state.drawer={kind:'customer-detail',customer:{...state.customers[0],papers:[]}};renderCustomerDetail()");
 html=nodes.get('#overlay-root').innerHTML;assert.match(html,/客户类型/);assert.match(html,/他人推荐/);
 assert.match(html,/介绍人 &lt;script&gt;bad\(\)&lt;\/script&gt;/);
 run("openCustomerEditor();globalThis.typeCalls=[];api=async(url,options)=>{typeCalls.push({url,options});return state.customers[0];};finishSave=async()=>{};");
 const fixture=validationForm(run,'customer-form',[
  {name:'name',label:'客户姓名',required:true,value:'新客户'},
  {name:'customerType',label:'客户类型',tagName:'SELECT',required:true,value:''},
  {name:'referrer',label:'介绍人',value:'介绍人乙'},
 ]);
 await Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));
 assert.equal(run('typeCalls.length'),0);assert.match(fixture.controls.customerType.inlineError.textContent,/请选择客户类型/);
 fixture.controls.customerType.value='他人介绍';
 await Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));
 const sent=JSON.parse(run('typeCalls[0].options.body'));
 assert.equal(sent.customerType,'他人介绍');assert.equal(sent.referrer,'介绍人乙');
});

test('customer exports include type and referrer and follow the selected category',async()=>{
 const {run}=app();seedBusiness(run);
 run(`state.customers=['同行','终端客户（自主开发）','他人介绍',''].map((customerType,i)=>({...state.customers[0],
  id:'type-'+i,name:'导出客户'+i,customerType,referrer:i===2?'介绍人丙':''}));
  state.tab='他人介绍';download=(name,blob)=>{globalThis.typeExport={name,blob};};exportCustomers();`);
 let csv=await run('typeExport.blob').text();
 for(const text of ['客户类型','介绍人','他人推荐','介绍人丙','导出客户2'])assert.ok(csv.includes(text));
 for(const text of ['导出客户0','导出客户1','导出客户3','13800000003','customer-private@example.com'])assert.ok(!csv.includes(text));
 run("state.tab='unclassified';exportCustomers()");csv=await run('typeExport.blob').text();
 assert.ok(csv.includes('未分类'));assert.ok(csv.includes('导出客户3'));assert.ok(!csv.includes('导出客户2'));
});

test('all business editors and relationship detail cards render without saved passwords',()=>{
 const {run,nodes}=app();seedBusiness(run);
 run('openWritingEditor(state.papers[0])');
 assert.match(nodes.get('#overlay-root').innerHTML,/name="customerId"/);
 assert.match(nodes.get('#overlay-root').innerHTML,/name="writingStartAt"/);
 assert.match(nodes.get('#overlay-root').innerHTML,/name="writerDepositAmount"/);
 assert.ok(!nodes.get('#overlay-root').innerHTML.includes('name="submissionPassword"'));
 run('openSubmissionEditor(state.papers[0],state.papers[0].submissions[0])');
 assert.match(nodes.get('#overlay-root').innerHTML,/留空保留原密码/);
 assert.match(nodes.get('#overlay-root').innerHTML,/name="endedAt"/);
 assert.match(nodes.get('#overlay-root').innerHTML,/name="publishedAt"/);
 run('openCustomerEditor(state.customers[0])');
 assert.match(nodes.get('#overlay-root').innerHTML,/name="organization"/);
 const cards=run('submissionCards(state.papers[0])');assert.match(cards,/••••••••••/);
 run("state.drawer={kind:'customer-detail',customerTab:'papers',customer:{...state.customers[0],papers:state.papers}};renderCustomerDetail()");
 assert.match(nodes.get('#overlay-root').innerHTML,/关联论文与发表成果/);
 assert.match(nodes.get('#overlay-root').innerHTML,/customer-publication/);
});

test('business CSV exports omit account passwords and private contact information',async()=>{
 const {run}=app();seedBusiness(run);
 run("download=(name,blob)=>{globalThis.exported={name,blob};};state.tab='all';exportSubmissions()");
 let text=await run('globalThis.exported.blob').text();
 for(const secret of ['private-account','private@example.com','13800000000'])assert.ok(!text.includes(secret));
 assert.match(text,/投稿时长/);assert.match(text,/投稿题目/);
 run('exportManagedPapers()');text=await run('globalThis.exported.blob').text();assert.match(text,/收款定金/);assert.match(text,/写作定金/);assert.match(text,/已付尾款/);
 run('exportCustomers()');text=await run('globalThis.exported.blob').text();
 assert.ok(!text.includes('customer-private@example.com'));assert.ok(!text.includes('13800000003'));assert.match(text,/已发表期刊/);
});

test('an unresolved edit target never opens a new submission form',async()=>{
 for(const dataset of [
  {action:'edit-submission',paperId:'paper-0',id:'missing'},
  {action:'edit-submission',paperId:'paper-0'},
  {action:'edit-submission',id:'submission-paper-0'}
 ]){
  const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
  run('globalThis.messages=[];toast=message=>messages.push(message);api=async()=>state.papers[0]');
  await clickAction(handlers,dataset);
  assert.equal(run('state.drawer'),null);
  assert.equal(nodes.get('#overlay-root').innerHTML,'');
  assert.match(run('messages.at(-1)'),/投稿记录.*刷新/);
 }
});

test('late submission loads cannot replace a newer editor or reopen a closed drawer',async()=>{
 for(const next of ['edit','create','close']){
  const {run,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
  run(`globalThis.pending=[];api=url=>new Promise(resolve=>pending.push(resolve));
   state.drawer={kind:'detail',paper:state.papers[0],tab:'submissions'};`);
  const first=clickAction(handlers,{action:'edit-submission',paperId:'paper-0',id:'submission-paper-0'});
  if(next==='edit'){
   const second=clickAction(handlers,{action:'edit-submission',paperId:'paper-1',id:'submission-paper-1'});
   run('pending[1](state.papers[1])');await second;
  }else if(next==='create')run('openSubmissionEditor()');
  else run('closeOverlay()');
  const expected=run('state.drawer');
  run('pending[0](state.papers[0])');await first;
  assert.equal(run('state.drawer'),expected,next);
 }
});

test('late paper and customer loads cannot reopen closed drawers or replace newer screens',async()=>{
 for(const action of ['detail','edit-paper','writer-payment','customer-detail','delete-paper'])for(const next of ['close','new','other']){
  const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
  run("globalThis.pending=[];api=url=>new Promise(resolve=>pending.push(resolve));state.view='papers';");
  const loading=clickAction(handlers,{action,id:action==='customer-detail'?'customer-1':'paper-0',type:'outgoing_deposit'});
  if(next==='close')run('closeOverlay()');
  else if(next==='new')run('openEditor()');
  else {
   const newer=clickAction(handlers,{action:'detail',id:'paper-1'});
   run('pending[1](state.papers[1])');await newer;
  }
  const expected=run('state.drawer'),overlay=nodes.get('#overlay-root').innerHTML;
  run(action==='customer-detail'?'pending[0](state.customers[0])':'pending[0](state.papers[0])');await loading;
  assert.equal(run('state.drawer'),expected,action+' '+next);
  assert.equal(nodes.get('#overlay-root').innerHTML,overlay,action+' '+next);
 }
});

test('list refreshes discard older responses and never restore data after logout',async()=>{
 for(const next of ['newer','logout']){
  const {run}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
  run("state.authenticated=true;state.csrf='session-a';globalThis.pending=[];api=url=>new Promise(resolve=>pending.push({url,resolve}));globalThis.oldLoad=loadPapers();");
  if(next==='newer'){
   run("globalThis.newLoad=loadPapers();pending[2].resolve([{...state.papers[0],title:'较新的数据'}]);pending[3].resolve(state.customers);");
   await run('newLoad');
  }else run("state.authenticated=false;state.csrf='';state.papers=[];state.customers=[];");
  run("pending[0].resolve([{id:'obsolete',title:'过期数据'}]);pending[1].resolve([]);");await run('oldLoad');
  if(next==='newer')assert.equal(run('state.papers[0].title'),'较新的数据');
  else {assert.equal(run('state.papers.length'),0);assert.equal(run('state.customers.length'),0);}
 }
});

test('late save responses update records without closing a newer editor or resetting its navigation',async()=>{
 for(const kind of ['paper','customer','submission','transaction','termination','publication-fee']){
  const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
  run(`state.authenticated=true;state.csrf='session-a';state.view='papers';state.terminationSupported=true;
   globalThis.resolveSave=null;api=async(url,options={})=>options.method?new Promise(resolve=>resolveSave=resolve):url==='/api/customers'?state.customers:state.papers;
   globalThis.savedPaper={...state.papers[0],title:'后台已保存',version:2};`);
  if(kind==='paper')run('openEditor(state.papers[0])');
  else if(kind==='customer')run('openCustomerEditor(state.customers[0])');
  else if(kind==='submission')run('openSubmissionEditor(state.papers[0],state.papers[0].submissions[0])');
  else run("state.drawer={kind:'detail',paper:state.papers[0],tab:'finance'};"+(kind==='transaction'?'transactionForm()':kind==='termination'?'openTerminationForm()':'publicationFeeEditor()'));
  const id=kind==='publication-fee'?'publication-fee-form':kind+'-form';
  formValues(run,{title:'后台已保存',journal:'期刊丁',status:'待投稿',amount:'1.00',type:'incoming_balance',date:run('today()'),customerSettlement:'0',writerSettlement:'0',confirmTermination:'yes',publicationFeeMode:'free'});
  const fixture=formEvent(id),saving=Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));
  assert.equal(run('typeof resolveSave'),'function',kind);
  await clickAction(handlers,{action:'close'});run("state.view='papers';state.search='保留筛选';openEditor(state.papers[1]);");
  const drawer=run('state.drawer'),overlay=nodes.get('#overlay-root').innerHTML;
  run(kind==='customer'?"resolveSave({...state.customers[0],name:'后台已保存',version:2})":'resolveSave(savedPaper)');await saving;
  assert.equal(run('state.drawer'),drawer,kind);assert.equal(run('state.drawer.paper.id'),'paper-1',kind);
  assert.equal(nodes.get('#overlay-root').innerHTML,overlay,kind);assert.equal(run('state.view'),'papers',kind);
  assert.equal(run('state.search'),'保留筛选',kind);assert.equal(fixture.error.textContent,'',kind);
  assert.equal(run(kind==='customer'?'state.customers[0].name':'state.papers.find(p=>p.id==="paper-0").title'),'后台已保存',kind);
 }
});

test('an expired response from a previous login does not log out the current account',async()=>{
 const {run}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`state.authenticated=true;state.csrf='session-a';globalThis.resolveFetch=null;
  fetch=()=>new Promise(resolve=>resolveFetch=resolve);globalThis.oldRequest=api('/api/papers').catch(error=>error.message);
  state.csrf='session-b';resolveFetch({ok:false,status:401,json:async()=>({error:'旧登录已失效'})});`);
 assert.equal(await run('oldRequest'),'旧登录已失效');assert.equal(run('state.authenticated'),true);
 assert.equal(run('state.csrf'),'session-b');assert.equal(run('state.papers.length'),10);
});

test('late deletion responses preserve a newer editor after confirmation',async()=>{
 for(const action of ['delete-paper','delete-submission','delete-customer']){
  const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
  run(`state.authenticated=true;state.csrf='session-a';state.view='papers';globalThis.resolveDelete=null;
   state.drawer=${action==='delete-customer'?"{kind:'customer-detail',customer:state.customers[0]}":"{kind:'detail',paper:state.papers[0],tab:'finance'}"};
   api=async(url,options={})=>options.method?new Promise(resolve=>resolveDelete=resolve):url==='/api/papers'?state.papers:url==='/api/customers'?state.customers:state.papers[0];`);
  await clickAction(handlers,{action,id:action==='delete-transaction'?'tx-0':action==='delete-submission'?'submission-paper-0':'paper-0',paperId:'paper-0'});
  const deleting=clickAction(handlers,{action:'confirm-modal'});assert.equal(run('typeof resolveDelete'),'function',action);
  run('closeOverlay();openEditor(state.papers[1]);');const drawer=run('state.drawer'),overlay=nodes.get('#overlay-root').innerHTML;
  run('resolveDelete({...state.papers[0],transactions:[],submissions:[],activeSubmissionId:"",version:2})');await deleting;
  assert.equal(run('state.drawer'),drawer,action);assert.equal(nodes.get('#overlay-root').innerHTML,overlay,action);
  assert.equal(run('state.drawer.paper.id'),'paper-1',action);
 }
});

test('a list refresh started before confirmed fee changes cannot roll back the saved result',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`state.authenticated=true;state.csrf='session-a';globalThis.pending=[];
  api=async(url,options={})=>options.method?{...state.papers[0],title:'已确认的费用',publicationFeeMode:'free',version:2}:new Promise(resolve=>pending.push(resolve));
  globalThis.oldLoad=loadPapers();state.drawer={kind:'detail',paper:state.papers[0],tab:'finance'};publicationFeeEditor();`);
 formValues(run,{publicationFeeMode:'free'});const fixture=formEvent('publication-fee-form');
 await Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));
 run("pending[0]([{...state.papers[0],title:'过期的费用'}]);pending[1](state.customers)");await run('oldLoad');
 assert.equal(run('state.papers[0].title'),'已确认的费用');assert.equal(run('state.drawer.paper.title'),'已确认的费用');
 assert.match(nodes.get('#overlay-root').innerHTML,/已确认的费用/);
});

test('late manuscript upload responses respect the current editor and login',async()=>{
 for(const next of ['editor','logout']){
  const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
  run(`state.authenticated=true;state.csrf='session-a';state.drawer={kind:'detail',paper:state.papers[0],tab:'files'};
   globalThis.resolveUpload=null;uploadManuscript=()=>new Promise(resolve=>resolveUpload=resolve);
   globalThis.savedPaper={...state.papers[0],title:'已上传稿件',version:2};`);
  const fixture=formEvent('file-form'),query=fixture.event.target.querySelector;
  fixture.event.target.querySelector=selector=>selector==='#manuscript-file'?{files:[{name:'稿件.pdf',size:10}]}:query(selector);
  const uploading=Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));
  run('closeOverlay()');
  if(next==='editor')run('openEditor(state.papers[1])');
  else run("state.authenticated=false;state.csrf='';state.papers=[];state.customers=[];");
  const drawer=run('state.drawer'),html=nodes.get('#overlay-root').innerHTML;
  run('resolveUpload(savedPaper)');await uploading;
  assert.equal(run('state.drawer'),drawer);assert.equal(nodes.get('#overlay-root').innerHTML,html);
  if(next==='editor')assert.equal(run('state.papers[0].title'),'已上传稿件');
  else assert.equal(run('state.papers.length'),0);
 }
});

test('editing current or historical submissions uses PUT and retains every submission identity',async()=>{
 for(const serviceType of ['full','half'])for(const selected of [0,1]){
  const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
  run(`state.papers=state.papers.slice(0,1);state.papers[0].serviceType='${serviceType}';state.papers[0].version=12;
   state.papers[0].submissions[0].version=4;
   state.papers[0].submissions.push({...state.papers[0].submissions[0],id:'current',journal:'另一期刊',version:2});
   state.papers[0].activeSubmissionId='current';globalThis.before=JSON.stringify(state.papers[0]);globalThis.requests=[];
   api=async(url,options={})=>{
    if(options.method){const data=JSON.parse(options.body);requests.push({url,method:options.method,data});
     const p=JSON.parse(before);Object.assign(p.submissions[${selected}],data,{version:data.version+1});p.version++;return p;}
    return url==='/api/papers'?state.papers:url==='/api/customers'?state.customers:state.papers[0];
   };`);
  const id=run(`state.papers[0].submissions[${selected}].id`);
  await clickAction(handlers,{action:'edit-submission',paperId:'paper-0',id});
  assert.match(nodes.get('#overlay-root').innerHTML,/id="drawer-title">编辑投稿/);
  formValues(run,{title:'编辑后的题目',journal:selected?'另一期刊':'投稿期刊',status:'修改中',submittedAt:'2026-01-01',submissionPassword:''});
  const {event,error}=formEvent('submission-form');
  await Promise.all(handlers.get('submit').map(fn=>fn(event)));
  assert.equal(error.textContent,'');assert.equal(run('requests.length'),1);
  assert.equal(run('requests[0].method'),'PUT');assert.equal(run('requests[0].url'),`/api/papers/paper-0/submissions/${id}`);
  assert.equal(run('requests[0].data.version'),selected?2:4);
  assert.equal(run('Object.hasOwn(requests[0].data,"submissionPassword")'),false);
  assert.equal(run('state.papers[0].submissions.length'),2);assert.equal(run('state.papers[0].activeSubmissionId'),'current');
  assert.equal(run(`JSON.stringify(state.papers[0].submissions[${1-selected}])`),run(`JSON.stringify(JSON.parse(before).submissions[${1-selected}])`));
 }
});

test('losing an edit identity fails safely instead of posting a replacement',async()=>{
 const {run,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`globalThis.requests=[];api=async(url,options={})=>{requests.push({url,...options});return state.papers[0];};
  openSubmissionEditor(state.papers[0],state.papers[0].submissions[0]);state.drawer.submission=null;`);
 formValues(run,{title:'修改题目',journal:'投稿期刊'});
 const {event,error,submit}=formEvent('submission-form');
 await Promise.all(handlers.get('submit').map(fn=>fn(event)));
 assert.equal(run('requests.length'),0);assert.match(error.textContent,/投稿记录.*刷新/);
 assert.equal(submit.disabled,false);assert.equal(run('state.drawer.kind'),'submission-edit');
});

test('failed submission edits retain entered data and repeated saves never create a new submission',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`globalThis.requests=[];globalThis.attempt=0;globalThis.failSave=null;
  api=async(url,options={})=>{
   if(options.method){requests.push({url,method:options.method});if(++attempt===1)return new Promise((resolve,reject)=>{failSave=reject;});throw new Error('版本已过期，请刷新');}
   return state.papers[0];
  };openSubmissionEditor(state.papers[0],state.papers[0].submissions[0]);`);
 const before=nodes.get('#overlay-root').innerHTML;
 formValues(run,{title:'未保存的修改题目',journal:'投稿期刊',submissionPassword:''});
 const {event,error,submit}=formEvent('submission-form');
 const saving=Promise.all(handlers.get('submit').map(fn=>fn(event)));
 await Promise.all(handlers.get('submit').map(fn=>fn(event)));
 assert.equal(run('requests.length'),1);
 run("failSave(new Error('网络中断'))");await saving;
 assert.match(error.textContent,/网络中断/);assert.equal(submit.disabled,false);
 assert.equal(nodes.get('#overlay-root').innerHTML,before);assert.equal(run('formValues.title'),'未保存的修改题目');
 await Promise.all(handlers.get('submit').map(fn=>fn(event)));
 assert.match(error.textContent,/版本已过期/);assert.equal(run('requests.length'),2);
 assert.equal(run('requests.every(r=>r.method==="PUT"&&r.url.endsWith("/submission-paper-0"))'),true);
});

test('an old edit form cannot save through a newly opened create drawer',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run('openSubmissionEditor(state.papers[0],state.papers[0].submissions[0]);globalThis.requests=[];api=async()=>{requests.push(true);}');
 const {event,error}=formEvent('submission-form');
 event.target.dataset.editorId=String(run('state.drawer.editorId'));
 assert.ok(nodes.get('#overlay-root').innerHTML.includes(`data-editor-id="${event.target.dataset.editorId}"`));
 formValues(run,{paperId:'paper-0',title:'修改中的题目',journal:'投稿期刊'});
 run('openSubmissionEditor(state.papers[0])');
 await Promise.all(handlers.get('submit').map(fn=>fn(event)));
 assert.equal(run('requests.length'),0);assert.match(error.textContent,/投稿记录.*刷新/);
});

test('resubmitting full and half papers appends a submission and retains the selected source unchanged',async()=>{
 for(const serviceType of ['full','half']){
  const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
  run(`state.view='submissions';state.papers=state.papers.slice(0,1);state.papers[0].serviceType='${serviceType}';state.papers[0].version=7;
   state.papers[0].submissions[0].title='原投稿题目';state.papers[0].submissions[0].version=3;
   state.papers[0].submissions.push({...state.papers[0].submissions[0],id:'latest-submission',title:'另一篇投稿题目',journal:'另一家期刊'});
   state.papers[0].activeSubmissionId='latest-submission';
   globalThis.originalPaper=state.papers[0];globalThis.originalSubmissions=JSON.stringify(originalPaper.submissions);globalThis.savedPaper=null;globalThis.requests=[];
   api=async(url,options={})=>{
    if(options.method){if(options.method!=='POST')throw new Error('改投应新增记录');const data=JSON.parse(options.body);requests.push({url,method:options.method,data});
     const submission={...data,id:'new-submission',version:1,hasPassword:false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),durationDays:null};
     savedPaper={...originalPaper,version:8,activeSubmissionId:submission.id,submissions:[...originalPaper.submissions,submission]};return savedPaper;}
    return url==='/api/papers/paper-0'?originalPaper:url==='/api/papers'?[savedPaper||originalPaper]:state.customers;
   };renderShell();`);
  assert.match(nodes.get('#results').innerHTML,/data-action="resubmit-paper"/);
  await clickAction(handlers,{action:'resubmit-paper',paperId:'paper-0',id:'submission-paper-0'});
  const html=nodes.get('#overlay-root').innerHTML;
  assert.match(html,/id="drawer-title">论文改投<\/h2>/);assert.match(html,/value="paper-0" selected/);
  assert.match(html,/name="title"[^>]*value="原投稿题目"/);
  for(const name of ['journal','submissionAccount','submissionPassword','submittedAt','endedAt','publishedAt'])assert.match(html,new RegExp(`name="${name}"[^>]*value=""`));
  assert.match(html,/<option value="待投稿" selected>/);
  assert.equal(run('state.drawer.submission'),null);assert.equal(run('state.drawer.resubmit'),true);
  formValues(run,{title:'原投稿题目',journal:'改投新期刊',status:'待投稿',submissionAccount:'',submissionPassword:'',submittedAt:'',endedAt:'',publishedAt:''});
  const {event,error}=formEvent('submission-form');
  await Promise.all(handlers.get('submit').map(fn=>fn(event)));
  assert.equal(error.textContent,'');assert.equal(run('requests.length'),1);
  assert.equal(run('requests[0].url'),'/api/papers/paper-0/submissions');assert.equal(run('requests[0].method'),'POST');
  assert.equal(run('requests[0].data.version'),7);
  assert.equal(run('state.papers[0].submissions.length'),3);
  assert.equal(run('JSON.stringify(state.papers[0].submissions.slice(0,2))'),run('originalSubmissions'));
  assert.equal(run('state.papers[0].activeSubmissionId'),'new-submission');
  assert.equal(run('state.drawer'),null);assert.equal(run('state.view'),'submissions');
  assert.match(nodes.get('#results').innerHTML,/改投新期刊/);assert.match(nodes.get('#results').innerHTML,/另一家期刊/);
 }
});

test('resubmission from details selects the current record and cancelling leaves all records intact',async()=>{
 for(const inDetail of [false,true]){
  const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
  run(`state.view='submissions';state.papers=state.papers.slice(0,1);state.papers[0].activeSubmissionId=state.papers[0].submissions[0].id;
   globalThis.originalSubmissions=JSON.stringify(state.papers[0].submissions);globalThis.calls=[];
   api=async(url,options={})=>{calls.push({url,...options});return state.papers[0];};renderShell();`);
  if(inDetail)run("state.drawer={kind:'detail',paper:state.papers[0],tab:'submissions'};renderDetail()");
  await clickAction(handlers,{action:'resubmit-paper',paperId:'paper-0'});
  assert.equal(run('state.drawer.sourceSubmission.id'),'submission-paper-0');
  assert.match(nodes.get('#overlay-root').innerHTML,/type="submit">[\s\S]*保存<\/button>/);
  await clickAction(handlers,{action:'cancel-submission'});
  assert.equal(run('JSON.stringify(state.papers[0].submissions)'),run('originalSubmissions'));
  assert.equal(run('calls.filter(call=>call.method).length'),0);
  if(inDetail)assert.equal(run('state.drawer.kind'),'detail');else assert.equal(run('state.drawer'),null);
 }
});

test('resubmission shows the selected papers complete history without mixing same-title papers or revealing credentials',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`state.papers=state.papers.slice(0,2);state.papers.forEach(p=>p.title='同名论文');state.papers[1].submissions[0].journal='另一篇论文的专属期刊';
  globalThis.first={...state.papers[0].submissions[0],id:'first',journal:'期刊甲',title:'最早的投稿题目',status:'已拒稿',submittedAt:'2026-01-01',endedAt:'2026-01-15',publishedAt:'',durationDays:14,notes:'拒稿原因 <img src=x onerror=alert(1)>'};
  globalThis.freshPaper={...state.papers[0],activeSubmissionId:'latest',submissions:[first,{...first,id:'second',journal:' 期刊甲 ',title:'调整后的投稿题目',status:'已撤稿',submittedAt:'2026-02-01',endedAt:'2026-02-03',notes:''},{...first,id:'latest',journal:'期刊乙',title:'再次修改的题目',status:'审稿中',submittedAt:'2026-03-01',endedAt:'',notes:''}]};
  api=async()=>freshPaper;`);
 await clickAction(handlers,{action:'resubmit-paper',paperId:'paper-0',id:'first'});
 const html=nodes.get('#overlay-root').innerHTML;
 assert.match(html,/这篇论文的投稿历史/);assert.match(html,/2 个期刊 · 3 条记录/);
 assert.match(html,/最早的投稿题目/);assert.match(html,/再次修改的题目/);
 assert.match(html,/2026\.01\.15/);assert.match(html,/2026\.03\.01/);
 assert.match(html,/已拒稿/);assert.match(html,/审稿中/);
 assert.match(html,/本次改投来源/);assert.match(html,/当前记录/);
 assert.match(html,/拒稿原因 &lt;img src=x onerror=alert\(1\)&gt;/);
 assert.ok(!html.includes('另一篇论文的专属期刊'));assert.ok(!html.includes('<img src=x'));
 assert.ok(html.indexOf('这篇论文的投稿历史')<html.indexOf('填写本次改投'));
 const history=run("submissionHistory(state.drawer.paper,'first')");
 for(const secret of ['private-account','private@example.com','13800000000'])assert.ok(!history.includes(secret));
 assert.match(run("submissionHistory({id:'new',code:'NEW',title:'新论文',submissions:[]})"),/暂无投稿历史/);
 assert.match(run("submissionHistory({id:'draft',code:'DRAFT',title:'待投稿论文',submissions:[{id:'draft-sub',journal:'待投期刊',status:'待投稿'}]})"),/尚未投稿/);
});

test('journal history warnings match normalized names, exclude the edited record and update while typing',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`state.papers[0].submissions[0].journal='Nature Communications';state.papers[0].submissions[0].status='已拒稿';
  state.papers[0].submissions.push({...state.papers[0].submissions[0],id:'again',journal:'ＮＡＴＵＲＥ　ＣＯＭＭＵＮＩＣＡＴＩＯＮＳ',status:'待投稿',submittedAt:''});
  openSubmissionEditor(state.papers[0],null,{resubmit:true,source:state.papers[0].submissions[0]});`);
 const notice={innerHTML:''};nodes.set('#journal-history-notice',notice);
 const input=value=>Promise.all(handlers.get('input').map(fn=>fn({target:{id:'f-journal',value}})));
 await input('  nature communications  ');
 assert.match(notice.innerHTML,/<strong>2 条<\/strong>/);assert.match(notice.innerHTML,/已拒稿/);assert.match(notice.innerHTML,/待投稿/);
 assert.match(notice.innerHTML,/请编辑原记录更新进度/);
 await input('不同期刊');assert.equal(notice.innerHTML,'');
 await input('');assert.equal(notice.innerHTML,'');
 run('openSubmissionEditor(state.papers[0],state.papers[0].submissions[0])');
 await input('Nature Communications');assert.match(notice.innerHTML,/<strong>1 条<\/strong>/);
 assert.match(notice.innerHTML,/只更新正在编辑的记录/);
 run("state.papers[0].submissions[1].status='已撤稿';openSubmissionEditor(state.papers[0])");
 await input('Nature Communications');assert.match(notice.innerHTML,/可继续保存新一轮投稿/);
});

test('selecting another paper updates its history and clears stale journal warnings without changing entered text',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run("state.papers=state.papers.slice(0,2);state.papers[0].submissions[0].journal='期刊甲';state.papers[1].submissions[0].journal='期刊乙';openSubmissionEditor()");
 const history={innerHTML:''},notice={innerHTML:''},title={value:'我手工填写的题目',dataset:{}},journal={value:'期刊甲'};
 nodes.set('#submission-history-root',history);nodes.set('#journal-history-notice',notice);
 nodes.get('#overlay-root').querySelector=selector=>selector==='#f-title'?title:selector==='#f-journal'?journal:null;
 const select=value=>Promise.all(handlers.get('change').map(fn=>fn({target:{id:'submission-paper',value}})));
 await select('paper-0');assert.match(history.innerHTML,/期刊甲/);assert.match(notice.innerHTML,/同名期刊记录/);
 await select('paper-1');assert.match(history.innerHTML,/期刊乙/);assert.ok(!history.innerHTML.includes('期刊甲'));
 assert.equal(notice.innerHTML,'');assert.equal(title.value,'我手工填写的题目');
 await select('');assert.match(history.innerHTML,/请选择关联论文/);assert.equal(notice.innerHTML,'');
});

test('paper creation is confined to paper management and unrelated empty views offer contextual navigation',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 for(const view of ['records','customers','submissions','followups','finance','settings']){
  run(`state.view='${view}';state.tab='all';renderShell()`);
  for(const id of ['#content','#results'])assert.ok(!/data-action="new-(?:paper|writing)"/.test(nodes.get(id).innerHTML),view);
 }
 run("state.papers=[];state.customers=[];state.view='followups';renderShell()");
 assert.match(nodes.get('#results').innerHTML,/暂无跟进计划/);
 assert.ok(!/data-action="new-(?:paper|writing)"/.test(nodes.get('#content').innerHTML+nodes.get('#results').innerHTML));
 run("state.view='submissions';renderShell()");
 assert.match(nodes.get('#results').innerHTML,/尚无可投稿的论文/);
 assert.match(nodes.get('#results').innerHTML,/data-action="navigate" data-view="papers"/);
 await clickAction(handlers,{action:'new-submission'});
 assert.equal(run('state.view'),'papers');assert.equal(run('state.drawer'),null);
 assert.match(nodes.get('#content').innerHTML,/data-action="new-paper"/);
 assert.match(nodes.get('#content').innerHTML,/data-action="new-writing"/);
});

test('full and half paper rows delete only the confirmed paper using its latest version',async()=>{
 for(const serviceType of ['full','half']){
  const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
  run(`state.authenticated=true;state.papers=state.papers.slice(0,2);state.papers[0].serviceType='${serviceType}';state.papers.forEach(p=>p.transactions=[]);
   state.view='papers';syncCustomerSummaries();renderShell();
   globalThis.originalOther=JSON.stringify(state.papers[1]);globalThis.deletions=[];
   globalThis.latestPaper={...state.papers[0],version:9,title:'待删除论文 <script>alert(1)</script>'};
   api=async(url,options={})=>{
    if(options.method==='DELETE'){deletions.push({url,data:JSON.parse(options.body)});return {ok:true};}
    if(url==='/api/papers/paper-0')return latestPaper;
    if(url==='/api/papers'){if(state.papers.some(p=>p.id==='paper-0'))throw new Error('删除成功后应先更新列表');return state.papers;}
    if(url==='/api/customers')return state.customers;
    throw new Error('未预期的请求：'+url);
   };`);
  assert.match(nodes.get('#results').innerHTML,/class="text-btn paper-delete" data-action="delete-paper" data-id="paper-0"/);
  const selected={action:'delete-paper',id:'paper-0'};
  await clickAction(handlers,selected);
  assert.equal(run('state.modal.kind'),'confirm');assert.equal(run('deletions.length'),0);
  const confirmation=nodes.get('#overlay-root').innerHTML;
  assert.match(confirmation,/待删除论文 &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(confirmation,/LW-2026-0/);assert.match(confirmation,/1 次投稿/);assert.match(confirmation,/0 笔收支/);
  assert.match(confirmation,/客户和其他记录保留/);assert.match(confirmation,/此操作无法撤销/);
  assert.equal(confirmation.includes('写作安排'),serviceType==='full');
  await clickAction(handlers,{action:'cancel-modal'});
  assert.equal(run('deletions.length'),0);assert.equal(run('state.papers.length'),2);
  assert.equal(nodes.get('#overlay-root').innerHTML,'');
  await clickAction(handlers,selected);await clickAction(handlers,{action:'confirm-modal'});
  assert.equal(run('deletions.length'),1);assert.equal(run('deletions[0].url'),'/api/papers/paper-0');
  assert.equal(run('deletions[0].data.version'),9);
  assert.equal(run('state.papers.length'),1);assert.equal(run('JSON.stringify(state.papers[0])'),run('originalOther'));
  assert.equal(run("state.customers.find(c=>c.id==='customer-1').paperCount"),1);
  assert.equal(run("state.customers.find(c=>c.id==='customer-1').contractCents"),run('state.papers[0].contractCents'));
  assert.equal(run('state.modal'),null);assert.equal(run('state.drawer'),null);
  assert.ok(!nodes.get('#results').innerHTML.includes('data-action="delete-paper" data-id="paper-0"'));
 }
});

test('paper deletion retains records on failure and updates summaries before a failed refresh',async()=>{
 for(const inDetail of [false,true]){
  const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
  run(`state.authenticated=true;state.papers=state.papers.slice(0,2);state.papers.forEach(p=>p.transactions=[]);state.view='papers';syncCustomerSummaries();renderShell();
   globalThis.originalPaper=state.papers[0];globalThis.originalOther=JSON.stringify(state.papers[1]);
   globalThis.allowDelete=false;globalThis.messages=[];toast=message=>messages.push(message);
   api=async(url,options={})=>{
    if(options.method==='DELETE'){if(!allowDelete)throw new Error('论文已更新，请刷新后重试');return {ok:true};}
    if(url==='/api/papers/paper-0')return {...originalPaper,version:7};
    throw new Error('列表暂时无法同步');
   };`);
  if(inDetail)run("state.drawer={kind:'detail',paper:originalPaper,tab:'basic'};renderDetail()");
  const selected=inDetail?{action:'delete-paper'}:{action:'delete-paper',id:'paper-0'};
  await clickAction(handlers,selected);await clickAction(handlers,{action:'cancel-modal'});
  assert.equal(run('state.papers.length'),2);
  if(inDetail)assert.equal(run('state.drawer.paper.id'),'paper-0');
  await clickAction(handlers,selected);await clickAction(handlers,{action:'confirm-modal'});
  assert.equal(run('state.modal.kind'),'confirm');assert.equal(run('state.papers.length'),2);
  assert.equal(run("state.customers.find(c=>c.id==='customer-1').paperCount"),2);
  run('allowDelete=true');await clickAction(handlers,{action:'confirm-modal'});
  assert.equal(run('state.modal'),null);assert.equal(run('state.drawer'),null);
  assert.equal(nodes.get('#overlay-root').innerHTML,'');
  assert.equal(run('state.papers.length'),1);assert.equal(run('JSON.stringify(state.papers[0])'),run('originalOther'));
  assert.equal(run("state.customers.find(c=>c.id==='customer-1').paperCount"),1);
  assert.equal(run("state.customers.find(c=>c.id==='customer-1').receivedCents"),run('state.papers[0].contractReceivedCents'));
  assert.equal(run('allTransactions().length'),0);
  assert.match(run('messages.at(-1)'),/删除成功，列表刷新失败/);
 }
});

test('submission row deletion confirms the selected record and refreshes the list without deleting the paper',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`state.papers=state.papers.slice(0,1);state.view='submissions';state.search='客户乙';state.customerId='customer-1';renderShell();
  globalThis.originalPaper=state.papers[0];globalThis.savedPaper={...originalPaper,submissions:[],activeSubmissionId:''};globalThis.deletions=[];
  api=async(url,options={})=>{if(options.method==='DELETE'){deletions.push({url,data:JSON.parse(options.body)});return savedPaper;}return url==='/api/papers/paper-0'?originalPaper:url==='/api/papers'?[savedPaper]:state.customers;};`);
 const list=nodes.get('#results').innerHTML;
 assert.match(list,/data-action="edit-submission"/);assert.match(list,/data-action="delete-submission"/);
 assert.match(list,/>详情<\/button>/);assert.ok(!list.includes('详情 / 密码'));
 const selected={action:'delete-submission',paperId:'paper-0',id:'submission-paper-0'};
 await clickAction(handlers,selected);
 assert.equal(run('state.modal.kind'),'confirm');assert.equal(run('deletions.length'),0);
 assert.match(nodes.get('#overlay-root').innerHTML,/论文、收支与其他投稿记录保留/);
 await clickAction(handlers,{action:'cancel-modal'});
 assert.equal(run('deletions.length'),0);assert.equal(run('state.papers[0].submissions.length'),1);
 await clickAction(handlers,selected);await clickAction(handlers,{action:'confirm-modal'});
 assert.equal(run('deletions.length'),1);
 assert.equal(run('deletions[0].url'),'/api/papers/paper-0/submissions/submission-paper-0');
 assert.equal(run('deletions[0].data.version'),1);
 assert.equal(run('state.papers.length'),1);assert.equal(run('state.papers[0].submissions.length'),0);
 assert.equal(run('state.search'),'客户乙');assert.equal(run('state.customerId'),'customer-1');
 assert.equal(run('state.drawer'),null);assert.equal(run('state.modal'),null);
 assert.equal(nodes.get('#overlay-root').innerHTML,'');assert.match(nodes.get('#results').innerHTML,/暂无符合条件的投稿记录/);
});

test('submission deletion retains the confirmation on failure and commits before a failed refresh',async()=>{
 for(const inDetail of [false,true]){
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`state.authenticated=true;state.papers=state.papers.slice(0,1);state.view='submissions';renderShell();
  globalThis.originalPaper=state.papers[0];globalThis.savedPaper={...originalPaper,submissions:[],activeSubmissionId:''};globalThis.allowDelete=false;globalThis.messages=[];
  toast=message=>messages.push(message);
  api=async(url,options={})=>{if(options.method==='DELETE'){if(!allowDelete)throw new Error('投稿已更新，请刷新后重试');return savedPaper;}if(url==='/api/papers/paper-0')return originalPaper;throw new Error('列表暂时无法连接');};`);
 if(inDetail)run("state.drawer={kind:'detail',paper:originalPaper,tab:'submissions'};renderDetail()");
 await clickAction(handlers,{action:'delete-submission',paperId:'paper-0',id:'submission-paper-0'});
 await clickAction(handlers,{action:'confirm-modal'});
 assert.equal(run('state.modal.kind'),'confirm');assert.equal(run('state.papers[0].submissions.length'),1);
 run('allowDelete=true');await clickAction(handlers,{action:'confirm-modal'});
 assert.equal(run('state.modal'),null);assert.equal(run('state.papers[0].submissions.length'),0);
 if(inDetail){assert.equal(run('state.drawer.kind'),'detail');assert.equal(run('state.drawer.paper.submissions.length'),0);}
 else assert.equal(nodes.get('#overlay-root').innerHTML,'');
 assert.match(run('messages.at(-1)'),/删除成功，列表刷新失败/);
 }
});

test('customer and submission forms have exactly one submit owner',async()=>{
 const {run,handlers}=app();await new Promise(resolve=>setImmediate(resolve));
 run("globalThis.formValues={name:'客户乙',status:'合作中',cooperationStartedAt:'2026-01-12'};globalThis.FormData=class { constructor(){} *[Symbol.iterator](){yield* Object.entries(globalThis.formValues);} };globalThis.savedRequests=[];api=async(url,options)=>{savedRequests.push({method:options.method,url,data:JSON.parse(options.body)});return {id:'saved-customer'};};loadPapers=async()=>{};finishSave=async()=>{};openCustomer=async()=>{};toast=()=>{};state.drawer={kind:'customer-edit',customer:null};");
 const submit={disabled:false,isConnected:true},error={textContent:'',isConnected:true};
 const form={id:'customer-form',querySelector:selector=>selector==='[type=submit]'?submit:selector==='.error-message'?error:null};
 const event={target:form,preventDefault(){}};
 await Promise.all(handlers.get('submit').map(fn=>fn(event)));
 assert.equal(run('savedRequests.length'),1);assert.equal(run('savedRequests[0].url'),'/api/customers');assert.equal(error.textContent,'');
 assert.equal(run('savedRequests[0].data.cooperationStartedAt'),'2026-01-12');
 run("formValues={paperId:'paper-1',title:'投稿题目',journal:'期刊乙',status:'待投稿',submissionPassword:''};state.papers=[{id:'paper-1',version:5}];openSubmissionEditor();renderDetail=()=>{};savedRequests=[];");
 form.id='submission-form';
 await Promise.all(handlers.get('submit').map(fn=>fn(event)));
 assert.equal(run('savedRequests.length'),1);assert.equal(run('savedRequests[0].url'),'/api/papers/paper-1/submissions');assert.equal(run('savedRequests[0].data.version'),5);
});

test('customer cooperation date is editable, visible and included in exports',async()=>{
 const {run,nodes}=app();seedBusiness(run);
 run("state.customers[0].cooperationStartedAt='2026-01-12';state.view='customers';renderShell()");
 assert.match(nodes.get('#results').innerHTML,/合作开始日期/);
 assert.match(nodes.get('#results').innerHTML,/2026\.01\.12/);
 run('openCustomerEditor(state.customers[0])');
 assert.match(nodes.get('#overlay-root').innerHTML,/name="cooperationStartedAt" type="date" value="2026-01-12"/);
 run('openCustomerEditor()');
 assert.match(nodes.get('#overlay-root').innerHTML,/name="cooperationStartedAt" type="date" value=""/);
 run("state.drawer={kind:'customer-detail',customer:{...state.customers[0],papers:[]}};renderCustomerDetail()");
 assert.match(nodes.get('#overlay-root').innerHTML,/2026\.01\.12/);
 run("download=(name,blob)=>{globalThis.exported={name,blob};};exportCustomers()");
 const exported=await run('globalThis.exported.blob').text();
 assert.match(exported,/合作开始日期/);assert.match(exported,/2026-01-12/);
 run('delete state.customers[0].cooperationStartedAt;renderCustomerResults()');
 assert.match(nodes.get('#results').innerHTML,/未记录/);
});

function formEvent(id,mode='') {
 const submit={disabled:false,isConnected:true,innerHTML:'保存'};
 const error={textContent:'',isConnected:true};
 const form={id,dataset:{mode},elements:{clearPassword:{checked:false}},querySelector:selector=>selector==='[type=submit]'?submit:selector==='.error-message'?error:null};
 return {event:{target:form,preventDefault(){}},submit,error};
}
function formValues(run,values) {
 run(`globalThis.formValues=${JSON.stringify(values)};globalThis.FormData=class { *[Symbol.iterator](){yield* Object.entries(globalThis.formValues);} };`);
}

function validationForm(run,id,definitions,mode='') {
 return run(`(()=>{
  const summary={textContent:'',isConnected:true,dataset:{},focusCount:0,scrollCount:0,focus(){this.focusCount++;},scrollIntoView(){this.scrollCount++;}};
  const submit={disabled:false,isConnected:true,innerHTML:'保存'};
  const errors={};
  const form={id:${JSON.stringify(id)},dataset:{mode:${JSON.stringify(mode)}},elements:[],querySelector(selector){
   if(selector==='[type=submit]')return submit;if(selector==='.error-message')return summary;return errors[selector]||null;
  }};
  form.elements.namedItem=name=>form.elements.find(control=>control.name===name);
  for(const definition of ${JSON.stringify(definitions)}){
   const label={textContent:definition.label,mark:null,querySelector(selector){return selector==='.required-mark'?this.mark:null;},append(mark){this.mark=mark;}};
   const control={tagName:'INPUT',type:'text',required:false,disabled:false,checked:false,value:'',...definition,
    id:'test-'+definition.name,dataset:{label:definition.label},form,labels:[label],attributes:{},focusCount:0,scrollCount:0,
    setAttribute(key,value){this.attributes[key]=value;},getAttribute(key){return this.attributes[key]||null;},
    focus(){this.focusCount++;},scrollIntoView(){this.scrollCount++;},
   };
   Object.defineProperty(control,'validity',{get(){const state={...control.flags};
    if(control.type==='number'&&control.value!==''){if(control.min!==undefined&&Number(control.value)<Number(control.min))state.rangeUnderflow=true;
     if(control.max!==undefined&&Number(control.value)>Number(control.max))state.rangeOverflow=true;}
    state.valid=!Object.values(state).some(Boolean);return state;
   }});
   const error={id:control.id+'-error',textContent:'',hidden:true};errors['#'+control.id+'-error']=error;
   control.inlineError=error;form.elements.push(control);form.elements[control.name]=control;
  }
  globalThis.FormData=class { constructor(form){this.form=form;} *[Symbol.iterator](){for(const control of this.form.elements)if(!control.disabled&&(control.type!=='checkbox'||control.checked))yield [control.name,control.value];} };
  return {form,summary,submit,event:{target:form,preventDefault(){}},controls:form.elements};
 })()`);
}

test('missing required values block all form submissions and focus the first invalid field',async()=>{
 for(const [id,name,label] of [['paper-form','title','论文题目'],['customer-form','name','客户姓名'],['submission-form','journal','投稿期刊名称'],['transaction-form','amount','金额（元）'],['auth-form','username','登录账号'],['password-form','currentPassword','当前密码'],['restore-form','password','备份密码']]){
  const {run,handlers}=app();await new Promise(resolve=>setImmediate(resolve));
  run('globalThis.calls=[];api=async(...args)=>{calls.push(args);return {};};');
  const fixture=validationForm(run,id,[{name,label,required:true,value:'   '}],'login');
  await Promise.all(handlers.get('submit').map(handler=>handler(fixture.event)));
  assert.equal(run('calls.length'),0,id);assert.match(fixture.summary.textContent,/未提交/);assert.ok(fixture.summary.textContent.includes(label));
  assert.equal(fixture.controls[0].attributes['aria-invalid'],'true');assert.equal(fixture.controls[0].inlineError.hidden,false);
  assert.equal(fixture.controls[0].focusCount,1);assert.equal(fixture.controls[0].scrollCount,1);
  assert.equal(fixture.submit.disabled,false);assert.equal(fixture.submit.innerHTML,'保存');assert.equal(fixture.controls[0].value,'   ');
 }
});

test('submission date becomes visibly required with the selected status and can be corrected without reopening',async()=>{
 const {run,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run("openSubmissionEditor(state.papers[0]);globalThis.calls=[];api=async(url,options)=>{calls.push({url,options});return state.papers[0];};finishSave=async()=>{};");
 const fixture=validationForm(run,'submission-form',[
  {name:'journal',label:'投稿期刊名称',required:true,value:'期刊甲'},
  {name:'status',label:'投稿状态',tagName:'SELECT',value:'审稿中'},
  {name:'submittedAt',label:'实际投稿日期',type:'date',value:''},
 ]);
 await Promise.all(handlers.get('change').map(handler=>handler({target:fixture.controls.status})));
 assert.equal(fixture.controls.submittedAt.required,true);assert.equal(fixture.controls.submittedAt.labels[0].mark.textContent,'必填');
 await Promise.all(handlers.get('submit').map(handler=>handler(fixture.event)));
 assert.equal(run('calls.length'),0);assert.match(fixture.summary.textContent,/实际投稿日期/);
 fixture.controls.submittedAt.value='2026-01-01';
 await Promise.all(handlers.get('input').map(handler=>handler({target:fixture.controls.submittedAt})));
 assert.equal(fixture.summary.textContent,'');assert.equal(fixture.controls.submittedAt.inlineError.hidden,true);
 await Promise.all(handlers.get('submit').map(handler=>handler(fixture.event)));
 assert.equal(run('calls.length'),1);assert.equal(fixture.submit.disabled,false);
 const sent=JSON.parse(run('calls[0].options.body'));assert.equal(sent.submittedAt,'2026-01-01');assert.equal(sent.status,'审稿中');
 fixture.controls.status.value='待投稿';fixture.controls.submittedAt.value='';
 await Promise.all(handlers.get('change').map(handler=>handler({target:fixture.controls.status})));
 assert.equal(fixture.controls.submittedAt.required,false);assert.equal(fixture.controls.submittedAt.labels[0].mark.hidden,true);
});

test('cross-field mistakes highlight dates and deposits while a rejected save keeps entered content',async()=>{
 const {run,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run("state.drawer={kind:'edit',paper:null};globalThis.calls=[];api=async(...args)=>{calls.push(args);throw new Error('数据库暂时不可用，请稍后重试');};");
 const fixture=validationForm(run,'paper-form',[
  {name:'title',label:'论文题目',required:true,value:'需要保留的题目'},
  {name:'writingStartAt',label:'写作开始日期',type:'date',value:'2026-02-01'},
  {name:'writingDueAt',label:'预计交稿日期',type:'date',value:'2026-01-01'},
  {name:'writerFee',label:'稿酬总额',type:'number',value:'100'},
  {name:'writerDepositAmount',label:'约定定金',type:'number',value:'200'},
 ]);
 await Promise.all(handlers.get('submit').map(handler=>handler(fixture.event)));
 assert.equal(run('calls.length'),0);assert.match(fixture.summary.textContent,/共 2 项待修改/);
 assert.match(fixture.controls.writingDueAt.inlineError.textContent,/不能早于/);assert.match(fixture.controls.writerDepositAmount.inlineError.textContent,/不能超过/);
 fixture.controls.writingDueAt.value='2026-02-02';fixture.controls.writerDepositAmount.value='50';
 await Promise.all(handlers.get('submit').map(handler=>handler(fixture.event)));
 assert.equal(run('calls.length'),1);assert.match(fixture.summary.textContent,/数据库暂时不可用/);
 assert.equal(fixture.summary.focusCount,1);assert.equal(fixture.controls.title.value,'需要保留的题目');
 assert.equal(fixture.submit.disabled,false);assert.equal(fixture.submit.innerHTML,'保存');
});

test('delivery dates synchronize the writing status before saving and preserve revision states',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run("openEditor(state.papers[0]);globalThis.calls=[];api=async(url,options)=>{calls.push({url,options});return state.papers[0];};finishSave=async()=>{};");
 assert.match(nodes.get('#overlay-root').innerHTML,/填写实际交稿日期后/);
 const fixture=validationForm(run,'paper-form',[
  {name:'title',label:'论文题目',value:'交稿状态回归',required:true},
  {name:'writingStatus',label:'写作状态',tagName:'SELECT',value:'写作中'},
  {name:'writingDeliveredAt',label:'实际交稿日期',type:'date',value:'2026-01-12'},
 ]);
 for(const event of ['input','change']){
  fixture.controls.writingStatus.value='写作中';
  await Promise.all(handlers.get(event).map(handler=>handler({target:fixture.controls.writingDeliveredAt})));
  assert.equal(fixture.controls.writingStatus.value,'已交稿');
 }
 fixture.controls.writingStatus.value='待分配';
 await Promise.all(handlers.get('change').map(handler=>handler({target:fixture.controls.writingStatus})));
 assert.equal(fixture.controls.writingStatus.value,'已交稿');
 for(const status of ['待修改','已交稿','已完成','已取消']){
  fixture.controls.writingStatus.value=status;
  await Promise.all(handlers.get('change').map(handler=>handler({target:fixture.controls.writingStatus})));
  assert.equal(fixture.controls.writingStatus.value,status);
 }
 fixture.controls.writingStatus.value='写作中';
 await Promise.all(handlers.get('submit').map(handler=>handler(fixture.event)));
 const sent=JSON.parse(run('calls[0].options.body'));
 assert.equal(sent.writingStatus,'已交稿');assert.equal(sent.writingDeliveredAt,'2026-01-12');
 fixture.controls.writingDeliveredAt.value='';fixture.controls.writingStatus.value='写作中';
 await Promise.all(handlers.get('change').map(handler=>handler({target:fixture.controls.writingStatus})));
 assert.equal(fixture.controls.writingStatus.value,'写作中');
});

test('customer deposit fields calculate the balance and prevent saving a deposit above the total',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 for(const serviceType of ['half','full']){
  run(`state.papers[0].serviceType='${serviceType}';state.papers[0].contractCents=300010;state.papers[0].contractDepositCents=100005;openEditor(state.papers[0]);`);
  const html=nodes.get('#overlay-root').innerHTML;
  assert.match(html,/name="contractDepositAmount"[^>]*value="1000.05"/);
  assert.match(html,/name="contractBalanceAmount"[^>]*value="2000.05"[^>]*readonly/);
  assert.equal(html.includes('name="writerDepositAmount"'),serviceType==='full');
 }
 run("state.drawer={kind:'edit',paper:null};globalThis.calls=[];api=async(url,options)=>{calls.push({url,options});return state.papers[0];};finishSave=async()=>{};");
 const fixture=validationForm(run,'paper-form',[
  {name:'title',label:'论文题目',required:true,value:'客户定金测试'},
  {name:'contractAmount',label:'服务费用（元）',type:'number',value:'3000.10'},
  {name:'contractDepositAmount',label:'约定定金（元）',type:'number',value:'1000.05'},
  {name:'contractBalanceAmount',label:'约定尾款（元）',type:'number',value:'0.00',readOnly:true},
 ]);
 await Promise.all(handlers.get('input').map(handler=>handler({target:fixture.controls.contractDepositAmount})));
 assert.equal(fixture.controls.contractBalanceAmount.value,'2000.05');
 fixture.controls.contractAmount.value='0.30';fixture.controls.contractDepositAmount.value='0.10';
 await Promise.all(handlers.get('change').map(handler=>handler({target:fixture.controls.contractAmount})));
 assert.equal(fixture.controls.contractBalanceAmount.value,'0.20');
 fixture.controls.contractDepositAmount.value='1';
 await Promise.all(handlers.get('submit').map(handler=>handler(fixture.event)));
 assert.equal(run('calls.length'),0);assert.match(fixture.summary.textContent,/定金不能超过服务费用/);
 fixture.controls.contractDepositAmount.value='0.10';
 await Promise.all(handlers.get('submit').map(handler=>handler(fixture.event)));
 assert.equal(run('calls.length'),1);assert.equal(JSON.parse(run('calls[0].options.body')).contractDepositAmount,'0.10');
});

test('customer payment terms appear in details and exports independently from writer fees',async()=>{
 const {run,nodes}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run("state.papers=state.papers.slice(0,1);Object.assign(state.papers[0],{contractCents:300010,contractDepositCents:100005,contractBalanceCents:200005});state.view='papers';renderShell();");
 const customerTerms=nodes.get('#results').innerHTML.match(/class="cell-sub paper-terms">([\s\S]*?)<\/div>/)[1];
 assert.match(customerTerms,/收款定金 ¥1,000.05/);assert.match(customerTerms,/尾款 ¥2,000.05/);
 assert.match(run('financeDetail(state.papers[0])'),/约定定金 ¥1,000.05 · 尾款 ¥2,000.05/);
 run("download=(name,blob)=>{globalThis.exported={name,blob};};exportManagedPapers()");
 let csv=await run('exported.blob').text();assert.match(csv,/收款定金（元）/);assert.match(csv,/收款尾款（元）/);assert.match(csv,/"3000.1","1000.05","2000.05"/);
 run("state.financeType='balances';exportFinance()");csv=await run('exported.blob').text();assert.match(csv,/"1000.05","2000.05"/);
 run("delete state.papers[0].contractDepositCents;openEditor(state.papers[0])");
 assert.match(nodes.get('#overlay-root').innerHTML,/name="contractDepositAmount"[^>]*value="0.00"/);
 assert.match(nodes.get('#overlay-root').innerHTML,/name="contractBalanceAmount"[^>]*value="3000.10"/);
});

test('zero payments and invalid email formats receive specific inline errors',async()=>{
 const {run,handlers}=app();await new Promise(resolve=>setImmediate(resolve));
 run('globalThis.calls=[];api=async(...args)=>calls.push(args);');
 const payment=validationForm(run,'transaction-form',[{name:'amount',label:'金额（元）',type:'number',required:true,value:'0',min:'0.01'}]);
 await Promise.all(handlers.get('submit').map(handler=>handler(payment.event)));
 assert.match(payment.summary.textContent,/不能小于 0.01/);assert.equal(run('calls.length'),0);
 const customer=validationForm(run,'customer-form',[{name:'email',label:'邮箱',type:'email',value:'wrong-email',flags:{typeMismatch:true}}]);
 await Promise.all(handlers.get('submit').map(handler=>handler(customer.event)));
 assert.match(customer.summary.textContent,/name@example.com/);assert.equal(run('calls.length'),0);
});

test('server validation errors identify their field and password mismatch never sends a request',async()=>{
 const {run,handlers}=app();await new Promise(resolve=>setImmediate(resolve));
 run("globalThis.calls=[];api=async(...args)=>{calls.push(args);throw new Error('客户邮箱格式不正确');};state.drawer={kind:'customer-edit',customer:null};");
 const customer=validationForm(run,'customer-form',[{name:'email',label:'客户邮箱',type:'email',value:'customer@example.com'}]);
 await Promise.all(handlers.get('submit').map(handler=>handler(customer.event)));
 assert.equal(run('calls.length'),1);assert.equal(customer.controls.email.focusCount,1);
 assert.match(customer.controls.email.inlineError.textContent,/邮箱格式不正确/);
 const password=validationForm(run,'password-form',[
  {name:'newPassword',label:'新密码',required:true,value:'Example-password-123'},
  {name:'confirm',label:'确认新密码',required:true,value:'Different-password-123'},
 ]);
 await Promise.all(handlers.get('submit').map(handler=>handler(password.event)));
 assert.equal(run('calls.length'),1);assert.match(password.summary.textContent,/两次输入/);assert.equal(password.controls.confirm.focusCount,1);
});

test('form preparation adds accessible requirements and inline feedback to manually written fields',async()=>{
 const {run}=app();await new Promise(resolve=>setImmediate(resolve));
 const fixture=validationForm(run,'customer-form',[{name:'name',label:'客户姓名',required:true,value:''}]);
 fixture.summary.classList={add(){}};
 fixture.form.insertAdjacentHTML=function(position,html){this.guide=html;};
 fixture.controls.name.closest=()=>({querySelector:()=>null});
 run('globalThis.preparedRoot={querySelectorAll(){return [];}};');
 const root=run('preparedRoot');root.querySelectorAll=()=>[fixture.form];
 run('prepareForms(preparedRoot)');
 assert.equal(fixture.form.noValidate,true);assert.match(fixture.form.guide,/其余可选/);
 assert.equal(fixture.controls.name.attributes['aria-required'],'true');
 assert.equal(fixture.controls.name.labels[0].mark.textContent,'必填');
 assert.match(fixture.controls.name.attributes['aria-describedby'],/test-name-error/);
 assert.equal(fixture.summary.tabIndex,-1);
});

test('long business forms show errors in their action footer and mark required fields explicitly',async()=>{
 const {run,nodes}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 for(const command of ['openEditor()','openWritingEditor()','openCustomerEditor()','openSubmissionEditor(state.papers[0])',"state.drawer={kind:'detail',paper:state.papers[0]};transactionForm()"]){
  run(command);const html=nodes.get('#overlay-root').innerHTML;
  assert.match(html,/<form[^>]*novalidate/);assert.match(html,/<span class="required-mark">必填<\/span>/);
  assert.match(html,/<footer class="drawer-foot"><div class="error-message form-feedback" role="alert" aria-live="assertive"/);
 }
 run("openSubmissionEditor(state.papers[0],state.papers[0].submissions[0])");
 assert.match(nodes.get('#overlay-root').innerHTML,/name="submittedAt"[^>]*required/);
 run("openEditor();");assert.match(nodes.get('#overlay-root').innerHTML,/name="title"[^>]*placeholder="填写客户提供的文章题目"/);
});

test('home exposes login, registration and password change without confusing registration with login',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));
 for(const label of ['登录','注册','修改密码'])assert.ok(nodes.get('#root').innerHTML.includes(`>${label}</button>`));
 assert.match(nodes.get('#root').innerHTML,/id="auth-form"[^>]*data-mode="login"/);
 await clickAction(handlers,{action:'auth-mode',mode:'login'});
 assert.match(nodes.get('#root').innerHTML,/data-mode="login"/);
 assert.ok(!nodes.get('#root').innerHTML.includes('name="confirm"'));
 assert.equal(run('state.initialized'),false);
 await clickAction(handlers,{action:'auth-mode',mode:'password'});
 for(const name of ['username','currentPassword','newPassword','confirm'])assert.ok(nodes.get('#root').innerHTML.includes(`name="${name}"`));
 assert.match(nodes.get('#root').innerHTML,/需要原密码/);
 run("state.initialized=true;state.username='<script>';state.authMode='register';renderAuth()");
 assert.match(nodes.get('#root').innerHTML,/id="auth-form"[^>]*data-mode="register"/);
 for(const name of ['username','password','confirm'])assert.ok(nodes.get('#root').innerHTML.includes(`name="${name}"`));
 assert.ok(!nodes.get('#root').innerHTML.includes('当前工作台已注册'));
 assert.match(nodes.get('#root').innerHTML,/独立工作台/);
 await clickAction(handlers,{action:'auth-mode',mode:'login'});
 assert.match(nodes.get('#root').innerHTML,/value="&lt;script&gt;"/);
 run('renderShell()');assert.match(nodes.get('#root').innerHTML,/data-action="change-password"/);
 await clickAction(handlers,{action:'change-password'});
 assert.equal(run('state.view'),'settings');assert.match(nodes.get('#content').innerHTML,/id="password-form"/);
});

test('home forms omit required badges and include a separate visibility control for each password',async()=>{
 const {run,nodes}=app();await new Promise(resolve=>setImmediate(resolve));
 for(const [mode,names] of [['login',['password']],['register',['password','confirm']],['password',['currentPassword','newPassword','confirm']]]){
  run(`state.authMode=${JSON.stringify(mode)};renderAuth()`);
  const html=nodes.get('#root').innerHTML;
  assert.ok(!html.includes('required-mark'));assert.ok(!html.includes('form-guide'));assert.ok(!html.includes('标记项必须填写'));
  assert.match(html,/name="username"[^>]*required/);
  const toggles=[...html.matchAll(/<button\b([^>]*data-action="toggle-auth-password"[^>]*)>/g)].map(m=>m[1]);
  assert.equal(toggles.length,names.length);
  for(const name of names){
   assert.match(html,new RegExp(`id="auth-${name}" name="${name}" type="password" required`));
   const attributes=toggles.find(value=>value.includes(`data-target="auth-${name}"`));
   assert.ok(attributes);assert.match(attributes,/type="button"/);assert.match(attributes,/aria-pressed="false"/);
   assert.ok(attributes.includes(`aria-controls="auth-${name}"`));
  }
 }
});

test('terminated papers keep their editorial status but leave writing and follow-up work and expose settlement totals',async()=>{
 const {run,nodes}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`state.papers=state.papers.slice(0,2);Object.assign(state.papers[0],{serviceStatus:'terminated',status:'审稿中',writingStatus:'写作中',writingOverdue:true,
  termination:{terminatedAt:today(),reason:'客户爽约 <script>bad()</script>',customerCents:60000,writerCents:40000},
  settlementContractCents:60000,settlementWriterFeeCents:40000,contractReceivedCents:100000,writerPaidCents:50000,refundableCents:40000,recoverableCents:10000,receivableCents:0,payableCents:0,settlementComplete:false});
  state.drawer={kind:'detail',paper:state.papers[0],tab:'finance'};renderDetail();`);
 let html=nodes.get('#overlay-root').innerHTML;
 assert.match(html,/服务已终止/);assert.match(html,/待结算/);assert.match(html,/客户爽约 &lt;script&gt;bad\(\)&lt;\/script&gt;/);
 assert.match(html,/data-action="settlement-payment"[^>]*data-type="outgoing_refund"/);
 assert.match(html,/data-type="incoming_writer_refund"/);assert.match(html,/待退 ¥400.00/);
 assert.ok(!html.includes('data-action="edit-paper"'));assert.ok(!html.includes('登记已付定金'));
 assert.equal(run('state.papers[0].status'),'审稿中');assert.equal(run('hasFollowUp(state.papers[0])'),false);
 assert.equal(run('writingFinished(state.papers[0])'),true);
 assert.equal(run('followUpPlans().length'),1);
 run("state.tab='active'");assert.equal(run('filteredManagedPapers().length'),1);
 run("state.tab='overdue'");assert.equal(run('filteredManagedPapers().length'),0);
 run("state.tab='terminated'");assert.equal(run('filteredManagedPapers().length'),1);
 run("state.view='papers';renderShell()");html=nodes.get('#results').innerHTML;
 assert.match(html,/服务已终止/);assert.ok(!html.includes('data-action="resubmit-paper"'));assert.ok(!html.includes('data-action="edit-paper"'));
 run("state.view='finance';state.financeType='balances';state.tab='all';renderShell()");
 assert.match(nodes.get('#results').innerHTML,/待退款 ¥400.00/);assert.match(nodes.get('#results').innerHTML,/待追回 ¥100.00/);
 run('syncCustomerSummaries()');assert.equal(run('state.customers[0].refundableCents'),40000);
 run("state.drawer={kind:'detail',paper:state.papers[0],tab:'submissions'};renderDetail()");
 html=nodes.get('#overlay-root').innerHTML;assert.ok(!html.includes('data-action="edit-submission"'));assert.ok(!html.includes('data-action="resubmit-paper"'));
});

test('termination form explicitly confirms independent settlement and failed requests retain the form',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`state.terminationSupported=true;openSubmissionEditor(state.papers[0],state.papers[0].submissions[0]);`);
 assert.match(nodes.get('#overlay-root').innerHTML,/<option value="终止服务"/);
 const selection=validationForm(run,'submission-form',[{name:'status',label:'投稿状态',tagName:'SELECT',value:'终止服务'}]);
 await Promise.all(handlers.get('change').map(fn=>fn({target:selection.controls.status})));
 let html=nodes.get('#overlay-root').innerHTML;
 assert.match(html,/id="termination-form"/);for(const name of ['terminatedAt','terminationReason','customerSettlement','writerSettlement','confirmTermination'])assert.ok(html.includes(`name="${name}"`));
 assert.match(html,/原费用约定及实际流水保留/);assert.equal(run('isEditingDrawer()'),true);
 const fixture=validationForm(run,'termination-form',[
  {name:'terminatedAt',label:'终止日期',required:true,type:'date',value:run('today()')},
  {name:'terminationReason',label:'终止原因',required:true,value:'客户爽约'},
  {name:'customerSettlement',label:'客户最终结算',required:true,value:'600.00'},
  {name:'writerSettlement',label:'写作者最终结算',required:true,value:'400.00'},
  {name:'confirmTermination',label:'确认终止结算',required:true,type:'checkbox',checked:false,value:'yes'},
 ]);
 run("globalThis.terminationCalls=[];api=async(url,options)=>{terminationCalls.push({url,options});throw new Error('连接暂时不可用')}");
 await Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));assert.equal(run('terminationCalls.length'),0);
 fixture.controls.confirmTermination.checked=true;
 await Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));
 assert.equal(run('terminationCalls.length'),1);assert.equal(run('state.drawer.kind'),'termination');assert.match(fixture.summary.textContent,/连接暂时不可用/);
 assert.equal(fixture.submit.disabled,false);
 run(`api=async(url,options)=>{terminationCalls.push({url,options});return {...state.papers[0],serviceStatus:'terminated',termination:{terminatedAt:today(),reason:'客户爽约',customerCents:60000,writerCents:40000},settlementContractCents:60000,settlementWriterFeeCents:40000,settlementComplete:false};}`);
 await Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));
 assert.equal(run('state.drawer.kind'),'detail');assert.equal(run('state.drawer.tab'),'finance');
 const sent=JSON.parse(run('terminationCalls.at(-1).options.body'));
 assert.equal(sent.confirmTermination,true);assert.equal(sent.customerSettlement,'600.00');assert.equal(sent.version,1);
 assert.equal(run('terminationCalls.at(-1).options.method'),'POST');
 await clickAction(handlers,{action:'terminate-service'});assert.match(nodes.get('#overlay-root').innerHTML,/调整终止结算/);
 await Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));
 assert.equal(run('terminationCalls.at(-1).options.method'),'PUT');
});

test('selecting termination preserves draft submission values when returning and closing never ends service',async()=>{
 for(const serviceType of ['full','half'])for(const historical of [false,true]){
  const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
  run(`state.papers[0].serviceType='${serviceType}';state.papers[0].submissions.push({...state.papers[0].submissions[0],id:'historical',status:'已拒稿'});
   openSubmissionEditor(state.papers[0],state.papers[0].submissions[${historical?1:0}]);
   globalThis.originalDrawer=state.drawer;globalThis.originalPapers=JSON.stringify(state.papers);globalThis.calls=[];api=async(...args)=>{calls.push(args);};`);
  const fixture=validationForm(run,'submission-form',[
   {name:'status',label:'投稿状态',tagName:'SELECT',value:'修改中'},
   {name:'submittedAt',label:'实际投稿日期',type:'date',value:run('today()')},
   {name:'title',label:'投稿题目',value:'尚未保存的投稿题目'},
  ]);
  fixture.form.dataset.editorId=String(run('state.drawer.editorId'));
  const change=()=>Promise.all(handlers.get('change').map(fn=>fn({target:fixture.controls.status})));
  await change();
  const root=nodes.get('#overlay-root'),html=root.innerHTML;root.childNodes=[fixture.form];
  root.replaceChildren=(...children)=>{root.childNodes=children;root.innerHTML=html;};
  fixture.controls.status.value='终止服务';await change();
  assert.equal(run('state.drawer.kind'),'termination');assert.equal(run('state.drawer.paper.id'),'paper-0');
  assert.match(root.innerHTML,/终止整篇论文的服务（含全部投稿）/);assert.match(root.innerHTML,/返回投稿/);
  assert.equal(fixture.controls.status.value,'修改中');assert.equal(run('calls.length'),0);
  assert.equal(run('JSON.stringify(state.papers)'),run('originalPapers'));
  await clickAction(handlers,{action:'cancel-termination'});
  assert.equal(run('state.drawer===originalDrawer'),true);assert.equal(root.childNodes[0],fixture.form);
  assert.equal(fixture.controls.title.value,'尚未保存的投稿题目');assert.equal(fixture.controls.status.value,'修改中');
  fixture.controls.status.value='终止服务';await change();await clickAction(handlers,{action:'close'});
  assert.equal(root.innerHTML,'');assert.equal(run('state.drawer'),null);assert.equal(run('state.modal'),null);
  assert.equal(run('calls.length'),0);assert.equal(run('JSON.stringify(state.papers)'),run('originalPapers'));
 }
});

test('termination requires a selected paper and submitting the action opens confirmation without saving an incomplete submission',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run('openSubmissionEditor();globalThis.calls=[];api=async(...args)=>{calls.push(args);};');
 const fixture=validationForm(run,'submission-form',[
  {name:'paperId',label:'关联论文',tagName:'SELECT',value:''},
  {name:'status',label:'投稿状态',tagName:'SELECT',value:'终止服务'},
  {name:'journal',label:'投稿期刊名称',required:true,value:''},
 ]);
 await Promise.all(handlers.get('change').map(fn=>fn({target:fixture.controls.status})));
 assert.equal(run('state.drawer.kind'),'submission-edit');assert.match(fixture.summary.textContent,/请先选择关联论文/);
 assert.equal(fixture.controls.status.value,'待投稿');assert.equal(run('calls.length'),0);
 fixture.controls.paperId.value='paper-1';fixture.controls.status.value='终止服务';
 await Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));
 assert.equal(run('state.drawer.kind'),'termination');assert.equal(run('state.drawer.paper.id'),'paper-1');
 assert.match(nodes.get('#overlay-root').innerHTML,/id="termination-form"/);assert.equal(run('calls.length'),0);
 assert.equal(fixture.submit.disabled,false);assert.equal(run('state.drawer.returnToSubmission.drawer.paper'),null);
});

test('terminated submissions can be filtered and exported while original journal statuses remain intact',async()=>{
 const {run,nodes}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`state.papers=state.papers.slice(0,2);Object.assign(state.papers[0],{serviceStatus:'terminated',termination:{terminatedAt:today(),reason:'客户终止合作'}});
  state.papers[0].submissions[0].status='审稿中';state.papers[0].submissions.push({...state.papers[0].submissions[0],id:'historical',title:'历史投稿',status:'已拒稿'});
  state.view='submissions';state.tab='all';renderShell();`);
 assert.match(nodes.get('#content').innerHTML,/data-tab="terminated"/);
 assert.match(nodes.get('#content').innerHTML,/<option >服务已终止<\/option>/);
 assert.match(nodes.get('#results').innerHTML,/终止前：<span class="badge blue">审稿中/);
 run("state.tab='active'");assert.equal(run('filteredSubmissions().length'),1);
 run("state.tab='finished'");assert.equal(run('filteredSubmissions().length'),2);
 run("state.tab='terminated'");assert.equal(run('filteredSubmissions().length'),2);
 run("state.tab='all';state.status='服务已终止'");assert.equal(run('filteredSubmissions().length'),2);
 run("state.search='历史'");assert.equal(run('filteredSubmissions()[0].id'),'historical');
 run("download=(name,blob)=>{globalThis.exported={name,blob};};exportSubmissions()");
 const csv=await run('exported.blob').text();
 assert.match(csv,/服务状态/);assert.match(csv,/终止日期/);assert.match(csv,/终止原因/);
 assert.match(csv,/服务已终止/);assert.match(csv,/客户终止合作/);assert.match(csv,/已拒稿/);
 assert.ok(!csv.includes('private-account'));assert.ok(!csv.includes('private@example.com'));
 run("state.search='';state.status='已拒稿'");assert.equal(run('filteredSubmissions().length'),1);
 assert.equal(run('statuses.includes("终止服务")'),false);assert.equal(run('state.papers[0].submissions[0].status'),'审稿中');
});

test('terminated service transactions expose refund and recovery types and export final amounts separately',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`state.papers=state.papers.slice(0,1);Object.assign(state.papers[0],{serviceStatus:'terminated',
  termination:{terminatedAt:today(),reason:'客户爽约',customerCents:60000,writerCents:40000},
  settlementContractCents:60000,settlementWriterFeeCents:40000,refundableCents:40000,recoverableCents:10000});
  state.drawer={kind:'detail',paper:state.papers[0],tab:'finance'};transactionForm('outgoing_refund');`);
 let html=nodes.get('#overlay-root').innerHTML;
 assert.match(html,/value="outgoing_refund" selected/);assert.match(html,/name="amount" type="number" value="400.00"/);
 assert.match(html,/name="confirmSettlementPayment"[^>]*required/);
 assert.ok(!html.includes('value="incoming_deposit"'));assert.ok(!html.includes('value="outgoing_deposit"'));
 assert.match(html,/value="incoming_writer_refund"/);assert.match(html,/value="outgoing_settlement"/);
 run("download=(name,blob)=>{globalThis.closedExport={name,blob};};state.view='finance';state.financeType='balances';exportFinance()");
 const csv=await run('closedExport.blob').text();
 assert.match(csv,/客户最终结算（元）/);assert.match(csv,/待退款（元）/);assert.match(csv,/服务已终止/);assert.match(csv,/客户爽约/);
});

test('customer receipts reject excess amounts before posting and allow the remaining amount to be corrected',async()=>{
 const {run,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`Object.assign(state.papers[0],{contractCents:300000,contractDepositCents:100000,contractReceivedCents:60000,
  transactions:[{id:'receipt-1',type:'incoming_deposit',amountCents:60000}]});
  state.drawer={kind:'transaction',paper:state.papers[0]};globalThis.receiptCalls=[];
  api=async(url,options)=>{receiptCalls.push({url,data:JSON.parse(options.body)});return state.papers[0]};finishSave=async()=>{};`);
 const fixture=validationForm(run,'transaction-form',[
  {name:'type',label:'收支类型',tagName:'SELECT',required:true,value:'incoming_deposit'},
  {name:'amount',label:'本次实际收付金额',required:true,type:'number',value:'400.01'},
  {name:'date',label:'收付日期',required:true,type:'date',value:run('today()')},
 ]);
 await Promise.all(handlers.get('submit').map(handler=>handler(fixture.event)));
 assert.equal(run('receiptCalls.length'),0);assert.match(fixture.controls.amount.inlineError.textContent,/不能超过/);
 assert.match(fixture.controls.amount.inlineError.textContent,/400.00/);
 fixture.controls.amount.value='400.00';
 await Promise.all(handlers.get('submit').map(handler=>handler(fixture.event)));
 assert.equal(run('receiptCalls.length'),1);assert.equal(run('receiptCalls[0].data.amount'),'400.00');
 fixture.controls.type.value='incoming_balance';fixture.controls.amount.value='2000.01';
 await Promise.all(handlers.get('submit').map(handler=>handler(fixture.event)));
 assert.equal(run('receiptCalls.length'),1);
 assert.equal(run("transactionRemaining(state.papers[0],'incoming_other')"),null);
});

test('home form preparation keeps validation and accessible requirements without adding required decorations',async()=>{
 const {run}=app();await new Promise(resolve=>setImmediate(resolve));
 const fixture=validationForm(run,'auth-form',[
  {name:'username',label:'登录账号',required:true,value:''},
  {name:'password',label:'管理密码',required:true,type:'password',value:''},
 ],'login');
 fixture.summary.classList={add(){}};
 fixture.form.insertAdjacentHTML=function(position,html){this.guide=html;};
 for(const control of fixture.controls)control.closest=()=>({querySelector:()=>null});
 run('globalThis.preparedAuthRoot={querySelectorAll(){return [];}}');
 run('preparedAuthRoot').querySelectorAll=()=>[fixture.form];
 run('prepareForms(preparedAuthRoot)');
 assert.equal(fixture.form.guide,undefined);
 for(const control of fixture.controls){
  assert.equal(control.required,true);assert.equal(control.attributes['aria-required'],'true');assert.equal(control.labels[0].mark,null);
  assert.match(control.attributes['aria-describedby'],new RegExp(control.id+'-error'));
 }
 assert.equal(run('validateForm(preparedAuthRoot.querySelectorAll()[0])'),false);
 assert.match(fixture.summary.textContent,/未提交/);
});

test('home password visibility toggles each field independently while preserving entered values',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));
 run('globalThis.visibilityRequests=0;api=async()=>{visibilityRequests++;throw new Error("unexpected request")};');
 const form={id:'auth-form'},controls=new Map();
 for(const name of ['password','currentPassword','newPassword','confirm']){
  const id='auth-'+name,input={type:'password',value:'Keep-entered-value-'+name,form,required:true,autocomplete:'new-password'};
  controls.set(id,input);nodes.set('#'+id,input);
 }
 for(const [id,input] of controls){
  const original=input.value,button={dataset:{action:'toggle-auth-password',target:id,label:'管理密码'},disabled:false,isConnected:true,
   attributes:{},setAttribute(name,value){this.attributes[name]=value;},innerHTML:''};
  const click=()=>Promise.all(handlers.get('click').map(handler=>handler({target:{closest:()=>button}})));
  await click();
  assert.equal(input.type,'text');assert.equal(input.value,original);assert.equal(input.required,true);
  assert.equal(button.attributes['aria-pressed'],'true');assert.equal(button.attributes['aria-label'],'隐藏管理密码');
  assert.equal(button.title,'隐藏管理密码');assert.equal(button.innerHTML,run("icon('eyeOff')"));
  for(const [otherId,otherInput] of controls)if(otherId!==id)assert.equal(otherInput.type,'password');
  await click();assert.equal(input.type,'password');assert.equal(input.value,original);
  assert.equal(button.attributes['aria-pressed'],'false');assert.equal(button.attributes['aria-label'],'显示管理密码');
  assert.equal(button.innerHTML,run("icon('eye')"));
 }
 assert.equal(run('visibilityRequests'),0);
});

test('home registration and login submit their own endpoint and enter the workspace',async()=>{
 for(const mode of ['login','register']) {
  const {run,handlers}=app();await new Promise(resolve=>setImmediate(resolve));
  run(`globalThis.calls=[];api=async(url,options={})=>{calls.push({url,...options});return options.method?{csrf:'new-token',username:'test-user'}:[];};`);
  formValues(run,{username:'test-user',password:'Test-password-2026',confirm:'Test-password-2026'});
  const {event,error}=formEvent('auth-form',mode);
  await Promise.all(handlers.get('submit').map(fn=>fn(event)));
  assert.equal(error.textContent,'');assert.equal(run('calls[0].url'),`/api/${mode}`);
  assert.equal(run('state.authenticated'),true);assert.equal(run('state.csrf'),'new-token');
  assert.equal(run('state.view'),'records');assert.equal(run('state.authSubmitting'),false);
 }
});

test('duplicate account errors retain the registration form so a different account can be submitted',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));
 run("state.initialized=true;state.authMode='register';renderAuth();api=async()=>{throw new Error('该账号已被注册，请更换账号或直接登录');}");
 formValues(run,{username:'existing-user',password:'Test-password-2026',confirm:'Test-password-2026'});
 const {event,error,submit}=formEvent('auth-form','register');
 await Promise.all(handlers.get('submit').map(fn=>fn(event)));
 assert.match(error.textContent,/该账号已被注册/);assert.equal(submit.disabled,false);
 assert.match(nodes.get('#root').innerHTML,/id="auth-form"[^>]*data-mode="register"/);
 assert.equal(run('state.authenticated'),false);
 run("globalThis.registered=[];api=async(url,options={})=>{if(options.method){registered.push(JSON.parse(options.body));return {csrf:'second-token',username:'new-user'};}return [];};");
 formValues(run,{username:'new-user',password:'Test-password-2026',confirm:'Test-password-2026'});
 await Promise.all(handlers.get('submit').map(fn=>fn(event)));
 assert.equal(error.textContent,'');assert.equal(run('state.username'),'new-user');assert.equal(run('state.authenticated'),true);
});

test('home password change validates confirmation, retains errors and returns to login after success',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));
 run("state.initialized=true;state.authMode='password';renderAuth();globalThis.calls=[];globalThis.messages=[];toast=message=>messages.push(message);api=async(url,options)=>{calls.push({url,data:JSON.parse(options.body)});return {ok:true};};");
 formValues(run,{username:'test-user',currentPassword:'Original-password',newPassword:'Changed-password',confirm:'Mismatch-password'});
 const {event,error,submit}=formEvent('auth-form','password');
 await Promise.all(handlers.get('submit').map(fn=>fn(event)));
 assert.match(error.textContent,/两次输入的新密码不一致/);assert.equal(run('calls.length'),0);
 assert.equal(submit.disabled,false);assert.equal(run('state.authSubmitting'),false);
 formValues(run,{username:'test-user',currentPassword:'Original-password',newPassword:'Changed-password',confirm:'Changed-password'});
 run("api=async()=>{throw new Error('账号或密码不正确');}");
 await Promise.all(handlers.get('submit').map(fn=>fn(event)));
 assert.match(error.textContent,/账号或密码不正确/);assert.equal(run('state.authMode'),'password');
 assert.match(nodes.get('#root').innerHTML,/name="currentPassword"/);
 run("api=async(url,options)=>{calls.push({url,data:JSON.parse(options.body)});return {ok:true};}");
 await Promise.all(handlers.get('submit').map(fn=>fn(event)));
 assert.equal(run('calls[0].url'),'/api/change-password');
 assert.equal(run('calls[0].data.currentPassword'),'Original-password');
 assert.equal(run('calls[0].data.newPassword'),'Changed-password');
 assert.equal(run('state.authenticated'),false);assert.equal(run('state.csrf'),'');assert.equal(run('state.authMode'),'login');
 assert.match(nodes.get('#root').innerHTML,/登录系统/);assert.match(run('messages.at(-1)'),/密码修改成功，请重新登录/);
 assert.ok(!nodes.get('#root').innerHTML.includes('Changed-password'));
});

test('incorrect current password in settings keeps the active session and the form visible',async()=>{
 const {run,nodes}=app();await new Promise(resolve=>setImmediate(resolve));
 run("state.authenticated=true;state.view='settings';renderShell();fetch=async()=>({ok:false,status:401,json:async()=>({error:'当前密码不正确',authenticated:true})});");
 await assert.rejects(run("request('POST','/api/password',{currentPassword:'wrong',newPassword:'Next-password'})"),/当前密码不正确/);
 assert.equal(run('state.authenticated'),true);assert.match(nodes.get('#content').innerHTML,/id="password-form"/);
 run("fetch=async()=>({ok:false,status:401,json:async()=>({error:'登录已失效，请重新登录',authenticated:false})});");
 await assert.rejects(run("request('POST','/api/password',{})"),/登录已失效/);
 assert.equal(run('state.authenticated'),false);assert.match(nodes.get('#root').innerHTML,/登录系统/);
});

test('new paper and new writing actions open distinct half and full forms with the customer retained',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run("state.view='papers';renderShell()");
 assert.match(nodes.get('#content').innerHTML,/data-action="new-paper"/);
 assert.match(nodes.get('#content').innerHTML,/data-action="new-writing"/);
 for(const [action,type,title] of [['new-paper','half','新增记录（半包）'],['new-writing','full','新增记录（全包）']]){
  const button={dataset:{action,customerId:'customer-1'},isConnected:true,disabled:false};
  await Promise.all(handlers.get('click').map(fn=>fn({target:{closest:()=>button}})));
  const html=nodes.get('#overlay-root').innerHTML;
  assert.match(html,new RegExp(`id="drawer-title">${title}</h2>`));
  assert.match(html,new RegExp(`name="serviceType" value="${type}"`));
  assert.match(html,/value="customer-1" selected/);
  assert.equal(html.includes('name="writer"'),type==='full');
  assert.equal(html.includes('name="writingDueAt"'),type==='full');
  assert.equal(html.includes('name="writerFee"'),type==='full');
 }
 run("state.papers[0].serviceType='half';openEditor(state.papers[0])");
 assert.match(nodes.get('#overlay-root').innerHTML,/id="drawer-title">编辑记录（半包）<\/h2>/);
 assert.ok(!nodes.get('#overlay-root').innerHTML.includes('name="writerFee"'));
 run('delete state.papers[0].serviceType;openEditor(state.papers[0])');
 assert.match(nodes.get('#overlay-root').innerHTML,/id="drawer-title">编辑记录（全包）<\/h2>/);
 run("state.drawer={kind:'customer-detail',customerTab:'papers',customer:{...state.customers[0],papers:state.papers}};renderCustomerDetail()");
 assert.match(nodes.get('#overlay-root').innerHTML,/data-action="navigate" data-view="papers" data-customer-id="customer-1"/);
 await clickAction(handlers,{action:'navigate',view:'papers',customerId:'customer-1'});
 assert.equal(run('state.customerId'),'customer-1');assert.equal(run('state.drawer'),null);
 assert.match(nodes.get('#content').innerHTML,/data-action="new-writing" data-customer-id="customer-1"/);
});

test('paper management includes half papers without treating them as writing tasks or exporting stale writing data',async()=>{
 const {run,nodes}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run("Object.assign(state.papers[0],{serviceType:'half',title:'客户供稿的半包论文',writer:'半包旧写作人',writingStatus:'写作中',writingOverdue:true,writerFeeCents:999999999,payableCents:999999999});state.pageSize=20;state.view='papers';renderShell()");
 assert.equal(run('filteredManagedPapers().length'),10);
 assert.match(nodes.get('#results').innerHTML,/客户供稿的半包论文/);
 assert.match(nodes.get('#results').innerHTML,/无需安排写作/);
 assert.match(nodes.get('#content').innerHTML,/论文管理/);
 assert.match(nodes.get('#content').innerHTML,/class="stat-value ">10<span/);
 assert.ok(!nodes.get('#content').innerHTML.includes('9,999,999.99'));
 assert.ok(!nodes.get('#results').innerHTML.includes('半包旧写作人'));
 run("download=(name,blob)=>{globalThis.exported={name,blob};};exportManagedPapers()");
 let csv=await run('globalThis.exported.blob').text();
 assert.match(csv,/客户供稿的半包论文/);assert.match(csv,/服务类型/);
 assert.ok(!csv.includes('半包旧写作人'));assert.ok(!csv.includes('9999999.99'));
 run("state.tab='active';renderContent();exportManagedPapers()");
 assert.equal(run('filteredManagedPapers().length'),9);
 assert.ok(!nodes.get('#results').innerHTML.includes('客户供稿的半包论文'));
 assert.ok(!(await run('globalThis.exported.blob').text()).includes('客户供稿的半包论文'));
 run("state.tab='half';renderContent();exportManagedPapers()");
 assert.equal(run('filteredManagedPapers().length'),1);
 assert.match(await run('globalThis.exported.blob').text(),/客户供稿的半包论文/);
 run("state.tab='overdue';renderContent()");assert.equal(run('filteredManagedPapers().length'),0);
 assert.match(nodes.get('#results').innerHTML,/重置筛选/);
 run("state.tab='all';state.view='records';renderShell();exportPapers()");
 assert.match(nodes.get('#results').innerHTML,/半包 · 客户供稿/);
 csv=await run('globalThis.exported.blob').text();
 assert.match(csv,/服务类型/);assert.match(csv,/半包 · 客户供稿/);
 assert.equal(run('allSubmissions().length'),10);
 assert.ok(!run('basicDetail(state.papers[0])').includes('写作安排'));
 assert.ok(!run('financeDetail(state.papers[0])').includes('已付稿酬 / 约定稿酬'));
 run("state.drawer={kind:'detail',paper:state.papers[0]};transactionForm()");
 assert.ok(!nodes.get('#overlay-root').innerHTML.includes('value="outgoing_deposit"'));
 assert.match(nodes.get('#overlay-root').innerHTML,/value="outgoing_other"/);
});

test('paper filters combine service type, writing progress, customer and local creation date',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`state.view='papers';state.papers=state.papers.slice(0,5);
  state.papers.forEach((p,i)=>Object.assign(p,{createdAt:new Date(2026,0,10+i,9).toISOString(),customerId:i<3?'customer-1':'customer-2',writingOverdue:false,writingStatus:i===2?'已交稿':'写作中'}));
  state.papers[1].serviceType='half';state.papers[4].serviceType='half';state.papers[1].journal='客户提供文章的期刊';state.papers[1].writingOverdue=true;state.papers[3].writingOverdue=true;
  renderShell();`);
 for(const [tab,count] of [['all',5],['full',3],['half',2],['active',2],['overdue',1],['finished',1]]){
  await clickAction(handlers,{action:'tab',tab});assert.equal(run('filteredManagedPapers().length'),count,tab);
 }
 run("state.tab='all';state.status='写作中';state.customerId='customer-1';state.from='2026-01-10';state.to='2026-01-10';renderContent()");
 assert.equal(run('filteredManagedPapers().length'),1);
 assert.equal(run('filteredManagedPapers()[0].id'),'paper-0');
 run("state.status='';state.from='2026-01-11';state.to='2026-01-11';renderContent()");
 assert.equal(run('filteredManagedPapers()[0].id'),'paper-1');
 assert.match(nodes.get('#results').innerHTML,/2026\.01\.11/);
 run("state.from='';state.to='';state.search='客户提供文章的期刊';renderManagedPaperResults()");
 assert.equal(run('filteredManagedPapers().length'),1);
 run("state.from='2026-02-02';state.to='2026-01-01';renderManagedPaperResults()");
 assert.match(nodes.get('#results').innerHTML,/起始日期不能晚于截止日期/);
 await clickAction(handlers,{action:'clear-filters'});assert.equal(run('filteredManagedPapers().length'),5);
 run("state.papers=[];renderContent()");
 assert.match(nodes.get('#results').innerHTML,/还没有论文档案/);
 assert.match(nodes.get('#content').innerHTML,/data-action="new-paper"/);
 assert.match(nodes.get('#content').innerHTML,/data-action="new-writing"/);
 assert.ok(!nodes.get('#results').innerHTML.includes('data-action="new-paper"'));
});

test('saving each business form closes the drawer, updates its list and clears filters that hide saved rows',async()=>{
 for(const kind of ['half','full','writing','half-from-papers','edit-paper','customer','submission','transaction']){
  const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
  const half=['half','half-from-papers'].includes(kind);
  run(`globalThis.savedPaper={...state.papers[0],title:'保存后的论文',serviceType:'${half?'half':'full'}'};globalThis.savedCustomer={...state.customers[0],name:'保存后的客户'};globalThis.savedRequests=[];
   api=async(url,options={})=>{if(options.method){savedRequests.push({url,method:options.method,data:JSON.parse(options.body)});return ${kind==='customer'?'savedCustomer':'savedPaper'};}return url==='/api/papers'?[savedPaper]:[savedCustomer];};
   state.authenticated=true;state.view='records';state.tab='due';state.page=6;state.search='隐藏新记录的筛选';state.status='已拒稿';state.from='2026-01-01';state.customerId='missing';`);
  let id='paper-form',expected='records';
  if(kind==='customer'){
   id='customer-form';expected='customers';run('openCustomerEditor()');formValues(run,{name:'保存后的客户',status:'合作中'});
  }else if(kind==='submission'){
   id='submission-form';expected='submissions';run('openSubmissionEditor(state.papers[0])');formValues(run,{journal:'期刊乙',title:'本次投稿题目'});
  }else if(kind==='transaction'){
   id='transaction-form';expected='finance';run("state.drawer={kind:'detail',paper:state.papers[0]};transactionForm()");formValues(run,{type:'incoming_deposit',amount:'100',date:'2026-01-01'});
  }else{
   if(['writing','half-from-papers'].includes(kind)){run("state.view='papers'");expected='papers';}
   run(['full','writing'].includes(kind)?'openWritingEditor()':kind==='edit-paper'?'openEditor(state.papers[0])':'openEditor()');
   formValues(run,{title:'保存后的论文',serviceType:half?'half':'full'});
  }
  const {event,error}=formEvent(id);
  await Promise.all(handlers.get('submit').map(fn=>fn(event)));
  assert.equal(error.textContent,'',kind);
  assert.equal(run('savedRequests.length'),1,kind);
  assert.equal(run('state.drawer'),null,kind);
  assert.equal(nodes.get('#overlay-root').innerHTML,'',kind);
  assert.equal(run('document.body.style.overflow'),'',kind);
  assert.equal(run('state.view'),expected,kind);
  if(kind==='transaction')assert.equal(run('state.financeType'),'all');
  assert.equal(run('state.search'),'');assert.equal(run('state.status'),'');assert.equal(run('state.tab'),'all');assert.equal(run('state.page'),1);
  assert.match(nodes.get('#results').innerHTML,kind==='customer'?/保存后的客户/:/保存后的论文/);
  if(kind==='edit-paper'){assert.equal(run('savedRequests[0].method'),'PUT');assert.equal(run('savedRequests[0].data.version'),1);}
 }
});

test('a saved paper is visible and the form is closed even while list refresh is pending or fails',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`globalThis.savedPaper={...state.papers[0],title:'已保存的半包论文',serviceType:'half'};globalThis.messages=[];globalThis.savedRequests=[];
  toast=(message,error)=>messages.push({message,error});state.authenticated=true;
  api=async(url,options={})=>{if(options.method){savedRequests.push(url);return savedPaper;}if(url==='/api/papers')return new Promise((resolve,reject)=>{globalThis.rejectRefresh=reject;});return state.customers;};openEditor();`);
 formValues(run,{title:'已保存的半包论文',serviceType:'half'});
 const {event,submit}=formEvent('paper-form');
 const saving=Promise.all(handlers.get('submit').map(fn=>fn(event)));
 await Promise.all(handlers.get('submit').map(fn=>fn(event)));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(run('savedRequests.length'),1);
 assert.equal(run('state.drawer'),null);
 assert.equal(nodes.get('#overlay-root').innerHTML,'');
 assert.match(nodes.get('#results').innerHTML,/已保存的半包论文/);
 assert.equal(submit.disabled,true);
 assert.equal(submit.innerHTML,'保存中…');
 run("rejectRefresh(new Error('网络暂时不可用'))");await saving;
 assert.match(run('messages.at(-1).message'),/保存成功.*列表刷新失败/);
 assert.equal(run('state.papers[0].title'),'已保存的半包论文');
 assert.equal(nodes.get('#overlay-root').innerHTML,'');
});

test('failed saves retain entered data, report the error and allow retry',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run("api=async()=>{throw new Error('服务器拒绝保存，请检查日期');};openEditor();");
 const before=nodes.get('#overlay-root').innerHTML;
 formValues(run,{title:'尚未保存的论文',serviceType:'half'});
 const {event,submit,error}=formEvent('paper-form');
 await Promise.all(handlers.get('submit').map(fn=>fn(event)));
 assert.equal(run('state.drawer.kind'),'edit');
 assert.equal(nodes.get('#overlay-root').innerHTML,before);
 assert.match(error.textContent,/服务器拒绝保存/);
 assert.equal(submit.disabled,false);
 assert.equal(submit.innerHTML,'保存');
});

test('manuscript revisions render escaped names and notes with independent authenticated downloads',()=>{
 const {run,nodes}=app();seedBusiness(run);
 run(`state.papers[0].files=[{id:'first-file',revision:1,filename:'初稿.pdf',size:1234,note:'原稿',uploadedAt:'2026-01-01T00:00:00Z'},
 {id:'second-file',revision:2,filename:'修改稿<script>.docx',size:5678,note:'<img src=x onerror=alert(1)>',uploadedAt:'2026-01-02T00:00:00Z'}];
 state.drawer={kind:'detail',paper:state.papers[0],tab:'files'};renderDetail();`);
 const html=nodes.get('#overlay-root').innerHTML;
 assert.match(html,/文件与版本/);assert.match(html,/上传新版本/);assert.match(html,/最新版本/);
 assert.ok(html.indexOf('V2')<html.indexOf('V1'));
 assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img/);assert.ok(!html.includes('<img src=x'));
 assert.match(html,/\/files\/first-file/);assert.match(html,/\/files\/second-file/);
 run('openSubmissionEditor(state.papers[0])');
 assert.match(nodes.get('#overlay-root').innerHTML,/name="manuscriptId"/);
 assert.match(nodes.get('#overlay-root').innerHTML,/暂不关联稿件/);
});

test('a failed initial manuscript upload retries the saved paper without creating another record',async()=>{
 const {run,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`globalThis.savedPaper={...state.papers[0],id:'newly-saved',title:'带稿件的新论文',version:1};globalThis.requests=[];globalThis.uploads=0;
 selectedManuscript=()=>({name:'初稿.pdf',size:100});
 uploadManuscript=async p=>{uploads++;if(uploads===1)throw new Error('网络中断');return {...p,version:2,files:[{id:'file',revision:1}]};};
 api=async(url,options={})=>{if(options.method){requests.push({url,method:options.method});return {...savedPaper,version:requests.length};}return url==='/api/papers'?[savedPaper]:[];};openEditor();`);
 formValues(run,{title:'带稿件的新论文',serviceType:'half'});
 const {event,error,submit}=formEvent('paper-form');
 await Promise.all(handlers.get('submit').map(fn=>fn(event)));
 assert.match(error.textContent,/论文信息已保存.*稿件上传失败/);
 assert.equal(run('state.drawer.paper.id'),'newly-saved');assert.equal(run('state.drawer.pendingManuscript'),true);
 assert.equal(run('fileTransferBusy'),false);assert.equal(submit.disabled,false);
 await Promise.all(handlers.get('submit').map(fn=>fn(event)));
 assert.equal(run('uploads'),2);
 assert.equal(run('requests.filter(r=>r.method==="POST").length'),1);
 assert.equal(run('requests[1].method'),'PUT');assert.equal(run('state.drawer'),null);
});

test('uploaded manuscripts remain visible and downloadable when reopening either paper editor',()=>{
 const {run,nodes}=app();seedBusiness(run);
 run(`state.papers[0].files=[{id:'first-file',revision:1,filename:'初稿.pdf',size:1200,note:'初稿',uploadedAt:'2026-01-01T00:00:00Z'},
  {id:'revised-file',revision:2,filename:'修改稿<script>.docx',size:2400,note:'修改说明 <img src=x>',uploadedAt:'2026-01-02T00:00:00Z'}];`);
 for(const serviceType of ['full','half']){
  run(`state.papers[0].serviceType='${serviceType}';openEditor(state.papers[0])`);
  const html=nodes.get('#overlay-root').innerHTML;
  assert.match(html,/已上传稿件/);assert.match(html,/2 个/);
  assert.match(html,/初稿\.pdf/);assert.match(html,/修改稿&lt;script&gt;\.docx/);
  assert.match(html,/\/files\/first-file/);assert.match(html,/\/files\/revised-file/);
  assert.ok(html.indexOf('V2')<html.indexOf('V1'));
  assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x>'));
  assert.match(html,/保存后上传/);
 }
 run('openEditor()');assert.match(nodes.get('#overlay-root').innerHTML,/尚未上传稿件/);
});

test('paper lists and basic details expose saved file counts and a direct route to downloads',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`state.papers=state.papers.slice(0,1);state.papers[0].files=[{id:'saved-file',revision:1,filename:'已上传.docx',size:2000,note:'',uploadedAt:'2026-01-01T00:00:00Z'}];
  api=async()=>state.papers[0];`);
 for(const view of ['records','papers']){
  run(`state.view='${view}';renderShell()`);
  const html=nodes.get('#results').innerHTML;
  assert.match(html,/data-action="paper-files"/);assert.match(html,/稿件 1 个/);
 }
 await clickAction(handlers,{action:'paper-files',id:'paper-0'});
 assert.equal(run('state.drawer.tab'),'files');
 assert.match(nodes.get('#overlay-root').innerHTML,/已上传\.docx/);
 run("state.drawer.tab='basic';renderDetail()");
 const html=nodes.get('#overlay-root').innerHTML;
 assert.match(html,/最新稿件/);assert.match(html,/已上传\.docx/);assert.match(html,/\/files\/saved-file/);
 assert.match(html,/文件与版本（1）/);
});

test('successful uploads show the saved version immediately and refresh the underlying paper list',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`state.papers=state.papers.slice(0,1);state.view='papers';state.drawer={kind:'detail',paper:state.papers[0],tab:'files'};
  globalThis.uploads=0;selectedManuscript=()=>({name:'新上传稿件.pdf',size:100});
  uploadManuscript=async p=>{uploads++;return {...p,version:p.version+1,files:[{id:'uploaded-file',revision:1,filename:'新上传稿件.pdf',size:100,note:'',uploadedAt:'2026-01-01T00:00:00Z'}]};};renderShell();renderDetail();`);
 const {event,error}=formEvent('file-form');
 await Promise.all(handlers.get('submit').map(fn=>fn(event)));
 assert.equal(error.textContent,'');assert.equal(run('uploads'),1);
 assert.equal(run('state.drawer.paper.files[0].id'),'uploaded-file');
 assert.match(nodes.get('#overlay-root').innerHTML,/新上传稿件\.pdf/);
 assert.match(nodes.get('#overlay-root').innerHTML,/\/files\/uploaded-file/);
 assert.match(nodes.get('#results').innerHTML,/稿件 1 个/);
 run('openEditor(state.papers[0])');assert.match(nodes.get('#overlay-root').innerHTML,/新上传稿件\.pdf/);
});

test('file upload failure keeps the selected file form available for retry',async()=>{
 const {run,handlers,nodes}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`state.drawer={kind:'detail',paper:state.papers[0],tab:'files'};renderDetail();selectedManuscript=()=>({name:'修改稿.pdf',size:100});uploadManuscript=async()=>{throw new Error('磁盘空间不足');};`);
 const before=nodes.get('#overlay-root').innerHTML;
 const {event,error,submit}=formEvent('file-form');
 await Promise.all(handlers.get('submit').map(fn=>fn(event)));
 assert.match(error.textContent,/磁盘空间不足/);assert.equal(nodes.get('#overlay-root').innerHTML,before);
 assert.equal(submit.disabled,false);assert.equal(run('state.drawer.tab'),'files');
});

test('follow-up reasons appear in reminders, details, searched plans and CSV exports with escaped text',async()=>{
 const {run,nodes}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`state.papers=state.papers.slice(0,2);state.papers[0].followUpAt=today();state.papers[0].followUpReason='客户尚未确认修改意见 <script>alert(1)</script>';
 state.papers[1].followUpAt=today();delete state.papers[1].followUpReason;state.view='followups';renderShell();`);
 assert.match(nodes.get('#results').innerHTML,/跟进日期 \/ 事项/);
 assert.match(nodes.get('#results').innerHTML,/客户尚未确认修改意见 &lt;script&gt;/);
 assert.match(nodes.get('#results').innerHTML,/待补充跟进事项/);
 assert.ok(!nodes.get('#results').innerHTML.includes('<script>alert(1)</script>'));
 assert.match(run('overviewPanels()'),/客户尚未确认修改意见 &lt;script&gt;/);
 run("state.drawer={kind:'detail',paper:state.papers[0],tab:'basic'};renderDetail()");
 assert.match(nodes.get('#overlay-root').innerHTML,/跟进事项 \/ 由来/);
 assert.match(nodes.get('#overlay-root').innerHTML,/客户尚未确认修改意见 &lt;script&gt;/);
 run("state.search='确认修改意见'");assert.equal(run('filteredPapers().length'),1);assert.equal(run('filteredManagedPapers().length'),1);
 run("download=(name,blob)=>{globalThis.reasonExport={name,blob};};exportPapers()");
 let csv=await run('reasonExport.blob').text();assert.match(csv,/跟进事项 \/ 由来/);assert.match(csv,/客户尚未确认修改意见/);
 run('exportManagedPapers()');csv=await run('reasonExport.blob').text();assert.match(csv,/跟进事项 \/ 由来/);assert.match(csv,/客户尚未确认修改意见/);
 run('openEditor(state.papers[0])');const html=nodes.get('#overlay-root').innerHTML;
 assert.ok(html.indexOf('name="followUpAt"')<html.indexOf('name="followUpReason"'));
 assert.match(html,/name="followUpReason"[^>]*required/);assert.match(html,/maxlength="1000"/);
});

test('choosing a follow-up date requires context and removing the date makes it optional',async()=>{
 const {run,handlers}=app();await new Promise(resolve=>setImmediate(resolve));
 run("globalThis.calls=[];api=async(url,options)=>{calls.push({url,options});return {id:'saved'};};finishSave=async()=>{};state.drawer={kind:'edit',paper:null};");
 const fixture=validationForm(run,'paper-form',[
  {name:'title',label:'论文题目',required:true,value:'需跟进的论文'},
  {name:'followUpAt',label:'下次业务跟进日期',type:'date',value:'2030-01-12'},
  {name:'followUpReason',label:'跟进事项 / 由来',tagName:'TEXTAREA',value:'   '},
 ]);
 await Promise.all(handlers.get('change').map(fn=>fn({target:fixture.controls.followUpAt})));
 assert.equal(fixture.controls.followUpReason.required,true);
 await Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));
 assert.equal(run('calls.length'),0);assert.match(fixture.summary.textContent,/跟进事项/);
 assert.ok(fixture.controls.followUpReason.focusCount>0);
 fixture.controls.followUpReason.value='客户未回复，需要联系确认修改意见';
 await Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));
 assert.equal(run('calls.length'),1);assert.match(JSON.parse(run('calls[0].options.body')).followUpReason,/客户未回复/);
 fixture.controls.followUpAt.value='';fixture.controls.followUpReason.value='';
 await Promise.all(handlers.get('change').map(fn=>fn({target:fixture.controls.followUpAt})));
 assert.equal(fixture.controls.followUpReason.required,false);
 await Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));
 assert.equal(run('calls.length'),2);
});

test('paper category tabs filter matching records and keep details available',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`state.papers=state.papers.slice(0,6).map((p,i)=>({...p,serviceType:i===5?'half':'full',
  writingStatus:['写作中','待修改','待分配','已完成','已取消','写作中'][i],
  writingOverdue:[true,false,true,false,false,true][i],payableCents:[3000000,1300000,0,20000,0,9000000][i]}));
  state.view='papers';globalThis.requests=[];api=async path=>{requests.push(path);return state.papers.find(p=>path.endsWith('/'+p.id));};`);
 const sourceIds=()=>JSON.parse(run('JSON.stringify(filteredManagedPapers().map(p=>p.id).sort())'));
 for(const [tab,expected] of [['all',[0,1,2,3,4,5]],['active',[0,1,2]],['overdue',[0,2]],['payable',[0,1,3]]]){
  run("resetFilters();state.page=9;");
  await clickAction(handlers,{action:'tab',tab});
  assert.equal(run('state.view'),'papers');assert.equal(run('state.tab'),tab);assert.equal(run('state.page'),1);
  for(const field of ['search','status','from','to','customerId'])assert.equal(run(`state.${field}`),'');
  assert.deepEqual(sourceIds(),expected.map(i=>'paper-'+i));
  assert.match(nodes.get('#content').innerHTML,new RegExp(`data-action="tab" data-tab="${tab}" role="tab" aria-selected="true"`));
 }
 assert.equal(run('requests.length'),0);
 assert.match(nodes.get('#results').innerHTML,/待付写作稿酬 ¥43,200.00/);
 assert.match(nodes.get('#results').innerHTML,/当前筛选 3 篇/);
 run('download=(name,blob)=>{globalThis.statExport={name,blob};};exportManagedPapers()');
 const csv=await run('statExport.blob').text();
 for(const index of [0,1,3])assert.ok(csv.includes('LW-2026-'+index));
 for(const index of [2,4,5])assert.ok(!csv.includes('LW-2026-'+index));
 await clickAction(handlers,{action:'detail-finance',id:'paper-1'});
 assert.equal(run('state.drawer.paper.id'),'paper-1');assert.equal(run('state.drawer.tab'),'finance');
});

test('paper statistics use shared display cards while category tabs stay interactive',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run("state.view='papers';state.papers=state.papers.slice(0,1).map(p=>({...p,writingStatus:'已完成',writingOverdue:false,payableCents:0}));renderShell()");
 const html=nodes.get('#content').innerHTML;
 assert.equal([...html.matchAll(/<div class="stat-card">/g)].length,4);
 assert.ok(!html.includes('paper-source'));assert.ok(!html.includes('stat-card-link'));assert.ok(!html.includes('查看明细'));
 assert.ok(!/<button\b[^>]*class="stat-card/.test(html));
 for(const tab of ['active','overdue','payable']){
  await clickAction(handlers,{action:'tab',tab});
  assert.equal(run('filteredManagedPapers().length'),0);assert.equal(run('state.tab'),tab);
  assert.match(nodes.get('#results').innerHTML,/没有符合条件的论文/);
 }
 await clickAction(handlers,{action:'tab',tab:'all'});
 assert.equal(run('filteredManagedPapers().length'),1);
});

test('paper rows retain writing and financial data with labeled cells and one consistent action group',()=>{
 const {run,nodes}=app();seedBusiness(run);
 run(`state.papers=state.papers.slice(0,2);state.papers.forEach(p=>p.transactions=[]);
 Object.assign(state.papers[0],{title:'很长的论文题目'.repeat(30)+'<script>alert(1)</script>',writer:'写作人员甲',writingStatus:'已交稿',writingStartAt:'2026-01-02',writingDueAt:'2026-01-10',writingDeliveredAt:'2026-01-12',writingDays:10,writingOverdue:false,contractCents:100000000,contractDepositCents:20000000,writerFeeCents:30000000,writerDepositCents:5000000,writerBalanceCents:25000000,outgoing_depositCents:5000000,outgoing_balanceCents:10000000,payableCents:15000000});
 Object.assign(state.papers[1],{serviceType:'half',submissions:[]});state.view='papers';renderShell();`);
 const html=nodes.get('#results').innerHTML;
 const rows=[...html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(match=>match[1]);
 assert.equal(rows.length,2);
 const columnLabels=['论文题目 / 编号','客户 / 作者','关联期刊','写作安排 / 进度','服务费用 / 稿酬','写作付款','操作'];
 for(const [index,row] of rows.entries()){
  const cells=[...row.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/g)];
  assert.equal(cells.length,8);assert.deepEqual(cells.slice(1).map(cell=>cell[1].match(/data-label="([^"]+)"/)[1]),columnLabels);
  const actions=cells.at(-1)[2];assert.match(actions,/role="group" aria-label="论文操作"/);
  assert.deepEqual([...actions.matchAll(/data-action="([^"]+)"/g)].map(m=>m[1]),['edit-paper','detail-finance',index?'new-submission':'resubmit-paper','delete-paper']);
  const actionButtons=[...actions.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];assert.equal(actionButtons.length,4);
  for(const button of actionButtons){assert.match(button[2],/<svg class="icon"/);assert.ok(button[1].includes(`="paper-${index}"`));}
  assert.ok(!actions.includes('cell-sub'));assert.ok(!row.includes('private-secret-42'));
 }
 const fullText=rows[0].replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
 for(const value of ['写作人员甲','已交稿','开始 2026.01.02','预计交稿 2026.01.10','实际交稿 2026.01.12','写作时长 10 天','服务费 ¥1,000,000.00','收款定金 ¥200,000.00','尾款 ¥800,000.00','稿酬 ¥300,000.00','写作定金 ¥50,000.00','尾款 ¥250,000.00','已付定金 ¥50,000.00','已付尾款 ¥100,000.00','待付稿酬 ¥150,000.00'])assert.ok(fullText.includes(value),value);
 assert.ok(!fullText.includes('已逾期'));
 assert.ok(!rows[0].includes('<script>alert(1)</script>'));assert.match(rows[0],/&lt;script&gt;/);
 assert.match(rows[1],/客户供稿/);assert.match(rows[1],/无需安排写作/);assert.match(rows[1],/无需写作稿酬/);
 assert.ok(!rows[1].includes('paper-writing-dates'));assert.ok(!rows[1].includes('paper-payment-list'));
 assert.equal([...html.matchAll(/<th\b/g)].length,8);assert.match(html,/<table class="managed-paper-table">/);
});

test('author counts use paper bylines, deduplicate repeated names and keep English names intact',()=>{
 const {run}=app();
 run("state.papers=[{authors:'张三、李四,张三；王五\\r\\nＡｌｉｃｅ　Ｓｍｉｔｈ;alice smith'},{authors:'张三'},{authors:''}]");
 assert.deepEqual(JSON.parse(run('JSON.stringify(linkedAuthors(state.papers))')), [
  {name:'Alice Smith',paperCount:1},{name:'张三',paperCount:2},{name:'李四',paperCount:1},{name:'王五',paperCount:1}]);
 assert.deepEqual(JSON.parse(run("JSON.stringify(authorNames('  ,、;  '))")),[]);
});

test('customers link to papers and keep each paper author list in its own card',async()=>{
 const {run,nodes}=app();seedBusiness(run);
 run(`state.username='account-a';state.papers=state.papers.slice(0,3);
  state.papers[0].authors='张三、李四';state.papers[1].authors='张三';state.papers[2].authors='<img src=x onerror=alert(1)>';
  state.papers[2].customerId='another-customer';syncCustomerSummaries();state.view='customers';renderShell();`);
 assert.ok(!nodes.get('#content').innerHTML.includes('当前客户关联作者'));
 assert.ok(!nodes.get('#results').innerHTML.includes('张三'));
 assert.ok(!nodes.get('#results').innerHTML.includes('关联作者'));
 assert.match(nodes.get('#results').innerHTML,/<th>关联论文<\/th>/);
 assert.match(nodes.get('#results').innerHTML,/data-action="customer-papers" data-id="customer-1"/);
 assert.match(nodes.get('#results').innerHTML,/>2 篇论文/);
 assert.ok(!nodes.get('#results').innerHTML.includes('论文 / 已发表'));
 run("state.drawer={kind:'customer-detail',customerTab:'papers',customer:{...state.customers[0],papers:state.papers.slice(0,2)}};renderCustomerDetail()");
 const html=nodes.get('#overlay-root').innerHTML;
 assert.ok(!html.includes('关联作者'));
 const cards=[...html.matchAll(/<article class="customer-paper">([\s\S]*?)<\/article>/g)].map(m=>m[1]);
 assert.equal(cards.length,2);
 assert.match(cards[0],/共同作者：张三、李四/);assert.match(cards[1],/作者：张三/);
 assert.ok(!cards[1].includes('李四'));assert.ok(!html.includes('onerror'));
 run('download=(name,blob)=>{globalThis.authorExport={name,blob};};exportCustomers()');
 const csv=await run('authorExport.blob').text();
 assert.match(csv,/关联论文数/);assert.ok(!csv.includes('关联作者'));
 run('exportManagedPapers()');const paperCsv=await run('authorExport.blob').text();
 assert.match(paperCsv,/作者/);assert.match(paperCsv,/张三、李四/);
});

test('coauthors share one paper and remain associated with their own paper',()=>{
 const {run,nodes}=app();seedBusiness(run);
 run(`state.papers=state.papers.slice(0,1);state.papers[0].authors='丁妹、丁懿';state.papers[0].title='两位作者合著的论文';
  state.papers[0].published=true;state.papers[0].publishedJournals=['期刊甲'];
  syncCustomerSummaries();state.drawer={kind:'customer-detail',customerTab:'papers',customer:{...state.customers[0],papers:state.papers}};renderCustomerDetail();`);
 let html=nodes.get('#overlay-root').innerHTML;
 assert.match(html,/共同作者：丁妹、丁懿/);
 assert.equal([...html.matchAll(/<article class="customer-paper">/g)].length,1);
 assert.ok(!html.includes('author-chips'));
 assert.equal(run('state.customers[0].paperCount'),1);
 assert.equal(run('state.customers[0].publishedPaperCount'),1);
 run(`state.papers.push({...state.papers[0],id:'second-paper',published:false,authors:'丁懿、王五'});syncCustomerSummaries();
  state.drawer.customer={...state.customers[0],papers:state.papers};renderCustomerDetail()`);
 html=nodes.get('#overlay-root').innerHTML;
 assert.match(html,/共同作者：丁妹、丁懿/);assert.match(html,/共同作者：丁懿、王五/);
 assert.equal([...html.matchAll(/<article class="customer-paper">/g)].length,2);
 assert.equal(run('state.customers[0].publishedPaperCount'),1);
 assert.equal(run("paperAuthorByline({authors:'<script>alert(1)</script>、张三'})"),'<p>共同作者：&lt;script&gt;alert(1)&lt;/script&gt;、张三</p>');
});

test('customer papers paginate and search without changing the customer list filters',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 nodes.set('#customer-paper-results',{innerHTML:''});
 nodes.set('#customer-paper-pagination',{innerHTML:''});
 run(`state.papers=Array.from({length:12},(_,i)=>({...state.papers[0],id:'paper-'+i,code:'LW-'+i,title:'关联论文 '+i,
  authors:i===6?'特定作者、共同作者':i===11?'':'普通作者'}));syncCustomerSummaries();state.view='customers';state.search='客户乙';state.page=2;
  state.drawer={kind:'customer-detail',customerTab:'papers',customer:{...state.customers[0],papers:state.papers}};renderCustomerDetail();`);
 let html=nodes.get('#overlay-root').innerHTML;
 assert.equal([...html.matchAll(/<article class="customer-paper">/g)].length,3);
 assert.match(html,/共 12 篇，显示 1–3 篇/);
 assert.match(html,/data-page="0" disabled/);
 await clickAction(handlers,{action:'customer-paper-page',page:'2'});
 html=nodes.get('#customer-paper-results').innerHTML;
 assert.match(nodes.get('#customer-paper-pagination').innerHTML,/共 12 篇，显示 4–6 篇/);
 assert.match(html,/aria-label="序号 4"/);assert.ok(!html.includes('data-id="paper-0"'));
 await clickAction(handlers,{action:'customer-paper-page',page:'4'});
 html=nodes.get('#customer-paper-results').innerHTML;
 assert.equal([...html.matchAll(/<article class="customer-paper">/g)].length,3);
 assert.match(html,/作者：未填写作者/);assert.match(nodes.get('#customer-paper-pagination').innerHTML,/data-page="5" disabled/);
 const search=async value=>Promise.all(handlers.get('input').map(fn=>fn({target:{id:'customer-paper-search',value}})));
 await search(' 特定作者 ');html=nodes.get('#customer-paper-results').innerHTML;
 assert.match(html,/data-id="paper-6"/);assert.match(html,/共同作者：特定作者、共同作者/);
 assert.equal([...html.matchAll(/<article class="customer-paper">/g)].length,1);
 assert.equal(run('state.drawer.paperPage'),1);assert.equal(run('state.page'),2);assert.equal(run('state.search'),'客户乙');
 await search('lw-11');assert.match(nodes.get('#customer-paper-results').innerHTML,/data-id="paper-11"/);
 await search('不存在的作者');assert.match(nodes.get('#customer-paper-results').innerHTML,/没有符合条件的论文/);
 await search('');assert.match(nodes.get('#customer-paper-pagination').innerHTML,/显示 1–3 篇/);
});

test('long paper bylines expand inside their own paper and escape author markup',()=>{
 const {run}=app();
 const html=run("paperAuthorByline({authors:'张三、李四、王五、赵六、<img src=x onerror=alert(1)>'})");
 assert.match(html,/<details class="paper-authors">/);
 assert.match(html,/<summary>作者：张三、李四、王五 等 5 位<\/summary>/);
 assert.match(html,/赵六、&lt;img src=x onerror=alert\(1\)&gt;/);assert.ok(!html.includes('<img'));
 assert.equal(run("paperAuthorByline({authors:''})"),'<p>作者：未填写作者</p>');
});

test('customer paper count opens only that customer papers and retains paper detail links',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run("api=async()=>({...state.customers[0],papers:state.papers.slice(0,1)});");
 await clickAction(handlers,{action:'customer-papers',id:'customer-1'});
 assert.equal(run('state.drawer.kind'),'customer-detail');assert.equal(run('state.drawer.customer.id'),'customer-1');
 assert.equal(run('state.drawer.customerTab'),'papers');
 assert.equal(run('state.drawer.paperPage'),1);assert.equal(run('state.drawer.paperSearch'),'');
 const html=nodes.get('#overlay-root').innerHTML;
 assert.match(html,/data-action="detail" data-id="paper-0"/);assert.ok(!html.includes('data-id="paper-1"'));
 run("api=async()=>state.papers[0]");await clickAction(handlers,{action:'detail',id:'paper-0'});
 assert.equal(run('state.drawer.kind'),'detail');assert.equal(run('state.drawer.paper.id'),'paper-0');
});

test('customer tabs separate profile content from a large paper list and retain the current search page',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 nodes.set('#customer-paper-results',{innerHTML:'',scrollTop:120});
 nodes.set('#customer-paper-pagination',{innerHTML:''});
 run(`state.papers=Array.from({length:100},(_,i)=>({...state.papers[0],id:'many-'+i,title:'客户关联论文 '+i}));
  syncCustomerSummaries();api=async()=>({...state.customers[0],notes:'需要保留的客户备注',papers:state.papers});`);
 await clickAction(handlers,{action:'customer-detail',id:'customer-1'});
 let html=nodes.get('#overlay-root').innerHTML;
 assert.equal(run('state.drawer.customerTab'),'info');
 assert.match(html,/id="customer-tab-info"[^>]*aria-selected="true"/);
 assert.match(html,/客户类型/);assert.match(html,/需要保留的客户备注/);
 assert.ok(!html.includes('class="customer-paper"'));assert.ok(!html.includes('id="customer-paper-search"'));
 await clickAction(handlers,{action:'customer-detail-tab',tab:'papers'});
 html=nodes.get('#overlay-root').innerHTML;
 assert.match(html,/id="customer-tab-papers"[^>]*aria-selected="true"/);
 assert.match(html,/class="customer-paper-panel"/);assert.match(html,/共 100 篇，显示 1–3 篇/);
 assert.equal([...html.matchAll(/<article class="customer-paper">/g)].length,3);
 assert.ok(!html.includes('需要保留的客户备注'));assert.ok(!html.includes('手机号'));
 const toolbar=html.indexOf('class="customer-paper-toolbar"'),list=html.indexOf('id="customer-paper-results"'),paging=html.indexOf('id="customer-paper-pagination"');
 assert.ok(toolbar<list&&list<paging);
 await Promise.all(handlers.get('input').map(fn=>fn({target:{id:'customer-paper-search',value:'关联论文'}})));
 await clickAction(handlers,{action:'customer-paper-page',page:'4'});
 assert.equal(nodes.get('#customer-paper-results').scrollTop,0);
 await clickAction(handlers,{action:'customer-detail-tab',tab:'info'});
 assert.ok(!nodes.get('#overlay-root').innerHTML.includes('class="customer-paper"'));
 await clickAction(handlers,{action:'customer-detail-tab',tab:'papers'});
 html=nodes.get('#overlay-root').innerHTML;
 assert.equal(run('state.drawer.paperPage'),4);assert.equal(run('state.drawer.paperSearch'),'关联论文');
 assert.match(html,/共 100 篇，显示 10–12 篇/);assert.match(html,/value="关联论文"/);
 await clickAction(handlers,{action:'edit-customer'});
 assert.equal(run('state.drawer.kind'),'customer-edit');
 await clickAction(handlers,{action:'cancel-customer'});
 assert.equal(run('state.drawer.customerTab'),'papers');assert.equal(run('state.drawer.paperPage'),4);
 assert.match(nodes.get('#overlay-root').innerHTML,/共 100 篇，显示 10–12 篇/);
});

test('customer paper status choices match the business and filter by the current submission state',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 nodes.set('#customer-paper-results',{innerHTML:''});nodes.set('#customer-paper-pagination',{innerHTML:''});
 const businessStatuses=['草稿','待投稿','已投稿','审稿中','修改中','已录用','已发表','已拒稿','已撤稿'];
 run(`state.papers=state.papers.slice(0,9).map((p,i)=>({...p,id:'state-'+i,status:statuses[i],activeSubmissionId:'current-'+i,
  published:true,publishedJournals:['历史发表期刊'],submissions:[{id:'old-'+i,status:'已发表',journal:'历史发表期刊'},
  {id:'current-'+i,status:statuses[i],journal:'当前期刊'}]}));
  state.view='records';state.tab='all';state.drawer={kind:'customer-detail',customerTab:'papers',customer:{...state.customers[0],papers:state.papers}};
  renderCustomerDetail();`);
 const html=nodes.get('#overlay-root').innerHTML;
 const choices=[...html.matchAll(/role="option"[^>]*data-status="([^"]*)"[^>]*>[\s\S]*?<span>([^<]*)<\/span><\/div>/g)].map(m=>[m[1],m[2]]);
 assert.deepEqual(choices,[['','全部状态'],...businessStatuses.map(status=>[status,status])]);
 assert.match(html,/class="customer-paper-status-picker" id="customer-paper-status-picker"><div class="customer-paper-status-control"><button type="button"[^>]*aria-haspopup="listbox"/);
 assert.match(html,/id="customer-paper-status-options" role="listbox"[^>]*hidden/);
 assert.match(html,/class="customer-paper-page-size">每页 <strong>3<\/strong> 篇/);
 const styles=fs.readFileSync(path.join(__dirname,'../web/styles.css'),'utf8');
 assert.match(styles,/\.customer-paper-status-menu\[hidden\]\{display:none\}/);
 assert.match(styles,/\.customer-paper-status-option\.is-selected\{[^}]*background:#edf5f0/);
 assert.match(styles,/\.customer-paper-status-menu\{position:absolute;z-index:140/);
 assert.ok(!html.includes('customer-published-only'));assert.ok(!html.includes('仅看已发表'));
 const filter=async status=>clickAction(handlers,{action:'customer-paper-status-option',status});
 for(const [i,status] of businessStatuses.entries()){
  run('state.drawer.paperPage=3');await filter(status);
  run(`state.status=${JSON.stringify(status)}`);
  assert.equal(run('state.drawer.paperPage'),1);
  assert.equal(run('customerPaperPage().total'),1,status);
  assert.equal(run('customerPaperPage().papers[0].id'),'state-'+i,status);
  assert.equal(run('filteredPapers()[0].id'),'state-'+i,status+' matches the overview');
  assert.match(nodes.get('#customer-paper-results').innerHTML,new RegExp(`data-id="state-${i}"`));
 }
 await filter('');assert.equal(run('customerPaperPage().total'),9);
 assert.match(nodes.get('#customer-paper-pagination').innerHTML,/共 9 篇，显示 1–3 篇/);
});

test('customer status filters combine with author search, persist across tabs and edits, and reset pagination',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 nodes.set('#customer-paper-results',{innerHTML:''});nodes.set('#customer-paper-pagination',{innerHTML:''});
 run(`state.papers=Array.from({length:8},(_,i)=>({...state.papers[0],id:'outcome-'+i,title:'论文 '+i,authors:i===6?'目标作者':'其他作者',
  status:[2,4,6,7].includes(i)?'审稿中':'已拒稿',published:false,publishedJournals:[],submissions:[]}));
  syncCustomerSummaries();state.search='外层客户搜索';state.status='待投稿';state.page=2;
  state.drawer={kind:'customer-detail',customerTab:'papers',paperPage:3,customer:{...state.customers[0],papers:state.papers}};
  renderCustomerDetail();`);
 const filter=async status=>clickAction(handlers,{action:'customer-paper-status-option',status});
 await filter('审稿中');
 let html=nodes.get('#customer-paper-results').innerHTML;
 assert.equal(run('state.drawer.paperPage'),1);assert.equal([...html.matchAll(/<article class="customer-paper">/g)].length,3);
 for(const i of [2,4,6])assert.ok(html.includes(`data-id="outcome-${i}"`));
 assert.ok(!html.includes('data-id="outcome-0"'));
 await clickAction(handlers,{action:'customer-paper-page',page:'2'});
 assert.match(nodes.get('#customer-paper-pagination').innerHTML,/共 4 篇，显示 4–4 篇/);
 assert.match(nodes.get('#customer-paper-results').innerHTML,/data-id="outcome-7"/);
 await Promise.all(handlers.get('input').map(fn=>fn({target:{id:'customer-paper-search',value:'目标作者'}})));
 html=nodes.get('#customer-paper-results').innerHTML;
 assert.match(html,/data-id="outcome-6"/);assert.equal([...html.matchAll(/<article class="customer-paper">/g)].length,1);
 assert.equal(run('state.drawer.paperPage'),1);
 await clickAction(handlers,{action:'customer-detail-tab',tab:'info'});
 await clickAction(handlers,{action:'customer-detail-tab',tab:'papers'});
 assert.match(nodes.get('#overlay-root').innerHTML,/aria-label="投稿状态：审稿中"/);
 await clickAction(handlers,{action:'edit-customer'});await clickAction(handlers,{action:'cancel-customer'});
 assert.equal(run('state.drawer.paperStatus'),'审稿中');assert.equal(run('state.drawer.paperSearch'),'目标作者');
 assert.match(nodes.get('#overlay-root').innerHTML,/aria-label="投稿状态：审稿中"/);
 await filter('已拒稿');assert.match(nodes.get('#customer-paper-results').innerHTML,/没有符合条件的论文/);
 await filter('');assert.match(nodes.get('#customer-paper-results').innerHTML,/data-id="outcome-6"/);
 assert.equal(run('state.status'),'待投稿');assert.equal(run('state.search'),'外层客户搜索');assert.equal(run('state.page'),2);
 await Promise.all(handlers.get('input').map(fn=>fn({target:{id:'customer-paper-search',value:'不存在'}})));
 assert.match(nodes.get('#customer-paper-results').innerHTML,/没有符合条件的论文/);
 const paging=nodes.get('#customer-paper-pagination').innerHTML;
 assert.match(paging,/共 0 篇/);assert.equal([...paging.matchAll(/ disabled/g)].length,2);
 assert.equal(run('state.drawer.paperPage'),1);
});

test('custom customer status menu supports keyboard selection, escape, and outside-click dismissal',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run('requestAnimationFrame=callback=>callback()');
 nodes.set('#customer-paper-results',{innerHTML:''});nodes.set('#customer-paper-pagination',{innerHTML:''});
 const picker={innerHTML:''},trigger={focusCount:0,focus(){this.focusCount++;}},optionNodes=[];
 const menu={attributes:{},focusCount:0,focus(){this.focusCount++;},scrollIntoView(){},setAttribute(name,value){this.attributes[name]=value;},querySelectorAll(){return optionNodes;}};
 for(let index=0;index<10;index++){
  const option={id:`customer-paper-status-option-${index}`,classes:new Set(),scrollCount:0,scrollIntoView(){this.scrollCount++;}};
  option.classList={toggle(name,on){if(on)option.classes.add(name);else option.classes.delete(name);}};optionNodes.push(option);
  nodes.set('#'+option.id,option);
 }
 nodes.set('#customer-paper-status-picker',picker);nodes.set('#customer-paper-status-options',menu);nodes.set('#customer-paper-status-button',trigger);
 run("state.drawer={kind:'customer-detail',customerTab:'papers',paperSearch:'',paperPage:3,paperStatus:'',customer:{...state.customers[0],papers:state.papers}};");
 await clickAction(handlers,{action:'customer-paper-status-toggle'});
 assert.equal(run('state.drawer.paperStatusOpen'),true);assert.match(picker.innerHTML,/aria-expanded="true"/);
 const key=key=>run(`handleCustomerPaperStatusKeydown({key:${JSON.stringify(key)},preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true}})`);
 key('ArrowDown');assert.equal(run('state.drawer.paperStatusActiveIndex'),1);
 assert.equal(menu.attributes['aria-activedescendant'],'customer-paper-status-option-1');
 assert.ok(optionNodes[1].classes.has('is-active'));assert.ok(optionNodes[1].scrollCount>0);
 key('Enter');assert.equal(run('state.drawer.paperStatus'),'草稿');assert.equal(run('state.drawer.paperPage'),1);
 assert.equal(run('state.drawer.paperStatusOpen'),false);assert.ok(trigger.focusCount>0);
 await clickAction(handlers,{action:'customer-paper-status-toggle'});key('End');
 assert.equal(run('state.drawer.paperStatusActiveIndex'),9);key('Escape');
 assert.equal(run('state.drawer.paperStatusOpen'),false);assert.equal(run('state.drawer.kind'),'customer-detail');
 await clickAction(handlers,{action:'customer-paper-status-toggle'});
 const outside={dataset:{action:'customer-detail-tab',tab:'info'},disabled:false,isConnected:true};
 const event={target:{closest(selector){return selector==='[data-action]'?outside:null;}}};
 await Promise.all(handlers.get('click').map(handler=>handler(event)));
 assert.equal(run('state.drawer.paperStatusOpen'),false);assert.equal(run('state.drawer.customerTab'),'info');
});

test('customer paper summaries stay compact with many publication records and link to the full history',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`state.papers[0].submissions=Array.from({length:100},(_,i)=>({id:'publication-'+i,status:'已发表',
  journal:i===99?'<script>期刊</script>':'期刊 '+i,publishedAt:i===99?'2026-11-01':'2026-01-01'}));
  state.drawer={kind:'customer-detail',customerTab:'papers',customer:{...state.customers[0],papers:[state.papers[0]]}};renderCustomerDetail();`);
 const html=nodes.get('#overlay-root').innerHTML;
 assert.equal([...html.matchAll(/class="customer-publication"/g)].length,1);
 assert.ok(!html.includes('class="publication-line"'));
 assert.match(html,/共 100 次发表/);assert.match(html,/2026\.11\.01/);
 assert.match(html,/&lt;script&gt;期刊&lt;\/script&gt;/);assert.ok(!html.includes('<script>期刊'));
 run('api=async()=>state.papers[0]');
 await clickAction(handlers,{action:'submission-detail',paperId:'paper-0'});
 assert.equal(run('state.drawer.tab'),'submissions');assert.equal(run('state.drawer.paper.submissions.length'),100);
 run("state.drawer={kind:'customer-detail',customerTab:'papers',customer:{...state.customers[0],paperCount:0,papers:[]}};renderCustomerDetail()");
 assert.match(nodes.get('#overlay-root').innerHTML,/暂无关联论文/);
 assert.match(nodes.get('#overlay-root').innerHTML,/data-action="navigate" data-view="papers"/);
});

test('writing fee entry separates terms, auto-calculated tail and newly recorded payments',()=>{
 const {run,nodes}=app();seedBusiness(run);
 run("Object.assign(state.papers[0],{writerFeeCents:300000,writerDepositCents:150000,outgoing_depositCents:150000,outgoing_balanceCents:0});openWritingEditor(state.papers[0]);");
 const html=nodes.get('#overlay-root').innerHTML;
 assert.match(html,/确认稿酬约定/);assert.match(html,/登记实际已付款/);
 assert.match(html,/name="writerBalanceAmount"[^>]*value="1500.00"[^>]*readonly/);
 assert.match(html,/name="writerPaymentDeposit"[^>]*value="0.00"/);
 assert.match(html,/name="writerPaymentBalance"[^>]*value="0.00"/);
 assert.match(html,/已有记录：已付定金 ¥1,500.00/);
 assert.match(html,/下方只填本次新增金额/);
 assert.match(run('writingPaymentsCell(state.papers[0])'),/登记尾款/);
 assert.ok(!run('writingPaymentsCell(state.papers[0])').includes('登记定金'));
 assert.match(run('writingPaymentSummary(state.papers[0],true)'),/¥3,000.00 − 已付定金 ¥1,500.00 − 已付尾款 ¥0.00 = ¥1,500.00/);
 run("openEditor(null,'');");assert.ok(!nodes.get('#overlay-root').innerHTML.includes('name="writerPaymentDeposit"'));
});

test('writing payments need explicit confirmation and actual dates and submit atomically with the paper',async()=>{
 const {run,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`openWritingEditor();globalThis.calls=[];globalThis.finished=false;
  api=async(url,options)=>{calls.push({url,data:JSON.parse(options.body)});return {...state.papers[0],writerFeeCents:300000,writerDepositCents:150000,outgoing_depositCents:150000,outgoing_balanceCents:0};};finishSave=async()=>{finished=true;};`);
 const fixture=validationForm(run,'paper-form',[
  {name:'title',label:'论文题目',value:'同时补记付款',required:true},
  {name:'writerFee',label:'约定总稿酬',type:'number',value:'3000'},
  {name:'writerDepositAmount',label:'约定定金',type:'number',value:'1500'},
  {name:'writerBalanceAmount',label:'约定尾款',type:'number',value:'0',readOnly:true},
  {name:'writerPaymentDeposit',label:'本次登记已付定金',type:'number',value:'1500'},
  {name:'writerPaymentDepositDate',label:'定金实际支付日期',type:'date',value:''},
  {name:'writerPaymentBalance',label:'本次登记已付尾款',type:'number',value:'0'},
  {name:'writerPaymentBalanceDate',label:'尾款实际支付日期',type:'date',value:''},
  {name:'confirmWriterPayments',label:'确认实际已付',type:'checkbox',value:'yes',checked:false},
 ]);
 await Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));
 assert.equal(run('calls.length'),0);assert.equal(fixture.controls.writerBalanceAmount.value,'1500.00');
 assert.equal(fixture.controls.writerPaymentDepositDate.required,true);assert.equal(fixture.controls.writerPaymentBalanceDate.required,false);
 fixture.controls.writerPaymentDepositDate.value='2026-01-02';
 await Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));
 assert.equal(run('calls.length'),0);assert.match(fixture.controls.confirmWriterPayments.inlineError.textContent,/勾选确认/);
 fixture.controls.confirmWriterPayments.checked=true;
 await Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));
 assert.equal(run('calls.length'),1);assert.equal(run('finished'),true);
 const data=run('calls[0].data');assert.ok(data.createRequestId);assert.equal(data.confirmWriterPayments,true);
 assert.deepEqual(JSON.parse(JSON.stringify(data.writerPayments)),[{type:'outgoing_deposit',amount:'1500',date:'2026-01-02',method:'',note:'论文表单登记实际付款'}]);
 assert.ok(!('writerBalanceAmount' in data));assert.ok(!('writerPaymentDeposit' in data));
 assert.equal(fixture.controls.writerPaymentDeposit.value,'0.00');assert.equal(fixture.controls.confirmWriterPayments.checked,false);
});

test('writing payment previews use cents and reject amounts beyond the remaining planned payment',async()=>{
 const {run,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run("state.drawer={kind:'edit',paper:null};globalThis.calls=[];api=async(...args)=>{calls.push(args);return state.papers[0];};finishSave=async()=>{};");
 const fixture=validationForm(run,'paper-form',[
  {name:'title',label:'论文题目',value:'小数测试'},
  {name:'writerFee',label:'约定总稿酬',type:'number',value:'0.30'},
  {name:'writerDepositAmount',label:'约定定金',type:'number',value:'0.10'},
  {name:'writerBalanceAmount',label:'约定尾款',type:'number',value:'0',readOnly:true},
  {name:'writerPaymentDeposit',label:'本次定金',type:'number',value:'0.11'},
  {name:'writerPaymentDepositDate',label:'实际支付日期',type:'date',value:'2026-01-02'},
  {name:'confirmWriterPayments',label:'确认',type:'checkbox',value:'yes',checked:true},
 ]);
 await Promise.all(handlers.get('input').map(fn=>fn({target:fixture.controls.writerDepositAmount})));
 assert.equal(fixture.controls.writerBalanceAmount.value,'0.20');
 await Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));
 assert.equal(run('calls.length'),0);assert.match(fixture.controls.writerPaymentDeposit.inlineError.textContent,/剩余约定定金/);
 fixture.controls.writerPaymentDeposit.value='0.001';
 await Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));
 assert.equal(run('calls.length'),0);assert.match(fixture.controls.writerPaymentDeposit.inlineError.textContent,/最多两位小数/);
 fixture.controls.writerPaymentDeposit.value='0';
 await Promise.all(handlers.get('change').map(fn=>fn({target:fixture.controls.writerPaymentDeposit})));
 assert.equal(fixture.controls.writerPaymentDepositDate.required,false);assert.equal(fixture.controls.confirmWriterPayments.required,false);
});

test('payment shortcuts prefill the remaining amount and require actual payment confirmation',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`Object.assign(state.papers[0],{writerFeeCents:300000,writerDepositCents:150000,outgoing_depositCents:150000,outgoing_balanceCents:0});
  globalThis.calls=[];api=async(url,options={})=>{if(options.method)calls.push({url,data:JSON.parse(options.body)});return state.papers[0];};finishSave=async()=>{};`);
 await clickAction(handlers,{action:'writer-payment',id:'paper-0',type:'outgoing_balance'});
 const html=nodes.get('#overlay-root').innerHTML;
 assert.match(html,/登记已付尾款/);assert.match(html,/<option value="outgoing_balance" selected>/);
 assert.match(html,/name="amount"[^>]*value="1500.00"/);assert.match(html,/确认本次金额已实际支付/);
 const fixture=validationForm(run,'transaction-form',[
  {name:'type',label:'收支类型',value:'outgoing_balance',tagName:'SELECT'},
  {name:'amount',label:'金额',type:'number',value:'1500'},
  {name:'date',label:'支付日期',type:'date',value:'2026-01-02'},
  {name:'confirmWriterPayment',label:'确认实际付款',type:'checkbox',value:'yes',checked:false},
 ]);
 await Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));
 assert.equal(run('calls.length'),0);
 fixture.controls.confirmWriterPayment.checked=true;fixture.controls.amount.value='1501';
 await Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));
 assert.equal(run('calls.length'),0);assert.match(fixture.controls.amount.inlineError.textContent,/不能超过/);
 fixture.controls.amount.value='1500';
 await Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));
 assert.equal(run('calls.length'),1);assert.equal(run('calls[0].data.confirmWriterPayment'),true);
 assert.equal(run('calls[0].data.amount'),'1500');
 fixture.controls.type.value='incoming_deposit';
 await Promise.all(handlers.get('change').map(fn=>fn({target:fixture.controls.type})));
 assert.equal(fixture.controls.confirmWriterPayment.disabled,true);
 assert.equal(fixture.controls.confirmWriterPayment.checked,false);
});

test('payment forms refuse to submit to an old service that cannot save the new payment fields',async()=>{
 const {run,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run("openWritingEditor();state.writerPaymentsSupported=false;globalThis.calls=[];api=async(...args)=>{calls.push(args);return state.papers[0];};");
 formValues(run,{title:'旧服务不能忽略付款',writerFee:'3000',writerDepositAmount:'1500',writerPaymentDeposit:'1500',writerPaymentDepositDate:'2026-01-02',confirmWriterPayments:'yes'});
 const {event,error}=formEvent('paper-form');
 await Promise.all(handlers.get('submit').map(fn=>fn(event)));
 assert.equal(run('calls.length'),0);assert.match(error.textContent,/重启服务并刷新页面/);
 assert.match(error.textContent,/本次尚未提交/);
});

test('retrying a manuscript upload never repeats payments already saved with the paper',async()=>{
 const {run,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`globalThis.saved={...state.papers[0],writerFeeCents:300000,writerDepositCents:150000,outgoing_depositCents:150000,outgoing_balanceCents:0};
  globalThis.calls=[];globalThis.uploads=0;selectedManuscript=()=>({name:'稿件.pdf',size:10});
  uploadManuscript=async p=>{if(++uploads===1)throw new Error('上传中断');return {...p,version:p.version+1};};
  api=async(url,options)=>{calls.push(JSON.parse(options.body));return {...saved,version:calls.length};};finishSave=async()=>{};openWritingEditor();`);
 const fixture=validationForm(run,'paper-form',[
  {name:'title',label:'论文题目',value:'付款及稿件'},
  {name:'writerFee',label:'总稿酬',type:'number',value:'3000'},
  {name:'writerDepositAmount',label:'约定定金',type:'number',value:'1500'},
  {name:'writerPaymentDeposit',label:'本次定金',type:'number',value:'1500'},
  {name:'writerPaymentDepositDate',label:'支付日期',type:'date',value:'2026-01-02'},
  {name:'confirmWriterPayments',label:'确认',type:'checkbox',value:'yes',checked:true},
 ]);
 await Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));
 assert.match(fixture.summary.textContent,/稿件上传失败/);assert.equal(run('calls.length'),1);
 assert.equal(fixture.controls.writerPaymentDeposit.value,'0.00');
 await Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));
 assert.equal(run('calls.length'),2);assert.equal(run('calls[0].writerPayments.length'),1);
 assert.equal(run('calls[1].writerPayments'),undefined);
});

test('overview acceptance and publication tabs match current status and explain automatic archive classification',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seed(run);
 run(`state.papers=state.papers.slice(0,9).map((p,i)=>({...p,title:'状态分类-'+i,status:statuses[i],submittedAt:'2026-01-10',followUpAt:'',receivableCents:i===6?10000:0,payableCents:0}));state.view='records';renderShell();`);
 let html=nodes.get('#content').innerHTML;
 assert.match(html,/data-tab="accepted"[^>]*>已录用<span class="count">1<\/span>/);
 assert.match(html,/data-tab="published"[^>]*>已发表<span class="count">1<\/span>/);
 assert.match(html,/data-tab="finished"[^>]*>已归档<span class="count">2<\/span>/);
 assert.match(html,/分类按当前投稿状态统计/);assert.match(html,/已发表或已撤稿自动归入“已归档”/);assert.match(html,/已录用仍属于“进行中”/);
 assert.ok(!html.includes('paper-source'));
 for(const [tab,expected] of [['accepted',[5]],['published',[6]],['finished',[6,8]],['active',[0,1,2,3,4,5,7]]]){
  run('state.page=4');await clickAction(handlers,{action:'tab',tab});
  assert.equal(run('state.page'),1);
  assert.deepEqual(JSON.parse(run('JSON.stringify(filteredPapers().map(p=>p.id))')),expected.map(i=>'paper-'+i));
  for(const i of expected)assert.ok(nodes.get('#results').innerHTML.includes('状态分类-'+i));
 }
 await clickAction(handlers,{action:'tab',tab:'published'});
 run('download=(name,blob)=>{globalThis.statusExport={name,blob};};exportPapers()');
 const csv=await run('statusExport.blob').text();assert.ok(csv.includes('状态分类-6'));assert.ok(!csv.includes('状态分类-5'));assert.ok(!csv.includes('状态分类-8'));
 run("state.search='找不到的论文';renderPaperResults()");assert.equal(run('filteredPapers().length'),0);
 await clickAction(handlers,{action:'clear-filters'});assert.equal(run('state.tab'),'published');assert.equal(run('filteredPapers().length'),1);
 await clickAction(handlers,{action:'navigate',view:'followups'});html=nodes.get('#content').innerHTML;
 assert.ok(!html.includes('data-tab="accepted"'));assert.ok(!html.includes('data-tab="published"'));assert.ok(!html.includes('overview-classification-note'));
});

test('changing the current submission status updates overview outcomes and archive membership after refresh',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seed(run);
 run(`state.papers=state.papers.slice(0,1);state.papers[0].status='已录用';state.view='records';globalThis.refreshedPapers=state.papers;api=async url=>url==='/api/papers'?refreshedPapers:state.customers;renderShell();`);
 await clickAction(handlers,{action:'tab',tab:'accepted'});assert.equal(run('filteredPapers().length'),1);
 run("refreshedPapers=[{...state.papers[0],status:'已发表'}]");await clickAction(handlers,{action:'refresh'});
 assert.equal(run('filteredPapers().length'),0);assert.match(nodes.get('#content').innerHTML,/data-tab="accepted"[^>]*>已录用<span class="count">0<\/span>/);
 await clickAction(handlers,{action:'tab',tab:'published'});assert.equal(run('filteredPapers().length'),1);
 await clickAction(handlers,{action:'tab',tab:'finished'});assert.equal(run('filteredPapers().length'),1);
 run("refreshedPapers=[{...state.papers[0],status:'已投稿'}]");await clickAction(handlers,{action:'refresh'});
 assert.equal(run('filteredPapers().length'),0);
 await clickAction(handlers,{action:'tab',tab:'active'});assert.equal(run('filteredPapers().length'),1);
 await clickAction(handlers,{action:'tab',tab:'published'});assert.equal(run('filteredPapers().length'),0);
});


test('publication terms exclude author-paid amounts and require a positive included cost',async()=>{
 const {run,nodes,handlers}=app();seedBusiness(run);
 run("state.drawer={kind:'detail',paper:state.papers[0]};publicationFeeEditor();globalThis.calls=[];api=async(url,options={})=>{calls.push({url,data:JSON.parse(options.body)});return {...state.papers[0],publicationFeeMode:'author',publicationFeeCents:0};};");
 assert.match(nodes.get('#overlay-root').innerHTML,/作者自理版面费/);
 assert.match(nodes.get('#overlay-root').innerHTML,/不包含在报价中/);
 const fixture=validationForm(run,'publication-fee-form',[
  {name:'publicationFeeMode',label:'版面费承担方式',value:'author',tagName:'SELECT'},
  {name:'publicationFeeAmount',label:'我方承担版面费',type:'number',value:'9999',min:'0.01'}
 ]);
 run('updateFormRequirements')(fixture.form);
 assert.equal(fixture.controls.publicationFeeAmount.disabled,true);
 fixture.controls.publicationFeeMode.value='included';fixture.controls.publicationFeeAmount.value='0';
 await Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));
 assert.equal(run('calls.length'),0);assert.equal(fixture.controls.publicationFeeAmount.required,true);
 fixture.controls.publicationFeeMode.value='author';
 await Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));
 assert.equal(run('calls.length'),1);
 assert.match(run('calls[0].url'),/publication-fee$/);
 assert.equal(run('calls[0].data.publicationFeeMode'),'author');
 assert.equal(run('calls[0].data.publicationFeeAmount'),undefined);
});

test('page fee payments and refunds require confirmation and respect remaining cost',async()=>{
 const {run,nodes,handlers}=app();seedBusiness(run);
 run(`Object.assign(state.papers[0],{publicationFeeMode:'included',publicationFeeCents:150000,publicationPaidCents:50000,publicationPayableCents:100000});
  state.drawer={kind:'detail',paper:state.papers[0]};transactionForm('outgoing_publication');
  globalThis.calls=[];api=async(url,options={})=>{calls.push({url,data:JSON.parse(options.body)});return state.papers[0];};finishSave=async()=>{};`);
 assert.match(nodes.get('#overlay-root').innerHTML,/<option value="outgoing_publication" selected>/);
 assert.match(nodes.get('#overlay-root').innerHTML,/name="amount"[^>]*value="1000.00"/);
 const fixture=validationForm(run,'transaction-form',[
  {name:'type',label:'收支类型',value:'outgoing_publication',tagName:'SELECT'},
  {name:'amount',label:'金额',type:'number',value:'1000'},
  {name:'date',label:'支付日期',type:'date',value:'2026-01-02'},
  {name:'confirmPublicationPayment',label:'确认实际付款',type:'checkbox',value:'yes',checked:false}
 ]);
 await Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));assert.equal(run('calls.length'),0);
 fixture.controls.confirmPublicationPayment.checked=true;fixture.controls.amount.value='1000.01';
 await Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));assert.equal(run('calls.length'),0);
 fixture.controls.amount.value='1000';
 await Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));
 assert.equal(run('calls.length'),1);assert.equal(run('calls[0].data.confirmPublicationPayment'),true);
 fixture.controls.type.value='incoming_publication_refund';fixture.controls.amount.value='500.01';
 await Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));assert.equal(run('calls.length'),1);
 run("Object.assign(state.papers[0],{publicationFeeMode:'author',publicationPayableCents:0,serviceStatus:'terminated'})");
 assert.equal(run("transactionTypeAllowed(state.papers[0],'outgoing_publication')"),false);
 assert.equal(run("transactionTypeAllowed(state.papers[0],'incoming_publication_refund')"),true);
});

test('profit details and exports distinguish unknown costs, expected profit and settled cash',()=>{
 const {run,nodes}=app();seedBusiness(run);
 run(`Object.assign(state.papers[0],{publicationFeeMode:'included',publicationFeeCents:150000,publicationPaidCents:50000,publicationPayableCents:100000,
  profitEstimateKnown:true,estimatedProfitCents:450000,profitSettled:false,settledProfitCents:null,netCents:250000});
  state.drawer={kind:'detail',paper:state.papers[0],tab:'finance'};renderDetail();`);
 let html=nodes.get('#overlay-root').innerHTML;
 assert.match(html,/预计利润/);assert.match(html,/已结清利润/);assert.match(html,/待结清/);assert.match(html,/现金净额/);
 assert.match(html,/写作定金与尾款合计为总稿酬/);assert.match(html,/我方承担版面费/);
 run("globalThis.csv=[];csvDownload=(name,rows)=>{csv=rows};paperCsvDownload('fee.csv',[['题目'],['论文']],state.papers.slice(0,1))");
 const headers=Array.from(run('csv[0]')),row=run('csv[1]');
 assert.equal(row[headers.indexOf('我方版面费成本（元）')],1500);
 assert.equal(row[headers.indexOf('预计利润（元）')],4500);
 assert.equal(row[headers.indexOf('已结清利润（元）')],'待结清');
 run("Object.assign(state.papers[0],{publicationFeeMode:'pending',profitEstimateKnown:false,estimatedProfitCents:null});renderDetail()");
 assert.match(nodes.get('#overlay-root').innerHTML,/待核算/);
 run("state.view='finance';state.financeType='balances';renderShell()");
 assert.match(nodes.get('#results').innerHTML,/版面费 \/ 预计利润/);
});


test('finance annual summaries separate transaction year cash flows from paper year profit and balances',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seed(run);
 run(`state.view='finance';state.financeType='balances';state.papers=state.papers.slice(0,2);
  Object.assign(state.papers[0],{createdAt:'2026-03-10T12:00:00Z',transactions:[
   {id:'in-26',type:'incoming_deposit',amountCents:100000,date:'2026-03-12',createdAt:'2026-03-12T12:00:00Z',method:'转账',note:''},
   {id:'other-in-26',type:'incoming_other',amountCents:5000,date:'2026-03-14',createdAt:'2026-03-14T12:00:00Z',method:'转账',note:''},
   {id:'out-26',type:'outgoing_deposit',amountCents:20000,date:'2026-03-15',createdAt:'2026-03-15T12:00:00Z',method:'转账',note:''}] ,
   receivableCents:300000,payableCents:40000,publicationPayableCents:25000,refundableCents:10000,recoverableCents:5000,
   profitEstimateKnown:true,estimatedProfitCents:180000,profitSettled:true,settledProfitCents:120000});
  Object.assign(state.papers[1],{createdAt:'2025-05-10T12:00:00Z',transactions:[
   {id:'in-25-paid-26',type:'incoming_balance',amountCents:15000,date:'2026-04-01',createdAt:'2026-04-01T12:00:00Z',method:'转账',note:''},
   {id:'out-25-26',type:'outgoing_other',amountCents:3000,date:'2026-04-02',createdAt:'2026-04-02T12:00:00Z',method:'转账',note:''}],
   receivableCents:90000,payableCents:10000,publicationPayableCents:0,profitEstimateKnown:false,estimatedProfitCents:null,profitSettled:false,settledProfitCents:null});
  state.financeYear='2026';renderFinance();`);
 let html=nodes.get('#content').innerHTML;
 assert.match(html,/2026 年收支汇总/);assert.match(html,/按年度查看收付款/);
 assert.match(html,/累计收款[\s\S]*?¥1,200\.00/);
 assert.match(html,/累计付款[\s\S]*?¥230\.00/);
 assert.match(html,/净现金流[\s\S]*?¥970\.00/);
 assert.match(html,/待收服务费[\s\S]*?¥3,000\.00/);
 assert.match(html,/稿酬 ¥400\.00 · 版面费 ¥250\.00/);
 assert.match(html,/¥1,800\.00/);assert.match(html,/净利润（已结清）[\s\S]*?¥1,200\.00/);
 assert.match(html,/收付款按实际发生年份统计/);
 await Promise.all(handlers.get('change').map(fn=>fn({target:{id:'finance-year',value:'2025'}})));
 html=nodes.get('#content').innerHTML;
 assert.equal(run('state.financeYear'),'2025');
 assert.match(html,/2025 年收支汇总/);
 assert.match(html,/部分待核算/);assert.match(html,/1 篇版面费待确认/);
 assert.match(html,/累计收款[\s\S]*?¥0\.00/);
 assert.match(html,/待收服务费[\s\S]*?¥900\.00/);
 assert.match(html,/value="all" >全部年份/);
});


test('year selection scopes source lists and exports while resets preserve the selected year',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seed(run);
 run(`state.view='finance';state.financeYear='2026';state.papers=state.papers.slice(0,3);
  state.papers.forEach((p,i)=>{p.createdAt=(i===0?'2025':i===1?'2026':'2027')+'-06-01T12:00:00Z';p.transactions=p.transactions.map(t=>({...t,date:i===2?'2027-01-01':'2026-02-01'}));});
  state.search='no-match';state.from='2028-01-01';state.to='2028-02-01';renderFinance();`);
 await clickAction(handlers,{action:'finance-source',type:'incoming'});
 assert.equal(run('state.financeYear'),'2026');
 assert.deepEqual(Array.from(run('filteredTransactions().map(t=>t.paper.id)')),['paper-0','paper-1']);
 assert.ok(!nodes.get('#results').innerHTML.includes('paper-2'));
 run("download=(name,blob)=>{globalThis.yearExport={name,blob};};exportFinance()");
 let csv=await run('yearExport.blob').text();assert.ok(csv.includes('LW-2026-0'));assert.ok(csv.includes('LW-2026-1'));assert.ok(!csv.includes('LW-2026-2'));
 await clickAction(handlers,{action:'finance-source',type:'balances'});
 assert.deepEqual(Array.from(run('filteredFinancePapers().map(p=>p.id)')),['paper-1']);
 run("exportFinance()");csv=await run('yearExport.blob').text();assert.ok(csv.includes('LW-2026-1'));assert.ok(!csv.includes('LW-2026-0'));
 await clickAction(handlers,{action:'clear-filters'});assert.equal(run('state.financeYear'),'2026');
 await Promise.all(handlers.get('change').map(fn=>fn({target:{id:'finance-year',value:'all'}})));
 assert.equal(run('filteredFinancePapers().length'),3);
 run("exportFinanceYear()");csv=await run('yearExport.blob').text();
 assert.match(csv,/累计收款/);assert.match(csv,/净利润（已结清）/);assert.match(csv,/待退回版面费/);assert.match(csv,/全部年份/);
 for(const secret of ['private-account','private@example.com','13800000000'])assert.ok(!csv.includes(secret));
});

test('annual profit attribution handles cross-year settlement, refunds and negative profit without double counting',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seed(run);
 run(`state.view='finance';state.financeYear='2026';state.papers=state.papers.slice(0,3);
  Object.assign(state.papers[0],{createdAt:'2025-04-01T12:00:00Z',profitEstimateKnown:true,profitSettled:true,settledProfitCents:150000,estimatedProfitCents:150000,
   contractCents:300000,writerFeeCents:100000,publicationFeeMode:'included',publicationFeeCents:50000,
   transactions:[{id:'old-deposit',type:'incoming_deposit',amountCents:100000,date:'2025-04-01',createdAt:'2025-04-01T12:00:00Z',note:'',method:''},
    {id:'tail',type:'incoming_balance',amountCents:200000,date:'2026-01-01',createdAt:'2026-01-01T12:00:00Z',note:'',method:''}]});
  Object.assign(state.papers[1],{createdAt:'2026-05-01T12:00:00Z',profitEstimateKnown:true,profitSettled:false,settledProfitCents:null,estimatedProfitCents:50000,
   transactions:[{id:'pending',type:'incoming_deposit',amountCents:50000,date:'2026-05-01',createdAt:'2026-05-01T12:00:00Z',note:'',method:''}]});
  Object.assign(state.papers[2],{createdAt:'2026-05-01T12:00:00Z',profitEstimateKnown:true,profitSettled:true,settledProfitCents:-20000,estimatedProfitCents:-20000,
   serviceStatus:'terminated',termination:{terminatedAt:'2026-08-01'},
   transactions:[{id:'refund',type:'outgoing_refund',amountCents:80000,date:'2026-08-10',createdAt:'2026-08-10T12:00:00Z',note:'',method:''},
    {id:'fee-return',type:'incoming_publication_refund',amountCents:20000,date:'2026-08-11',createdAt:'2026-08-11T12:00:00Z',note:'',method:''}]});
  renderFinance();`);
 assert.equal(run('financeYearSummary().settledProfit'),130000);
 assert.equal(run('financeYearSummary().paid'),80000);
 assert.equal(run('financeYearSummary().received'),270000);
 assert.equal(run('financeYearSummary().profit'),30000);
 assert.equal(run('financeSettlementDate(state.papers[2])'),'2026-08-11');
 await clickAction(handlers,{action:'finance-source',type:'profits'});
 assert.deepEqual(Array.from(run('filteredFinancePapers().map(p=>p.id)')),['paper-0','paper-2']);
 assert.match(nodes.get('#results').innerHTML,/净利润 ¥1,300\.00/);assert.match(nodes.get('#results').innerHTML,/2026\.08\.11/);
 run("download=(name,blob)=>{globalThis.profitExport={name,blob};};exportFinance()");
 let csv=await run('profitExport.blob').text();assert.match(csv,/1500/);assert.match(csv,/-200/);assert.ok(!csv.includes('LW-2026-1'));
 await Promise.all(handlers.get('change').map(fn=>fn({target:{id:'finance-profit-basis',value:'created'}})));
 assert.equal(run('financeYearSummary().settledProfit'),-20000);
 assert.deepEqual(Array.from(run('filteredFinancePapers().map(p=>p.id)')),['paper-2']);
 await Promise.all(handlers.get('change').map(fn=>fn({target:{id:'finance-year',value:'2025'}})));
 assert.equal(run('financeYearSummary().settledProfit'),150000);
 run("state.financeProfitBasis='settled';Object.assign(state.papers[0],{profitSettled:false,settledProfitCents:null})");
 assert.equal(run('financeYearSummary().settledProfit'),0);
});


test('annual cash sums respect calendar boundaries and cents including refunds, with empty years reported as zero',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seed(run);
 run(`state.view='finance';state.financeYear='2026';state.papers=state.papers.slice(0,1);
  Object.assign(state.papers[0],{createdAt:'2024-06-01T12:00:00Z',transactions:[
   {type:'incoming_deposit',amountCents:99999,date:'2025-12-31'},
   {type:'incoming_balance',amountCents:10,date:'2026-01-01'},
   {type:'incoming_publication_refund',amountCents:20,date:'2026-12-31'},
   {type:'outgoing_refund',amountCents:4,date:'2026-01-01'},
   {type:'outgoing_other',amountCents:16,date:'2026-12-31'},
   {type:'outgoing_balance',amountCents:99999,date:'2027-01-01'}].map((tx,i)=>({...tx,id:'boundary-'+i,createdAt:tx.date+'T12:00:00Z',method:'',note:''}))});`);
 assert.equal(run('financeYearSummary().received'),30);
 assert.equal(run('financeYearSummary().paid'),20);
 assert.equal(run('financeYearSummary().cashNet'),10);
 assert.equal(run('financeYearSummary().papers.length'),0);
 assert.deepEqual(Array.from(run('financeYearOptions()')),['2027','2026','2025','2024']);
 await Promise.all(handlers.get('change').map(fn=>fn({target:{id:'finance-year',value:'2023'}})));
 assert.equal(run('financeYearSummary().received'),0);assert.equal(run('financeYearSummary().settledProfit'),0);
 assert.equal(run('financeYearSummary().unknownCount'),0);
 assert.match(nodes.get('#results').innerHTML,/没有找到符合条件/);
 run("state.papers=[];state.financeYear='all';renderFinance()");
 assert.match(nodes.get('#content').innerHTML,/全部年份收支汇总/);
 assert.equal(run('financeYearSummary().cashNet'),0);
});


test('publication fee pending mode stays available and resubmission requests fresh terms',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run("openPaperEditor(null,'half')");
 let html=nodes.get('#overlay-root').innerHTML;
 assert.match(html,/<option value="pending" selected>/);
 run(`Object.assign(state.papers[0],{publicationFeeMode:'included',publicationFeeCents:150000});
   openSubmissionEditor(state.papers[0],null,{resubmit:true,source:state.papers[0].submissions[0]});`);
 html=nodes.get('#overlay-root').innerHTML;
 assert.match(html,/原版面费约定：我方承担版面费/);assert.match(html,/请按新期刊重新选择/);
 assert.match(html,/<option value="pending" selected>/);
 const fixture=validationForm(run,'submission-form',[
  {name:'journal',label:'期刊',value:'新期刊'},
  {name:'publicationFeeMode',label:'版面费承担方式',value:'',tagName:'SELECT',required:true},
  {name:'publicationFeeAmount',label:'我方承担版面费',value:'0',type:'number'}
 ]);
 assert.equal(run('validateForm')(fixture.form),false);
 fixture.controls.publicationFeeMode.value='pending';
 assert.equal(run('validateForm')(fixture.form),true);
 fixture.controls.publicationFeeMode.value='included';fixture.controls.publicationFeeAmount.value='0';
 assert.equal(run('validateForm')(fixture.form),false);
 fixture.controls.publicationFeeAmount.value='1200';
 assert.equal(run('validateForm')(fixture.form),true);
 assert.equal(fixture.controls.publicationFeeAmount.required,true);
 fixture.controls.publicationFeeMode.value='author';
 assert.equal(run('validateForm')(fixture.form),true);
 assert.equal(fixture.controls.publicationFeeAmount.disabled,true);
});


test('resubmission saves the new journal and fee terms in one request, and active edits include the paper version',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));seedBusiness(run);
 run(`state.papers=state.papers.slice(0,1);Object.assign(state.papers[0],{activeSubmissionId:state.papers[0].submissions[0].id,publicationFeeMode:'included',publicationFeeCents:80000,version:12});
  globalThis.feeCalls=[];api=async(url,options={})=>{if(options.method)feeCalls.push({url,data:JSON.parse(options.body)});return state.papers[0];};finishSave=async()=>{};
  openSubmissionEditor(state.papers[0],null,{resubmit:true,source:state.papers[0].submissions[0]});`);
 let fixture=validationForm(run,'submission-form',[
  {name:'journal',label:'投稿期刊',required:true,value:'新期刊'},
  {name:'publicationFeeMode',label:'版面费承担方式',tagName:'SELECT',required:true,value:'included'},
  {name:'publicationFeeAmount',label:'我方承担金额',type:'number',value:'1200'}
 ]);
 await Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));
 assert.equal(run('feeCalls.length'),1);assert.equal(run('feeCalls[0].data.journal'),'新期刊');
 assert.equal(run('feeCalls[0].data.publicationFeeAmount'),'1200');assert.equal(run('feeCalls[0].data.version'),12);
 assert.equal(run('feeCalls[0].url'),'/api/papers/paper-0/submissions');
 run("openSubmissionEditor(state.papers[0],state.papers[0].submissions[0],{mode:'edit'})");
 assert.match(nodes.get('#overlay-root').innerHTML,/name="publicationFeeMode"/);
 fixture=validationForm(run,'submission-form',[
  {name:'journal',label:'投稿期刊',required:true,value:'重新确认期刊'},
  {name:'publicationFeeMode',label:'版面费承担方式',tagName:'SELECT',required:true,value:'pending'},
  {name:'publicationFeeAmount',label:'我方承担金额',type:'number',value:'0'}
 ]);
 await Promise.all(handlers.get('submit').map(fn=>fn(fixture.event)));
 assert.equal(run('feeCalls.length'),2);assert.equal(run('feeCalls[1].data.paperVersion'),12);
 assert.equal(run('feeCalls[1].data.publicationFeeMode'),'pending');
 assert.equal(run('feeCalls[1].data.publicationFeeAmount'),undefined);
});
