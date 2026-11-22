'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const money = cents => new Intl.NumberFormat('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}).format((cents || 0)/100);
const yuan = cents => `¥${money(cents)}`;
const dateLabel = value => value ? esc(value.replaceAll('-','.')) : '—';
const instantLabel = value => new Date(value).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const statuses = ['草稿','待投稿','已投稿','审稿中','修改中','已录用','已发表','已拒稿','已撤稿'];
const typeLabels = {incoming_deposit:'收取定金',incoming_balance:'收取尾款',incoming_other:'其他收入',outgoing_deposit:'支付定金',outgoing_balance:'支付尾款',outgoing_other:'其他支出'};
const statusColors = {'草稿':'slate','待投稿':'slate','已投稿':'blue','审稿中':'blue','修改中':'amber','已录用':'green','已发表':'green','已拒稿':'red','已撤稿':'violet'};
const terminal = p => ['已发表','已撤稿'].includes(p.status);
const due = p => p.followUpAt && p.followUpAt <= today() && !terminal(p);
const sum = (list, key) => list.reduce((n, p) => n + (p[key] || 0), 0);
const state = {storage:'file',csrf:'',username:'',initialized:false,authenticated:false,authMode:'',authSubmitting:false,papers:[],customers:[],customerId:'',view:'records',tab:'all',search:'',status:'',from:'',to:'',financeType:'balances',page:1,pageSize:8,drawer:null,modal:null,loading:false};
let credentialTimer;
let previousFocus;
const icons = {
 document:'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4M9 12h6M9 16h5"/>',
 grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
 calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2"/>',
 wallet:'<path d="M20 8V6a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v10H6a3 3 0 0 1-3-3V7"/><path d="M20 12h-5v5h5M17 14.5h.01"/>',
 settings:'<path d="m9 3-1 3-3 1-2 4 2 2v3l3 2 1 3h6l1-3 3-2v-3l2-2-2-4-3-1-1-3z"/><circle cx="12" cy="12" r="3"/>',
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',
 down:'<path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5"/>',
 upload:'<path d="M12 16V4m-5 5 5-5 5 5M5 17v4h14v-4"/>',
 chevron:'<path d="m9 5 7 7-7 7"/>',
 left:'<path d="m15 5-7 7 7 7"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
 logout:'<path d="M10 4H4v16h6M10 12h11m-4-4 4 4-4 4"/>',
 arrowUp:'<path d="m7 14 5-5 5 5M12 9v11M5 4h14"/>',
 arrowDown:'<path d="m7 10 5 5 5-5M12 15V4M5 20h14"/>',
 check:'<path d="m5 12 4 4L19 6"/>',
 checkCircle:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
 close:'<path d="m6 6 12 12M18 6 6 18"/>',
 edit:'<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z"/>',
 trash:'<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
 eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12"/><circle cx="12" cy="12" r="3"/>',
 lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
 link:'<path d="M14 3h7v7M21 3l-9 9M10 5H4v16h16v-6"/>',
 users:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6M19 15a5 5 0 0 1 2 4v2"/>',
 info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
 menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
 refresh:'<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
 chart:'<path d="M4 3v18h17M8 16v-5M13 16V7M18 16V4"/>',
 filter:'<path d="M4 5h16l-6 7v7l-4 2v-9z"/>'
};
function icon(name) { return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.document}</svg>`; }
function badge(status) { return `<span class="badge ${statusColors[status] || 'slate'}">${esc(status)}</span>`; }
function btn(action, label, glyph, classes='', extra='') { return `<button type="button" class="btn ${classes}" data-action="${action}" ${extra}>${glyph ? icon(glyph) : ''}${label}</button>`; }
function toast(message, error=false) {
 const node = document.createElement('div'); node.className = `toast${error ? ' error' : ''}`;
 node.innerHTML = `${icon(error ? 'info' : 'checkCircle')}<span>${esc(message)}</span>`;
 $('#toast-root').append(node); setTimeout(() => node.remove(), 4500);
}
async function api(path, options={}) {
 const response = await fetch(path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrf,...options.headers}});
 const result = await response.json();
 if (!response.ok) {
  if (response.status === 401 && state.authenticated && result.authenticated!==true) { state.authenticated = false; state.authMode='login';state.csrf='';state.papers=[];state.customers=[]; closeOverlay(); renderAuth(); }
  throw new Error(result.error || '请求失败，请重试');
 }
 return result;
}
const request = (method, path, body={}) => api(path,{method,body:JSON.stringify(body)});
async function loadPapers() { const [papers,customers] = await Promise.all([api('/api/papers'),api('/api/customers')]); state.papers=papers;state.customers=customers;renderShell(); }


// Commit the successful response to the visible list before syncing related summaries.
// A failed follow-up GET must never leave a saved form open for accidental resubmission.
async function finishSave(saved,message,{customer=false,view=state.view,financeType='balances'}={}) {
 if(customer)state.customers=[saved,...state.customers.filter(c=>c.id!==saved.id)];
 else {
  state.papers=[saved,...state.papers.filter(p=>p.id!==saved.id)];
  for(const c of state.customers) {
   const papers=state.papers.filter(p=>p.customerId===c.id);
   Object.assign(c,{paperCount:papers.length,publishedPaperCount:papers.filter(p=>p.published).length,
    publishedJournals:[...new Set(papers.flatMap(p=>p.publishedJournals||[]))],contractCents:sum(papers,'contractCents'),
    receivedCents:sum(papers,'contractReceivedCents'),receivableCents:sum(papers,'receivableCents'),writerFeeCents:sum(papers,'writerFeeCents')});
  }
 }
 state.view=view;state.tab='all';state.financeType=financeType;resetFilters();
 closeOverlay();renderShell();toast(message);
 try { await loadPapers(); }
 catch(error) { if(state.authenticated)toast(`数据已保存，列表同步暂时失败，请点击刷新。${error.message}`,true); }
}

function brand() { return `<div class="brand"><div class="brand-mark">${icon('document')}</div><div><div class="brand-name">知序</div><div class="brand-en">PAPER DESK</div></div></div>`; }
function renderAuth() {
 const mode = state.authMode || 'login';
 const setup = mode==='register', changing = mode==='password';
 const title = changing ? '修改密码' : setup ? '注册账号' : '登录系统';
 const subtitle = changing ? '验证账号与原密码后，设置新的管理密码。' : setup ? '填写账号和密码，创建你的独立工作台。' : '输入账号与密码，继续处理你的投稿记录。';
 const passwordNote = state.storage==='mysql' ? '管理密码用于登录和加密备份，投稿密码使用独立密钥加密。请妥善保管管理密码、加密密钥和备份。系统没有预设账号或默认密码。' : '管理密码同时用于加密本地数据，请妥善保管。忘记密码将无法恢复数据，系统没有预设账号或默认密码。';
 const passwordField = (name,label,fresh=false) => `<div class="field"><label for="auth-${name}">${label}</label><input id="auth-${name}" name="${name}" type="password" required minlength="${fresh?10:1}" maxlength="128" autocomplete="${fresh?'new-password':'current-password'}" placeholder="${fresh?'10–128 个字符':changing?'请输入原密码':'请输入管理密码'}"></div>`;
 const form = `<form id="auth-form" data-mode="${mode}">
  <div class="field"><label for="auth-username">登录账号</label><input id="auth-username" name="username" type="text" required minlength="3" maxlength="64" ${setup?'pattern="[A-Za-z0-9][A-Za-z0-9_.@+\\-]{2,63}" title="3–64 个字符，以字母或数字开头，支持字母、数字、下划线、点、@、加号和减号"':''} autocomplete="username" placeholder="请输入登录账号" value="${esc(state.username)}" autofocus>${setup?'<small>3–64 个字符，以字母或数字开头，支持 _ . @ + -</small>':''}</div>
  ${changing ? passwordField('currentPassword','原密码')+passwordField('newPassword','新密码',true) : passwordField('password',setup?'设置管理密码':'管理密码',setup)}
  ${setup||changing ? passwordField('confirm',changing?'确认新密码':'确认密码',true) : ''}
  ${setup?'<small>每个账号拥有独立的客户、论文与收支记录。账号名是否可用将在提交后校验。</small>':''}<div class="error-message" id="auth-error" role="alert"></div><button class="btn primary" type="submit">${changing?'确认修改密码':setup?'注册并创建工作台':'登录工作台'}${icon('chevron')}</button>
 </form>`;
 $('#root').innerHTML = `<div class="auth-layout"><aside class="auth-brand-panel">${brand()}<div class="auth-intro"><div class="eyebrow">A CLEARER WAY TO MANAGE</div><h1>每一次投稿，<br>都井然有序。</h1><p>从论文档案到投稿进度，从定金到尾款，<br>让每一笔记录、每一个节点，都清晰可循。</p><div class="auth-art" aria-hidden="true"><div class="art-head"><span class="art-dot"></span>我的投稿工作台</div><div class="art-row"></div><div class="art-row"></div><div class="art-bars"><span></span><span></span><span></span><span></span><span></span></div></div></div><div class="auth-bottom">${icon('shield')}${state.storage==='mysql'?'数据库保存 · 投稿密码加密 · 专注管理':'本地保存 · 加密保护 · 专注管理'}</div></aside><main class="auth-form-panel"><div class="auth-form-wrap"><div class="eyebrow">YOUR PERSONAL WORKSPACE</div><nav class="auth-nav" aria-label="账号功能">${[['login','登录'],['register','注册'],['password','修改密码']].map(([id,label])=>`<button type="button" class="tab ${mode===id?'active':''}" data-action="auth-mode" data-mode="${id}" ${mode===id?'aria-current="page"':''}>${label}</button>`).join('')}</nav><h2>${title}</h2><p class="subtitle">${subtitle}</p>${form}<div class="auth-note">${icon('lock')}<span>${changing?'修改密码需要原密码，无法用于找回忘记的密码。修改成功后，此账号的所有页面需重新登录，旧备份仍使用备份时的密码。':setup?passwordNote:'登录有效期为 8 小时，离开时可点击左下角退出，锁定访问。'}</span></div></div></main></div>`;
}

function renderShell() {
 const views = {papers:'论文管理',submissions:'投稿管理',customers:'客户管理',records:'论文总览',followups:'待跟进事项',finance:'收支管理',settings:'数据与设置'};
 const countDue = state.papers.filter(due).length;
 $('#root').innerHTML = `<div class="app-shell"><aside class="sidebar" id="sidebar">${brand()}<div class="workspace-tag">我的工作空间</div><nav class="nav" aria-label="主导航">${[['records','grid','论文总览'],['customers','users','客户管理'],['papers','document','论文管理'],['submissions','upload','投稿管理'],['followups','calendar','待跟进事项'],['finance','wallet','收支管理'],['settings','settings','数据与设置']].map(([id,glyph,label]) => `<button class="nav-item ${state.view === id ? 'active' : ''}" data-action="navigate" data-view="${id}" ${state.view === id ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span>${id === 'followups' && countDue ? `<span class="nav-count">${countDue}</span>` : ''}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="local-note"><strong>${icon('shield')}安心记录，妥善保管</strong>${state.storage==='mysql'?'投稿密码加密保存，<br>业务记录可下载加密备份。':'你的投稿信息与账号密码<br>均在本机加密保存。'}</div><div class="profile"><div class="avatar">管</div><div><div class="profile-name">${esc(state.username||'我的工作台')}</div><div class="profile-sub">独立工作空间</div></div><button class="icon-btn" data-action="logout" title="退出并锁定" aria-label="退出并锁定">${icon('logout')}</button></div></div></aside><main class="main"><header class="topbar"><div class="breadcrumb"><button class="icon-btn mobile-menu" data-action="menu" aria-label="打开导航">${icon('menu')}</button>${icon('grid')}<span>工作空间</span>${icon('chevron')}<strong>${views[state.view]}</strong></div><div class="topbar-right">${btn('change-password','修改密码','lock','account-password')}<button class="icon-btn" data-action="refresh" title="刷新列表" aria-label="刷新列表">${icon('refresh')}</button><span class="today-text">${new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'})}</span><span class="connection"><span class="dot"></span>本地工作台</span></div></header><div class="content" id="content"></div></main></div>`;
 renderContent();
}

function pageHeading(title, subtitle, actions='') { return `<div class="page-heading"><div><div class="eyebrow">PAPER MANAGEMENT WORKSPACE</div><h1>${title}</h1><p class="subtitle">${subtitle}</p></div><div class="actions">${actions}</div></div>`; }
function stat(label, value, glyph, foot, color='', unit='', isMoney=false) { return `<div class="stat-card"><div class="stat-label">${label}<span class="stat-symbol ${color}">${icon(glyph)}</span></div><div class="stat-value ${isMoney ? 'money' : ''}">${value}${unit ? `<span class="unit">${unit}</span>` : ''}</div><div class="stat-foot">${foot}</div></div>`; }
function stats() {
 const p = state.papers;
 return `<div class="stats-grid">${stat('论文总数',p.length,'document',`<strong>${p.filter(x=>!terminal(x)).length} 篇</strong> 正在跟进`,'','篇')}${stat('已录用 / 已发表',p.filter(x=>['已录用','已发表'].includes(x.status)).length,'checkCircle',`已发表 <strong>${p.filter(x=>x.status==='已发表').length} 篇</strong>`,'blue','篇')}${stat('累计已收款',yuan(sum(p,'receivedCents')),'wallet',`待收款 <strong>${yuan(sum(p,'receivableCents'))}</strong>`,'gold','',true)}${stat('累计已付款',yuan(sum(p,'paidCents')),'arrowUp',`待付稿酬 <strong>${yuan(sum(p,'payableCents'))}</strong>`,'purple','',true)}</div>`;
}
function footer() { return `<footer class="footer-note"><span>${icon('shield')}${state.storage==='mysql'?'数据保存在 MySQL · 投稿密码默认隐藏':'数据保存在本机 · 密码默认隐藏'}</span><span>知序 PAPER DESK &nbsp; / &nbsp; 让每一次投稿都有迹可循</span></footer>`; }
function renderContent() {
 if(state.view==='papers')return renderPaperManagement();
 if(state.view==='submissions')return renderSubmissions();
 if(state.view==='customers')return renderCustomers();
 if (state.view === 'settings') return renderSettings();
 if (state.view === 'finance') return renderFinance();
 const followups = state.view === 'followups';
 const tabs = followups ? [['all','全部计划',state.papers.filter(p=>p.followUpAt&&!terminal(p)).length],['due','到期待跟进',state.papers.filter(due).length],['upcoming','未来 7 天',upcoming().length]] : [['all','全部记录',state.papers.length],['active','进行中',state.papers.filter(p=>!terminal(p)).length],['due','待跟进',state.papers.filter(due).length],['finished','已归档',state.papers.filter(terminal).length]];
 $('#content').innerHTML = `${pageHeading(followups ? '待跟进事项' : '论文总览',followups ? '把握投稿节点，让需要关注的事情一目了然。' : '每一篇论文，每一个进展，都有迹可循。',btn('export-papers','导出记录','down')+(followups?'':btn('navigate','查看论文管理','document','','data-view="papers"')))}${stats()}<section class="panel"><div class="panel-header"><h2 class="panel-title">${followups ? '跟进计划' : '论文记录'} <small>${followups ? 'FOLLOW-UPS' : 'SUBMISSION RECORDS'}</small></h2><button class="text-btn" data-action="refresh" title="刷新记录">${icon('refresh')}刷新</button></div><div class="tab-bar" role="tablist">${tabs.map(([id,label,count])=>`<button class="tab ${state.tab===id?'active':''}" data-action="tab" data-tab="${id}" role="tab" aria-selected="${state.tab===id}">${label}<span class="count">${count}</span></button>`).join('')}</div><div class="filter-row"><div class="search-box">${icon('search')}<input id="search" type="search" placeholder="搜索题目、作者、期刊、客户或账号…" aria-label="搜索论文" value="${esc(state.search)}"></div><select id="status-filter" aria-label="投稿状态"><option value="">全部投稿状态</option>${statuses.map(s=>`<option ${state.status===s?'selected':''}>${s}</option>`).join('')}</select><span class="filter-label">投稿日期</span><input class="date-filter" id="from-filter" type="date" aria-label="投稿起始日期" value="${esc(state.from)}"><span class="date-sep">至</span><input class="date-filter" id="to-filter" type="date" aria-label="投稿截止日期" value="${esc(state.to)}">${btn('clear-filters','重置','','')}</div><div id="results"></div></section>${followups ? '' : overviewPanels()}${footer()}`;
 renderPaperResults();
}
function upcoming() { const end = new Date(); end.setDate(end.getDate()+7); const day = `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`; return state.papers.filter(p=>p.followUpAt>today()&&p.followUpAt<=day&&!terminal(p)); }
function filteredPapers() {
 let papers = state.papers.filter(p => {
  if (state.view === 'followups' && (!p.followUpAt || terminal(p))) return false;
  if (state.tab === 'active' && terminal(p)) return false;
  if (state.tab === 'finished' && !terminal(p)) return false;
  if (state.tab === 'due' && !due(p)) return false;
  if (state.tab === 'upcoming' && !upcoming().some(x=>x.id===p.id)) return false;
  if (state.status && p.status !== state.status) return false;
  if (state.from && (!p.submittedAt || p.submittedAt < state.from)) return false;
  if (state.to && (!p.submittedAt || p.submittedAt > state.to)) return false;
  if (state.search.trim()) {
   const haystack = ['title','code','authors','customer','writer','journal','submissionSystem','submissionAccount','boundEmail','boundPhone','notes'].map(k=>p[k]||'').join(' ').toLocaleLowerCase();
   if (!haystack.includes(state.search.trim().toLocaleLowerCase())) return false;
  }
  return true;
 });
 if (state.view === 'followups') papers.sort((a,b)=>a.followUpAt.localeCompare(b.followUpAt));
 return papers;
}
function emptyState(filtered=false, label='论文') {
 if(state.view==='followups'){
  const hasFilters=Boolean(state.search.trim()||state.status||state.from||state.to||state.tab!=='all');
  return `<div class="empty-state"><div class="empty-illustration">${icon('calendar')}</div><h3>${hasFilters?'没有符合条件的跟进事项':'暂无跟进计划'}</h3><p>${hasFilters?'调整筛选条件，查看其他跟进计划。':'可在已有论文的详情中设置下次跟进日期，到期后会在这里提醒。'}</p>${hasFilters?btn('clear-filters','重置筛选','refresh'):btn('navigate','查看论文','document','','data-view="papers"')}</div>`;
 }
 return `<div class="empty-state"><div class="empty-illustration">${icon(filtered?'search':'document')}</div><h3>${filtered?'没有找到符合条件的记录':`还没有${label}记录`}</h3><p>${filtered?'试试其他关键词，或重置筛选条件。':'请在论文管理中建立论文档案，再查看投稿进度和收支记录。'}</p>${filtered?btn('clear-filters','重置筛选','refresh'):btn('navigate','前往论文管理','document','','data-view="papers"')}</div>`;
}
function pagination(total) {
 const pages = Math.max(1,Math.ceil(total/state.pageSize)); state.page = Math.min(state.page,pages);
 const visible = Array.from({length:pages},(_,i)=>i+1).filter(p=>p===1||p===pages||Math.abs(p-state.page)<=1);
 let last=0;
 return `<div class="table-footer"><span>共 ${total} 条记录${total?`，显示 ${(state.page-1)*state.pageSize+1}–${Math.min(state.page*state.pageSize,total)} 条`:''}</span><div class="pagination"><button class="page-btn" data-action="page" data-page="${state.page-1}" ${state.page<=1?'disabled':''} aria-label="上一页">${icon('left')}</button>${visible.map(p=>{const gap=p-last>1?'<span>…</span>':'';last=p;return `${gap}<button class="page-btn ${p===state.page?'active':''}" data-action="page" data-page="${p}" aria-label="第 ${p} 页" ${p===state.page?'aria-current="page"':''}>${p}</button>`;}).join('')}<button class="page-btn" data-action="page" data-page="${state.page+1}" ${state.page>=pages?'disabled':''} aria-label="下一页">${icon('chevron')}</button></div></div>`;
}
function renderPaperResults() {
 const papers = filteredPapers(); const paging = pagination(papers.length); const visible = papers.slice((state.page-1)*state.pageSize,state.page*state.pageSize);
 if (state.from && state.to && state.from > state.to) { $('#results').innerHTML = '<div class="empty-state"><h3>起始日期不能晚于截止日期</h3><p>调整投稿日期范围后重新查询。</p></div>'; return; }
 $('#results').innerHTML = papers.length ? `<div class="table-scroll"><table><thead><tr><th>论文题目 / 编号</th><th>客户 / 作者</th><th>投稿期刊</th><th>投稿日期</th><th>投稿状态</th><th>收款 / 应收</th><th>已付 / 稿酬</th><th>${state.view==='followups'?'跟进日期':'操作'}</th></tr></thead><tbody>${visible.map(p=>`<tr><td class="paper-cell"><button class="paper-title" data-action="detail" data-id="${esc(p.id)}">${esc(p.title)}</button><div class="paper-meta">${esc(p.code)}</div><div class="cell-sub">${serviceBadge(p)}</div></td><td>${customerLink(p)}<div class="cell-sub">${esc(p.authors||'未填写作者')}</div></td><td><div class="journal-name" title="${esc(p.journal)}">${esc(p.journal||'待选择期刊')}</div><div class="cell-sub">${esc(p.submissionSystem||'—')}</div></td><td>${dateLabel(p.submittedAt)}${due(p)?`<div class="cell-sub due-date">${icon('clock')}需要跟进</div>`:''}</td><td>${badge(p.status)}</td><td><div class="cell-money">${yuan(p.contractReceivedCents)}</div><div class="cell-sub">应收 ${yuan(p.contractCents)}</div></td><td>${hasWriting(p)?`<div class="cell-money light">${yuan(p.writerPaidCents)}</div><div class="cell-sub">稿酬 ${yuan(p.writerFeeCents)}</div>`:'<span class="panel-hint">客户供稿</span>'}</td><td>${state.view==='followups'?`<div class="${due(p)?'due-date':''}">${dateLabel(p.followUpAt)}</div><button class="text-btn" data-action="detail" data-id="${esc(p.id)}">查看详情</button>`:`<button class="text-btn" data-action="detail" data-id="${esc(p.id)}">详情${icon('chevron')}</button>`}</td></tr>`).join('')}</tbody></table></div>${paging}` : emptyState(state.papers.length>0);
}
function overviewPanels() {
 const p = state.papers; const groups = [['准备中',p.filter(x=>['草稿','待投稿'].includes(x.status)).length],['投稿 / 审稿',p.filter(x=>['已投稿','审稿中'].includes(x.status)).length],['修改中',p.filter(x=>x.status==='修改中').length],['录用 / 发表',p.filter(x=>['已录用','已发表'].includes(x.status)).length]];
 const reminders = p.filter(due).sort((a,b)=>a.followUpAt.localeCompare(b.followUpAt)).slice(0,3);
 return `<div class="bottom-grid"><section class="panel mini-panel"><div class="panel-header"><h2 class="panel-title">投稿进度分布</h2><span class="panel-hint">按当前状态统计</span></div><div class="progress-list">${groups.map(([label,count])=>`<div class="progress-col"><div class="progress-label">${label}<strong>${count}</strong></div><div class="progress-track"><div class="progress-fill" style="width:${p.length?Math.round(count/p.length*100):0}%"></div></div></div>`).join('')}</div><div class="overview-caption">${icon('info')}共 ${p.length} 篇论文${p.length?`，其中 ${p.filter(x=>['已拒稿','已撤稿'].includes(x.status)).length} 篇已拒稿或撤稿`:''}</div></section><section class="panel mini-panel"><div class="panel-header"><h2 class="panel-title">近期需关注 <small>${p.filter(due).length} 项</small></h2><button class="text-btn" data-action="navigate" data-view="followups">查看全部${icon('chevron')}</button></div><div class="reminders">${reminders.length?reminders.map(p=>`<div class="reminder"><div class="reminder-icon">${icon('clock')}</div><div class="reminder-main"><button class="paper-title reminder-title" data-action="detail" data-id="${esc(p.id)}">${esc(p.title)}</button><div class="reminder-note">${esc(p.journal||'未填写期刊')} · ${esc(p.status)}</div></div><span class="reminder-date">${p.followUpAt===today()?'今天跟进':dateLabel(p.followUpAt)}</span></div>`).join(''):`<div class="empty-small">${icon('checkCircle')} 暂无到期事项，安排好下一次跟进即可。</div>`}</div></section></div>`;
}

function allTransactions() { return state.papers.flatMap(p=>(p.transactions||[]).map(tx=>({...tx,paper:p}))).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt)); }
function filteredFinancePapers() {
 const query=state.search.trim().toLocaleLowerCase();
 return state.papers.filter(p=>!query||[p.title,p.code,p.customer,p.writer].join(' ').toLocaleLowerCase().includes(query));
}
function selectFinanceTab(type,reset=false) {
 state.financeType=type;state.page=1;
 if(reset)resetFilters();
 if(type==='balances'){state.from='';state.to='';}
 renderFinance();
}
function filteredTransactions() {
 return allTransactions().filter(tx=>{
  if(state.financeType!=='all'&&!tx.type.startsWith(state.financeType))return false;
  if(state.from&&tx.date<state.from)return false; if(state.to&&tx.date>state.to)return false;
  const query = state.search.trim().toLocaleLowerCase();
  return !query||[tx.paper.title,tx.paper.code,tx.paper.customer,tx.paper.writer,tx.note,tx.method,typeLabels[tx.type]].join(' ').toLocaleLowerCase().includes(query);
 });
}
function renderFinance() {
 const p = state.papers;const balances=state.financeType==='balances';
 const sourceLink=(type,label)=>btn('finance-source',label,'chevron','text-btn finance-source-link',`data-type="${type}"`);
 $('#content').innerHTML = `${pageHeading('收支管理','查看每篇论文的费用约定、剩余款项与实际收付，追溯每笔金额的来源。',btn('export-finance',balances?'导出应收应付':'导出流水','down'))}<div class="stats-grid finance-summary">${stat('累计已收款',yuan(sum(p,'receivedCents')),'arrowDown',`<span>其中其他收入 <strong>${yuan(sum(p,'otherIncomeCents'))}</strong></span>${sourceLink('incoming','查看收入明细')}`,'','',true)}${stat('累计已付款',yuan(sum(p,'paidCents')),'arrowUp',`<span>其中其他支出 <strong>${yuan(sum(p,'otherExpenseCents'))}</strong></span>${sourceLink('outgoing','查看支出明细')}`,'gold','',true)}${stat('待收款',yuan(sum(p,'receivableCents')),'clock',`<span>待付稿酬 <strong>${yuan(sum(p,'payableCents'))}</strong></span>${sourceLink('balances','查看应收应付')}`,'blue','',true)}${stat('现金净额',yuan(sum(p,'netCents')),'chart',`<span>实际已收 − 实际已付</span>${sourceLink('all','查看收付明细')}`,'purple','',true)}</div><section class="panel"><div class="panel-header"><h2 class="panel-title">收支明细 <small>FINANCIAL DETAILS</small></h2><span class="panel-hint">上方汇总全部论文，筛选仅影响下方明细</span></div><div class="tab-bar finance-tabs" role="tablist">${[['balances','应收应付'],['all','全部流水'],['incoming','收入'],['outgoing','支出']].map(([id,label])=>`<button class="tab ${state.financeType===id?'active':''}" data-action="finance-tab" data-type="${id}" role="tab" aria-selected="${state.financeType===id}">${label}</button>`).join('')}</div><div class="filter-row"><div class="search-box">${icon('search')}<input id="search" type="search" placeholder="${balances?'搜索论文、编号、客户或写作者…':'搜索论文、客户、写作者或备注…'}" aria-label="${balances?'搜索应收应付明细':'搜索收支流水'}" value="${esc(state.search)}"></div>${balances?'':`<span class="filter-label">收支日期</span><input class="date-filter" id="from-filter" type="date" aria-label="收支起始日期" value="${esc(state.from)}"><span class="date-sep">至</span><input class="date-filter" id="to-filter" type="date" aria-label="收支截止日期" value="${esc(state.to)}">`}${btn('clear-filters','重置')}</div><div id="results"></div></section><div class="notice green" style="margin-top:22px">${icon('info')}<span>待收款 = 约定应收 − 已收定金及尾款；待付稿酬 = 约定稿酬 − 已付定金及尾款，均以 0 为下限。费用约定不会自动生成实际流水，需在论文收支明细中登记。其他收入、支出单独统计，不抵扣尾款；现金净额包含全部流水，不代表最终利润。</span></div>${footer()}`;
 renderFinanceResults();
}
function renderFinanceBalances() {
 const papers=filteredFinancePapers();const paging=pagination(papers.length);
 if(!papers.length){$('#results').innerHTML=emptyState(state.papers.length>0);return;}
 $('#results').innerHTML=`<div class="results-note">当前筛选：约定应收 ${yuan(sum(papers,'contractCents'))} · 已收定金及尾款 ${yuan(sum(papers,'contractReceivedCents'))} · 待收款 ${yuan(sum(papers,'receivableCents'))}<br>约定稿酬 ${yuan(sum(papers,'writerFeeCents'))} · 已付稿酬 ${yuan(sum(papers,'writerPaidCents'))} · 待付稿酬 ${yuan(sum(papers,'payableCents'))}</div><div class="table-scroll"><table class="finance-balances"><thead><tr><th>关联论文</th><th>客户 / 写作者</th><th>约定应收 / 已收定金尾款</th><th>待收款</th><th>约定稿酬 / 已付稿酬</th><th>待付稿酬</th><th>操作</th></tr></thead><tbody>${papers.slice((state.page-1)*state.pageSize,state.page*state.pageSize).map(p=>`<tr><td class="paper-cell"><button class="paper-title" data-action="detail-finance" data-id="${esc(p.id)}">${esc(p.title)}</button><div class="paper-meta">${esc(p.code)}</div><div class="cell-sub">${serviceBadge(p)}</div></td><td><div>客户：${esc(p.customer||'未填写')}</div><div class="cell-sub">${hasWriting(p)?`写作者：${esc(p.writer||'未填写')}`:'客户供稿 · 无写作稿酬'}</div></td><td><div class="cell-money">约定 ${yuan(p.contractCents)}</div><div class="cell-sub">已收 ${yuan(p.contractReceivedCents)}</div>${p.contractReceivedCents>p.contractCents?'<div class="cell-sub">已收超过约定，请核对</div>':''}</td><td class="cell-money">${yuan(p.receivableCents)}</td><td>${hasWriting(p)?`<div class="cell-money">约定 ${yuan(p.writerFeeCents)}</div><div class="cell-sub">已付 ${yuan(p.writerPaidCents)}</div>${p.writerPaidCents>p.writerFeeCents?'<div class="cell-sub">已付超过约定，请核对</div>':''}`:'<span class="panel-hint">无需写作稿酬</span>'}</td><td class="cell-money">${yuan(p.payableCents)}</td><td><button class="text-btn" data-action="detail-finance" data-id="${esc(p.id)}">核对 / 登记${icon('chevron')}</button></td></tr>`).join('')}</tbody></table></div>${paging}`;
}
function renderFinanceResults() {
 if(state.financeType==='balances')return renderFinanceBalances();
 const txs = filteredTransactions(); const paging = pagination(txs.length);
 if(state.from&&state.to&&state.from>state.to){$('#results').innerHTML='<div class="empty-state"><h3>起始日期不能晚于截止日期</h3></div>';return;}
 if(!txs.length) {
  const hasTransactions=allTransactions().length>0;
  $('#results').innerHTML=`<div class="empty-state"><div class="empty-illustration">${icon('wallet')}</div><h3>${hasTransactions?'没有符合条件的流水':'还没有收支流水'}</h3><p>${hasTransactions?'试试其他关键词、收支日期或分类。':'费用约定与待收待付可在“应收应付”中查看。实际收付款需进入论文详情逐笔登记。'}</p>${hasTransactions?btn('clear-filters','重置筛选','refresh'):btn('finance-tab','查看应收应付','chevron','','data-type="balances"')}</div>`;
  return;
 }
 $('#results').innerHTML = `<div class="results-note">当前筛选：收入 ${yuan(txs.filter(t=>t.type.startsWith('incoming')).reduce((n,t)=>n+t.amountCents,0))} &nbsp; · &nbsp; 支出 ${yuan(txs.filter(t=>t.type.startsWith('outgoing')).reduce((n,t)=>n+t.amountCents,0))}</div><div class="table-scroll"><table><thead><tr><th>收支日期</th><th>关联论文</th><th>客户 / 写作者</th><th>收支类型</th><th>金额</th><th>收付方式 / 备注</th><th>操作</th></tr></thead><tbody>${txs.slice((state.page-1)*state.pageSize,state.page*state.pageSize).map(tx=>`<tr><td>${dateLabel(tx.date)}</td><td class="paper-cell"><button class="paper-title" data-action="detail-finance" data-id="${esc(tx.paper.id)}">${esc(tx.paper.title)}</button><div class="paper-meta">${esc(tx.paper.code)}</div></td><td>${esc(tx.type.startsWith('incoming')?tx.paper.customer||'—':tx.paper.writer||'—')}</td><td><span class="cash-label ${tx.type.startsWith('outgoing')?'outgoing':''}">${typeLabels[tx.type]}</span></td><td class="finance-amount ${tx.type.startsWith('incoming')?'incoming':'outgoing'}">${tx.type.startsWith('incoming')?'+':'−'}${yuan(tx.amountCents)}</td><td><div>${esc(tx.method||'—')}</div><div class="cell-sub" title="${esc(tx.note)}">${esc(tx.note.length>24?tx.note.slice(0,24)+'…':tx.note||'无备注')}</div></td><td><button class="text-btn" data-action="detail-finance" data-id="${esc(tx.paper.id)}">详情${icon('chevron')}</button></td></tr>`).join('')}</tbody></table></div>${paging}`;
}

