'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
function randomUuid() {
 if(typeof globalThis.crypto?.randomUUID==='function')return globalThis.crypto.randomUUID();
 // Public HTTP pages expose getRandomValues, but not randomUUID.
 const bytes=globalThis.crypto.getRandomValues(new Uint8Array(16));
 bytes[6]=(bytes[6]&0x0f)|0x40;bytes[8]=(bytes[8]&0x3f)|0x80;
 const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const money = cents => new Intl.NumberFormat('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}).format((cents || 0)/100);
const yuan = cents => `¥${money(cents)}`;
const dateLabel = value => value ? esc(value.replaceAll('-','.')) : '—';
const instantLabel = value => new Date(value).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const statuses = ['草稿','待投稿','已投稿','审稿中','修改中','已录用','已发表','已拒稿','已撤稿'];
const typeLabels = {incoming_deposit:'收取定金',incoming_balance:'收取尾款',incoming_other:'其他收入',outgoing_deposit:'支付定金',outgoing_balance:'支付尾款',outgoing_other:'其他支出',incoming_settlement:'终止结算收款',outgoing_refund:'退还客户款',outgoing_settlement:'终止结算稿酬',incoming_writer_refund:'写作者退回稿酬',outgoing_publication:'支付版面费',incoming_publication_refund:'版面费退回'};
const statusColors = {'草稿':'slate','待投稿':'slate','已投稿':'blue','审稿中':'blue','修改中':'amber','已录用':'green','已发表':'green','已拒稿':'red','已撤稿':'violet'};
const terminal = p => serviceEnded(p)||['已发表','已撤稿'].includes(p.status);
const accepted = p => p.status==='已录用';
const published = p => p.status==='已发表';
const paperInProgress = p => !terminal(p)&&!accepted(p);
const hasFollowUp = p => p.followUpTask?followUpActive(p.followUpTask):paperFollowUps(p).some(followUpActive);
const due = p => hasFollowUp(p)&&p.followUpAt<=today();
function followUpPlans() {
 return allFollowUps().filter(p=>followUpActive(p.followUpTask));
}
function followUpReasonLabel(p) { return p.followUpReason?.trim()||(p.followUpAt?'待补充跟进事项':'未安排跟进事项'); }
function followUpLabel(p) {
 return p.followUpAt<today()?'已逾期 · '+dateLabel(p.followUpAt):p.followUpAt===today()?'今天跟进':dateLabel(p.followUpAt)+' 跟进';
}
const sum = (list, key) => list.reduce((n, p) => n + (p[key] || 0), 0);
const state = {storage:'file',csrf:'',username:'',initialized:false,authenticated:false,authMode:'',authSubmitting:false,loginFailed:false,authEmail:'',recoveryEmail:'',resetSending:false,resetResendAt:0,registrationResendAt:0,papers:[],customers:[],customerId:'',view:'records',tab:'all',search:'',status:'',from:'',to:'',financeType:'balances',financeYear:String(new Date().getFullYear()),financeProfitBasis:'settled',page:1,pageSize:8,drawer:null,modal:null,loading:false};
let credentialTimer;
let previousFocus;
let overlayRevision=0,drawerRequestSequence=0,dataLoadSequence=0;
function beginDrawerRequest() {
 const sequence=++drawerRequestSequence,revision=overlayRevision,view=state.view,csrf=state.csrf;
 return ()=>sequence===drawerRequestSequence&&revision===overlayRevision&&view===state.view&&csrf===state.csrf;
}
function saveContext() {
 const revision=overlayRevision,view=state.view,csrf=state.csrf;
 return {drawer:state.drawer,csrf,current:()=>revision===overlayRevision&&view===state.view&&csrf===state.csrf};
}
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
 eyeOff:'<path d="m3 3 18 18M10.6 5.1A12 12 0 0 1 12 5c6 0 10 7 10 7a20 20 0 0 1-3.1 3.7M6.3 6.3A20 20 0 0 0 2 12s4 7 10 7a12 12 0 0 0 5.7-1.7M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
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
function paperCode(code) {
 return `<span class="paper-code" data-paper-code="${esc(code)}" tabindex="0" title="双击复制论文编号" aria-label="论文编号 ${esc(code)}，双击或按回车复制">${esc(code)}</span>`;
}
async function copyPaperCode(code) {
 if(!code)return;
 try {
  if(typeof navigator!=='undefined'&&navigator.clipboard?.writeText)await navigator.clipboard.writeText(code);
  else {
   const input=document.createElement('textarea');input.value=code;input.setAttribute('readonly','');
   input.style.position='fixed';input.style.opacity='0';document.body.append(input);
   try {input.select();if(!document.execCommand('copy'))throw new Error('copy failed');}finally{input.remove();}
  }
  toast('编号已复制');
 }catch{toast('复制失败，请手动选择编号复制',true);}
}
function badge(status) { return `<span class="badge ${statusColors[status] || 'slate'}">${esc(status)}</span>`; }
function btn(action, label, glyph, classes='', extra='') {
 const variants=classes.split(/\s+/),inline=variants.includes('small')&&!variants.includes('primary');
 return `<button type="button" class="${inline?'text-btn':'btn'} ${classes}" data-action="${action}" ${extra}>${glyph ? icon(glyph) : ''}${label}</button>`;
}
function toast(message, error=false) {
 const node = document.createElement('div'); node.className = `toast${error ? ' error' : ''}`;
 node.innerHTML = `${icon(error ? 'info' : 'checkCircle')}<span>${esc(message)}</span>`;
 $('#toast-root').append(node); setTimeout(() => node.remove(), 4500);
}
async function api(path, options={}) {
 const csrf=state.csrf;
 const response = await fetch(path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,...options.headers}});
 const result = await response.json();
 if (!response.ok) {
  if (response.status === 401 && csrf===state.csrf && state.authenticated && result.authenticated!==true) { state.authenticated = false; state.authMode='login';state.csrf='';state.papers=[];state.customers=[]; closeOverlay(); renderAuth(); }
  const recoveryUnavailable=response.status===404&&['/api/password-reset/code','/api/password-reset'].includes(path);
  const registrationUnavailable=response.status===404&&path==='/api/register/code';
  const error=new Error(registrationUnavailable?'当前服务尚未加载注册验证码功能，请重新启动服务并刷新页面后重试。':recoveryUnavailable?'当前服务尚未加载邮箱找回功能，请重新启动服务并刷新页面后重试。':result.error || '请求失败，请重试');error.status=response.status;error.code=result.code;throw error;
 }
 return result;
}
const request = (method, path, body={}) => api(path,{method,body:JSON.stringify(body)});
async function loadPapers() {
 const sequence=++dataLoadSequence,csrf=state.csrf,authenticated=state.authenticated;
 const [papers,customers]=await Promise.all([api('/api/papers'),api('/api/customers')]);
 if(sequence!==dataLoadSequence||csrf!==state.csrf||authenticated!==state.authenticated)return;
 state.papers=papers;state.customers=customers;renderShell();if(state.view==='writers')loadWriterProfiles();
}

function syncCustomerSummaries() {
 for(const c of state.customers) {
  const papers=state.papers.filter(p=>p.customerId===c.id);
  const authors=linkedAuthors(papers);
  Object.assign(c,{linkedAuthors:authors,authorCount:authors.length,paperCount:papers.length,publishedPaperCount:papers.filter(p=>p.published).length,
   publishedJournals:[...new Set(papers.flatMap(p=>p.publishedJournals||[]))],contractCents:papers.reduce((n,p)=>n+effectiveContract(p),0),
   receivedCents:sum(papers,'contractReceivedCents'),receivableCents:sum(papers,'receivableCents'),writerFeeCents:papers.reduce((n,p)=>n+effectiveWriterFee(p),0),refundableCents:sum(papers,'refundableCents')});
 }
}

// Commit the successful response to the visible list before syncing related summaries.
// A failed follow-up GET must never leave a saved form open for accidental resubmission.
async function finishSave(saved,message,{customer=false,view=state.view,financeType='balances',origin=null}={}) {
 if(origin&&origin.csrf!==state.csrf)return;
 dataLoadSequence++;
 if(customer)state.customers=[saved,...state.customers.filter(c=>c.id!==saved.id)];
 else {
  state.papers=[saved,...state.papers.filter(p=>p.id!==saved.id)];
  syncCustomerSummaries();
 }
 if(!origin||origin.current()){
  state.view=view;state.tab='all';state.financeType=financeType;resetFilters();closeOverlay();
 }
 renderShell();toast(message);
 try { await loadPapers(); }
 catch(error) { if(state.authenticated)toast('保存成功，列表刷新失败，请点击刷新。',true); }
}

function brand() { return `<div class="brand"><div class="brand-mark">${icon('document')}</div><div><div class="brand-name">知序</div><div class="brand-en">PAPER DESK</div></div></div>`; }
function showForgotPassword() {
 state.loginFailed=true;
 const entry=$('#auth-recovery-entry');
 if(entry)entry.innerHTML='<button type="button" class="text-btn auth-forgot" data-action="forgot-password">忘记密码？通过邮箱找回</button>';
}
function registrationEntry() {
 return '<button type="button" class="text-btn auth-forgot" data-action="auth-mode" data-mode="register">注册账号</button>';
}
function showRegistrationRequired() {
 state.initialized=false;state.loginFailed=false;
 const entry=$('#auth-recovery-entry');
 if(entry)entry.innerHTML=registrationEntry();
}
let recoveryTimer;
function updateRecoveryCooldown() {
 clearTimeout(recoveryTimer);
 const registrationButton=$('[data-action="send-register-code"]'),button=registrationButton||$('[data-action="send-reset-code"]');if(!button)return;
 const seconds=Math.max(0,Math.ceil(((registrationButton?state.registrationResendAt:state.resetResendAt)-Date.now())/1000));
 button.disabled=state.resetSending||seconds>0;
 button.textContent=state.resetSending?'发送中…':seconds?`${seconds} 秒后重发`:'获取验证码';
 if(seconds)recoveryTimer=setTimeout(updateRecoveryCooldown,1000);
}
async function sendAuthCode(registration=false) {
 const form=$('#auth-form'),username=$('#auth-username'),email=$('#auth-email');
 const cooldown=registration?'registrationResendAt':'resetResendAt';
 if(state.authSubmitting||state.resetSending||Date.now()<state[cooldown])return;
 if(!username.reportValidity()||!email.reportValidity())return;
 state.resetSending=true;updateRecoveryCooldown();
 const error=$('#auth-error');if(error)error.textContent='';
 try {
  const result=await request('POST',registration?'/api/register/code':'/api/password-reset/code',{username:username.value.trim(),email:email.value.trim()});
  state[cooldown]=Date.now()+(result.retryAfter||60)*1000;
  if(form.isConnected){const status=$('#reset-code-status');if(status)status.textContent=result.message;}
 } catch(error) { if(form.isConnected)showFormError(form,error.message); }
 finally { state.resetSending=false;updateRecoveryCooldown(); }
}
const sendResetCode=()=>sendAuthCode();
const sendRegistrationCode=()=>sendAuthCode(true);
function passwordVisibilityButton(id,label,action='toggle-password') {
 return `<button type="button" class="auth-password-toggle" data-action="${action}" data-target="${id}" data-label="${label}" aria-controls="${id}" aria-label="显示${label}" aria-pressed="false" title="显示${label}">${icon('eye')}</button>`;
}
function renderAuth() {
 clearTimeout(recoveryTimer);
 const mode=['register','forgot'].includes(state.authMode)?state.authMode:'login';
 const setup=mode==='register',recovering=mode==='forgot';
 const title=recovering?'找回密码':setup?'注册账号':'登录系统';
 const subtitle=recovering?'使用注册时绑定的邮箱接收验证码，设置新的登录密码。':setup?'填写账号和 QQ 邮箱，获取验证码后完成注册。注册成功后请登录。':state.initialized?'输入账号与密码，继续处理你的投稿记录。':'当前没有可登录的账号，请先注册。';
 const passwordField=(name,label,fresh=false)=>`<div class="field"><label for="auth-${name}">${label}</label><div class="auth-password-input"><input id="auth-${name}" name="${name}" type="password" required minlength="${fresh?10:1}" maxlength="128" autocomplete="${fresh?'new-password':'current-password'}" placeholder="${fresh?'10–128 个字符':'请输入管理密码'}">${passwordVisibilityButton(`auth-${name}`,label,'toggle-auth-password')}</div></div>`;
 const form=`<form id="auth-form" novalidate data-mode="${mode}">
  <div class="field"><label for="auth-username">登录账号</label><input id="auth-username" name="username" type="text" required minlength="3" maxlength="64" ${setup?'pattern="[A-Za-z0-9][A-Za-z0-9_.@+\\-]{2,63}" title="3–64 个字符，以字母或数字开头，支持字母、数字、下划线、点、@、加号和减号"':''} autocomplete="username" placeholder="请输入登录账号" value="${esc(state.username)}" autofocus>${setup?'<small>3–64 个字符，以字母或数字开头，支持 _ . @ + -</small>':''}</div>
  ${setup||recovering?`<div class="field"><label for="auth-email">${recovering?'绑定邮箱':'QQ 邮箱'}</label><input id="auth-email" name="email" type="email" required maxlength="254" autocomplete="email" value="${esc(state.authEmail)}" placeholder="${recovering?'请输入注册时绑定的邮箱':'请输入你的 QQ 邮箱，如 123456@qq.com'}" ${setup?'pattern="[^@]+@[Qq][Qq][.][Cc][Oo][Mm]" title="注册请使用 QQ 邮箱（以 @qq.com 结尾）" aria-describedby="register-email-hint"':''}>${setup?'<small id="register-email-hint">注册请使用本人常用的 QQ 邮箱（以 @qq.com 结尾），用于接收找回密码验证码。</small>':''}</div>`:''}
  ${setup||recovering?`<div class="field"><label for="auth-code">邮箱验证码</label><div class="auth-code-row"><input id="auth-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" required pattern="[0-9]{6}" minlength="6" maxlength="6" placeholder="6 位验证码"><button type="button" class="btn" data-action="${setup?'send-register-code':'send-reset-code'}">获取验证码</button></div><small id="reset-code-status" role="status" aria-live="polite">验证码 10 分钟内有效。</small></div>`:''}
  ${passwordField(recovering?'newPassword':'password',recovering?'新密码':setup?'设置管理密码':'管理密码',setup||recovering)}
  ${setup||recovering?passwordField('confirm',recovering?'确认新密码':'确认密码',true):''}
  ${setup?'<small>每个账号拥有独立的客户、论文与收支记录。</small>':''}
  <div class="error-message" id="auth-error" role="alert"></div>
  ${mode==='login'?`<div id="auth-recovery-entry">${state.initialized?'':registrationEntry()}</div>`:''}
  <button class="btn primary" type="submit">${recovering?'重置密码':setup?'完成注册':'登录工作台'}${icon('chevron')}</button>
  ${recovering?'<button type="button" class="text-btn auth-back" data-action="auth-mode" data-mode="login">返回登录</button>':''}
 </form>`;
 $('#root').innerHTML=`<div class="auth-layout"><aside class="auth-brand-panel">${brand()}<div class="auth-intro"><div class="eyebrow">A CLEARER WAY TO MANAGE</div><h1>每一次投稿，<br>都井然有序。</h1><p>从论文档案到投稿进度，从定金到尾款，<br>让每一笔记录、每一个节点，都清晰可循。</p><div class="auth-art" aria-hidden="true"><div class="art-head"><span class="art-dot"></span>我的投稿工作台</div><div class="art-row"></div><div class="art-row"></div><div class="art-bars"><span></span><span></span><span></span><span></span><span></span></div></div></div><div class="auth-bottom">${icon('shield')}${state.storage==='mysql'?'数据库保存 · 投稿密码加密 · 专注管理':'本地保存 · 加密保护 · 专注管理'}</div></aside><main class="auth-form-panel"><div class="auth-form-wrap"><div class="eyebrow">YOUR PERSONAL WORKSPACE</div><nav class="auth-nav" aria-label="账号功能">${[['login','登录'],['register','注册']].map(([id,label])=>`<button type="button" class="tab ${mode===id?'active':''}" data-action="auth-mode" data-mode="${id}" ${mode===id?'aria-current="page"':''}>${label}</button>`).join('')}</nav><h2>${title}</h2><p class="subtitle">${subtitle}</p>${form}<div class="auth-note">${icon('lock')}<span>${recovering?'重置成功后请重新登录。验证码将发送至注册时验证的邮箱。':setup?'请妥善保管密码和绑定邮箱。旧备份仍需使用备份时的密码解锁。':'登录有效期为 8 小时，离开时可点击左下角退出，锁定访问。'}</span></div></div></main></div>`;
 prepareForms($('#root'));if(mode==='login'&&state.loginFailed)showForgotPassword();if(setup||recovering)updateRecoveryCooldown();
}

