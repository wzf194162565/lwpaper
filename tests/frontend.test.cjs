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
 const context = vm.createContext({console,Blob,URL,Intl,Date,setTimeout:()=>1,clearTimeout(){},requestAnimationFrame(){},
  fetch:async()=>({ok:true,json:async()=>({initialized:false,authenticated:false,csrf:''})}),
  document:{querySelector:selector=>nodes.get(selector)||null,addEventListener(type,handler){if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(handler);},createElement:node,body:node(),activeElement:null},
  window:{addEventListener(){}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/business.js'),'utf8'),context);
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
 await run("finishSave(state.papers[0],'论文已保存')");
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
 assert.match(nodes.get('#overlay-root').innerHTML,/登记收支/);
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
 assert.match(nodes.get('#content').innerHTML,/¥13,500.05/);
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
 run("state.drawer={kind:'customer-detail',customer:{...state.customers[0],papers:state.papers}};renderCustomerDetail()");
 assert.match(nodes.get('#overlay-root').innerHTML,/关联论文与发表成果/);
 assert.match(nodes.get('#overlay-root').innerHTML,/publication-line/);
});

test('business CSV exports omit account passwords and private contact information',async()=>{
 const {run}=app();seedBusiness(run);
 run("download=(name,blob)=>{globalThis.exported={name,blob};};state.tab='all';exportSubmissions()");
 let text=await run('globalThis.exported.blob').text();
 for(const secret of ['private-account','private@example.com','13800000000'])assert.ok(!text.includes(secret));
 assert.match(text,/投稿时长/);assert.match(text,/投稿题目/);
 run('exportManagedPapers()');text=await run('globalThis.exported.blob').text();assert.match(text,/约定定金/);assert.match(text,/已付尾款/);
 run('exportCustomers()');text=await run('globalThis.exported.blob').text();
 assert.ok(!text.includes('customer-private@example.com'));assert.ok(!text.includes('13800000003'));assert.match(text,/已发表期刊/);
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
  assert.match(nodes.get('#overlay-root').innerHTML,/保存改投/);
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
 assert.match(notice.innerHTML,/可继续保存/);
 await input('不同期刊');assert.equal(notice.innerHTML,'');
 await input('');assert.equal(notice.innerHTML,'');
 run('openSubmissionEditor(state.papers[0],state.papers[0].submissions[0])');
 await input('Nature Communications');assert.match(notice.innerHTML,/<strong>1 条<\/strong>/);
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
 assert.match(run('messages.at(-1)'),/投稿已删除，列表同步暂时失败/);
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
 run("formValues={paperId:'paper-1',title:'投稿题目',journal:'期刊乙',status:'待投稿',submissionPassword:''};state.papers=[{id:'paper-1',version:5}];state.drawer={kind:'submission-edit',paper:null,submission:null};renderDetail=()=>{};savedRequests=[];");
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

test('home exposes login, registration and password change without confusing registration with login',async()=>{
 const {run,nodes,handlers}=app();await new Promise(resolve=>setImmediate(resolve));
 for(const label of ['登录','注册','修改密码'])assert.ok(nodes.get('#root').innerHTML.includes(`>${label}</button>`));
 assert.match(nodes.get('#root').innerHTML,/id="auth-form" data-mode="login"/);
 await clickAction(handlers,{action:'auth-mode',mode:'login'});
 assert.match(nodes.get('#root').innerHTML,/data-mode="login"/);
 assert.ok(!nodes.get('#root').innerHTML.includes('name="confirm"'));
 assert.equal(run('state.initialized'),false);
 await clickAction(handlers,{action:'auth-mode',mode:'password'});
 for(const name of ['username','currentPassword','newPassword','confirm'])assert.ok(nodes.get('#root').innerHTML.includes(`name="${name}"`));
 assert.match(nodes.get('#root').innerHTML,/需要原密码/);
 run("state.initialized=true;state.username='<script>';state.authMode='register';renderAuth()");
 assert.match(nodes.get('#root').innerHTML,/id="auth-form" data-mode="register"/);
 for(const name of ['username','password','confirm'])assert.ok(nodes.get('#root').innerHTML.includes(`name="${name}"`));
 assert.ok(!nodes.get('#root').innerHTML.includes('当前工作台已注册'));
 assert.match(nodes.get('#root').innerHTML,/独立工作台/);
 await clickAction(handlers,{action:'auth-mode',mode:'login'});
 assert.match(nodes.get('#root').innerHTML,/value="&lt;script&gt;"/);
 run('renderShell()');assert.match(nodes.get('#root').innerHTML,/data-action="change-password"/);
 await clickAction(handlers,{action:'change-password'});
 assert.equal(run('state.view'),'settings');assert.match(nodes.get('#content').innerHTML,/id="password-form"/);
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
 assert.match(nodes.get('#root').innerHTML,/id="auth-form" data-mode="register"/);
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
 assert.match(nodes.get('#root').innerHTML,/登录系统/);assert.match(run('messages.at(-1)'),/请使用新密码登录/);
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
 for(const [action,type,title] of [['new-paper','half','新建论文（半包）'],['new-writing','full','新建论文（全包）']]){
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
 assert.match(nodes.get('#overlay-root').innerHTML,/id="drawer-title">编辑论文（半包）<\/h2>/);
 assert.ok(!nodes.get('#overlay-root').innerHTML.includes('name="writerFee"'));
 run('delete state.papers[0].serviceType;openEditor(state.papers[0])');
 assert.match(nodes.get('#overlay-root').innerHTML,/id="drawer-title">编辑论文（全包）<\/h2>/);
 run("state.drawer={kind:'customer-detail',customer:{...state.customers[0],papers:state.papers}};renderCustomerDetail()");
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
 assert.match(run('messages.at(-1).message'),/数据已保存.*列表同步暂时失败/);
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