function renderSettings() {
 $('#content').innerHTML = `${pageHeading('数据与设置','妥善备份记录，安心管理你的工作台。')}<div class="settings-grid"><section class="panel settings-card"><h2>${icon('shield')}数据备份与恢复</h2><p>加密备份包含论文档案、投稿账号密码、全部收支和投稿历史。建议定期下载，并妥善保存备份时使用的管理密码。</p><div class="actions">${btn('backup','下载加密备份','down','primary')}${btn('restore','从备份恢复','upload')}</div><div class="notice">${icon('info')}<span>恢复会替换当前账号的全部记录，请先下载当前备份。恢复后仍使用当前账号与管理密码登录。</span></div><div class="settings-meta"><span>当前论文</span><strong>${state.papers.length} 篇</strong></div><div class="settings-meta"><span>收支流水</span><strong>${allTransactions().length} 笔</strong></div><div class="settings-meta"><span>数据保护</span><strong>${state.storage==='mysql'?'投稿密码与备份加密':'AES-256-GCM 加密'}</strong></div><div class="settings-meta"><span>数据存储</span><strong>${state.storage==='mysql'?'MySQL 数据库':'本机加密文件'}</strong></div></section><section class="panel settings-card"><h2>${icon('lock')}修改管理密码</h2><p>${state.storage==='mysql'?'新密码用于登录和加密之后下载的备份，投稿密码继续使用独立密钥加密。':'新密码会重新加密本机数据。'}更新密码会使此账号在其他页面的登录失效。旧备份仍需使用备份时的密码解锁。</p><form id="password-form"><div class="field"><label for="current-password">当前密码</label><input id="current-password" name="currentPassword" type="password" autocomplete="current-password" required maxlength="128"></div><div class="field"><label for="new-password">新密码</label><input id="new-password" name="newPassword" type="password" autocomplete="new-password" required minlength="10" maxlength="128" placeholder="至少 10 个字符"></div><div class="field"><label for="confirm-password">确认新密码</label><input id="confirm-password" name="confirm" type="password" autocomplete="new-password" required minlength="10" maxlength="128"></div><div class="error-message" role="alert"></div><button type="submit" class="btn primary">${icon('lock')}更新密码</button></form></section><section class="panel settings-card"><h2>${icon('info')}使用说明</h2><p>先在客户管理中建立客户档案，再到论文管理中新建全包或半包论文；全包可安排写作并约定稿酬。在论文详情中分别登记实际收取的定金、尾款与支付的定金、尾款。在投稿管理中分别登记每次投稿的期刊、账号与日期；改投时新增记录，旧投稿完整保留。客户档案会自动汇总其论文、发表期刊和费用。</p><p>投稿日期筛选针对当前投稿日期；收支管理的日期筛选针对收付日期。CSV 导出遵循当前筛选，且不包含投稿账号、密码、邮箱和手机号。加密备份用于完整迁移。</p><p>本机版仅接受本机访问。${state.storage==='mysql'?'业务记录保存在已配置的 MySQL 数据库。迁移或维护数据库前，请同时备份数据库及独立加密密钥文件。':'数据保存在项目 data 目录。'}不会自动查询期刊网站或同步外部投稿系统。</p></section><section class="panel settings-card"><h2>${icon('document')}关于知序</h2><p>知序 · Paper Desk<br>论文投稿与收支管理工作台 · 独立账号</p><div class="notice green">${icon('shield')}<span>管理密码没有找回功能，请妥善保管密码与加密备份。离开工作台时，可点击左下角退出按钮锁定访问。</span></div></section></div>${footer()}`;
}