function accountSettings() {
 return `<section class="panel settings-card"><h2>${icon('users')}账号信息</h2><dl class="account-info"><div><dt>登录账号</dt><dd>${esc(state.username)}</dd></div><div><dt>绑定邮箱</dt><dd>${esc(state.recoveryEmail||'未绑定邮箱')}</dd></div></dl><h3 class="section-heading">${icon('lock')}修改管理密码</h3><p>${state.storage==='mysql'?'新密码用于登录和加密之后下载的备份，投稿密码继续使用独立密钥加密。':'新密码会重新加密本机数据。'}更新密码会使此账号在其他页面的登录失效。旧备份仍需使用备份时的密码解锁。</p><form id="password-form" novalidate><div class="field"><label for="current-password">当前密码<span class="required-mark">必填</span></label><div class="auth-password-input"><input id="current-password" name="currentPassword" type="password" autocomplete="current-password" required maxlength="128">${passwordVisibilityButton('current-password','当前密码')}</div></div><div class="field"><label for="new-password">新密码<span class="required-mark">必填</span></label><div class="auth-password-input"><input id="new-password" name="newPassword" type="password" autocomplete="new-password" required minlength="10" maxlength="128" placeholder="至少 10 个字符">${passwordVisibilityButton('new-password','新密码')}</div></div><div class="field"><label for="confirm-password">确认新密码<span class="required-mark">必填</span></label><div class="auth-password-input"><input id="confirm-password" name="confirm" type="password" autocomplete="new-password" required minlength="10" maxlength="128">${passwordVisibilityButton('confirm-password','确认新密码')}</div></div><div class="error-message" role="alert"></div><button type="submit" class="btn primary">${icon('lock')}更新密码</button></form></section>`;
}