function setOverlay(html) {
 if(!$('#overlay-root').hasChildNodes()) previousFocus = document.activeElement;
 $('#overlay-root').innerHTML = html; document.body.style.overflow = 'hidden';
 requestAnimationFrame(()=>{ const first=$('[autofocus]', $('#overlay-root'))||$('input:not([type=hidden]),button,select,textarea', $('#overlay-root')); first?.focus(); });
}
function closeOverlay() { clearTimeout(credentialTimer); state.drawer=null;state.modal=null;$('#overlay-root').innerHTML='';document.body.style.overflow='';if(previousFocus?.isConnected)previousFocus.focus(); }
function field(name,label,value='',options={}) {
 const id='f-'+name;
 const control=options.textarea ? `<textarea id="${id}" name="${name}" maxlength="${options.max||5000}" placeholder="${esc(options.placeholder||'')}">${esc(value)}</textarea>` : options.select ? `<select id="${id}" name="${name}">${options.select.map(s=>`<option value="${esc(s)}" ${s===value?'selected':''}>${esc(s)}</option>`).join('')}</select>` : `<input id="${id}" name="${name}" type="${options.type||'text'}" value="${esc(value)}" ${options.required?'required':''} ${options.max?`maxlength="${options.max}"`:''} ${options.type==='number'?'min="0" max="1000000" step="0.01" inputmode="decimal"':''} ${options.type==='date'&&(options.maxDate||name==='submittedAt')?`max="${esc(options.maxDate||today())}"`:''} ${options.type==='date'&&options.minDate?`min="${esc(options.minDate)}"`:''} ${options.type==='password'?'autocomplete="new-password"':''} placeholder="${esc(options.placeholder||'')}">`;
 return `<div class="field ${options.full?'full':''}"><label for="${id}">${label}${options.required?'<em>*</em>':''}</label>${control}${options.hint?`<small>${options.hint}</small>`:''}</div>`;
}
function openEditor(p=null,customerId='') { openPaperEditor(p,p?(p.serviceType||'full'):'half',customerId); }

async function openDetail(id,tab='basic') {
 const paper = await api(`/api/papers/${encodeURIComponent(id)}`);
 clearTimeout(credentialTimer);state.drawer={kind:'detail',paper,tab};renderDetail();
}
function detailField(label,value,full=false) { return `<div class="detail-field ${full?'full':''}"><label>${label}</label><div class="value">${value||'—'}</div></div>`; }
function renderDetail() {
 const {paper:p,tab}=state.drawer;
 setOverlay(`<div class="overlay"><section class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><header class="drawer-head"><div><h2 id="drawer-title">${esc(p.title)}</h2><p>${esc(p.code)} &nbsp; · &nbsp; ${esc(p.authors||'未填写作者')}</p></div><button class="icon-btn" data-action="close" aria-label="关闭">${icon('close')}</button></header><div class="detail-tabs" role="tablist">${[['basic','论文详情'],['submissions','投稿记录'],['finance','收支明细'],['history','变更历史']].map(([id,label])=>`<button class="tab ${tab===id?'active':''}" data-action="detail-tab" data-tab="${id}" role="tab" aria-selected="${tab===id}">${label}</button>`).join('')}</div><div class="drawer-body" id="detail-body">${tab==='basic'?basicDetail(p):tab==='finance'?financeDetail(p):tab==='submissions'?submissionCards(p):historyDetail(p)}</div><footer class="drawer-foot">${btn('delete-paper','删除论文','trash','danger small')}<div class="actions">${btn('add-transaction','登记收支','wallet')}${btn('edit-paper','编辑','edit','primary')}</div></footer></section></div>`);
}
function basicDetail(p) {
 return writingOverview(p)+`<div class="detail-meta">${detailField('当前状态',badge(p.status))}${detailField('客户 / 委托人',esc(p.customer))}${hasWriting(p)?detailField('写作者 / 合作人',esc(p.writer)):''}${detailField('作者',esc(p.authors))}${detailField('投稿期刊',esc(p.journal))}${detailField('投稿系统',esc(p.submissionSystem))}${detailField('投稿日期',dateLabel(p.submittedAt))}${detailField('下次跟进',`${dateLabel(p.followUpAt)}${due(p)?' <span class="due-date">已到跟进时间</span>':''}`)}${detailField('投稿网址',p.submissionUrl?`<a href="${esc(p.submissionUrl)}" target="_blank" rel="noopener noreferrer">${esc(p.submissionUrl)} ${icon('link')}</a>`:'',true)}</div><div class="credential-box"><h3 class="section-heading">${icon('lock')}账号与绑定信息</h3><div class="detail-meta">${detailField('投稿账号',esc(p.submissionAccount))}${detailField('投稿密码',p.hasPassword?`<div class="password-row"><span id="password-value" class="password-value">••••••••••</span><button class="text-btn" data-action="reveal-password" id="reveal-button">${icon('eye')}显示</button></div>`:'未保存')}${detailField('绑定邮箱',esc(p.boundEmail))}${detailField('绑定手机号',esc(p.boundPhone))}</div></div><div class="section-heading" style="margin-top:26px">${icon('document')}备注</div><div class="detail-note">${esc(p.notes||'暂无备注')}</div><p class="panel-hint" style="margin-top:20px">建立于 ${instantLabel(p.createdAt)} &nbsp; · &nbsp; 更新于 ${instantLabel(p.updatedAt)}</p>`;
}
function financeDetail(p) {
 const transactions=[...p.transactions].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
 return `<div class="money-grid"><div class="money-box"><label>已收定金尾款 / 约定应收</label><strong>${yuan(p.contractReceivedCents)}</strong><small>约定 ${yuan(p.contractCents)} · 未收 ${yuan(p.receivableCents)}</small></div>${hasWriting(p)?`<div class="money-box"><label>已付稿酬 / 约定稿酬</label><strong>${yuan(p.writerPaidCents)}</strong><small>约定 ${yuan(p.writerFeeCents)} · 未付 ${yuan(p.payableCents)}</small></div>`:`<div class="money-box"><label>半包 · 客户供稿</label><strong>无需写作稿酬</strong><small>投稿等费用登记为其他支出</small></div>`}</div>${p.contractReceivedCents>p.contractCents||p.writerPaidCents>p.writerFeeCents?`<div class="notice">${icon('info')}累计实际收款或付款已超过对应约定金额，请核对费用约定与流水。</div>`:''}<div class="panel-header" style="padding:6px 0"><h3 class="panel-title">收支流水 <small>${p.transactions.length} 笔</small></h3>${btn('add-transaction','登记收支','plus','small')}</div><div class="transaction-list">${transactions.length?transactions.map(tx=>`<div class="transaction"><div class="transaction-circle ${tx.type.startsWith('outgoing')?'outgoing':''}">${icon(tx.type.startsWith('incoming')?'arrowDown':'arrowUp')}</div><div class="transaction-main"><div class="transaction-title">${typeLabels[tx.type]}</div><div class="transaction-note">${dateLabel(tx.date)}${tx.method?' · '+esc(tx.method):''}${tx.note?'<br>'+esc(tx.note):''}</div></div><div class="transaction-amount finance-amount ${tx.type.startsWith('incoming')?'incoming':'outgoing'}">${tx.type.startsWith('incoming')?'+':'−'}${yuan(tx.amountCents)}</div><button class="icon-btn" data-action="delete-transaction" data-id="${esc(tx.id)}" aria-label="删除这笔${typeLabels[tx.type]}" title="删除这笔流水">${icon('trash')}</button></div>`).join(''):'<div class="empty-small" style="padding:45px 10px">暂无流水。登记定金、尾款，让每笔收支清晰可查。</div>'}</div><div class="detail-note" style="margin-top:20px">现金净额：${yuan(p.netCents)}（实际已收 − 实际已付）<br>其他收入：${yuan(p.otherIncomeCents)} · 其他支出：${yuan(p.otherExpenseCents)}<br>其他收支单独统计，不抵扣应收尾款或应付稿酬。</div>`;
}
function historyDetail(p) {
 return `<div class="notice green" style="margin-bottom:27px">${icon('info')}修改期刊、投稿系统、投稿网址、投稿日期或状态时，会自动保留该次变更。</div><div class="timeline">${[...p.history].reverse().map(e=>`<div class="timeline-item"><h3>${esc(e.action)} &nbsp; ${badge(e.status)}</h3><p>期刊：${esc(e.journal||'未填写')}<br>系统：${esc(e.submissionSystem||'未填写')}<br>投稿日期：${dateLabel(e.submittedAt)}</p>${e.submissionUrl?`<p>${esc(e.submissionUrl)}</p>`:''}<time>${instantLabel(e.at)}</time></div>`).join('')}</div>`;
}
function transactionForm() {
 clearTimeout(credentialTimer);state.drawer.kind='transaction'; const p=state.drawer.paper;
 setOverlay(`<div class="overlay"><section class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><header class="drawer-head"><div><h2 id="drawer-title">登记收支</h2><p>${esc(p.title)}</p></div><button class="icon-btn" data-action="cancel-transaction" aria-label="返回论文详情">${icon('close')}</button></header><form id="transaction-form" style="display:contents"><div class="drawer-body"><div class="notice green" style="margin-bottom:25px">${icon('info')}收入对应向客户收款，支出对应向写作者付款或其他费用。</div><div class="form-grid"><div class="field full"><label for="tx-type">收支类型 <em>*</em></label><select id="tx-type" name="type"><optgroup label="收入 · 向客户收款">${Object.entries(typeLabels).filter(([k])=>k.startsWith('incoming')).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</optgroup><optgroup label="支出">${Object.entries(typeLabels).filter(([k])=>k.startsWith('outgoing')&&(hasWriting(p)||k==='outgoing_other')).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</optgroup></select></div>${field('amount','金额（元）','',{type:'number',required:true,placeholder:'0.00'})}<div class="field"><label for="tx-date">收付日期 <em>*</em></label><input id="tx-date" name="date" type="date" required value="${today()}" max="${today()}"></div>${field('method','收付方式','',{max:80,full:true,placeholder:'例如：银行转账、微信、支付宝'})}${field('note','收支备注','',{textarea:true,full:true,max:1000,placeholder:'例如：首笔定金、录用后尾款、转账凭证号…'})}</div><div class="error-message" role="alert"></div></div><footer class="drawer-foot"><span class="panel-hint">逐笔记录，自动汇总</span><div class="actions">${btn('cancel-transaction','返回详情')}<button class="btn primary" type="submit">${icon('check')}保存收支</button></div></footer></form></section></div>`);
}