function renderShell() {
 const views = {writers:'写作管理',papers:'论文管理',submissions:'投稿管理',customers:'客户管理',records:'论文总览',followups:'待跟进事项',finance:'收支管理',settings:'数据与设置'};
 $('#root').innerHTML = `<div class="app-shell"><aside class="sidebar" id="sidebar">${brand()}<div class="workspace-tag">我的工作空间</div><nav class="nav" aria-label="主导航">${[['records','grid','论文总览'],['customers','users','客户管理'],['writers','edit','写作管理'],['papers','document','论文管理'],['submissions','upload','投稿管理'],['followups','calendar','待跟进事项'],['finance','wallet','收支管理'],['settings','settings','数据与设置']].map(([id,glyph,label]) => `<button class="nav-item ${state.view === id ? 'active' : ''}" data-action="navigate" data-view="${id}" ${state.view === id ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span></button>`).join('')}</nav><div class="sidebar-bottom"><div class="local-note"><strong>${icon('shield')}安心记录，妥善保管</strong>${state.storage==='mysql'?'投稿密码加密保存，<br>业务记录可下载加密备份。':'你的投稿信息与账号密码<br>均在本机加密保存。'}</div><div class="profile"><div class="avatar">管</div><div><div class="profile-name" title="${esc(state.username||'我的工作台')}">${esc(state.username||'我的工作台')}</div><div class="profile-sub">独立工作空间</div></div><button class="icon-btn" data-action="logout" title="退出并锁定" aria-label="退出并锁定">${icon('logout')}</button></div></div></aside><main class="main"><header class="topbar"><div class="breadcrumb"><button class="icon-btn mobile-menu" data-action="menu" aria-label="打开导航">${icon('menu')}</button>${icon('grid')}<span>工作空间</span>${icon('chevron')}<strong>${views[state.view]}</strong></div><div class="topbar-right"><button class="icon-btn" data-action="refresh" title="刷新列表" aria-label="刷新列表">${icon('refresh')}</button><span class="today-text">${new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'})}</span><span class="connection"><span class="dot"></span>本地工作台</span></div></header><div class="content" id="content"></div></main></div>`;
 renderContent();
}

function pageHeading(title, subtitle, actions='') { return `<div class="page-heading"><div><div class="eyebrow">PAPER MANAGEMENT WORKSPACE</div><h1>${title}</h1><p class="subtitle">${subtitle}</p></div><div class="actions">${actions}</div></div>`; }
function stat(label, value, glyph, foot, color='', unit='', isMoney=false) { return `<div class="stat-card"><div class="stat-label">${label}<span class="stat-symbol ${color}">${icon(glyph)}</span></div><div class="stat-value ${isMoney ? 'money' : ''}">${value}${unit ? `<span class="unit">${unit}</span>` : ''}</div><div class="stat-foot">${foot}</div></div>`; }
function overviewExpenseBreakdown(papers) {
 const totals={publication:0,writing:0};
 for(const p of papers)for(const tx of p.transactions||[]){
  const amount=transactionAmount(tx);
  if(tx.type==='outgoing_publication')totals.publication+=amount;
  else if(['outgoing_deposit','outgoing_balance','outgoing_settlement'].includes(tx.type))totals.writing+=amount;
 }
 return `<div class="expense-breakdown"><span>版面费支出 <strong>${yuan(totals.publication)}</strong></span><span>写作费支出 <strong>${yuan(totals.writing)}</strong></span></div>`;
}
function stats() {
 const p = state.papers;
 return `<div class="stats-grid">${stat('论文总数',p.length,'document',`<strong>${p.filter(paperInProgress).length} 篇</strong> 正在跟进 · 关联作者 <strong>${linkedAuthors(p).length} 位</strong>`,'','篇')}${stat('已录用 / 已发表',p.filter(x=>accepted(x)||published(x)).length,'checkCircle',`已发表 <strong>${p.filter(published).length} 篇</strong>`,'blue','篇')}${stat('累计已收款',yuan(sum(p,'receivedCents')),'wallet',`待收款 <strong>${yuan(sum(p,'receivableCents'))}</strong>`,'gold','',true)}${stat('累计已付款',yuan(sum(p,'paidCents')),'arrowUp',overviewExpenseBreakdown(p),'purple','',true)}</div>`;
}
function followUpStats() {
 const plans=followUpPlans(),overdue=plans.filter(p=>p.followUpAt<today()).length,todayCount=plans.filter(p=>p.followUpAt===today()).length;
 return `<div class="stats-grid">${stat('全部计划',plans.length,'calendar','已安排跟进日期的记录','','项')}${stat('已逾期',overdue,'clock','跟进日期早于今天','gold','项')}${stat('今天跟进',todayCount,'document','今天需要处理的记录','blue','项')}${stat('未来 7 天',upcoming().length,'calendar','明天至第七天的计划','purple','项')}</div>`;
}
function footer() { return `<footer class="footer-note"><span>${icon('shield')}${state.storage==='mysql'?'数据保存在 MySQL · 投稿密码默认隐藏':'数据保存在本机 · 密码默认隐藏'}</span><span>知序 PAPER DESK &nbsp; / &nbsp; 让每一次投稿都有迹可循</span></footer>`; }
function renderContent() {
 if(state.view==='writers')return renderWriterManagement();
 closePageSizeMenu();
 if(state.view==='followups')return renderFollowUps();
 if(state.view==='papers')return renderPaperManagement();
 if(state.view==='submissions')return renderSubmissions();
 if(state.view==='customers')return renderCustomers();
 if (state.view === 'settings') return renderSettings();
 if (state.view === 'finance') return renderFinance();
 const followups = state.view === 'followups';
 const tabs = followups ? [['all','全部计划',followUpPlans().length],['due','到期待跟进',state.papers.filter(due).length],['upcoming','未来 7 天',upcoming().length]] : [['all','全部记录',state.papers.length],['active','进行中',state.papers.filter(paperInProgress).length],['due','到期待跟进',state.papers.filter(due).length],['accepted','已录用',state.papers.filter(accepted).length],['published','已发表',state.papers.filter(published).length],['finished','已归档',state.papers.filter(terminal).length]];
 $('#content').innerHTML = `${pageHeading(followups ? '待跟进事项' : '论文总览',followups ? '把握投稿节点，让需要关注的事情一目了然。' : '每一篇论文，每一个进展，都有迹可循。',btn('export-papers','导出记录','down'))}${followups?followUpStats():stats()}<section class="panel"><div class="panel-header"><h2 class="panel-title">${followups ? '跟进计划' : '论文记录'} <small>${followups ? 'FOLLOW-UPS' : 'SUBMISSION RECORDS'}</small></h2><button class="text-btn" data-action="refresh" title="刷新记录">${icon('refresh')}刷新</button></div><div class="tab-bar overview-tabs" role="tablist">${tabs.map(([id,label,count])=>`<button class="tab ${state.tab===id?'active':''}" data-action="tab" data-tab="${id}" role="tab" aria-selected="${state.tab===id}">${label}<span class="count">${count}</span></button>`).join('')}</div>${followups?'':'<p class="overview-classification-note">分类按当前投稿状态统计：已发表或已撤稿自动归入“已归档”，已录用单独归入“已录用”，不计入“进行中”。服务已终止的论文也归档保留，原投稿状态不变。</p>'}<div class="filter-row"><div class="search-box">${icon('search')}<input id="search" type="search" placeholder="搜索题目、客户、期刊或跟进事项…" aria-label="搜索论文" value="${esc(state.search)}"></div><select id="status-filter" aria-label="投稿状态"><option value="">全部投稿状态</option>${statuses.map(s=>`<option ${state.status===s?'selected':''}>${s}</option>`).join('')}</select><span class="filter-label">投稿日期</span><input class="date-filter" id="from-filter" type="date" aria-label="投稿起始日期" value="${esc(state.from)}"><span class="date-sep">至</span><input class="date-filter" id="to-filter" type="date" aria-label="投稿截止日期" value="${esc(state.to)}">${btn('clear-filters','重置','','')}</div><div id="results"></div></section>${followups ? '' : overviewPanels()}${footer()}`;
 renderPaperResults();
}
function upcoming() { const end = new Date(); end.setDate(end.getDate()+7); const day = `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`; return followUpPlans().filter(p=>p.followUpAt>today()&&p.followUpAt<=day); }
function filteredPapers() {
 if(state.view==='followups')return filteredFollowUps();
 const source=state.view==='followups'?followUpPlans():state.papers;
 const papers = source.filter(p => {
  if (state.tab === 'active' && !paperInProgress(p)) return false;
  if (state.tab === 'finished' && !terminal(p)) return false;
  if (state.tab === 'accepted' && !accepted(p)) return false;
  if (state.tab === 'published' && !published(p)) return false;
  if (state.tab === 'due' && !due(p)) return false;
  if (state.tab === 'upcoming' && !upcoming().some(x=>x.id===p.id)) return false;
  if (state.status && p.status !== state.status) return false;
  if (state.from && (!p.submittedAt || p.submittedAt < state.from)) return false;
  if (state.to && (!p.submittedAt || p.submittedAt > state.to)) return false;
  if (state.search.trim()) {
   const haystack = ['title','code','authors','customer','writer','journal','submissionSystem','submissionAccount','boundEmail','boundPhone','followUpReason','notes'].map(k=>p[k]||'').join(' ').toLocaleLowerCase();
   if (!haystack.includes(state.search.trim().toLocaleLowerCase())) return false;
  }
  return true;
 });
 return papers;
}
function emptyState(filtered=false, label='论文') {
 if(state.view==='followups'){
  const hasFilters=Boolean(state.search.trim()||state.status||state.from||state.to||state.tab!=='all');
  return `<div class="empty-state"><div class="empty-illustration">${icon('calendar')}</div><h3>${hasFilters?'没有符合条件的跟进事项':'暂无跟进计划'}</h3><p>${hasFilters?'调整筛选条件，查看其他跟进计划。':'可在已有论文中设置跟进日期及事项，到期后会在这里提醒。'}</p>${hasFilters?btn('clear-filters','重置筛选','refresh'):btn('navigate','查看论文','document','primary','data-view="papers"')}</div>`;
 }
 return `<div class="empty-state"><div class="empty-illustration">${icon(filtered?'search':'document')}</div><h3>${filtered?'没有找到符合条件的记录':`还没有${label}记录`}</h3><p>${filtered?'试试其他关键词，或重置筛选条件。':'请在论文管理中建立论文档案，再查看投稿进度和收支记录。'}</p>${filtered?btn('clear-filters','重置筛选','refresh'):btn('navigate','前往论文管理','document','primary','data-view="papers"')}</div>`;
}
const pageSizeOptions=[5,8,10,20,50,100];
const pageSizePreferences={};
let pageSizeMenu=null;
function closePageSizeMenu(restoreFocus=false) {
 if(!pageSizeMenu)return;
 const {element,trigger}=pageSizeMenu;pageSizeMenu=null;
 element.remove();trigger.setAttribute('aria-expanded','false');
 if(restoreFocus&&trigger.isConnected)trigger.focus({preventScroll:true});
}
function activatePageSizeOption(index) {
 if(!pageSizeMenu)return;
 pageSizeMenu.activeIndex=Math.max(0,Math.min(pageSizeOptions.length-1,index));
 const {element,activeIndex}=pageSizeMenu;
 element.setAttribute('aria-activedescendant',`page-size-option-${pageSizeOptions[activeIndex]}`);
 element.querySelectorAll('[role="option"]').forEach((option,i)=>{
  option.classList.toggle('is-active',i===activeIndex);
  if(i===activeIndex)option.scrollIntoView({block:'nearest'});
 });
}
function openPageSizeMenu(trigger) {
 closePageSizeMenu();
 const selected=pageSizePreference(),element=document.createElement('div');
 element.id='page-size-options';element.className='page-size-menu';element.tabIndex=-1;
 element.setAttribute('role','listbox');element.setAttribute('aria-label','每页显示条数');
 element.innerHTML=pageSizeOptions.map(size=>`<button type="button" class="page-size-option${size===selected?' is-selected':''}" id="page-size-option-${size}" role="option" aria-selected="${size===selected}" tabindex="-1" data-action="page-size-option" data-page-size="${size}"><span>${size}</span>${size===selected?icon('check'):''}</button>`).join('');
 document.body.append(element);
 pageSizeMenu={element,trigger,activeIndex:pageSizeOptions.indexOf(selected)};
 trigger.setAttribute('aria-expanded','true');
 const anchor=trigger.getBoundingClientRect(),menu=element.getBoundingClientRect(),margin=12,gap=8;
 const viewportWidth=document.documentElement.clientWidth,viewportHeight=window.innerHeight;
 const above=Math.max(0,anchor.top-gap-margin),below=Math.max(0,viewportHeight-anchor.bottom-gap-margin);
 const opensAbove=above>=menu.height||above>=below,available=opensAbove?above:below,height=Math.min(menu.height,available);
 element.style.maxHeight=`${available}px`;
 element.style.left=`${Math.max(margin,Math.min(anchor.right-menu.width,viewportWidth-menu.width-margin))}px`;
 element.style.top=`${opensAbove?anchor.top-gap-height:anchor.bottom+gap}px`;
 element.focus({preventScroll:true});activatePageSizeOption(pageSizeMenu.activeIndex);
}
function selectPageSize(value) {
 if(!pageSizeOptions.includes(Number(value)))return;
 closePageSizeMenu();setPageSize(value);$('#page-size')?.focus({preventScroll:true});
}
function handlePageSizeKeydown(event) {
 if(!pageSizeMenu){
  if(event.target?.id!=='page-size'||!['ArrowDown','ArrowUp'].includes(event.key))return false;
  event.preventDefault();openPageSizeMenu(event.target);return true;
 }
 const moves={ArrowDown:pageSizeMenu.activeIndex+1,ArrowUp:pageSizeMenu.activeIndex-1,Home:0,End:pageSizeOptions.length-1};
 if(Object.hasOwn(moves,event.key)){event.preventDefault();activatePageSizeOption(moves[event.key]);return true;}
 if(event.key==='Enter'||event.key===' '){event.preventDefault();selectPageSize(pageSizeOptions[pageSizeMenu.activeIndex]);return true;}
 if(event.key==='Escape'){event.preventDefault();closePageSizeMenu(true);return true;}
 if(event.key==='Tab'){closePageSizeMenu(true);return true;}
 return false;
}
function paginationKey() { return `${state.username}:${state.view}${state.view==='finance'?':'+state.financeType:''}`; }
function pageSizePreference() {
 const key=paginationKey();
 if(Object.hasOwn(pageSizePreferences,key))return pageSizePreferences[key];
 try { const saved=localStorage.getItem('paper-desk:page-size:'+key);pageSizePreferences[key]=pageSizeOptions.includes(Number(saved))?Number(saved):8; }
 catch { pageSizePreferences[key]=8; }
 return pageSizePreferences[key];
}
function updatePageSize() {
 const next=pageSizePreference();
 if(next!==state.pageSize) {
  const first=(Math.max(1,state.page)-1)*state.pageSize;
  state.pageSize=next;state.page=Math.floor(first/next)+1;
 }
 const results=$('#results');
 if(Number.isFinite(window.innerHeight)) {
  const top=(results?.getBoundingClientRect?.().top??500)+(window.scrollY||0);
  results?.style?.setProperty?.('--table-max-height',Math.max(240,window.innerHeight-top-96)+'px');
 }
}
function setPageSize(value) {
 const preference=Number(value);
 if(!pageSizeOptions.includes(preference))return;
 pageSizePreferences[paginationKey()]=preference;
 try { localStorage.setItem('paper-desk:page-size:'+paginationKey(),String(preference)); } catch {}
 state.page=1;updatePageSize();state.page=1;renderResults();
}
let paginationResizeTimer;
window.addEventListener('resize',()=>{
 closePageSizeMenu();
 clearTimeout(paginationResizeTimer);
 paginationResizeTimer=setTimeout(()=>{if(state.authenticated&&!state.drawer&&!state.modal&&$('#results')){updatePageSize();renderResults();}},150);
});
window.addEventListener('scroll',event=>{
 if(pageSizeMenu&&!pageSizeMenu.element.contains(event.target))closePageSizeMenu();
},true);
function pagination(total) {
 closePageSizeMenu();
 updatePageSize();
 const pages = Math.max(1,Math.ceil(total/state.pageSize)); state.page = Math.max(1,Math.min(Number.isFinite(state.page)?Math.floor(state.page):1,pages));
 const visible = [...new Set([1,state.page-1,state.page,state.page+1,pages])].filter(p=>p>=1&&p<=pages).sort((a,b)=>a-b);
 let last=0;
 return `<div class="table-footer"><span>共 ${total} 条记录${total?`，显示 ${(state.page-1)*state.pageSize+1}–${Math.min(state.page*state.pageSize,total)} 条`:''}</span><div class="pagination-controls"><div class="page-size-control"><span>每页</span><button type="button" class="page-size-trigger" id="page-size" data-action="page-size-toggle" aria-label="每页 ${state.pageSize} 条" aria-haspopup="listbox" aria-expanded="false" aria-controls="page-size-options"><span>${state.pageSize}</span>${icon('chevron')}</button><span>条</span></div><nav class="pagination" aria-label="分页导航"><button class="page-btn" data-action="page" data-page="${state.page-1}" ${state.page<=1?'disabled':''} aria-label="上一页">${icon('left')}</button>${visible.map(p=>{const gap=p-last>1?'<span>…</span>':'';last=p;return `${gap}<button class="page-btn ${p===state.page?'active':''}" data-action="page" data-page="${p}" aria-label="第 ${p} 页" ${p===state.page?'aria-current="page"':''}>${p}</button>`;}).join('')}<button class="page-btn" data-action="page" data-page="${state.page+1}" ${state.page>=pages?'disabled':''} aria-label="下一页">${icon('chevron')}</button></nav></div></div>`;
}
function sequenceCell(index) {
 return `<td class="sequence-cell">${(state.page-1)*state.pageSize+index+1}</td>`;
}
function sequenceBadge(index) {
 return `<span class="record-sequence" aria-label="序号 ${index+1}">${index+1}</span>`;
}
function renderPaperResults() {
 if(state.view==='followups')return renderFollowUpResults();
 const papers = filteredPapers(); const paging = pagination(papers.length); const visible = papers.slice((state.page-1)*state.pageSize,state.page*state.pageSize);
 if (state.from && state.to && state.from > state.to) { $('#results').innerHTML = '<div class="empty-state"><h3>起始日期不能晚于截止日期</h3><p>调整投稿日期范围后重新查询。</p></div>'; return; }
 $('#results').innerHTML = papers.length ? `<div class="table-scroll"><table><thead><tr><th class="sequence-cell" scope="col">序号</th><th>论文题目 / 编号</th><th>客户 / 作者</th><th>投稿期刊</th><th>投稿日期</th><th>投稿状态</th><th>收款 / 应收</th><th>已付 / 稿酬</th>${state.view==='followups'?'<th>跟进日期 / 事项</th>':''}<th>操作</th></tr></thead><tbody>${visible.map((p,index)=>`<tr>${sequenceCell(index)}<td class="paper-cell"><button class="paper-title" data-action="detail" data-id="${esc(p.id)}">${esc(p.title)}</button><div class="paper-meta">${paperCode(p.code)}</div><div class="cell-sub">${serviceBadge(p)}</div>${manuscriptShortcut(p)}</td><td>${customerLink(p)}<div class="cell-sub">${esc(p.authors||'未填写作者')}</div></td><td><div class="journal-name" title="${esc(p.journal)}">${esc(p.journal||'待选择期刊')}</div><div class="cell-sub">${esc(p.submissionSystem||'—')}</div></td><td>${dateLabel(p.submittedAt)}${due(p)?`<div class="cell-sub due-date">${icon('clock')}需要跟进</div>`:''}</td><td>${badge(p.status)}</td><td><div class="cell-money">${yuan(p.contractReceivedCents)}</div><div class="cell-sub">应收 ${yuan(p.contractCents)}</div></td><td>${hasWriting(p)?`<div class="cell-money light">${yuan(p.writerPaidCents)}</div><div class="cell-sub">稿酬 ${yuan(effectiveWriterFee(p))}</div>`:'<span class="panel-hint">客户供稿</span>'}</td><td>${state.view==='followups'?`<div class="${due(p)?'due-date':''}">${dateLabel(p.followUpAt)}</div><div class="cell-sub follow-up-reason">${esc(followUpReasonLabel(p))}</div></td><td>`:''}<button class="text-btn" data-action="detail" data-id="${esc(p.id)}">${icon('eye')}详情</button></td></tr>`).join('')}</tbody></table></div>${paging}` : emptyState(state.papers.length>0);
}
function overviewPanels() {
 const p = state.papers; const groups = [['准备中',p.filter(x=>['草稿','待投稿'].includes(x.status)).length],['投稿 / 审稿',p.filter(x=>['已投稿','审稿中'].includes(x.status)).length],['修改中',p.filter(x=>x.status==='修改中').length],['录用 / 发表',p.filter(x=>['已录用','已发表'].includes(x.status)).length]];
 const plans=followUpPlans(),reminders=plans.slice(0,3);
 return `<div class="bottom-grid"><section class="panel mini-panel"><div class="panel-header"><h2 class="panel-title">投稿进度分布</h2><span class="panel-hint">按当前状态统计</span></div><div class="progress-list">${groups.map(([label,count])=>`<div class="progress-col"><div class="progress-label">${label}<strong>${count}</strong></div><div class="progress-track"><div class="progress-fill" style="width:${p.length?Math.round(count/p.length*100):0}%"></div></div></div>`).join('')}</div><div class="overview-caption">${icon('info')}共 ${p.length} 篇论文${p.length?`，其中 ${p.filter(x=>['已拒稿','已撤稿'].includes(x.status)).length} 篇已拒稿或撤稿`:''}</div></section><section class="panel mini-panel"><div class="panel-header"><h2 class="panel-title">近期需关注 <small>${plans.length} 项</small></h2><button class="text-btn" data-action="navigate" data-view="followups">查看全部${icon('chevron')}</button></div><div class="reminders">${reminders.length?reminders.map(p=>`<div class="reminder"><div class="reminder-icon">${icon('clock')}</div><div class="reminder-main"><button class="paper-title reminder-title" data-action="detail" data-id="${esc(p.id)}">${esc(p.title)}</button><div class="reminder-note">${esc(p.journal||'未填写期刊')} · ${esc(p.status)}</div><div class="reminder-note follow-up-reason">${esc(followUpReasonLabel(p))}</div></div><span class="reminder-date ${due(p)?'due-date':''}">${followUpLabel(p)}</span></div>`).join(''):`<div class="empty-small">${icon('checkCircle')} 暂无跟进计划。</div>`}</div></section></div>`;
}

function allTransactions() { return state.papers.flatMap(p=>(p.transactions||[]).map(tx=>({...tx,signedAmountCents:transactionAmount(tx),paper:p}))).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt)); }
function financeSettlementDate(paper) {
 if(!paper.profitSettled)return '';
 const dates=(paper.transactions||[]).map(tx=>tx.date).filter(date=>/^\d{4}-\d{2}-\d{2}$/.test(date||''));
 if(paper.termination?.terminatedAt)dates.push(paper.termination.terminatedAt);
 return dates.sort().at(-1)||paperCreatedDate(paper);
}
function financeYearOptions() {
 const years=new Set([String(new Date().getFullYear())]);
 if(/^\d{4}$/.test(String(state.financeYear||'')))years.add(state.financeYear);
 for(const paper of state.papers){
  const date=paperCreatedDate(paper),settled=financeSettlementDate(paper);
  if(date)years.add(date.slice(0,4));if(settled)years.add(settled.slice(0,4));
  for(const tx of paper.transactions||[])if(/^\d{4}-\d{2}-\d{2}$/.test(tx.date||''))years.add(tx.date.slice(0,4));
 }
 const values=[...years].map(Number),min=Math.min(...values),max=Math.max(...values);
 if(max-min<=100)for(let year=min;year<=max;year++)years.add(String(year));
 return [...years].sort((a,b)=>b.localeCompare(a));
}
function financeYearSummary() {
 const selected=String(state.financeYear||''),year=selected==='all'||/^\d{4}$/.test(selected)?selected:String(new Date().getFullYear()),all=year==='all';
 const papers=all?state.papers:state.papers.filter(p=>paperCreatedDate(p).startsWith(year));
 const transactions=all?allTransactions():allTransactions().filter(tx=>tx.date.startsWith(year));
 const incoming=transactions.filter(tx=>tx.type.startsWith('incoming')),outgoing=transactions.filter(tx=>tx.type.startsWith('outgoing'));
 const pendingFeeCount=papers.filter(hasPendingPublicationCost).length;
 const basis=state.financeProfitBasis==='created'?'created':'settled';
 const settledPapers=(basis==='created'?papers:state.papers).filter(p=>p.profitSettled&&(all||basis==='created'||financeSettlementDate(p).startsWith(year)));
 return {year,all,basis,papers,settledPapers,transactions,received:sum(incoming,'signedAmountCents'),paid:sum(outgoing,'signedAmountCents'),
  receiptCount:incoming.length,paymentCount:outgoing.length,
  otherIncome:sum(transactions.filter(tx=>tx.type==='incoming_other'),'signedAmountCents'),otherExpense:sum(transactions.filter(tx=>tx.type==='outgoing_other'),'signedAmountCents'),
  cashNet:sum(incoming,'signedAmountCents')-sum(outgoing,'signedAmountCents'),receivable:sum(papers,'receivableCents'),
  writerPayable:sum(papers,'payableCents'),publicationPayable:sum(papers,'publicationPayableCents'),
  publicationRefundable:sum(papers,'publicationRefundableCents'),refundable:sum(papers,'refundableCents'),recoverable:sum(papers,'recoverableCents'),
  profit:sum(papers,'estimatedProfitCents'),settledProfit:sum(settledPapers,'settledProfitCents'),pendingFeeCount};
}
function financeAnnualPanel(report) {
 const scope=report.all?'全部年份':report.year+' 年',cohort=report.all?'全部论文':report.year+' 年建档论文';
 const sourceLink=(type,label)=>btn('finance-source',label,'chevron','text-btn finance-source-link',`data-type="${type}"`);
 return `<section class="annual-summary" aria-label="年度收支汇总">
  <div class="annual-summary-head"><div><h2>${scope}收支汇总</h2><p>按年度查看收付款、当前待结款项与净利润</p></div>
   <div class="annual-summary-controls"><label for="finance-year">统计年度<select id="finance-year" aria-label="收支统计年度"><option value="all" ${report.all?'selected':''}>全部年份</option>${financeYearOptions().map(year=>`<option value="${year}" ${year===report.year?'selected':''}>${year} 年</option>`).join('')}</select></label>
   <label for="finance-profit-basis">利润归属<select id="finance-profit-basis" aria-label="利润年度归属"><option value="settled" ${report.basis==='settled'?'selected':''}>按结清年度</option><option value="created" ${report.basis==='created'?'selected':''}>按建档年度</option></select></label></div>
  </div>
  <div class="stats-grid finance-summary">
   ${stat('累计收款',yuan(report.received),'arrowDown',`<span>实际收入 ${report.receiptCount} 笔 · 含退回款</span>${sourceLink('incoming','查看收入明细')}`,'','',true)}
   ${stat('累计付款',yuan(report.paid),'arrowUp',`<span>实际支出 ${report.paymentCount} 笔 · 含退款</span>${sourceLink('outgoing','查看支出明细')}`,'gold','',true)}
   ${stat('当前待收服务费',yuan(report.receivable),'clock',`<span>${cohort}</span>${sourceLink('balances','查看应收应付')}`,'blue','',true)}
   ${stat('当前待付费用',yuan(report.writerPayable+report.publicationPayable),'wallet',`<span>稿酬 ${yuan(report.writerPayable)} · 版面费 ${yuan(report.publicationPayable)}</span>${sourceLink('balances','查看应收应付')}`,'gold','',true)}
   ${stat('净利润（已结清）',yuan(report.settledProfit),'chart',`<span>${report.settledPapers.length} 篇 · ${report.basis==='settled'?'按最后收付 / 终止结算日期':'按论文建档日期'}</span>${sourceLink('profits','查看利润明细')}`,'','',true)}
   ${stat('预计净利润',yuan(report.profit),'chart',`<span>${report.pendingFeeCount?`${report.pendingFeeCount} 篇版面费待确认，暂按 0 元计入`:'服务费用 − 写作及版面成本 + 其他净收支'}</span>${sourceLink('balances','查看费用明细')}`,'purple','',true)}
  </div>
  <div class="annual-estimate"><span>${cohort} · 预计净利润 <strong>${yuan(report.profit)}</strong>${report.pendingFeeCount?`（${report.pendingFeeCount} 篇版面费待确认，暂按 0 元计入，确认后自动重算）`:''}</span><span>待退款 ${yuan(report.refundable)} · 待追回稿酬 ${yuan(report.recoverable)} · 待退回版面费 ${yuan(report.publicationRefundable)}</span></div>
  <p class="annual-summary-note">收付款按实际发生年份统计，包含跨年论文的本期流水。待收、待付和预计利润为所选年份建档论文的当前金额；净利润只计已结清论文，结清年度按最后一笔实际收付或终止结算日期确定。报表随当前记录更新。</p>
 </section>`;
}
function filteredFinancePapers() {
 const query=state.search.trim().toLocaleLowerCase();
 const report=financeYearSummary(),papers=state.financeType==='profits'?report.settledPapers:report.papers;
 return papers.filter(p=>!query||[p.title,p.code,p.customer,p.writer].join(' ').toLocaleLowerCase().includes(query));
}
function selectFinanceTab(type,reset=false) {
 state.financeType=type;state.page=1;
 if(reset)resetFilters();
 if(['balances','profits'].includes(type)){state.from='';state.to='';}
 renderFinance();
}
function filteredTransactions() {
 return financeYearSummary().transactions.filter(tx=>{
  if(state.financeType!=='all'&&!tx.type.startsWith(state.financeType))return false;
  if(state.from&&tx.date<state.from)return false; if(state.to&&tx.date>state.to)return false;
  const query = state.search.trim().toLocaleLowerCase();
  return !query||[tx.paper.title,tx.paper.code,tx.paper.customer,tx.paper.writer,tx.note,tx.method,typeLabels[tx.type]].join(' ').toLocaleLowerCase().includes(query);
 });
}
function renderFinance() {
 const balances=state.financeType==='balances',profits=state.financeType==='profits',paperView=balances||profits;
 const report=financeYearSummary();
 $('#content').innerHTML = `${pageHeading('收支管理','按年度查看实际收付款、待收待付和论文净利润。',btn('export-finance-year','导出年度汇总','down')+btn('export-finance',profits?'导出利润明细':balances?'导出应收应付':'导出流水','down'))}${financeAnnualPanel(report)}<section class="panel"><div class="panel-header"><h2 class="panel-title">收支明细 <small>FINANCIAL DETAILS</small></h2><span class="panel-hint">明细与上方统计年度一致，关键词和日期仅筛选下方记录</span></div><div class="tab-bar finance-tabs" role="tablist">${[['balances','应收应付'],['profits','利润明细'],['all','全部流水'],['incoming','收入'],['outgoing','支出']].map(([id,label])=>`<button class="tab ${state.financeType===id?'active':''}" data-action="finance-tab" data-type="${id}" role="tab" aria-selected="${state.financeType===id}">${label}</button>`).join('')}</div><div class="filter-row"><div class="search-box">${icon('search')}<input id="search" type="search" placeholder="${paperView?'搜索论文、编号、客户或写作者…':'搜索论文、客户、写作者或备注…'}" aria-label="${paperView?'搜索论文费用明细':'搜索收支流水'}" value="${esc(state.search)}"></div>${paperView?'':`<span class="filter-label">收支日期</span><input class="date-filter" id="from-filter" type="date" aria-label="收支起始日期" value="${esc(state.from)}"><span class="date-sep">至</span><input class="date-filter" id="to-filter" type="date" aria-label="收支截止日期" value="${esc(state.to)}">`}${btn('clear-filters','重置')}</div><div id="results"></div></section><div class="notice green" style="margin-top:22px">${icon('info')}<span>待收款 = 约定应收 − 已收定金及尾款；待付稿酬 = 约定稿酬 − 已付定金及尾款，均以 0 为下限。费用约定不会自动生成实际流水，需在论文收支明细中登记。其他收入、支出单独统计，不抵扣尾款；服务已终止的论文按最终结算金额计算待收待付，并单列待退款和待追回稿酬。版面费属于独立成本：我方承担时从服务费用中扣除，作者自理不计入报价及我方流水。预计利润 = 服务费用 − 稿酬 − 我方承担的版面费 − 其他支出 + 其他收入；待确认版面费先按 0 元计算预计利润，确认金额后自动重算；未结清利润与已实现收付款分开查看。</span></div>${footer()}`;
 renderFinanceResults();
}