function confirmModal(title,message,action,label='确定',danger=false) {
 hideCredential();
 clearTimeout(credentialTimer);state.modal={kind:'confirm',action};
 // Keep the live elements so cancelling preserves unsaved input values.
 state.modal.previous=[...$('#overlay-root').childNodes];
 setOverlay(`<div class="overlay modal-overlay"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><h2 id="modal-title">${esc(title)}</h2><p>${esc(message)}</p><div class="error-message" role="alert"></div><div class="actions">${btn('cancel-modal','取消')}${btn('confirm-modal',label,'',danger?'danger':'primary')}</div></section></div>`);
}
function cancelModal() {
 const previous=state.modal?.previous;state.modal=null;
 if(state.drawer?.paper&&state.drawer.kind==='detail')renderDetail();
 else if(previous?.length){$('#overlay-root').replaceChildren(...previous);$('input,button,select,textarea',$('#overlay-root'))?.focus();}else closeOverlay();
}
function restoreModal() {
 state.modal={kind:'restore'};
 setOverlay(`<div class="overlay modal-overlay"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><h2 id="modal-title">从加密备份恢复</h2><p>这将替换当前账号的全部论文及流水。请先在设置中下载当前账号的备份，恢复后仍使用当前账号与管理密码。</p><form id="restore-form"><div class="form-grid"><div class="field full"><label for="backup-file">选择 .vault 加密备份</label><input id="backup-file" name="file" type="file" accept=".vault,.bak" required></div><div class="field full"><label for="backup-password">备份时使用的密码</label><input id="backup-password" name="password" type="password" autocomplete="off" required maxlength="128"></div><div class="field full"><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" required style="width:auto">我已备份当前账号的数据，确认替换该账号的全部记录</label></div></div><div class="error-message" role="alert"></div><div class="actions">${btn('close','取消')}<button type="submit" class="btn danger">确认恢复</button></div></form></section></div>`);
}

function download(name,blob) { const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000); }
function csvCell(value) { let text=String(value??'');if(/^[\s]*[=+\-@\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"'; }
function csvDownload(name,rows) { const csv='\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');download(name,new Blob([csv],{type:'text/csv;charset=utf-8'})); }
function exportPapers() {
 const list=filteredPapers();if(!list.length)return toast('当前筛选下没有可导出的记录',true);
 const headers=['编号','论文题目','服务类型','作者','客户','写作者','投稿期刊','投稿系统','投稿网址','投稿日期','当前状态','跟进日期','约定应收（元）','稿酬总额（元）','已收定金（元）','已收尾款（元）','其他收入（元）','已付定金（元）','已付尾款（元）','其他支出（元）','已收总额（元）','已付总额（元）','未收（元）','未付（元）','备注'];
 const txsum=(p,type)=>p.transactions.filter(t=>t.type===type).reduce((n,t)=>n+t.amountCents,0)/100;
 csvDownload(`投稿记录-${today()}.csv`,[headers,...list.map(p=>[p.code,p.title,serviceLabel(p),p.authors,p.customer,p.writer,p.journal,p.submissionSystem,p.submissionUrl,p.submittedAt,p.status,p.followUpAt,p.contractCents/100,p.writerFeeCents/100,...['incoming_deposit','incoming_balance','incoming_other','outgoing_deposit','outgoing_balance','outgoing_other'].map(t=>txsum(p,t)),p.receivedCents/100,p.paidCents/100,p.receivableCents/100,p.payableCents/100,p.notes])]);toast(`已导出 ${list.length} 条记录`);
}
function exportFinance() {
 if(state.financeType==='balances') {
  const papers=filteredFinancePapers();if(!papers.length)return toast('当前筛选下没有可导出的应收应付',true);
  csvDownload(`应收应付-${today()}.csv`,[['论文编号','论文题目','服务类型','客户','写作者','约定应收（元）','已收定金及尾款（元）','待收款（元）','约定稿酬（元）','已付稿酬（元）','待付稿酬（元）'],...papers.map(p=>[p.code,p.title,serviceLabel(p),p.customer,p.writer,...['contractCents','contractReceivedCents','receivableCents','writerFeeCents','writerPaidCents','payableCents'].map(key=>(p[key]||0)/100)])]);toast(`已导出 ${papers.length} 条应收应付`);return;
 }
 const txs=filteredTransactions();if(!txs.length)return toast('当前筛选下没有可导出的流水',true);
 csvDownload(`收支流水-${today()}.csv`,[['收支日期','论文编号','论文题目','客户','写作者','收支类型','收入（元）','支出（元）','收付方式','备注'],...txs.map(t=>[t.date,t.paper.code,t.paper.title,t.paper.customer,t.paper.writer,typeLabels[t.type],t.type.startsWith('incoming')?t.amountCents/100:'',t.type.startsWith('outgoing')?t.amountCents/100:'',t.method,t.note])]);toast(`已导出 ${txs.length} 笔流水`);
}
function resetFilters() { Object.assign(state,{search:'',status:'',from:'',to:'',customerId:'',page:1}); }
function navigateTo(view,customerId='') {
 state.view=view;state.tab='all';state.financeType='balances';resetFilters();
 state.customerId=customerId;closeOverlay();renderShell();
}
function renderResults() { if(state.view==='papers')return renderManagedPaperResults();if(state.view==='submissions')return renderSubmissionResults();if(state.view==='customers')return renderCustomerResults();state.view==='finance'?renderFinanceResults():renderPaperResults(); }

document.addEventListener('click', async event => {
 const button=event.target.closest('[data-action]');if(!button||button.disabled)return;
 const action=button.dataset.action;
 try {
  if(action==='auth-mode') {
   if(state.authSubmitting||!['login','register','password'].includes(button.dataset.mode))return;
   state.username=$('#auth-username')?.value.trim()||state.username;state.authMode=button.dataset.mode;renderAuth();$('#auth-username')?.focus();
  }
  else if(action==='change-password'){state.view='settings';renderShell();$('#current-password')?.focus();}
  else if(action==='navigate')navigateTo(button.dataset.view,button.dataset.customerId||'');
  else if(action==='menu')$('#sidebar').classList.toggle('mobile-open');
  else if(action==='new-paper')openEditor(null,button.dataset.customerId||'');
  else if(action==='new-writing')openWritingEditor(null,button.dataset.customerId||'');
  else if(action==='close') {
   if(isEditingDrawer()){confirmModal('放弃未保存的修改？','关闭后，本次尚未保存的内容将丢失。',()=>closeOverlay(),'放弃修改');}
   else closeOverlay();
  }
  else if(action==='tab'){state.tab=button.dataset.tab;state.page=1;renderContent();}
  else if(action==='finance-tab'||action==='finance-source')selectFinanceTab(button.dataset.type,action==='finance-source');
  else if(action==='page'){state.page=Number(button.dataset.page);renderResults();}
  else if(action==='clear-filters'){resetFilters();renderContent();}
  else if(action==='refresh'){button.disabled=true;await loadPapers();toast('记录已刷新');}
  else if(action==='detail'||action==='detail-finance')await openDetail(button.dataset.id,action==='detail-finance'?'finance':'basic');
  else if(action==='detail-tab'){clearTimeout(credentialTimer);state.drawer.tab=button.dataset.tab;renderDetail();}
  else if(action==='edit-paper'){
   button.disabled=true;
   const paper=button.dataset.id?await api(`/api/papers/${encodeURIComponent(button.dataset.id)}`):state.drawer.paper;
   openEditor(paper);
  }
  else if(action==='cancel-edit'){state.drawer.kind='detail';state.drawer.tab='basic';renderDetail();}
  else if(action==='add-transaction')transactionForm();
  else if(action==='cancel-transaction'){state.drawer.kind='detail';state.drawer.tab='finance';renderDetail();}
  else if(action==='reveal-password') {
   const field=$('#password-value');
   if(button.dataset.visible==='true'){hideCredential();return;}
   button.disabled=true;const id=state.drawer.paper.id;
   const data=await request('POST',`/api/papers/${id}/credentials`);
   if(state.drawer?.paper.id!==id||!field.isConnected)return;
   field.textContent=data.password;button.innerHTML=`${icon('eye')}隐藏`;button.dataset.visible='true';button.disabled=false;
   clearTimeout(credentialTimer);credentialTimer=setTimeout(hideCredential,30000);
  }
  else if(action==='delete-paper') {
   const p=state.drawer.paper;
   confirmModal('删除这篇论文？',`“${p.title}”的档案、投稿历史和 ${p.transactions.length} 笔收支将一起删除。删除前建议下载加密备份。`,async()=>{await request('DELETE',`/api/papers/${p.id}`,{version:p.version});closeOverlay();await loadPapers();toast('论文已删除');},'确认删除',true);
  }
  else if(action==='delete-transaction') {
   const p=state.drawer.paper;const id=button.dataset.id;const tx=p.transactions.find(x=>x.id===id);
   confirmModal('删除这笔收支？',`${typeLabels[tx.type]} ${yuan(tx.amountCents)}，日期 ${tx.date}。删除后将重新计算这篇论文的收支金额。`,async()=>{const updated=await request('DELETE',`/api/papers/${p.id}/transactions/${id}`,{version:p.version});state.modal=null;state.drawer={kind:'detail',paper:updated,tab:'finance'};await loadPapers();renderDetail();toast('流水已删除');},'确认删除',true);
  }
  else if(action==='cancel-modal')cancelModal();
  else if(action==='confirm-modal'){button.disabled=true;await state.modal.action();}
  else if(action==='export-papers')exportPapers();
  else if(action==='export-finance')exportFinance();
  else if(action==='backup') {
   button.disabled=true;const response=await fetch('/api/backup',{credentials:'same-origin'});
   if(!response.ok){const error=await response.json();throw new Error(error.error||'备份下载失败');}
   download(`paper-desk-${today()}.vault`,await response.blob());toast('加密备份已下载');
  }
  else if(action==='restore')restoreModal();
  else if(action==='logout') {
   await request('POST','/api/logout');state.authenticated=false;state.authMode='login';state.papers=[];state.customers=[];state.initialized=true;state.csrf='';closeOverlay();renderAuth();toast('工作台已锁定');
  }
 } catch(error) {
  const errorField=$('.error-message',$('#overlay-root'));
  if(errorField)errorField.textContent=error.message;else toast(error.message,true);
 } finally { if(button.isConnected)button.disabled=false; }
});

document.addEventListener('input', event => {
 if(event.target.id==='search'){state.search=event.target.value;state.page=1;renderResults();}
});
document.addEventListener('change', event => {
 const names={'status-filter':'status','from-filter':'from','to-filter':'to','customer-filter':'customerId'};
 if(names[event.target.id]){state[names[event.target.id]]=event.target.value;state.page=1;renderResults();}
});
document.addEventListener('submit',async event=>{
 if(!['auth-form','paper-form','transaction-form','password-form','restore-form'].includes(event.target.id))return;
 event.preventDefault();const form=event.target;const data=Object.fromEntries(new FormData(form));const submit=$('[type=submit]',form);const errorField=$('.error-message',form);
 if(submit?.disabled)return;const submitLabel=submit?.innerHTML;if(submit){submit.disabled=true;if(form.id!=='auth-form')submit.innerHTML='保存中…';}if(errorField)errorField.textContent='';
 try {
  if(form.id==='auth-form') {
   state.authSubmitting=true;
   const mode=form.dataset.mode;state.username=data.username.trim();
   if(mode==='password') {
    if(data.newPassword!==data.confirm)throw new Error('两次输入的新密码不一致');
    await request('POST','/api/change-password',{username:data.username,currentPassword:data.currentPassword,newPassword:data.newPassword});
    state.authenticated=false;state.csrf='';state.papers=[];state.customers=[];state.initialized=true;state.authMode='login';closeOverlay();renderAuth();toast('密码已修改，请使用新密码登录');
   } else {
    if(mode==='register'&&data.password!==data.confirm)throw new Error('两次输入的密码不一致');
    const result=await request('POST',mode==='register'?'/api/register':'/api/login',{username:data.username,password:data.password});
    state.csrf=result.csrf;state.username=result.username;state.initialized=true;state.authenticated=true;state.authMode='login';state.view='records';resetFilters();renderShell();
    try { await loadPapers(); } catch(error) { if(state.authenticated)toast(`登录成功，列表加载失败，请点击刷新。${error.message}`,true); }
   }
  }
  else if(form.id==='paper-form') {
   const p=state.drawer.paper;const payload={...data};delete payload.clearPassword;
   if(p){payload.version=p.version;if(data.clearPassword==='on')payload.submissionPassword='';else if(data.submissionPassword==='')delete payload.submissionPassword;}
   const saved=await request(p?'PUT':'POST',p?`/api/papers/${p.id}`:'/api/papers',payload);
   await finishSave(saved,p?'论文已保存':hasWriting(saved)?'全包论文已建立':'半包论文已建立',{view:state.view==='papers'?'papers':'records'});
  }
  else if(form.id==='transaction-form') {
   const p=state.drawer.paper;const saved=await request('POST',`/api/papers/${p.id}/transactions`,{...data,version:p.version});
   await finishSave(saved,'收支已登记',{view:'finance',financeType:'all'});
  }
  else if(form.id==='password-form') {
   if(data.newPassword!==data.confirm)throw new Error('两次输入的新密码不一致');
   const result=await request('POST','/api/password',{currentPassword:data.currentPassword,newPassword:data.newPassword});state.csrf=result.csrf;form.reset();toast('管理密码已更新，此账号的其他页面需重新登录');
  }
  else if(form.id==='restore-form') {
   const file=$('#backup-file',form).files[0];if(!file)throw new Error('请选择备份文件');if(file.size>8*1024*1024)throw new Error('备份文件不能超过 8MB');
   const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
   await request('POST','/api/restore',{backup:btoa(binary),password:data.password});closeOverlay();resetFilters();await loadPapers();toast('备份已恢复');
  }
 } catch(error) { if(errorField?.isConnected)errorField.textContent=error.message;else toast(error.message,true); }
 finally {if(form.id==='auth-form')state.authSubmitting=false;if(submit?.isConnected){submit.disabled=false;submit.innerHTML=submitLabel;}}
});

function hideCredential() {
 hideSubmissionCredentials();
 clearTimeout(credentialTimer);const field=$('#password-value'),button=$('#reveal-button');
 if(field)field.textContent='••••••••••';if(button){button.innerHTML=`${icon('eye')}显示`;delete button.dataset.visible;}
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)hideCredential();});
document.addEventListener('keydown',event=>{
 const overlay=$('#overlay-root');if(!overlay.hasChildNodes())return;
 if(event.key==='Escape'){
  event.preventDefault();if(state.modal)cancelModal();else if(['detail','customer-detail'].includes(state.drawer?.kind))closeOverlay();
 }
 if(event.key==='Tab'){
  const items=[...overlay.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]')].filter(x=>x.getClientRects().length);
  if(!items.length)return;const first=items[0],last=items[items.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
 }
});
window.addEventListener('beforeunload',event=>{if(isEditingDrawer()){event.preventDefault();event.returnValue='';}});

(async()=>{
 try {
  const session=await api('/api/session');state.storage=session.storage||'file';state.initialized=session.initialized;state.authenticated=session.authenticated;state.username=session.username||'';state.csrf=session.csrf;
  if(session.authenticated)await loadPapers();else renderAuth();
 }catch(error){$('#root').innerHTML=`<div class="empty-state"><h3>工作台暂时无法连接</h3><p>${esc(error.message)}</p><a class="btn" href="/">重新连接</a></div>`;}
})();