function renderFinanceBalances() {
 const papers=filteredFinancePapers();const paging=pagination(papers.length);
 if(!papers.length){$('#results').innerHTML=emptyState(state.papers.length>0);return;}
 $('#results').innerHTML=`<div class="results-note">当前筛选：约定应收 ${yuan(papers.reduce((n,p)=>n+effectiveContract(p),0))} · 已收定金及尾款 ${yuan(sum(papers,'contractReceivedCents'))} · 待收款 ${yuan(sum(papers,'receivableCents'))}<br>约定稿酬 ${yuan(papers.reduce((n,p)=>n+effectiveWriterFee(p),0))} · 已付稿酬 ${yuan(sum(papers,'writerPaidCents'))} · 待付稿酬 ${yuan(sum(papers,'payableCents'))}</div><div class="table-scroll"><table class="finance-balances"><thead><tr><th class="sequence-cell" scope="col">序号</th><th>关联论文</th><th>客户 / 写作者</th><th>约定应收 / 已收定金尾款</th><th>待收款</th><th>约定稿酬 / 已付稿酬</th><th>待付稿酬</th><th>版面费 / 预计利润</th><th>操作</th></tr></thead><tbody>${papers.slice((state.page-1)*state.pageSize,state.page*state.pageSize).map((p,index)=>`<tr>${sequenceCell(index)}<td class="paper-cell"><button class="paper-title" data-action="detail-finance" data-id="${esc(p.id)}">${esc(p.title)}</button><div class="paper-meta">${paperCode(p.code)}</div><div class="cell-sub">${serviceBadge(p)}</div></td><td><div>客户：${esc(p.customer||'未填写')}</div><div class="cell-sub">${hasWriting(p)?`写作者：${esc(p.writer||'未填写')}`:'客户供稿 · 无写作稿酬'}</div></td><td><div class="cell-money">约定 ${yuan(effectiveContract(p))}</div><div class="cell-sub">已收 ${yuan(p.contractReceivedCents)}</div>${!serviceEnded(p)&&p.contractReceivedCents>p.contractCents?'<div class="cell-sub">已收超过约定，请核对</div>':''}</td><td class="cell-money">${yuan(p.receivableCents)}${p.refundableCents?`<div class="cell-sub">待退款 ${yuan(p.refundableCents)}</div>`:''}</td><td>${hasWriting(p)?`<div class="cell-money">约定 ${yuan(effectiveWriterFee(p))}</div><div class="cell-sub">已付 ${yuan(p.writerPaidCents)}</div>${!serviceEnded(p)&&p.writerPaidCents>effectiveWriterFee(p)?'<div class="cell-sub">已付超过约定，请核对</div>':''}`:'<span class="panel-hint">无需写作稿酬</span>'}</td><td class="cell-money">${yuan(p.payableCents)}${p.recoverableCents?`<div class="cell-sub">待追回 ${yuan(p.recoverableCents)}</div>`:''}</td><td><div>${publicationFeeLabels[publicationMode(p)]}</div>${publicationMode(p)==='included'||publicationTotal(p)>0?`<div class="cell-sub">成本 ${yuan(publicationTotal(p))} · 待付 ${yuan(p.publicationPayableCents)}</div>`:''}${p.publicationRefundableCents?`<div class="cell-sub">待退回 ${yuan(p.publicationRefundableCents)}</div>`:''}<div class="cell-sub">预计利润 ${yuan(p.estimatedProfitCents)}${hasPendingPublicationCost(p)?'（待确认版面费按 0 元）':''}</div></td><td><button class="text-btn" data-action="detail-finance" data-id="${esc(p.id)}">${icon('wallet')}详情</button></td></tr>`).join('')}</tbody></table></div>${paging}`;
}
function renderFinanceProfits() {
 const papers=filteredFinancePapers(),report=financeYearSummary(),paging=pagination(papers.length);
 if(!papers.length){$('#results').innerHTML='<div class="empty-state"><h3>当前范围内暂无已结清利润</h3><p>客户款、写作稿酬与版面费均结清后，才计入净利润；可在应收应付中查看未结款项。</p></div>';return;}
 $('#results').innerHTML=`<div class="results-note">${report.basis==='settled'?'按最后收付或终止结算日期':'按论文建档日期'}归属年度 · 已结清 ${papers.length} 篇 · 净利润 ${yuan(sum(papers,'settledProfitCents'))}</div><div class="table-scroll"><table><thead><tr><th class="sequence-cell">序号</th><th>关联论文 / 客户</th><th>结清日期</th><th>服务收入</th><th>写作成本</th><th>版面费成本</th><th>其他净收支</th><th>净利润</th><th>操作</th></tr></thead><tbody>${papers.slice((state.page-1)*state.pageSize,state.page*state.pageSize).map((p,index)=>`<tr>${sequenceCell(index)}<td class="paper-cell"><button class="paper-title" data-action="detail-finance" data-id="${esc(p.id)}">${esc(p.title)}</button><div class="cell-sub">${paperCode(p.code)} · ${esc(p.customer||'未关联客户')}</div></td><td>${dateLabel(financeSettlementDate(p))}</td><td class="cell-money">${yuan(effectiveContract(p))}</td><td>${yuan(effectiveWriterFee(p))}</td><td>${yuan(publicationTotal(p))}</td><td>${yuan((p.otherIncomeCents||0)-(p.otherExpenseCents||0))}</td><td class="cell-money">${yuan(p.settledProfitCents)}</td><td><button class="text-btn" data-action="detail-finance" data-id="${esc(p.id)}">${icon('wallet')}详情</button></td></tr>`).join('')}</tbody></table></div>${paging}`;
}
function renderFinanceResults() {
 if(state.financeType==='balances')return renderFinanceBalances();
 if(state.financeType==='profits')return renderFinanceProfits();
 const txs = filteredTransactions(); const paging = pagination(txs.length);
 if(state.from&&state.to&&state.from>state.to){$('#results').innerHTML='<div class="empty-state"><h3>起始日期不能晚于截止日期</h3></div>';return;}
 if(!txs.length) {
  const hasTransactions=allTransactions().length>0;
  $('#results').innerHTML=`<div class="empty-state"><div class="empty-illustration">${icon('wallet')}</div><h3>${hasTransactions?'没有符合条件的流水':'还没有收支流水'}</h3><p>${hasTransactions?'试试其他关键词、收支日期或分类。':'费用约定与待收待付可在“应收应付”中查看。实际收付款需进入论文详情逐笔登记。'}</p>${hasTransactions?btn('clear-filters','重置筛选','refresh'):btn('finance-tab','查看应收应付','chevron','primary','data-type="balances"')}</div>`;
  return;
 }
 $('#results').innerHTML = `<div class="results-note">当前筛选：收入 ${yuan(txs.filter(t=>t.type.startsWith('incoming')).reduce((n,t)=>n+transactionAmount(t),0))} &nbsp; · &nbsp; 支出 ${yuan(txs.filter(t=>t.type.startsWith('outgoing')).reduce((n,t)=>n+transactionAmount(t),0))}</div><div class="table-scroll"><table><thead><tr><th class="sequence-cell" scope="col">序号</th><th>收支日期</th><th>关联论文</th><th>客户 / 写作者</th><th>收支类型</th><th>金额</th><th>收付方式 / 备注</th><th>操作</th></tr></thead><tbody>${txs.slice((state.page-1)*state.pageSize,state.page*state.pageSize).map((tx,index)=>`<tr>${sequenceCell(index)}<td>${dateLabel(tx.date)}</td><td class="paper-cell"><button class="paper-title" data-action="detail-finance" data-id="${esc(tx.paper.id)}">${esc(tx.paper.title)}</button><div class="paper-meta">${paperCode(tx.paper.code)}</div></td><td>${esc(publicationTypes.includes(tx.type)?tx.paper.journal||'期刊':['outgoing_refund','incoming_settlement','incoming_deposit','incoming_balance'].includes(tx.type)?tx.paper.customer||'—':tx.type==='incoming_writer_refund'?tx.paper.writer||'—':tx.type.startsWith('incoming')?tx.paper.customer||'—':tx.paper.writer||'—')}</td><td><span class="cash-label ${tx.type.startsWith('outgoing')?'outgoing':''}">${tx.reversalOf?'冲销 · ':''}${typeLabels[tx.type]}${tx.reversed?'（已冲销）':''}</span></td><td class="finance-amount ${tx.type.startsWith('incoming')?'incoming':'outgoing'}">${tx.type.startsWith('incoming')?'+':'−'}${yuan(transactionAmount(tx))}</td><td><div>${esc(tx.method||'—')}</div><div class="cell-sub" title="${esc((tx.writerName?tx.writerName+' · ':'')+(tx.note||''))}">${esc(tx.note.length>24?tx.note.slice(0,24)+'…':tx.note||'无备注')}</div></td><td><button class="text-btn" data-action="detail-finance" data-id="${esc(tx.paper.id)}">${icon('wallet')}详情</button></td></tr>`).join('')}</tbody></table></div>${paging}`;
}

function renderSettings() {
 $('#content').innerHTML = `${pageHeading('数据与设置','妥善备份记录，安心管理你的工作台。')}<div class="settings-grid"><section class="panel settings-card"><h2>${icon('shield')}数据备份与恢复</h2><p>加密备份包含论文档案、投稿账号密码、全部收支和投稿历史。建议定期下载，并妥善保存备份时使用的管理密码。</p><div class="actions">${btn('backup','下载加密备份','down','primary')}${btn('restore','从备份恢复','upload')}</div><div class="notice">${icon('info')}<span>恢复会替换当前账号的全部记录，请先下载当前备份。恢复后仍使用当前账号与管理密码登录。</span></div><div class="settings-meta"><span>当前论文</span><strong>${state.papers.length} 篇</strong></div><div class="settings-meta"><span>收支流水</span><strong>${allTransactions().length} 笔</strong></div><div class="settings-meta"><span>数据保护</span><strong>${state.storage==='mysql'?'投稿密码与备份加密':'AES-256-GCM 加密'}</strong></div><div class="settings-meta"><span>数据存储</span><strong>${state.storage==='mysql'?'MySQL 数据库':'本机加密文件'}</strong></div></section>${accountSettings()}<section class="panel settings-card"><h2>${icon('info')}使用说明</h2><p>先在客户管理中建立客户档案，再到论文管理中新建全包或半包论文；全包可安排写作并约定稿酬。全包表单可同时填写稿酬约定和实际已付款，尾款与待付稿酬自动计算；后续也可通过“登记定金”“登记稿费尾款”补录付款；向客户收尾款使用“登记服务费尾款”。收款在论文收支明细中逐笔登记。投稿管理每篇论文只显示一条当前投稿，统计和导出按论文去重；改投历史保留在同一论文详情中。客户档案会自动汇总其论文、发表期刊和费用。客户归档保留数据；确认删除客户则同时删除其全部关联论文、投稿、跟进、收支、稿件和凭证，请先备份。</p><p>投稿日期筛选针对当前投稿日期；收支管理的日期筛选针对收付日期。CSV 导出遵循当前筛选，且不包含投稿账号、密码、邮箱和手机号。加密备份用于完整迁移；有稿件时下载 ZIP 备份，内含业务数据、加密稿件、凭证及全部历史版本；无附件时为 .vault。ZIP 内的 .bin 是加密附件，请选择整个 ZIP 恢复，不要拆开。</p><p>本机版仅接受本机访问。${state.storage==='mysql'?'业务记录保存在已配置的 MySQL 数据库。迁移或维护数据库前，请同时备份数据库及独立加密密钥文件。':'数据保存在项目 data 目录。'}不会自动查询期刊网站或同步外部投稿系统。</p></section><section class="panel settings-card"><h2>${icon('document')}关于知序</h2><p>知序 · Paper Desk<br>论文投稿与收支管理工作台 · 独立账号</p><div class="notice green">${icon('shield')}<span>忘记管理密码时可通过绑定邮箱找回，请妥善保管邮箱与加密备份。离开工作台时，可点击左下角退出按钮锁定访问。</span></div></section></div>${footer()}`;
 prepareForms($('#content'));
}

function setOverlay(html) {
 overlayRevision++;
 if(!$('#overlay-root').hasChildNodes()) previousFocus = document.activeElement;
 $('#overlay-root').innerHTML = html; document.body.style.overflow = 'hidden';prepareForms($('#overlay-root'));
 requestAnimationFrame(()=>{ const first=$('[autofocus]', $('#overlay-root'))||$('input:not([type=hidden]),button,select,textarea', $('#overlay-root')); first?.focus(); });
}
function closeOverlay() { overlayRevision++;clearTimeout(credentialTimer); state.drawer=null;state.modal=null;$('#overlay-root').innerHTML='';document.body.style.overflow='';if(previousFocus?.isConnected)previousFocus.focus(); }
const managedForms=['auth-form','paper-form','customer-form','submission-form','transaction-form','password-form','restore-form','termination-form','publication-fee-form','reversal-form','receipt-form','followup-form','writer-reassignment-form'];
function formGuide() { return '<p class="form-guide"><span class="required-mark">必填</span> 标记项必须填写，其余可选。</p>'; }
function formFeedback() { return '<div class="error-message form-feedback" role="alert" aria-live="assertive" tabindex="-1"></div>'; }
function formControls(form) { return Array.from(form.elements||[]).filter(control=>control.name&&!control.disabled&&!['hidden','submit','button','reset'].includes(control.type)); }
function controlLabel(control) { return control.dataset?.label||control.labels?.[0]?.textContent.replace(/必填|\*/g,'').trim()||control.name; }
function markRequired(control) {
 if(control.form?.id==='auth-form'){control.setAttribute('aria-required',String(control.required));return;}
 const label=control.labels?.[0];if(!label)return;
 const legacy=label.querySelector('em');if(legacy?.textContent.trim()==='*')legacy.remove();
 let mark=label.querySelector('.required-mark');
 if(control.required&&!mark){mark=document.createElement('span');mark.className='required-mark';mark.textContent='必填';label.append(mark);}
 if(mark)mark.hidden=!control.required;
 control.setAttribute('aria-required',String(control.required));
}
function updateFormRequirements(form) {
 if(['paper-form','publication-fee-form','submission-form'].includes(form.id))updatePublicationFeeForm(form);
 if(form.id==='paper-form'){
  const controls=formControls(form),date=controls.find(c=>c.name==='followUpAt'),reason=controls.find(c=>c.name==='followUpReason');
  if(reason){reason.required=Boolean(date?.value);markRequired(reason);}updateWriterPaymentForm(form);updateCustomerReceiptForm(form);return;
 }
 if(form.id==='transaction-form'){updateTransactionPayment(form);return;}
 if(form.id!=='submission-form')return;
 const controls=formControls(form),status=controls.find(control=>control.name==='status'),date=controls.find(control=>control.name==='submittedAt');
 if(!status||!date)return;
 date.required=!['草稿','待投稿'].includes(status.value);markRequired(date);
 const expected=form.elements.namedItem('expectedPublishedAt'),accepted=['已录用','已发表'].includes(status.value),ended=form.elements.namedItem('endedAt');
 if(ended){ended.required=status.value==='已录用';markRequired(ended);const endHint=$('#f-endedAt-hint',form);if(endHint)endHint.textContent=ended.required?'请填写实际录用日期，不能早于投稿日期或晚于今天。':'不能早于投稿日期；结束状态留空默认今天。';}
 if(expected){expected.disabled=false;const end=controls.find(control=>control.name==='endedAt')?.value;if(end){const next=new Date(end+'T00:00:00');next.setDate(next.getDate()+1);expected.min=next.getFullYear()+'-'+String(next.getMonth()+1).padStart(2,'0')+'-'+String(next.getDate()).padStart(2,'0');}else expected.removeAttribute?.('min');}
 const hint=$('#f-submittedAt-hint',form);
 if(hint)hint.textContent=date.required?'当前状态必须填写实际投稿日期。':'草稿、待投稿可留空；已投稿及后续状态必须填写。';
}
function prepareForms(root=document) {
 for(const form of root.querySelectorAll?.('form')||[]) {
  if(!managedForms.includes(form.id))continue;
  form.noValidate=true;
  const body=form.querySelector('.drawer-body')||form;
  if(form.id!=='auth-form'&&!form.querySelector('.form-guide'))body.insertAdjacentHTML('afterbegin',formGuide());
  const summary=$('.error-message',form);if(summary){summary.classList.add('form-feedback');summary.tabIndex=-1;}
  for(const control of formControls(form)) {
   markRequired(control);
   const field=control.closest('.field');if(!field||!control.id)continue;
   const described=new Set((control.getAttribute('aria-describedby')||'').split(' ').filter(Boolean));
   const hint=field.querySelector('small');if(hint){hint.id=hint.id||control.id+'-hint';described.add(hint.id);}
   let error=$('#'+control.id+'-error',form);
   if(!error){error=document.createElement('p');error.id=control.id+'-error';error.className='field-error';error.hidden=true;field.append(error);}
   described.add(error.id);control.setAttribute('aria-describedby',[...described].join(' '));
  }
  updateFormRequirements(form);
 }
}
function fieldValidationMessage(control) {
 const label=controlLabel(control),value=String(control.value||''),validity=control.validity||{};
 if(validity.badInput)return '请输入有效的'+label;
 if(control.required&&(control.type==='checkbox'?!control.checked:!value.trim()))return control.type==='checkbox'?'请勾选确认选项':(control.tagName==='SELECT'||control.type==='date'||control.type==='file'?'请选择':'请填写')+label;
 if(!value)return '';
 if(control.type==='email'&&control.form?.id==='auth-form'&&control.form.dataset?.mode==='register'&&!/^[^\s@]+@qq\.com$/i.test(value.trim()))return '注册请使用 QQ 邮箱（以 @qq.com 结尾）';
 if(validity.typeMismatch)return control.type==='email'?'邮箱格式不正确，例如 name@example.com':'网址需以 http:// 或 https:// 开头';
 if(control.type==='url'&&!/^https?:\/\/[^\s]+$/i.test(value))return '网址需以 http:// 或 https:// 开头';
 if(validity.tooShort)return label+'至少填写 '+control.minLength+' 个字符';
 if(validity.tooLong)return label+'最多填写 '+control.maxLength+' 个字符';
 if(validity.patternMismatch)return control.name==='code'?'请输入 6 位数字验证码':'账号需为 3–64 位，以字母或数字开头，支持 _ . @ + -';
 if(validity.rangeUnderflow)return control.type==='date'?label+'不能早于 '+control.min:label+'不能小于 '+control.min;
 if(validity.rangeOverflow)return control.type==='date'?label+'不能晚于 '+control.max:label+'不能超过 '+control.max;
 if(validity.stepMismatch)return label+'最多保留两位小数';
 return validity.valid===false?'请检查'+label+'的填写格式':'';
}
function fieldError(control,message) {
 control.setAttribute?.('aria-invalid',String(Boolean(message)));
 const error=control.form&&control.id?$('#'+control.id+'-error',control.form):null;
 if(error){error.textContent=message;error.hidden=!message;}
}
function showFormError(form,message,control=null,focus=true) {
 if(!control&&focus) {
  const fields=[['跟进事项','followUpReason'],['约定收款定金','contractDepositAmount'],['服务费用','contractAmount'],['实际投稿日期','submittedAt'],['预计交稿日期','writingDueAt'],['实际交稿日期','writingDeliveredAt'],['约定写作定金','writerDepositAmount'],['合作开始日期','cooperationStartedAt'],['客户姓名','name'],['期刊名称','journal'],['论文题目','title'],['邮箱','boundEmail'],['客户邮箱','email'],['投稿网址','submissionUrl'],['收支金额','amount'],['收支日期','date'],['两次输入','confirm']];
  for(const [keyword,name] of fields){if(message.includes(keyword)){const matched=formControls(form).find(item=>item.name===name);if(matched){control=matched;break;}}}
 }
 const summary=$('.error-message',form);
 if(summary){summary.textContent=message;if(summary.dataset)summary.dataset.validation=control?'field':'server';}
 if(control){fieldError(control,message);if(focus){control.focus?.({preventScroll:true});control.scrollIntoView?.({block:'center',behavior:'smooth'});}}
 else if(focus){summary?.focus?.({preventScroll:true});summary?.scrollIntoView?.({block:'nearest',behavior:'smooth'});}
}
function validateForm(form) {
 updateFormRequirements(form);
 const controls=formControls(form),issues=[];
 for(const control of controls){const message=fieldValidationMessage(control);fieldError(control,'');if(message)issues.push({control,message});}
 const value=name=>controls.find(control=>control.name===name)?.value||'';
 const add=(name,message)=>{const control=controls.find(control=>control.name===name);if(control&&!issues.some(issue=>issue.control===control))issues.push({control,message});};
 if(form.id==='paper-form') {
  updateWritingStatus(form);
  if(Number(value('contractDepositAmount'))>Number(value('contractAmount')))add('contractDepositAmount','约定定金不能超过服务费用');
  if(value('writingStartAt')&&value('writingDueAt')&&value('writingDueAt')<value('writingStartAt'))add('writingDueAt','预计交稿日期不能早于写作开始日期');
  if(value('writingDeliveredAt')&&value('writingStartAt')&&value('writingDeliveredAt')<value('writingStartAt'))add('writingDeliveredAt','实际交稿日期不能早于写作开始日期');
  if(Number(value('writerDepositAmount'))>Number(value('writerFee')))add('writerDepositAmount','约定定金不能超过稿酬总额');
  for(const [name,message] of [...writerPaymentIssues(form),...customerReceiptIssues(form)])add(name,message);
 }
 if(['paper-form','publication-fee-form','submission-form'].includes(form.id)&&value('publicationFeeMode')==='included'&&!(moneyCents(value('publicationFeeAmount'))>0))add('publicationFeeAmount','请填写我方承担的版面费金额，必须大于 0');
 if(form.id==='transaction-form'&&state.drawer?.paper){
  if(value('publicationAccountId'))state.drawer.publicationAccountId=value('publicationAccountId');const limit=transactionRemaining(state.drawer.paper,value('type'));
  if(limit!==null&&moneyCents(value('amount'))>limit)add('amount','本次收付金额不能超过剩余约定金额 '+yuan(limit));
 }
 if(form.id==='submission-form') {
  const expected=value('expectedPublishedAt');if(expected&&value('endedAt')&&expected<=value('endedAt'))add('expectedPublishedAt','预计发表日期必须晚于录用日期');
  const start=value('submittedAt'),end=value('endedAt'),published=value('publishedAt'),finished=['已录用','已发表','已拒稿','已撤稿'].includes(value('status'));
  if(finished&&start&&end&&end<start)add('endedAt','结束日期不能早于实际投稿日期');
  if(value('status')==='已发表'&&start&&published&&published<start)add('publishedAt','发表日期不能早于实际投稿日期');
  if(value('status')==='已发表'&&end&&published&&published<end)add('publishedAt','发表日期不能早于结束日期');
 }
 if(value('confirm')&&(form.id==='password-form'||form.dataset?.mode==='forgot')&&value('confirm')!==value('newPassword'))add('confirm','两次输入的新密码不一致');
 if(value('confirm')&&form.dataset?.mode==='register'&&value('confirm')!==value('password'))add('confirm','两次输入的密码不一致');
 if(!issues.length)return true;
 for(const issue of issues)fieldError(issue.control,issue.message);
 showFormError(form,'未提交：'+issues[0].message+(issues.length>1?'（共 '+issues.length+' 项待修改）':''),null,false);
 const first=issues[0].control;first.focus?.({preventScroll:true});first.scrollIntoView?.({block:'center',behavior:'smooth'});
 const summary=$('.error-message',form);if(summary?.dataset)summary.dataset.validation='field';
 return false;
}
document.addEventListener('input',event=>{
 const control=event.target,form=control.form;
 if(!form||!managedForms.includes(form.id))return;
 if(form.id==='paper-form'&&['contractAmount','contractDepositAmount'].includes(control.name))updateContractBalance(form);
 if(form.id==='paper-form'&&['writingStatus','writingDeliveredAt'].includes(control.name))updateWritingStatus(form);
 if(form.id==='paper-form'){updateWriterPaymentForm(form);updateCustomerReceiptForm(form);}
 if(form.id==='transaction-form')updateTransactionPayment(form);
 if(control.getAttribute?.('aria-invalid')==='true')fieldError(control,fieldValidationMessage(control));
 const summary=$('.error-message',form);if(summary?.dataset?.validation==='field')summary.textContent='';
});
document.addEventListener('change',event=>{const form=event.target.form;if(!form)return;updateFormRequirements(form);if(form.id==='paper-form'&&['contractAmount','contractDepositAmount'].includes(event.target.name))updateContractBalance(form);if(form.id==='paper-form'&&['writingStatus','writingDeliveredAt'].includes(event.target.name))updateWritingStatus(form);if(form.id==='transaction-form')updateTransactionPayment(form,event.target.name==='type');});
function field(name,label,value='',options={}) {
 const id='f-'+name,required=options.required?'required':'';
 const hint=options.hint||(options.type==='number'?'单位：元，最多两位小数，上限 100 万元。':options.type==='url'?'例如：https://journal.example.com':options.type==='email'?'例如：name@example.com':'');
 const placeholder=options.placeholder??(options.type==='number'?'0.00':options.type==='url'?'https://':options.type==='email'?'name@example.com':options.type==='date'||options.select?'':options.required?'请输入'+label:'选填');
 const attributes=`${required} ${options.readOnly?'readonly aria-readonly="true"':''} data-label="${esc(label)}" aria-describedby="${hint?id+'-hint ':''}${id}-error"`;
 const control=options.textarea ? `<textarea id="${id}" name="${name}" ${attributes} maxlength="${options.max||5000}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : options.select ? `<select id="${id}" name="${name}" ${attributes}>${options.select.map(s=>`<option value="${esc(s)}" ${s===value?'selected':''}>${esc(options.optionLabels?.[s]||s||options.emptyLabel||'')}</option>`).join('')}</select>` : `<input id="${id}" name="${name}" type="${options.type||'text'}" value="${esc(value)}" ${attributes} ${options.max?`maxlength="${options.max}"`:''} ${options.type==='number'?`min="${options.min??0}" max="1000000" step="0.01" inputmode="decimal"`:''} ${options.type==='date'&&(options.maxDate||name==='submittedAt')?`max="${esc(options.maxDate||today())}"`:''} ${options.type==='date'&&options.minDate?`min="${esc(options.minDate)}"`:''} ${options.type==='password'?'autocomplete="new-password"':''} placeholder="${esc(placeholder)}">`;
 return `<div class="field ${options.full?'full':''}"><label for="${id}">${label}${options.required?'<span class="required-mark">必填</span>':''}</label>${control}${hint?`<small id="${id}-hint">${hint}</small>`:''}<p id="${id}-error" class="field-error" hidden></p></div>`;
}
function openEditor(p=null,customerId='') { openPaperEditor(p,p?(p.serviceType||'full'):'half',customerId); }

async function openDetail(id,tab='basic') {
 const current=beginDrawerRequest();
 const paper = await api(`/api/papers/${encodeURIComponent(id)}`);
 if(!current())return false;
 clearTimeout(credentialTimer);state.drawer={kind:'detail',paper,tab};renderDetail();return true;
}
function detailField(label,value,full=false) { return `<div class="detail-field ${full?'full':''}"><label>${label}</label><div class="value">${value||'—'}</div></div>`; }
function renderDetail() {
 const {paper:p,tab}=state.drawer;
 setOverlay(`<div class="overlay"><section class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
  <header class="drawer-head"><div><h2 id="drawer-title">${esc(p.title)}</h2><p>${paperCode(p.code)} &nbsp; · &nbsp; ${esc(p.authors||'未填写作者')}</p></div><button class="icon-btn" data-action="close" aria-label="关闭">${icon('close')}</button></header>
  <div class="detail-tabs" role="tablist">${[['basic','论文详情'],['submissions','投稿记录'],['followups','跟进事项'],['files',`文件与版本（${sortedManuscripts(p).length}）`],['finance','收支明细'],['history','变更历史']].map(([id,label])=>`<button class="tab ${tab===id?'active':''}" data-action="detail-tab" data-tab="${id}" role="tab" aria-selected="${tab===id}">${label}</button>`).join('')}</div>
  <div class="drawer-body" id="detail-body">${tab==='basic'?basicDetail(p):tab==='finance'?financeDetail(p):tab==='submissions'?submissionCards(p):tab==='files'?fileVersions(p):tab==='followups'?followUpDetail(p):historyDetail(p)}</div>
  <footer class="drawer-foot"><span class="panel-hint">${tab==='followups'?'事项处理与历史记录':'查看记录'}</span><div class="actions">${writerReassignmentButton(p)}${btn('close','关闭')}</div></footer>
 </section></div>`);
}
function basicDetail(p) {
 return `<div class="actions" style="margin-bottom:18px">${btn('new-followup','新增跟进事项','plus','',`data-id="${esc(p.id)}"`)}${btn('followup-detail','查看跟进事项','','',`data-id="${esc(p.id)}"`)}</div>`+settlementSummary(p)+manuscriptSummary(p)+writingOverview(p)+`<div class="detail-meta">${detailField('当前状态',badge(p.status))}${detailField('客户 / 委托人',esc(p.customer))}${hasWriting(p)?detailField('写作者 / 合作人',esc(p.writer)):''}${detailField('作者',esc(p.authors))}${detailField('作者简介',`<span class="author-bio-text">${esc(p.authorBio||'未填写')}</span>`,true)}${detailField('投稿期刊',esc(p.journal))}${detailField('投稿系统',esc(p.submissionSystem))}${detailField('投稿日期',dateLabel(p.submittedAt))}${detailField('下次跟进',`${serviceEnded(p)?'服务已终止 · 原计划 ':''}${dateLabel(p.followUpAt)}${due(p)?' <span class="due-date">已到跟进时间</span>':''}`)}${detailField('跟进事项 / 由来',`<span class="follow-up-reason">${esc(followUpReasonLabel(p))}</span>`,true)}${detailField('投稿网址',p.submissionUrl?`<a href="${esc(p.submissionUrl)}" target="_blank" rel="noopener noreferrer">${esc(p.submissionUrl)} ${icon('link')}</a>`:'',true)}</div><div class="credential-box"><h3 class="section-heading">${icon('lock')}账号与绑定信息</h3><div class="detail-meta">${detailField('投稿账号',esc(p.submissionAccount))}${detailField('投稿密码',p.hasPassword?`<div class="password-row"><span id="password-value" class="password-value">••••••••••</span><button class="text-btn" data-action="reveal-password" id="reveal-button">${icon('eye')}显示</button></div>`:'未保存')}${detailField('绑定邮箱',esc(p.boundEmail))}${detailField('绑定手机号',esc(p.boundPhone))}</div></div><div class="section-heading" style="margin-top:26px">${icon('document')}备注</div><div class="detail-note">${esc(p.notes||'暂无备注')}</div><p class="panel-hint" style="margin-top:20px">建立于 ${instantLabel(p.createdAt)} &nbsp; · &nbsp; 更新于 ${instantLabel(p.updatedAt)}</p>`;
}
function financeDetail(p) {
 const transactions=[...p.transactions].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
 return `${profitSummary(p)}${settlementSummary(p)}${publicationFeeSummary(p)}${customerReceiptSummary(p)}${writingPaymentSummary(p,true)}${serviceEnded(p)?'':`<div class="money-grid"><div class="money-box"><label>已收定金尾款 / 约定应收</label><strong>${yuan(p.contractReceivedCents)}</strong><small>约定 ${yuan(p.contractCents)} · 未收 ${yuan(p.receivableCents)}</small><small>约定定金 ${yuan(p.contractDepositCents)} · 尾款 ${yuan((p.contractCents||0)-(p.contractDepositCents||0))}</small></div>${hasWriting(p)?`<div class="money-box"><label>已付稿酬 / 约定稿酬</label><strong>${yuan(p.writerPaidCents)}</strong><small>约定 ${yuan(effectiveWriterFee(p))} · 未付 ${yuan(p.payableCents)}</small></div>`:`<div class="money-box"><label>半包 · 客户供稿</label><strong>无需写作稿酬</strong><small>版面费单独登记，其他费用记入其他支出</small></div>`}</div>${p.contractReceivedCents>p.contractCents||p.writerPaidCents>effectiveWriterFee(p)?`<div class="notice">${icon('info')}累计实际收款或付款已超过对应约定金额，请核对费用约定与流水。</div>`:''}`}<div class="panel-header" style="padding:6px 0"><h3 class="panel-title">收支流水 <small>${p.transactions.length} 笔</small></h3>${btn('add-transaction','新增','plus','small')}</div><div class="transaction-list">${transactions.length?transactions.map((tx,index)=>financialRow(p,tx,index)).join(''):'<div class="empty-small" style="padding:45px 10px">暂无流水。登记定金、尾款，让每笔收支清晰可查。</div>'}</div><div class="detail-note" style="margin-top:20px">现金净额：${yuan(p.netCents)}（实际已收 − 实际已付）<br>其他收入：${yuan(p.otherIncomeCents)} · 其他支出：${yuan(p.otherExpenseCents)}<br>其他收支单独计入利润，不抵扣应收尾款、应付稿酬或版面费。</div>${financialAudit(p)}`;
}
function historyDetail(p) {
 return `<div class="notice green" style="margin-bottom:27px">${icon('info')}修改期刊、投稿系统、投稿网址、投稿日期或状态时，会自动保留该次变更。</div><div class="timeline">${[...p.history].reverse().map((e,index)=>`<div class="timeline-item"><h3>${sequenceBadge(index)}${esc(e.action)} &nbsp; ${badge(e.status)}</h3><p>期刊：${esc(e.journal||'未填写')}<br>系统：${esc(e.submissionSystem||'未填写')}<br>投稿日期：${dateLabel(e.submittedAt)}</p>${e.submissionUrl?`<p>${esc(e.submissionUrl)}</p>`:''}<time>${instantLabel(e.at)}</time></div>`).join('')}</div>`;
}
function transactionForm(selectedType='',publicationAccountId=state.drawer?.publicationAccountId||'') {
 clearTimeout(credentialTimer);state.drawer.kind='transaction';state.drawer.publicationAccountId=publicationAccountId; const p=state.drawer.paper;
 setOverlay(`<div class="overlay"><section class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><header class="drawer-head"><div><h2 id="drawer-title">${selectedType==='incoming_deposit'?'登记已收定金':selectedType==='incoming_balance'?'登记已收尾款':selectedType==='outgoing_deposit'?'登记已付定金':selectedType==='outgoing_balance'?'登记已付尾款':'新增收支'}</h2><p>${esc(p.title)}</p></div><button class="icon-btn" data-action="close" aria-label="关闭">${icon('close')}</button></header><form id="transaction-form" novalidate style="display:contents"><div class="drawer-body"><div class="notice green" style="margin-bottom:25px">${icon('info')}按实际收付逐笔登记。稿酬、版面费与其他支出分别记录；作者自理版面费不登记我方流水。</div><div class="form-grid"><div class="field full"><label for="tx-type">收支类型 <span class="required-mark">必填</span></label><select id="tx-type" name="type" required><optgroup label="收入 / 费用退回">${Object.entries(typeLabels).filter(([k])=>k.startsWith('incoming')&&transactionTypeAllowed(p,k)).map(([k,v])=>`<option value="${k}" ${k===selectedType?'selected':''}>${v}</option>`).join('')}</optgroup><optgroup label="支出">${Object.entries(typeLabels).filter(([k])=>k.startsWith('outgoing')&&transactionTypeAllowed(p,k)).map(([k,v])=>`<option value="${k}" ${k===selectedType?'selected':''}>${v}</option>`).join('')}</optgroup></select></div>${field('amount','本次实际收付金额（元）',selectedType&&transactionRemaining(p,selectedType)!==null?(transactionRemaining(p,selectedType)/100).toFixed(2):'',{type:'number',required:true,min:0.01,placeholder:'例如：2000.00',hint:'必须大于 0，最多两位小数。'})}<div class="field"><label for="tx-date">收付日期 <span class="required-mark">必填</span></label><input id="tx-date" name="date" type="date" required value="${today()}" max="${today()}"></div>${publicationAccountSelect(p)}${writerPaymentSelect(p)}${transactionPaymentFields()}<div class="field full payment-confirm" data-publication-payment-confirm hidden><label><input type="checkbox" name="confirmPublicationPayment" value="yes">确认这笔版面费已经实际支付或退回。</label></div>${serviceEnded(p)||p.writerAssignments?.length>1?settlementPaymentConfirmation():''}${field('method','收付方式','',{max:80,full:true,placeholder:'例如：银行转账、微信、支付宝'})}${field('note','收支备注','',{textarea:true,full:true,max:1000,placeholder:'例如：首笔定金、录用后尾款、转账凭证号…'})}</div></div><footer class="drawer-foot">${formFeedback()}<span class="panel-hint">逐笔记录，自动汇总</span><div class="actions">${btn('cancel-transaction','返回')}<button class="btn primary" type="submit">${icon('check')}保存</button></div></footer></form></section></div>`);
}

function confirmModal(title,message,action,label='确定',danger=false) {
 hideCredential();
 clearTimeout(credentialTimer);state.modal={kind:'confirm',action};
 // Keep the live elements so cancelling preserves unsaved input values.
 state.modal.previous=[...$('#overlay-root').childNodes];
 setOverlay(`<div class="overlay modal-overlay"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><h2 id="modal-title">${esc(title)}</h2><p>${esc(message)}</p><div class="error-message" role="alert"></div><div class="actions">${btn('cancel-modal','取消')}${btn('confirm-modal',label,'',danger?'danger':'primary')}</div></section></div>`);
}
function cancelModal() {
 overlayRevision++;
 const previous=state.modal?.previous;state.modal=null;
 if(state.drawer?.paper&&state.drawer.kind==='detail')renderDetail();
 else if(previous?.length){$('#overlay-root').replaceChildren(...previous);$('input,button,select,textarea',$('#overlay-root'))?.focus();}else closeOverlay();
}
function restoreModal() {
 state.modal={kind:'restore'};
 setOverlay(`<div class="overlay modal-overlay"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><h2 id="modal-title">从加密备份恢复</h2><p>这将替换当前账号的全部论文、稿件文件及流水。请先在设置中下载当前账号的备份，恢复后仍使用当前账号与管理密码。</p><form id="restore-form" novalidate><div class="form-grid"><div class="field full"><label for="backup-file">备份文件<span class="required-mark">必填</span></label><input id="backup-file" name="file" type="file" accept=".vault,.bak,.zip" required></div><div class="field full"><label for="backup-password">备份时使用的密码<span class="required-mark">必填</span></label><input id="backup-password" name="password" type="password" autocomplete="off" required maxlength="128"></div><div class="field full"><label class="choice-label"><input type="checkbox" required>我已备份当前账号的数据，确认替换该账号的全部记录</label></div></div><div class="error-message" role="alert"></div><div class="actions">${btn('close','取消')}<button type="submit" class="btn danger">确认恢复</button></div></form></section></div>`);
}

function download(name,blob) { const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000); }
function csvCell(value) { let text=String(value??'');if(/^[\s]*[=+\-@\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"'; }
function csvDownload(name,rows) { const numbered=rows.map((row,index)=>[index===0?'序号':index,...row]);const csv='\uFEFF'+numbered.map(row=>row.map(csvCell).join(',')).join('\r\n');download(name,new Blob([csv],{type:'text/csv;charset=utf-8'})); }
function exportPapers() {
 if(state.view==='followups')return exportFollowUps();
 const list=filteredPapers();if(!list.length)return toast('当前筛选下没有可导出的记录',true);
 const headers=['编号','论文题目','服务类型','作者','客户','写作者','投稿期刊','投稿系统','投稿网址','投稿日期','当前状态','跟进日期','跟进事项 / 由来','约定应收（元）','收款定金（元）','收款尾款（元）','稿酬总额（元）','已收定金（元）','已收尾款（元）','其他收入（元）','已付定金（元）','已付尾款（元）','其他支出（元）','已收总额（元）','已付总额（元）','未收（元）','未付（元）','备注'];
 const txsum=(p,type)=>p.transactions.filter(t=>t.type===type).reduce((n,t)=>n+transactionAmount(t),0)/100;
 paperCsvDownload(`投稿记录-${today()}.csv`,[headers,...list.map(p=>[p.code,p.title,serviceLabel(p),p.authors,p.customer,p.writer,p.journal,p.submissionSystem,p.submissionUrl,p.submittedAt,p.status,p.followUpAt,p.followUpReason||'',p.contractCents/100,(p.contractDepositCents||0)/100,((p.contractCents||0)-(p.contractDepositCents||0))/100,p.writerFeeCents/100,...['incoming_deposit','incoming_balance','incoming_other','outgoing_deposit','outgoing_balance','outgoing_other'].map(t=>txsum(p,t)),p.receivedCents/100,p.paidCents/100,p.receivableCents/100,p.payableCents/100,p.notes])],list);toast(`导出成功，共 ${list.length} 条`);
}
function exportFinanceYear() {
 const report=financeYearSummary(),scope=report.all?'全部年份':report.year+' 年';
 const rows=[['统计范围','项目','金额（元）','统计口径'],
  [scope,'累计收款',report.received/100,'按收付日期，包含费用退回及其他收入'],
  [scope,'累计付款',report.paid/100,'按收付日期，包含客户退款及其他支出'],
  [scope,'净现金流',report.cashNet/100,'累计收款 − 累计付款'],
  [scope,'待收服务费',report.receivable/100,'该年建档论文的当前待收余额'],
  [scope,'待付写作稿酬',report.writerPayable/100,'该年建档论文的当前待付余额'],
  [scope,'待付版面费',report.publicationPayable/100,'该年建档论文的当前待付余额'],
  [scope,'待退客户款',report.refundable/100,'该年建档论文的当前待退款'],
  [scope,'待追回稿酬',report.recoverable/100,'该年建档论文的当前待追回款'],
  [scope,'预计净利润',report.profit/100,'按论文建档年份；待确认版面费暂按 0 元，确认后自动重算'],
  [scope,'其中版面费待确认论文的预计利润',sum(report.papers.filter(hasPendingPublicationCost),'estimatedProfitCents')/100,report.pendingFeeCount+' 篇，待确认部分暂按 0 元计入'],
  [scope,'净利润（已结清）',report.settledProfit/100,report.basis==='settled'?'按最后一笔实际收付或终止结算日期归属年度':'按论文建档年份归属年度'],
  [scope,'待退回版面费',report.publicationRefundable/100,'该年建档论文的当前待退回款']];
 csvDownload(`收支年度汇总-${report.year}-${today()}.csv`,rows);toast('年度汇总已导出');
}
function exportFinance() {
 if(state.financeType==='profits') {
  const papers=filteredFinancePapers();if(!papers.length)return toast('当前范围内没有可导出的已结清利润',true);
  paperCsvDownload(`净利润明细-${state.financeYear}-${today()}.csv`,[['论文编号','论文题目','客户','结清日期','服务收入（元）','写作成本（元）','版面费成本（元）','其他收入（元）','其他支出（元）','净利润（元）'],...papers.map(p=>[p.code,p.title,p.customer,financeSettlementDate(p),effectiveContract(p)/100,effectiveWriterFee(p)/100,publicationTotal(p)/100,(p.otherIncomeCents||0)/100,(p.otherExpenseCents||0)/100,(p.settledProfitCents||0)/100])],papers);toast(`导出成功，共 ${papers.length} 条`);return;
 }
 if(state.financeType==='balances') {
  const papers=filteredFinancePapers();if(!papers.length)return toast('当前筛选下没有可导出的应收应付',true);
  paperCsvDownload(`应收应付-${state.financeYear}-${today()}.csv`,[['论文编号','论文题目','服务类型','客户','写作者','约定应收（元）','已收定金及尾款（元）','待收款（元）','约定稿酬（元）','已付稿酬（元）','待付稿酬（元）','收款定金（元）','收款尾款（元）'],...papers.map(p=>[p.code,p.title,serviceLabel(p),p.customer,p.writer,...['contractCents','contractReceivedCents','receivableCents','writerFeeCents','writerPaidCents','payableCents'].map(key=>(p[key]||0)/100),(p.contractDepositCents||0)/100,((p.contractCents||0)-(p.contractDepositCents||0))/100])],papers);toast(`导出成功，共 ${papers.length} 条`);return;
 }
 const txs=filteredTransactions();if(!txs.length)return toast('当前筛选下没有可导出的流水',true);
 csvDownload(`收支流水-${state.financeYear}-${today()}.csv`,[['收支日期','论文编号','论文题目','客户','写作者','收支类型','收入（元）','支出（元）','收付方式','备注','流水编号','经手账号','冲销原流水','重记原流水','版面费账户'],...txs.map(t=>[t.date,t.paper.code,t.paper.title,t.paper.customer,t.paper.writer,typeLabels[t.type],t.type.startsWith('incoming')?transactionAmount(t)/100:'',t.type.startsWith('outgoing')?transactionAmount(t)/100:'',t.method,t.note,t.id,t.actor||'历史记录',t.reversalOf||'',t.correctsTransactionId||'',t.publicationAccountId||''])]);toast(`导出成功，共 ${txs.length} 条`);
}
function resetFilters() { Object.assign(state,{search:'',status:'',from:'',to:'',customerId:'',page:1}); }
function navigateTo(view,customerId='') {
 state.view=view;state.tab='all';state.financeType='balances';resetFilters();
 state.customerId=customerId;closeOverlay();renderShell();if(view==='writers')loadWriterProfiles();
}
function renderResults() { if(state.view==='writers')return renderWriterResults(); if(state.view==='papers')return renderManagedPaperResults();if(state.view==='submissions')return renderSubmissionResults();if(state.view==='customers')return renderCustomerResults();state.view==='finance'?renderFinanceResults():renderPaperResults(); }

document.addEventListener('click', async event => {
 if(pageSizeMenu&&!pageSizeMenu.trigger.contains(event.target)&&!pageSizeMenu.element.contains(event.target))closePageSizeMenu();
 const button=event.target.closest('[data-action]');if(!button||button.disabled)return;
 const action=button.dataset.action;
 if(fileTransferBusy){toast('文件正在传输，请等待完成。',true);return;}
 try {
  if(action==='auth-mode') {
   if(state.authSubmitting||state.resetSending||!['login','register'].includes(button.dataset.mode))return;
   state.username=$('#auth-username')?.value.trim()||state.username;state.authEmail=$('#auth-email')?.value.trim()||state.authEmail;state.authMode=button.dataset.mode;renderAuth();$('#auth-username')?.focus();
  }
  else if(action==='forgot-password'){if(state.authSubmitting||state.resetSending)return;state.username=$('#auth-username')?.value.trim()||state.username;state.authMode='forgot';renderAuth();$('#auth-email')?.focus();}
  else if(action==='send-reset-code')await sendResetCode();
  else if(action==='send-register-code')await sendRegistrationCode();
  else if(action==='toggle-auth-password'||action==='toggle-password') {
   const auth=action==='toggle-auth-password';
   if(!(auth?['auth-password','auth-newPassword','auth-confirm']:['current-password','new-password','confirm-password']).includes(button.dataset.target))return;
   const input=$('#'+button.dataset.target);
   if(input?.form?.id!==(auth?'auth-form':'password-form')||!['password','text'].includes(input.type))return;
   const visible=input.type==='password';input.type=visible?'text':'password';
   const label=(visible?'隐藏':'显示')+button.dataset.label;
   button.setAttribute('aria-pressed',String(visible));button.setAttribute('aria-label',label);button.title=label;
   button.innerHTML=icon(visible?'eyeOff':'eye');
  }
  else if(['new-followup','edit-followup','complete-followup','reopen-followup'].includes(action)) {
   button.disabled=true;
   await openFollowUpEditor(button.dataset.id||'',button.dataset.taskId||'',action==='complete-followup'?'complete':action==='reopen-followup'?'reopen':'edit');
  }
  else if(action==='followup-detail')await openDetail(button.dataset.id,'followups');
  else if(action==='followup-task-detail')await openFollowUpTaskDetail(button.dataset.id,button.dataset.taskId);
  else if(action==='cancel-followup')cancelFollowUpEditor();
  else if(action==='terminate-service')openTerminationForm();
  else if(action==='cancel-termination')cancelTermination();
  else if(action==='settlement-payment')transactionForm(button.dataset.type);
  else if(action==='navigate')navigateTo(button.dataset.view,button.dataset.customerId||'');
  else if(action==='menu')$('#sidebar').classList.toggle('mobile-open');
  else if(action==='new-paper')openEditor(null,button.dataset.customerId||'');
  else if(action==='new-writing')openWritingEditor(null,button.dataset.customerId||'');
  else if(action==='close')closeOverlay();
  else if(action==='tab'){state.tab=button.dataset.tab;state.page=1;renderContent();}
  else if(action==='finance-tab'||action==='finance-source')selectFinanceTab(button.dataset.type,action==='finance-source');
  else if(action==='page-size-toggle'){if(pageSizeMenu)closePageSizeMenu(true);else openPageSizeMenu(button);}
  else if(action==='page-size-option')selectPageSize(button.dataset.pageSize);
  else if(action==='page'){state.page=Number(button.dataset.page);renderResults();}
  else if(action==='clear-filters'){resetFilters();renderContent();}
  else if(action==='refresh'){button.disabled=true;await loadPapers();toast('刷新成功');}
  else if(action==='detail'||action==='detail-finance')await openDetail(button.dataset.id,action==='detail-finance'?'finance':'basic');
  else if(action==='paper-files')await openDetail(button.dataset.id,'files');
  else if(action==='detail-tab'){clearTimeout(credentialTimer);state.drawer.tab=button.dataset.tab;renderDetail();}
  else if(action==='edit-paper'){
   button.disabled=true;
   const current=beginDrawerRequest();
   const paper=button.dataset.id?await api(`/api/papers/${encodeURIComponent(button.dataset.id)}`):state.drawer.paper;
   if(!current())return;
   openEditor(paper);
  }
  else if(action==='edit-publication-fee')publicationFeeEditor(button.dataset.accountId||'');
  else if(action==='cancel-publication-fee'){state.drawer.kind='detail';state.drawer.tab='finance';renderDetail();}
  else if(action==='publication-payment')transactionForm(button.dataset.type,button.dataset.accountId||'');
  else if(action==='add-transaction')transactionForm();
  else if(action==='writer-payment'||action==='customer-payment'){
   button.disabled=true;
   const current=beginDrawerRequest();
   const paper=await api(`/api/papers/${encodeURIComponent(button.dataset.id)}`);
   if(!current())return;
   state.drawer={kind:'detail',paper,tab:'finance'};transactionForm(button.dataset.type);
  }
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
   button.disabled=true;
   const current=beginDrawerRequest();
   const id=button.dataset.id||state.drawer?.paper?.id;
   if(!id)throw new Error('请选择要删除的论文');
   const p=await api(`/api/papers/${encodeURIComponent(id)}`);
   if(!current())return;
   confirmModal('确认删除？',`“${p.title}”（${p.code}）\n一并删除：${hasWriting(p)?'写作安排、':''}${p.submissions?.length||0} 次投稿（含账号、历史）、${sortedManuscripts(p).length} 个稿件版本和 ${p.transactions?.length||0} 笔收支及财务记录。\n客户和其他论文保留。删除会清除该论文的全部数据，此操作无法撤销。`,async()=>{
    const origin=saveContext();
    await request('DELETE',`/api/papers/${encodeURIComponent(p.id)}`,{version:p.version});
    if(origin.csrf!==state.csrf)return;dataLoadSequence++;
    state.papers=state.papers.filter(paper=>paper.id!==p.id);syncCustomerSummaries();
    if(origin.current())closeOverlay();renderShell();toast('删除成功');
    try{await loadPapers();}catch(error){if(state.authenticated)toast('删除成功，列表刷新失败，请点击刷新。',true);}
   },'确认删除',true);
  }
  else if(action==='delete-transaction')reversalEditor(button.dataset.id);
  else if(action==='cancel-modal')cancelModal();
  else if(action==='confirm-modal'){button.disabled=true;await state.modal.action();}
  else if(action==='export-papers')exportPapers();
  else if(action==='export-finance')exportFinance();
  else if(action==='export-finance-year')exportFinanceYear();
  else if(action==='backup') {
   button.disabled=true;const response=await fetch('/api/backup',{credentials:'same-origin'});
   if(!response.ok){const error=await response.json();throw new Error(error.error||'备份下载失败');}
   download(`paper-desk-${today()}.${(response.headers.get('Content-Disposition')||'').includes('.zip')?'zip':'vault'}`,await response.blob());toast('已开始下载');
  }
  else if(action==='restore')restoreModal();
  else if(action==='logout') {
   confirmModal('确认退出系统？','退出后需要重新登录。尚未保存的内容将丢失，请确认已保存。',async()=>{
    await request('POST','/api/logout');state.authenticated=false;state.authMode='login';state.papers=[];state.customers=[];state.initialized=true;state.csrf='';closeOverlay();renderAuth();toast('退出成功');
   },'确认退出');
  }
 } catch(error) {
  const errorField=$('.error-message',$('#overlay-root'));
  if(errorField)errorField.textContent=error.message;else toast(error.message,true);
 } finally { if(button.isConnected&&!['send-reset-code','send-register-code'].includes(action))button.disabled=false; }
});

document.addEventListener('input', event => {
 if(event.target.id==='search'){state.search=event.target.value;state.page=1;renderResults();}
});
document.addEventListener('change', event => {
 if(event.target.id==='finance-profit-basis'){state.financeProfitBasis=event.target.value==='created'?'created':'settled';state.page=1;renderFinance();return;}
 if(event.target.id==='finance-year'){state.financeYear=event.target.value||String(new Date().getFullYear());resetFilters();renderFinance();return;}
 const names={'status-filter':'status','from-filter':'from','to-filter':'to','customer-filter':'customerId'};
 if(names[event.target.id]){state[names[event.target.id]]=event.target.value;state.page=1;renderResults();}
});
document.addEventListener('submit',async event=>{
 if(!['auth-form','paper-form','transaction-form','password-form','restore-form','termination-form','publication-fee-form','followup-form'].includes(event.target.id))return;
 event.preventDefault();const form=event.target;const submit=$('[type=submit]',form);const errorField=$('.error-message',form);
 if(submit?.disabled)return;if(!validateForm(form))return;const submitLabel=submit?.innerHTML;if(submit){submit.disabled=true;if(form.id!=='auth-form')submit.innerHTML='保存中…';}if(errorField)errorField.textContent='';
 const origin=saveContext();
 try {
  const data=Object.fromEntries(new FormData(form));
  if(form.id==='auth-form') {
   state.authSubmitting=true;
   const mode=form.dataset.mode;
   if(!['login','register','forgot'].includes(mode))return;
   state.username=data.username.trim();
   if(mode==='forgot') {
    if(data.newPassword!==data.confirm)throw new Error('两次输入的新密码不一致');
    await request('POST','/api/password-reset',{username:data.username,email:data.email,code:data.code,newPassword:data.newPassword});
    state.authenticated=false;state.csrf='';state.papers=[];state.customers=[];state.authMode='login';state.loginFailed=false;state.authEmail='';state.resetResendAt=0;closeOverlay();renderAuth();toast('密码已重置，请使用新密码登录');return;
   }
   if(mode==='register'&&!/^[^\s@]+@qq\.com$/i.test(String(data.email||'').trim()))throw new Error('注册请使用 QQ 邮箱（以 @qq.com 结尾）');
   if(mode==='register'&&data.password!==data.confirm)throw new Error('两次输入的密码不一致');
   if(mode==='register') {
    if(!/^[0-9]{6}$/.test(data.code||''))throw new Error('请输入 QQ 邮箱收到的 6 位注册验证码');
    await request('POST','/api/register',{username:data.username,email:data.email,code:data.code,password:data.password});
    state.authenticated=false;state.csrf='';state.papers=[];state.customers=[];state.initialized=true;state.authMode='login';state.loginFailed=false;state.authEmail='';state.registrationResendAt=0;closeOverlay();renderAuth();toast('注册成功，请使用账号和密码登录');return;
   }
   const result=await request('POST','/api/login',{username:data.username,password:data.password});
   state.csrf=result.csrf;state.username=result.username;state.recoveryEmail=result.recoveryEmail||'';state.loginFailed=false;state.authEmail='';state.initialized=true;state.authenticated=true;state.authMode='login';state.view='records';resetFilters();renderShell();
   try { await loadPapers(); } catch(error) { if(state.authenticated)toast('登录成功，列表加载失败，请点击刷新。',true); }
  }
  else if(form.id==='followup-form')await saveFollowUpForm(form,data,origin);
  else if(form.id==='paper-form') {
   const drawer=origin.drawer,file=selectedManuscript(form),p=drawer.paper;const payload=customerReceiptPayload(writerPaymentPayload(form,data));delete payload.clearPassword;
   if(payload.customerReceiptTotals&&state.customerReceiptTotalsSupported!==true)throw new Error('收款录入功能已更新，请重启服务并刷新页面后再保存。本次尚未提交。');
   if(payload.writerPayments?.length&&state.writerPaymentsSupported===false)throw new Error('付款录入功能已更新，请重启服务并刷新页面后再保存。本次尚未提交。');
   if(!p&&drawer.createRequestId)payload.createRequestId=drawer.createRequestId;
   if(p){payload.version=p.version;if(data.clearPassword==='on')payload.submissionPassword='';else if(data.submissionPassword==='')delete payload.submissionPassword;}
   if(file)fileTransferBusy=true;
   let saved;
   if(file&&drawer.pendingManuscript){
    saved=await uploadManuscript(p,file,form);payload.version=saved.version;drawer.paper=saved;drawer.pendingManuscript=false;
    saved=await request('PUT',`/api/papers/${saved.id}`,payload);
    clearRecordedWriterPayments(form,saved,drawer);clearRecordedCustomerReceipts(form,saved,drawer);
   }else{
    saved=await request(p?'PUT':'POST',p?`/api/papers/${p.id}`:'/api/papers',payload);
    clearRecordedWriterPayments(form,saved,drawer);clearRecordedCustomerReceipts(form,saved,drawer);
    if(file){drawer.paper=saved;drawer.pendingManuscript=true;dataLoadSequence++;state.papers=[saved,...state.papers.filter(item=>item.id!==saved.id)];syncCustomerSummaries();
     try{saved=await uploadManuscript(saved,file,form);drawer.pendingManuscript=false;}catch(error){throw new Error('论文信息已保存，稿件上传失败：'+error.message+'。可再次保存重试。');}}
   }
   await finishSave(saved,p?'保存成功':'新增成功',{view:state.view==='papers'?'papers':'records',origin});
  }
  else if(form.id==='termination-form') {
   const p=origin.drawer.paper;
   if(state.terminationSupported!==true)throw new Error('请重启服务并刷新页面后使用终止服务功能');
   const saved=await request(serviceEnded(p)?'PUT':'POST',`/api/papers/${p.id}/termination`,{...data,version:p.version,confirmTermination:data.confirmTermination==='yes'});
   if(origin.csrf!==state.csrf)return;dataLoadSequence++;
   state.papers=state.papers.map(item=>item.id===saved.id?saved:item);syncCustomerSummaries();
   if(origin.current()){state.drawer={kind:'detail',paper:saved,tab:'finance'};renderDetail();}renderShell();toast(serviceEnded(p)?'结算约定已更新':'服务已终止，实际款项请按结算登记');
  }
  else if(form.id==='publication-fee-form') {
   const p=origin.drawer.paper;
   const saved=await request('PUT',`/api/papers/${p.id}/publication-fee`,{...data,version:p.version});
   if(origin.csrf!==state.csrf)return;dataLoadSequence++;
   state.papers=state.papers.map(item=>item.id===saved.id?saved:item);syncCustomerSummaries();
   if(origin.current()){state.drawer={kind:'detail',paper:saved,tab:'finance'};renderDetail();}renderShell();toast('版面费约定已更新');
  }
  else if(form.id==='transaction-form') {
   const p=origin.drawer.paper,payload={...data,version:p.version,correctsTransactionId:origin.drawer.correctsTransactionId||''};
   if(data.confirmWriterPayment==='yes'&&state.writerPaymentsSupported===false)throw new Error('付款录入功能已更新，请重启服务并刷新页面后再保存。本次尚未提交。');
   if(data.confirmWriterPayment==='yes')payload.confirmWriterPayment=true;else delete payload.confirmWriterPayment;
   if(data.confirmSettlementPayment==='yes')payload.confirmSettlementPayment=true;else delete payload.confirmSettlementPayment;
   if(data.confirmPublicationPayment==='yes')payload.confirmPublicationPayment=true;else delete payload.confirmPublicationPayment;
   const saved=await request('POST',`/api/papers/${p.id}/transactions`,payload);
   await finishSave(saved,'新增成功',{view:'finance',financeType:'all',origin});
  }
  else if(form.id==='password-form') {
   if(data.newPassword!==data.confirm)throw new Error('两次输入的新密码不一致');
   const result=await request('POST','/api/password',{currentPassword:data.currentPassword,newPassword:data.newPassword});if(origin.csrf!==state.csrf||!state.authenticated)return;state.csrf=result.csrf;if(form.isConnected)form.reset();toast('密码修改成功');
  }
  else if(form.id==='restore-form') {
   const file=$('#backup-file',form).files[0];if(!file)throw new Error('请选择备份文件');
   if(/\.zip$/i.test(file.name)){if(file.size>600*1024*1024)throw new Error('附件备份不能超过 600MB');fileTransferBusy=true;try{await binaryRequest('/api/restore-archive',file,{'X-Backup-Password':encodeURIComponent(data.password)},form);}finally{fileTransferBusy=false;}closeOverlay();resetFilters();await loadPapers();toast('恢复成功');return;}
   if(file.size>8*1024*1024)throw new Error('备份文件不能超过 8MB');
   const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
   await request('POST','/api/restore',{backup:btoa(binary),password:data.password});closeOverlay();resetFilters();await loadPapers();toast('恢复成功');
  }
 } catch(error) {
  if(form.id==='auth-form'&&form.dataset.mode==='login'){
   if(error.code==='REGISTRATION_REQUIRED')showRegistrationRequired();
   else if(error.status===401||error.code==='INVALID_CREDENTIALS')showForgotPassword();
  }
  if(errorField?.isConnected)showFormError(form,error.message);else toast(error.message,true);
 }
 finally {fileTransferBusy=false;if(form.id==='auth-form')state.authSubmitting=false;if(submit?.isConnected){submit.disabled=false;submit.innerHTML=submitLabel;}}
});

function hideCredential() {
 hideSubmissionCredentials();
 clearTimeout(credentialTimer);const field=$('#password-value'),button=$('#reveal-button');
 if(field)field.textContent='••••••••••';if(button){button.innerHTML=`${icon('eye')}显示`;delete button.dataset.visible;}
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)hideCredential();});
document.addEventListener('keydown',event=>{
 if(handlePageSizeKeydown(event))return;
 const overlay=$('#overlay-root');if(!overlay.hasChildNodes())return;
 if(event.key==='Escape'){
  if(fileTransferBusy){event.preventDefault();return;}
  event.preventDefault();if(state.modal)cancelModal();else if(['detail','customer-detail','followup-detail'].includes(state.drawer?.kind))closeOverlay();
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
  const session=await api('/api/session');state.customerReceiptTotalsSupported=session.customerReceiptTotalsSupported===true;state.customerReceiptsSupported=session.customerReceiptsSupported===true;state.writerPaymentsSupported=session.writerPaymentsSupported===true;state.terminationSupported=session.terminationSupported===true;state.publicationFeesSupported=session.publicationFeesSupported===true;state.storage=session.storage||'file';state.fileMaxBytes=session.fileMaxBytes||50*1024*1024;state.initialized=session.initialized;state.authenticated=session.authenticated;state.username=session.username||'';state.recoveryEmail=session.recoveryEmail||'';state.csrf=session.csrf;
  if(session.authenticated)await loadPapers();else renderAuth();
 }catch(error){$('#root').innerHTML=`<div class="empty-state"><h3>工作台暂时无法连接</h3><p>${esc(error.message)}</p><a class="btn" href="/">重新连接</a></div>`;}
})();

document.addEventListener('dblclick',event=>{
 const code=event.target.closest('[data-paper-code]');if(!code)return;
 event.preventDefault();event.stopPropagation();copyPaperCode(code.dataset.paperCode);
});
document.addEventListener('keydown',event=>{
 const code=event.target.closest?.('[data-paper-code]');if(!code||!['Enter',' '].includes(event.key))return;
 event.preventDefault();event.stopPropagation();copyPaperCode(code.dataset.paperCode);
});
