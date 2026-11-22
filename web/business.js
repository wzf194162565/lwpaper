'use strict';

const writingStatuses = ['待分配','写作中','待修改','已交稿','已完成','已取消'];
const customerStatuses = ['待合作','合作中','已归档'];
const hasWriting = p => (p.serviceType || 'full') === 'full';
const serviceLabel = p => hasWriting(p) ? '全包 · 含论文写作' : '半包 · 客户供稿';
function serviceBadge(p) { return `<span class="badge ${hasWriting(p)?'green':'blue'}">${serviceLabel(p)}</span>`; }
function newPaperActions(customerId=state.customerId,classes='') {
 const extra=customerId?`data-customer-id="${esc(customerId)}"`:'';
 return btn('new-paper','新建论文（半包）','document',`${classes} primary`,`${extra} title="半包：客户提供文章，管理投稿与收支"`)+btn('new-writing','新建论文（全包）','edit',`${classes} primary`,`${extra} title="全包：包含写作、投稿与收支"`);
}
const writingFinished = p => ['已交稿','已完成','已取消'].includes(p.writingStatus);
function writingBadge(status) { const colors={'待分配':'slate','写作中':'blue','待修改':'amber','已交稿':'green','已完成':'green','已取消':'violet'};return `<span class="badge ${colors[status]||'slate'}">${esc(status||'待分配')}</span>`; }
function businessTabs(items) { return `<div class="tab-bar" role="tablist">${items.map(([id,label,count])=>`<button class="tab ${state.tab===id?'active':''}" data-action="tab" data-tab="${id}" role="tab" aria-selected="${state.tab===id}">${label}${count===undefined?'':`<span class="count">${count}</span>`}</button>`).join('')}</div>`; }
function customerOptions(selected='',empty='全部客户') { return `<option value="">${empty}</option>${state.customers.map(c=>`<option value="${esc(c.id)}" ${selected===c.id?'selected':''}>${esc(c.name)}${c.phone?' · '+esc(c.phone):''}</option>`).join('')}`; }
function businessFilters(placeholder,statusOptions,dateText='',statusLabel='全部状态') { return `<div class="filter-row"><div class="search-box">${icon('search')}<input id="search" type="search" aria-label="搜索记录" value="${esc(state.search)}" placeholder="${placeholder}"></div><select id="status-filter" aria-label="${esc(statusLabel)}"><option value="">${esc(statusLabel)}</option>${statusOptions.map(s=>`<option ${state.status===s?'selected':''}>${esc(s)}</option>`).join('')}</select>${state.view==='customers'?'':`<select id="customer-filter" aria-label="客户筛选">${customerOptions(state.customerId)}</select>`}${dateText?`<span class="filter-label">${dateText}</span><input class="date-filter" id="from-filter" type="date" aria-label="起始日期" value="${esc(state.from)}"><input class="date-filter" id="to-filter" type="date" aria-label="截止日期" value="${esc(state.to)}">`:''}${btn('clear-filters','重置')}</div>`; }
function customerLink(p) { return p.customerId?`<button class="text-btn customer-link" data-action="customer-detail" data-id="${esc(p.customerId)}">${esc(p.customer)}</button>`:esc(p.customer||'未关联客户'); }
function daysLabel(days) { return days===null||days===undefined?'未计算':`${days} 天`; }
function businessEmpty(glyph,title,text,action,label,extra='') { return `<div class="empty-state"><div class="empty-illustration">${icon(glyph)}</div><h3>${title}</h3><p>${text}</p>${btn(action,label,action==='navigate'?'chevron':'plus','primary',extra)}</div>`; }
function validDateRange() { return !state.from||!state.to||state.from<=state.to; }
function filterDate(value) { return (!state.from||(value&&value>=state.from))&&(!state.to||(value&&value<=state.to)); }
function searchText(values) { return values.join(' ').toLocaleLowerCase().includes(state.search.trim().toLocaleLowerCase()); }

function paperCreatedDate(p) {
 const date=new Date(p.createdAt);
 return Number.isNaN(date.getTime())?'':`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function filteredManagedPapers() {
 return state.papers.filter(p=>{
  const full=hasWriting(p);
  if(state.tab==='full'&&!full||state.tab==='half'&&full)return false;
  if(state.tab==='active'&&(!full||writingFinished(p)))return false;
  if(state.tab==='overdue'&&(!full||!p.writingOverdue))return false;
  if(state.tab==='finished'&&(!full||!writingFinished(p)))return false;
  return (!state.status||(full&&p.writingStatus===state.status))&&(!state.customerId||p.customerId===state.customerId)&&filterDate(paperCreatedDate(p))&&searchText([p.title,p.code,full?p.writer:'',p.customer,p.authors,p.journal,p.notes]);
 }).sort((a,b)=>Number(hasWriting(b)&&b.writingOverdue)-Number(hasWriting(a)&&a.writingOverdue)||String(hasWriting(a)&&a.writingDueAt||'9999').localeCompare(String(hasWriting(b)&&b.writingDueAt||'9999'))||String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
}
function renderPaperManagement() {
 const papers=state.papers,full=papers.filter(hasWriting),active=full.filter(p=>!writingFinished(p)),overdue=full.filter(p=>p.writingOverdue);
 $('#content').innerHTML=`${pageHeading('论文管理','统一管理全包与半包论文，关联客户、写作安排、服务费用和投稿。',btn('export-managed-papers','导出论文档案','down')+newPaperActions())}
 <div class="stats-grid">${stat('论文总数',papers.length,'document',`全包 <strong>${full.length} 篇</strong> · 半包 <strong>${papers.length-full.length} 篇</strong>`,'','篇')}${stat('写作进行中',active.length,'edit',`已交稿 / 完成 <strong>${full.filter(p=>['已交稿','已完成'].includes(p.writingStatus)).length} 篇</strong>`,'blue','篇')}${stat('逾期未交',overdue.length,'clock','仅统计全包论文的写作任务','gold','篇')}${stat('待付写作稿酬',yuan(sum(full,'payableCents')),'wallet',`约定稿酬 <strong>${yuan(sum(full,'writerFeeCents'))}</strong>`,'purple','',true)}</div>
 <section class="panel"><div class="panel-header"><h2 class="panel-title">论文档案 <small>PAPER MANAGEMENT</small></h2><span class="panel-hint">全包安排写作，半包由客户供稿</span></div>
 ${businessTabs([['all','全部论文',papers.length],['full','全包论文',full.length],['half','半包论文',papers.length-full.length],['active','写作进行中',active.length],['overdue','逾期未交',overdue.length],['finished','已交稿 / 结束',full.filter(writingFinished).length]])}
 ${businessFilters('搜索论文题目、编号、客户、写作人或期刊…',writingStatuses,'论文建档日期','全部写作状态')}<div id="results"></div></section>${footer()}`;
 renderManagedPaperResults();
}
function managedPaperRow(p) {
 const full=hasWriting(p);
 return `<tr><td class="paper-cell"><button class="paper-title" data-action="detail" data-id="${esc(p.id)}">${esc(p.title)}</button><div class="paper-meta">${esc(p.code)} · 建档 ${dateLabel(paperCreatedDate(p))}</div><div class="cell-sub">${serviceBadge(p)}</div></td>
 <td>${customerLink(p)}<div class="cell-sub">${esc(p.authors||'未填写作者')}</div></td><td><div class="journal-name" title="${esc(p.journal||'')}">${esc(p.journal||'暂未关联期刊')}</div><div class="cell-sub">${p.submissions?.length?`${badge(p.status)} · ${p.submissions.length} 次投稿`:'可先关联期刊，稍后补充投稿资料'}</div></td>
 <td>${full?`${esc(p.writer||'尚未分配')}<div class="cell-sub">${writingBadge(p.writingStatus)}</div>`:'客户供稿<div class="cell-sub">无需安排写作</div>'}</td>
 <td>${full?`${dateLabel(p.writingStartAt)}<div class="cell-sub ${p.writingOverdue?'due-date':''}">交稿 ${dateLabel(p.writingDueAt)}${p.writingOverdue?' · 已逾期':''}</div>`:'—'}</td>
 <td>${full?`${dateLabel(p.writingDeliveredAt)}<div class="cell-sub">${daysLabel(p.writingDays)}</div>`:'—'}</td>
 <td class="cell-money">${yuan(p.contractCents)}<div class="cell-sub">${full?`稿酬 ${yuan(p.writerFeeCents)}`:'无需写作稿酬'}</div>${full?`<div class="cell-sub">约定定金 ${yuan(p.writerDepositCents)} / 尾款 ${yuan(p.writerBalanceCents)}</div>`:''}</td>
 <td>${full?`<div>定金 ${yuan(p.outgoing_depositCents)}</div><div class="cell-sub">尾款 ${yuan(p.outgoing_balanceCents)} · 待付 ${yuan(p.payableCents)}</div>`:'—'}</td>
 <td><button class="text-btn" data-action="edit-paper" data-id="${esc(p.id)}">${icon('edit')}编辑论文</button><div class="cell-sub"><button class="text-btn" data-action="detail-finance" data-id="${esc(p.id)}">登记 / 查看收支</button></div><div class="cell-sub"><button class="text-btn" data-action="${p.submissions?.length?'resubmit-paper':'new-submission'}" data-paper-id="${esc(p.id)}">${p.submissions?.length?'改投论文':'关联期刊'}${icon('chevron')}</button></div></td></tr>`;
}
function renderManagedPaperResults() {
 if(!validDateRange()){$('#results').innerHTML='<div class="empty-state"><h3>起始日期不能晚于截止日期</h3></div>';return;}
 const papers=filteredManagedPapers(),paging=pagination(papers.length);
 $('#results').innerHTML=papers.length?`<div class="table-scroll"><table><thead><tr><th>论文题目 / 编号</th><th>客户 / 作者</th><th>关联期刊</th><th>写作人 / 状态</th><th>开始 / 预计交稿</th><th>实际交稿 / 时长</th><th>服务费用 / 稿酬</th><th>写作定金 / 尾款实付</th><th>操作</th></tr></thead><tbody>${papers.slice((state.page-1)*state.pageSize,state.page*state.pageSize).map(managedPaperRow).join('')}</tbody></table></div>${paging}`:state.papers.length?`<div class="empty-state"><h3>没有符合条件的论文</h3><p>试试其他关键词、服务类型或写作状态，或重置筛选条件。</p>${btn('clear-filters','重置筛选','refresh')}</div>`:`<div class="empty-state"><div class="empty-illustration">${icon('document')}</div><h3>还没有论文档案</h3><p>使用页面右上方的新建入口，选择全包或半包，建立论文并关联客户。</p></div>`;
}

function allSubmissions() { return state.papers.flatMap(p=>(p.submissions||[]).map(s=>({...s,paper:p,current:p.activeSubmissionId===s.id}))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)); }
function submissionActive(s) { return ['已投稿','审稿中','修改中'].includes(s.status); }
function filteredSubmissions() {
 return allSubmissions().filter(s=>{
  if(state.tab==='active'&&!submissionActive(s))return false;
  if(state.tab==='finished'&&!['已录用','已发表','已拒稿','已撤稿'].includes(s.status))return false;
  if(state.tab==='long'&&(!submissionActive(s)||s.durationDays<30))return false;
  return (!state.status||s.status===state.status)&&(!state.customerId||s.paper.customerId===state.customerId)&&filterDate(s.submittedAt)&&searchText([s.title,s.paper.title,s.paper.code,s.paper.customer,s.journal,s.submissionSystem,s.submissionAccount,s.boundEmail,s.boundPhone,s.notes]);
 });
}
function renderSubmissions() {
 const subs=allSubmissions();
 $('#content').innerHTML=`${pageHeading('投稿管理','每次投稿独立记录，期刊、账号与投稿时长清晰可查。',btn('export-submissions','导出投稿记录','down')+btn('new-submission','新建投稿','plus','primary'))}<div class="stats-grid">${stat('累计投稿',subs.length,'document',`关联 <strong>${state.papers.filter(p=>p.submissions?.length).length} 篇论文</strong>`,'','次')}${stat('审稿 / 修改中',subs.filter(submissionActive).length,'clock','自动计算从投稿日起的时长','blue','次')}${stat('已录用 / 发表',subs.filter(s=>['已录用','已发表'].includes(s.status)).length,'checkCircle',`已发表 <strong>${subs.filter(s=>s.status==='已发表').length} 次</strong>`,'gold','次')}${stat('已投稿满 30 天',subs.filter(s=>submissionActive(s)&&s.durationDays>=30).length,'calendar','仅统计尚在投稿流程中的记录','purple','次')}</div><section class="panel"><div class="panel-header"><h2 class="panel-title">投稿记录 <small>SUBMISSION TRACKING</small></h2><span class="panel-hint">改投时新增记录，保留原期刊与账号</span></div>${businessTabs([['all','全部投稿',subs.length],['active','进行中',subs.filter(submissionActive).length],['long','满 30 天',subs.filter(s=>submissionActive(s)&&s.durationDays>=30).length],['finished','已结束',subs.filter(s=>['已录用','已发表','已拒稿','已撤稿'].includes(s.status)).length]])}${businessFilters('搜索题目、期刊、客户、账号、邮箱或手机号…',statuses,'投稿日期')}<div id="results"></div></section><div class="notice green" style="margin-top:20px">${icon('info')}<span>投稿时长从实际投稿日期计算至结束/录用日期；尚未结束则计算到今天。旧记录缺少结束日期时显示“未计算”，可编辑补录。发表成果按每次投稿保存，客户费用按关联论文汇总。</span></div>${footer()}`;renderSubmissionResults();
}
function submissionActions(s) {
 const ids=`data-paper-id="${esc(s.paper.id)}" data-id="${esc(s.id)}"`;
 return `<div class="submission-row-actions" role="group" aria-label="投稿操作"><button class="text-btn" data-action="edit-submission" ${ids}>编辑</button><button class="text-btn" data-action="resubmit-paper" ${ids}>改投</button><button class="text-btn submission-delete" data-action="delete-submission" ${ids}>删除</button><button class="text-btn" data-action="submission-detail" ${ids}>详情</button></div>`;
}
function renderSubmissionResults() {
 if(!validDateRange()){$('#results').innerHTML='<div class="empty-state"><h3>起始日期不能晚于截止日期</h3></div>';return;}
 const subs=filteredSubmissions(),paging=pagination(subs.length);
 $('#results').innerHTML=subs.length?`<div class="table-scroll"><table><thead><tr><th>投稿题目 / 关联文章</th><th>客户 / 投稿期刊</th><th>投稿系统 / 账号</th><th>绑定邮箱 / 手机</th><th>投稿日期 / 时长</th><th>状态 / 发表日期</th><th>操作</th></tr></thead><tbody>${subs.slice((state.page-1)*state.pageSize,state.page*state.pageSize).map(s=>`<tr><td class="paper-cell"><button class="paper-title" data-action="submission-detail" data-paper-id="${esc(s.paper.id)}" data-id="${esc(s.id)}">${esc(s.title)}</button><div class="paper-meta">${esc(s.paper.code)}${s.current?' · 当前投稿':''}</div>${s.title!==s.paper.title?`<div class="cell-sub">论文题目：${esc(s.paper.title)}</div>`:''}</td><td>${customerLink(s.paper)}<div class="cell-sub">${esc(s.journal)}</div></td><td>${esc(s.submissionSystem||'—')}<div class="cell-sub">${esc(s.submissionAccount||'未填写账号')}</div></td><td>${esc(s.boundEmail||'—')}<div class="cell-sub">${esc(s.boundPhone||'—')}</div></td><td>${dateLabel(s.submittedAt)}<div class="cell-sub ${submissionActive(s)&&s.durationDays>=30?'due-date':''}">${daysLabel(s.durationDays)}</div></td><td>${badge(s.status)}<div class="cell-sub">${s.publishedAt?dateLabel(s.publishedAt):'尚未发表'}</div></td><td>${submissionActions(s)}</td></tr>`).join('')}</tbody></table></div>${paging}`:!state.papers.length?businessEmpty('document','尚无可投稿的论文','请先在论文管理中建立论文档案，再登记投稿。','navigate','前往论文管理','data-view="papers"'):businessEmpty('document','暂无符合条件的投稿记录','选择已有论文，登记其期刊、投稿账号和投稿时间。','new-submission','新建投稿');
}

function filteredCustomers() { return state.customers.filter(c=>(!state.status||c.status===state.status)&&searchText([c.name,c.phone,c.email,c.wechat,c.organization,c.notes])); }
function renderCustomers() {
 const c=state.customers;
 $('#content').innerHTML=`${pageHeading('客户管理','把客户资料、发表成果和费用往来关联起来。',btn('export-customers','导出客户汇总','down')+btn('new-customer','新建客户','plus','primary'))}<div class="stats-grid">${stat('客户总数',c.length,'users',`合作中 <strong>${c.filter(x=>x.status==='合作中').length} 位</strong>`,'','位')}${stat('关联论文',sum(c,'paperCount'),'document',`已发表 <strong>${sum(c,'publishedPaperCount')} 篇</strong>`,'blue','篇')}${stat('约定服务费用',yuan(sum(c,'contractCents')),'wallet','按论文汇总，多次投稿不重复计费','gold','',true)}${stat('客户待付款',yuan(sum(c,'receivableCents')),'clock',`已收定金及尾款 <strong>${yuan(sum(c,'receivedCents'))}</strong>`,'purple','',true)}</div><section class="panel"><div class="panel-header"><h2 class="panel-title">客户信息 <small>CUSTOMER RELATIONSHIPS</small></h2><span class="panel-hint">同名客户可分别建档，以编号区分</span></div>${businessFilters('搜索客户姓名、手机号、邮箱、微信或单位…',customerStatuses)}<div id="results"></div></section>${footer()}`;renderCustomerResults();
}
function renderCustomerResults() {
 const clients=filteredCustomers(),paging=pagination(clients.length);
 $('#results').innerHTML=clients.length?`<div class="table-scroll"><table><thead><tr><th>客户姓名 / 状态</th><th>联系方式</th><th>单位 / 微信</th><th>合作开始日期</th><th>论文 / 已发表</th><th>已发表期刊</th><th>服务费用 / 已收</th><th>待收款</th><th>操作</th></tr></thead><tbody>${clients.slice((state.page-1)*state.pageSize,state.page*state.pageSize).map(c=>`<tr><td><button class="paper-title" data-action="customer-detail" data-id="${esc(c.id)}">${esc(c.name)}</button><div class="cell-sub">${esc(c.status)}</div></td><td>${esc(c.phone||'—')}<div class="cell-sub">${esc(c.email||'—')}</div></td><td>${esc(c.organization||'—')}<div class="cell-sub">${esc(c.wechat||'—')}</div></td><td>${c.cooperationStartedAt?dateLabel(c.cooperationStartedAt):'未记录'}</td><td>${c.paperCount} 篇<div class="cell-sub">已发表 ${c.publishedPaperCount} 篇</div></td><td><div class="journal-name" title="${esc(c.publishedJournals.join('、'))}">${esc(c.publishedJournals.join('、')||'暂无发表')}</div></td><td class="cell-money">${yuan(c.contractCents)}<div class="cell-sub">已收 ${yuan(c.receivedCents)}</div></td><td class="cell-money">${yuan(c.receivableCents)}</td><td><button class="text-btn" data-action="customer-detail" data-id="${esc(c.id)}">客户详情${icon('chevron')}</button></td></tr>`).join('')}</tbody></table></div>${paging}`:businessEmpty('users','还没有符合条件的客户','建立客户信息后，可以在全包或半包论文中选择并关联客户。','new-customer','新建客户');
}

function openWritingEditor(p=null,customerId='') { openPaperEditor(p,p?.serviceType||'full',customerId); }
function openPaperEditor(p=null,serviceType='half',customerId='') {
 const full=serviceType==='full';
 clearTimeout(credentialTimer);state.drawer={kind:'edit',paper:p,serviceType};
 const writing=full?`<div class="form-section"><h3 class="section-heading">${icon('edit')}写作安排</h3><div class="form-grid">
  ${field('writer','写作人',p?.writer,{max:200,placeholder:'填写写作者或合作人'})}
  ${field('writingStatus','写作状态',p?.writingStatus||'待分配',{select:writingStatuses})}
  ${field('writingStartAt','写作开始日期',p?.writingStartAt,{type:'date'})}
  ${field('writingDueAt','预计交稿日期',p?.writingDueAt,{type:'date'})}
  ${field('writingDeliveredAt','实际交稿日期',p?.writingDeliveredAt,{type:'date',hint:'标记已交稿/已完成但未填日期时，默认记为今天'})}
 </div></div><div class="form-section"><h3 class="section-heading">${icon('wallet')}写作费用约定</h3><div class="form-grid">
  ${field('writerFee','稿酬总额（元）',((p?.writerFeeCents||0)/100).toFixed(2),{type:'number'})}
  ${field('writerDepositAmount','约定写作定金（元）',((p?.writerDepositCents||0)/100).toFixed(2),{type:'number',hint:'约定尾款自动按稿酬总额减定金计算'})}
 </div><div class="notice green" style="margin-top:16px">${icon('info')}实际支付定金、尾款，请在论文详情的“收支明细”中逐笔登记。</div></div>`:'';
 setOverlay(`<div class="overlay"><section class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
  <header class="drawer-head"><div><h2 id="drawer-title">${p?'编辑':'新建'}论文（${full?'全包':'半包'}）</h2><p>${serviceLabel({serviceType})}${p?' · '+esc(p.code):''}</p></div><button class="icon-btn" data-action="close" aria-label="关闭">${icon('close')}</button></header>
  <form id="paper-form" style="display:contents"><input type="hidden" name="serviceType" value="${serviceType}"><div class="drawer-body">
   <div class="notice green service-notice">${icon('info')}<span>${full?'全包：由我们安排论文写作，并管理后续投稿与收支。':'半包：客户提供文章，直接管理论文、投稿与收支。'}</span></div>
   <div class="form-section"><h3 class="section-heading">${icon('document')}文章与客户</h3><div class="form-grid">
    ${field('title',full?'写作文章题目':'论文题目',p?.title,{required:true,full:true,max:300,placeholder:full?'填写写作题目，可关联多次投稿':'填写客户提供的文章题目'})}
    ${field('authors','作者',p?.authors,{max:200})}
    <div class="field"><label for="f-customerId">关联客户</label><select id="f-customerId" name="customerId">${customerOptions(p?.customerId||customerId,'暂不关联客户')}</select><small>如无客户信息，请先到客户管理中建立。</small></div>
    ${field('contractAmount','向客户约定收取费用（元）',((p?.contractCents||0)/100).toFixed(2),{type:'number',hint:'整篇论文的服务费用，不因多次投稿重复计费'})}
    ${field('followUpAt','下次业务跟进日期',p?.followUpAt,{type:'date'})}
   </div></div>
   <div class="form-section"><h3 class="section-heading">${icon('link')}关联期刊</h3><div class="form-grid">
    ${field('journal','当前关联期刊名称',p?.journal,{max:200,full:true,required:!!p?.submissions?.length,placeholder:'填写拟投或已投期刊名称',hint:p?.submissions?.length?'修改此处将更新当前投稿记录的期刊名称；改投请选择“改投论文”，保留原投稿。':'填写后保存，会建立一条“待投稿”的记录；账号、密码及投稿日期可稍后在投稿管理中补充。'})}
   </div></div>
   ${writing}<div class="form-grid">${field('notes','备注',p?.notes,{textarea:true,full:true})}</div><div class="error-message" role="alert"></div>
  </div><footer class="drawer-foot"><span class="panel-hint">保存后返回列表</span><div class="actions">${btn(p?'cancel-edit':'close','取消')}<button class="btn primary" type="submit">${icon('check')}保存论文</button></div></footer></form>
 </section></div>`);
}

function writingOverview(p) {
 const strip=`<div class="relationship-strip"><span>${serviceBadge(p)}</span><span>${icon('users')}${customerLink(p)}</span>${hasWriting(p)?`<span>${icon('edit')}${writingBadge(p.writingStatus)}</span>`:''}<span>${icon('document')}${p.submissions?.length||0} 次投稿</span></div>`;
 const writing=hasWriting(p)?`<h3 class="section-heading">${icon('edit')}写作安排</h3><div class="detail-meta">${detailField('写作人',esc(p.writer))}${detailField('写作状态',writingBadge(p.writingStatus))}${detailField('开始 / 预计交稿',`${dateLabel(p.writingStartAt)} / ${dateLabel(p.writingDueAt)}`)}${detailField('实际交稿 / 写作时长',`${dateLabel(p.writingDeliveredAt)} / ${daysLabel(p.writingDays)}`)}${detailField('约定稿酬 / 定金 / 尾款',`${yuan(p.writerFeeCents)} / ${yuan(p.writerDepositCents)} / ${yuan(p.writerBalanceCents)}`,true)}</div>`:'';
 return strip+writing+`<h3 class="section-heading">${icon('document')}当前投稿与基本资料</h3>`;
}
function submissionCards(p) {
 return `<div class="panel-header" style="padding:0 0 20px"><h3 class="panel-title">全部投稿 <small>${p.submissions.length} 次</small></h3>${btn(p.submissions.length?'resubmit-paper':'new-submission',p.submissions.length?'改投论文':'新增投稿','plus','small',`data-paper-id="${esc(p.id)}"`)}</div>${p.submissions.length?[...p.submissions].reverse().map(s=>`<article class="submission-card" id="submission-${esc(s.id)}"><div class="submission-card-head"><div><h3>${esc(s.journal||'未填写期刊')}</h3><p>${esc(s.title)}</p></div>${badge(s.status)}</div><div class="detail-meta">${detailField('投稿系统',esc(s.submissionSystem))}${detailField('投稿时长',daysLabel(s.durationDays))}${detailField('投稿日期',dateLabel(s.submittedAt))}${detailField('结束 / 录用日期',dateLabel(s.endedAt))}${detailField('发表日期',dateLabel(s.publishedAt))}${detailField('投稿账号',esc(s.submissionAccount))}${detailField('投稿密码',s.hasPassword?`<div class="password-row"><span class="password-value" data-secret-value="${esc(s.id)}">••••••••••</span><button class="text-btn" data-action="reveal-submission-password" data-id="${esc(s.id)}">${icon('eye')}显示</button></div>`:'未保存')}${detailField('绑定邮箱',esc(s.boundEmail))}${detailField('绑定手机号',esc(s.boundPhone))}${detailField('投稿网址',s.submissionUrl?`<a href="${esc(s.submissionUrl)}" target="_blank" rel="noopener noreferrer">${esc(s.submissionUrl)} ${icon('link')}</a>`:'',true)}</div>${s.notes?`<div class="detail-note">${esc(s.notes)}</div>`:''}<div class="submission-card-actions"><span class="panel-hint">${p.activeSubmissionId===s.id?'当前投稿记录':'此前投稿记录'}</span><div class="actions">${btn('resubmit-paper','改投','refresh','small',`data-paper-id="${esc(p.id)}" data-id="${esc(s.id)}"`)}${btn('delete-submission','删除','trash','small danger',`data-paper-id="${esc(p.id)}" data-id="${esc(s.id)}"`)}${btn('edit-submission','编辑','edit','small',`data-paper-id="${esc(p.id)}" data-id="${esc(s.id)}"`)}</div></div></article>`).join(''):'<div class="empty-small" style="padding:50px 10px">暂无投稿。点击“新增投稿”，为这篇论文添加第一条投稿记录。</div>'}`;
}

const journalKey = value => String(value||'').normalize('NFKC').toLowerCase().replace(/\s+/gu,'');
function matchingJournalRecords(p,journal,excludeId='') {
 const key=journalKey(journal);
 return key?(p?.submissions||[]).filter(s=>s.id!==excludeId&&journalKey(s.journal)===key):[];
}
function submissionHistory(p,sourceId='') {
 if(!p)return '<div class="notice green">请选择关联论文，随后可查看这篇论文的全部投稿历史。</div>';
 const records=p.submissions||[],journals=new Set(records.map(s=>journalKey(s.journal)).filter(Boolean));
 return `<details class="submission-history" open><summary><strong>这篇论文的投稿历史</strong><span>${journals.size} 个期刊 · ${records.length} 条记录</span></summary>
 <div class="submission-history-paper"><strong>${esc(p.title)}</strong><span>论文编号：${esc(p.code)}</span></div>
 ${records.length?`<div class="submission-history-list" tabindex="0" aria-label="该论文历次投稿记录">${[...records].reverse().map((s,index)=>`<article class="submission-history-item ${s.id===sourceId?'is-source':''}">
  <div class="submission-history-heading"><strong>${esc(s.journal||'期刊未填写')}</strong><div>${badge(s.status)}${s.id===p.activeSubmissionId?'<span class="history-tag">当前记录</span>':''}${s.id===sourceId?'<span class="history-tag source">本次改投来源</span>':''}</div></div>
  <p class="submission-history-title">第 ${records.length-index} 条 · 投稿题目：${esc(s.title||p.title)}</p>
  <dl class="submission-history-dates"><div><dt>投稿日期</dt><dd>${s.submittedAt?dateLabel(s.submittedAt):['草稿','待投稿'].includes(s.status)?'尚未投稿':'未填写'}</dd></div><div><dt>结束 / 录用日期</dt><dd>${dateLabel(s.endedAt)}</dd></div><div><dt>投稿时长</dt><dd>${daysLabel(s.durationDays)}</dd></div>${s.publishedAt?`<div><dt>发表日期</dt><dd>${dateLabel(s.publishedAt)}</dd></div>`:''}</dl>
  ${s.notes?`<p class="submission-history-notes">备注：${esc(s.notes)}</p>`:''}</article>`).join('')}</div>`:'<p class="submission-history-empty">暂无投稿历史，本次将建立第一条投稿记录。</p>'}</details>`;
}
function journalRepeatNotice(p,journal,excludeId='') {
 const matches=matchingJournalRecords(p,journal,excludeId);
 if(!matches.length)return '';
 return `<div class="notice">${icon('info')}<span>这篇论文已有 <strong>${matches.length} 条</strong>“${esc(String(journal).trim())}”的同名期刊记录：${[...matches].reverse().slice(0,3).map(s=>`${esc(s.status)}（${s.submittedAt?dateLabel(s.submittedAt):'尚未填写投稿日期'}）`).join('、')}${matches.length>3?'，其余记录见上方投稿历史':''}。请核对是否需要向同一期刊再次投稿，确认后可继续保存。</span></div>`;
}
function updateJournalNotice(journal) {
 const drawer=state.drawer;
 if(drawer?.kind!=='submission-edit')return;
 const notice=$('#journal-history-notice');
 if(notice)notice.innerHTML=journalRepeatNotice(drawer.paper||drawer.historyPaper,journal,drawer.submission?.id);
}
function openSubmissionEditor(p=null,s=null,{resubmit=false,source=null}={}) {
 const returnToDetails=state.drawer?.kind==='detail'&&state.drawer.paper?.id===p?.id;
 clearTimeout(credentialTimer);state.drawer={kind:'submission-edit',paper:p,submission:s,resubmit,sourceSubmission:source,returnToDetails,historyPaper:p};
 setOverlay(`<div class="overlay"><section class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><header class="drawer-head"><div><h2 id="drawer-title">${s?'编辑投稿记录':resubmit?'论文改投':'新建投稿'}</h2><p>每次投稿保留独立期刊、账号、日期和时长</p></div><button class="icon-btn" data-action="close" aria-label="关闭">${icon('close')}</button></header><form id="submission-form" style="display:contents"><div class="drawer-body"><div id="submission-history-root">${submissionHistory(p,source?.id)}</div><h3 class="section-heading">${icon('edit')}${resubmit?'填写本次改投':s?'编辑本次投稿':'填写本次投稿'}</h3><div class="form-grid"><div class="field full"><label for="submission-paper">关联论文 <em>*</em></label><select id="submission-paper" name="paperId" required ${p?'disabled':''}><option value="">请选择已有论文</option>${state.papers.map(x=>`<option value="${esc(x.id)}" ${x.id===p?.id?'selected':''}>${esc(x.title)} · ${esc(x.customer||'未关联客户')}</option>`).join('')}</select></div>${field('title','投稿题目',s?.title||(resubmit?source?.title:'')||p?.title,{required:true,full:true,max:300,hint:'可以与论文题目不同，系统仍通过论文编号保持关联'})}${field('journal','投稿期刊名称',s?.journal,{required:true,max:200})}${field('status','投稿状态',s?.status||'待投稿',{select:statuses})}<div id="journal-history-notice" class="field full" aria-live="polite">${journalRepeatNotice(p,s?.journal||'',s?.id)}</div>${field('submissionSystem','投稿系统',s?.submissionSystem,{max:200})}${field('submissionUrl','投稿网址',s?.submissionUrl,{type:'url',max:200})}${field('submissionAccount','投稿账号',s?.submissionAccount,{max:200})}${field('submissionPassword',s?.hasPassword?'更换投稿密码':'投稿密码','',{type:'password',max:500,placeholder:s?.hasPassword?'留空保留原密码':'填写投稿系统密码',hint:s?.hasPassword?'<label><input type="checkbox" name="clearPassword" style="width:auto;min-height:0"> 清除原密码</label>':'密码不会出现在列表或 CSV 导出中'})}${field('boundEmail','绑定邮箱',s?.boundEmail,{type:'email',max:200})}${field('boundPhone','绑定手机号',s?.boundPhone,{type:'tel',max:200})}${field('submittedAt','实际投稿日期',s?.submittedAt,{type:'date'})}${field('endedAt','结束 / 录用日期',s?.endedAt,{type:'date',hint:'录用、拒稿、撤稿时用于结束时长计算'})}${field('publishedAt','实际发表日期',s?.publishedAt,{type:'date',hint:'已发表且未填日期时默认今天'})}${field('notes','本次投稿备注',s?.notes,{textarea:true,full:true})}</div><div class="notice green" style="margin-top:19px">${icon('info')}${resubmit?`从“${esc(source?.journal||'原期刊')}”改投：保存后新增一次投稿，原期刊、状态、账号、日期与收支保留。请填写新的期刊及投稿资料。`:'新建投稿会作为当前投稿，之前的记录仍完整保留。编辑旧投稿不会覆盖其他期刊的账号信息。'}</div><div class="error-message" role="alert"></div></div><footer class="drawer-foot"><span class="panel-hint">关联论文，独立记录</span><div class="actions">${btn('cancel-submission','取消')}<button class="btn primary" type="submit">${icon('check')}${resubmit?'保存改投':'保存投稿'}</button></div></footer></form></section></div>`);
}

async function openCustomer(id) {
 const c=await api(`/api/customers/${encodeURIComponent(id)}`);clearTimeout(credentialTimer);state.drawer={kind:'customer-detail',customer:c};renderCustomerDetail();
}
function renderCustomerDetail() {
 const c=state.drawer.customer;
 setOverlay(`<div class="overlay"><section class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><header class="drawer-head"><div><h2 id="drawer-title">${esc(c.name)}</h2><p>客户信息 · ${esc(c.status)}</p></div><button class="icon-btn" data-action="close" aria-label="关闭">${icon('close')}</button></header><div class="drawer-body"><div class="detail-meta">${detailField('合作开始日期',c.cooperationStartedAt?dateLabel(c.cooperationStartedAt):'未记录')}${detailField('手机号',esc(c.phone))}${detailField('邮箱',esc(c.email))}${detailField('微信',esc(c.wechat))}${detailField('单位 / 机构',esc(c.organization))}${detailField('联系地址',esc(c.address),true)}</div><div class="money-grid"><div class="money-box"><label>约定服务费用 / 已收</label><strong>${yuan(c.contractCents)}</strong><small>已收 ${yuan(c.receivedCents)} · 待收 ${yuan(c.receivableCents)}</small></div><div class="money-box"><label>关联论文 / 已发表论文</label><strong>${c.paperCount} / ${c.publishedPaperCount}</strong><small>费用按论文汇总，改投不重复计费</small></div></div><h3 class="section-heading">${icon('checkCircle')}已发表期刊</h3><div class="journal-chips">${c.publishedJournals.length?c.publishedJournals.map(j=>`<span>${esc(j)}</span>`).join(''):'<span>暂无已发表期刊</span>'}</div><div class="panel-header" style="padding:25px 0 15px"><h3 class="panel-title">关联论文与发表成果</h3><div class="actions paper-create-actions">${btn('navigate','查看客户论文','document','small',`data-view="papers" data-customer-id="${esc(c.id)}"`)}</div></div><div class="customer-papers">${c.papers.length?c.papers.map(p=>`<article class="customer-paper"><button class="paper-title" data-action="detail" data-id="${esc(p.id)}">${esc(p.title)}</button><div class="customer-paper-meta">${serviceBadge(p)}${hasWriting(p)?writingBadge(p.writingStatus):''}${badge(p.status)}<span>${p.submissions.length} 次投稿</span></div><p>已发表期刊：${esc(p.publishedJournals.join('、')||'暂无')}</p><p>服务费用 ${yuan(p.contractCents)} · 已收 ${yuan(p.contractReceivedCents)} · 待收 ${yuan(p.receivableCents)}</p>${p.submissions.filter(s=>s.status==='已发表').map(s=>`<div class="publication-line">${icon('checkCircle')}<span>${esc(s.title)}<br>${esc(s.journal)} · ${s.publishedAt?dateLabel(s.publishedAt):'发表日期待补录'}</span></div>`).join('')}</article>`).join(''):'<div class="empty-small">暂无关联论文。新增论文时，选择这位客户即可。</div>'}</div><h3 class="section-heading" style="margin-top:25px">${icon('document')}客户备注</h3><div class="detail-note">${esc(c.notes||'暂无备注')}</div><div class="error-message" role="alert"></div></div><footer class="drawer-foot">${c.paperCount?'<span class="panel-hint">有论文的客户可归档保留</span>':btn('delete-customer','删除客户','trash','danger small')}<div class="actions">${btn('edit-customer','编辑客户','edit','primary')}</div></footer></section></div>`);
}
function openCustomerEditor(c=null) {
 clearTimeout(credentialTimer);state.drawer={kind:'customer-edit',customer:c};
 setOverlay(`<div class="overlay"><section class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><header class="drawer-head"><div><h2 id="drawer-title">${c?'编辑客户信息':'新建客户信息'}</h2><p>客户信息修改后，关联论文仍保持对应</p></div><button class="icon-btn" data-action="close" aria-label="关闭">${icon('close')}</button></header><form id="customer-form" style="display:contents"><div class="drawer-body"><div class="form-grid">${field('name','客户姓名',c?.name,{required:true,max:200})}${field('status','合作状态',c?.status||'合作中',{select:customerStatuses})}${field('cooperationStartedAt','合作开始日期',c?.cooperationStartedAt,{type:'date',minDate:'1000-01-01',maxDate:today(),full:true,hint:'记录实际开始合作的日期；尚未合作或日期不确定时可留空。'})}${field('phone','手机号',c?.phone,{type:'tel',max:200})}${field('email','邮箱',c?.email,{type:'email',max:200})}${field('wechat','微信',c?.wechat,{max:200})}${field('organization','单位 / 机构',c?.organization,{max:200})}${field('address','联系地址',c?.address,{full:true,max:300})}${field('notes','客户备注',c?.notes,{textarea:true,full:true})}</div><div class="error-message" role="alert"></div></div><footer class="drawer-foot"><span class="panel-hint">以独立客户编号关联业务</span><div class="actions">${btn('cancel-customer','取消')}<button class="btn primary" type="submit">${icon('check')}保存客户</button></div></footer></form></section></div>`);
}

function hideSubmissionCredentials() { for(const node of document.querySelectorAll?.('[data-secret-value]')||[])node.textContent='••••••••••';for(const button of document.querySelectorAll?.('[data-action="reveal-submission-password"]')||[]){button.innerHTML=`${icon('eye')}显示`;delete button.dataset.visible;} }
function isEditingDrawer() { return ['edit','transaction','customer-edit','submission-edit'].includes(state.drawer?.kind); }

function exportManagedPapers() {
 const list=filteredManagedPapers();if(!validDateRange()||!list.length)return toast('当前筛选下没有可导出的论文',true);
 const writingKeys=['writer','writingStatus','writingStartAt','writingDueAt','writingDeliveredAt'];
 const moneyKeys=['writerFeeCents','writerDepositCents','writerBalanceCents','outgoing_depositCents','outgoing_balanceCents','payableCents'];
 csvDownload(`论文档案-${today()}.csv`,[['论文编号','论文题目','服务类型','客户','作者','关联期刊','建档日期','服务费用（元）','写作人','写作状态','开始日期','预计交稿','实际交稿','稿酬（元）','约定定金（元）','约定尾款（元）','已付定金（元）','已付尾款（元）','未付稿酬（元）'],...list.map(p=>[p.code,p.title,serviceLabel(p),p.customer,p.authors,p.journal,paperCreatedDate(p),(p.contractCents||0)/100,...writingKeys.map(key=>hasWriting(p)?p[key]||'':''),...moneyKeys.map(key=>hasWriting(p)?(p[key]||0)/100:'')])]);toast(`已导出 ${list.length} 篇论文档案`);
}
function exportSubmissions() {
 const list=filteredSubmissions();if(!validDateRange()||!list.length)return toast('当前筛选下没有可导出的投稿',true);
 csvDownload(`投稿记录-${today()}.csv`,[['论文编号','论文题目','投稿题目','客户','期刊名称','投稿系统','投稿日期','结束日期','发表日期','投稿状态','投稿时长（天）'],...list.map(s=>[s.paper.code,s.paper.title,s.title,s.paper.customer,s.journal,s.submissionSystem,s.submittedAt,s.endedAt,s.publishedAt,s.status,s.durationDays??''])]);toast(`已导出 ${list.length} 次投稿`);
}
function exportCustomers() {
 const list=filteredCustomers();if(!list.length)return toast('当前筛选下没有可导出的客户',true);
 csvDownload(`客户汇总-${today()}.csv`,[['客户姓名','合作状态','合作开始日期','单位','关联论文数','已发表论文数','已发表期刊','约定服务费用（元）','已收款（元）','待收款（元）'],...list.map(c=>[c.name,c.status,c.cooperationStartedAt||'',c.organization,c.paperCount,c.publishedPaperCount,c.publishedJournals.join('、'),c.contractCents/100,c.receivedCents/100,c.receivableCents/100])]);toast(`已导出 ${list.length} 位客户`);
}

document.addEventListener('click',async event=>{
 const button=event.target.closest('[data-action]');if(!button||button.disabled)return;const action=button.dataset.action;
 const actions=['new-customer','customer-detail','edit-customer','cancel-customer','delete-customer','new-submission','resubmit-paper','edit-submission','cancel-submission','submission-detail','delete-submission','reveal-submission-password','export-managed-papers','export-submissions','export-customers'];
 if(!actions.includes(action))return;
 try{
  if(action==='new-customer')openCustomerEditor();
  else if(action==='customer-detail')await openCustomer(button.dataset.id);
  else if(action==='edit-customer')openCustomerEditor(state.drawer.customer);
  else if(action==='cancel-customer'){if(state.drawer.customer){state.drawer.kind='customer-detail';renderCustomerDetail();}else closeOverlay();}
  else if(action==='resubmit-paper'){
   button.disabled=true;
   const p=await api(`/api/papers/${encodeURIComponent(button.dataset.paperId)}`);
   const source=button.dataset.id?p.submissions.find(s=>s.id===button.dataset.id):p.submissions.find(s=>s.id===p.activeSubmissionId)||p.submissions.at(-1);
   if(!source)throw new Error('原投稿记录已不存在，请刷新列表');
   openSubmissionEditor(p,null,{resubmit:true,source});
  }
  else if(action==='new-submission'||action==='edit-submission'){
   if(!state.papers.length){navigateTo('papers');toast('请先在论文管理中新建论文，再登记投稿');return;}
   const p=button.dataset.paperId?await api(`/api/papers/${button.dataset.paperId}`):null;
   openSubmissionEditor(p,action==='edit-submission'?p.submissions.find(s=>s.id===button.dataset.id):null);
  }
  else if(action==='cancel-submission'){if(state.drawer.paper&&(!state.drawer.resubmit||state.drawer.returnToDetails)){state.drawer.kind='detail';state.drawer.tab='submissions';renderDetail();}else closeOverlay();}
  else if(action==='submission-detail') {
   await openDetail(button.dataset.paperId,'submissions');
   if(button.dataset.id)$(`#submission-${button.dataset.id}`)?.scrollIntoView({block:'start'});
  }
  else if(action==='delete-customer'){
   const c=state.drawer.customer;confirmModal('删除这位客户？',`确认删除客户“${c.name}”的基本资料？`,async()=>{await request('DELETE',`/api/customers/${c.id}`,{version:c.version});closeOverlay();await loadPapers();toast('客户已删除');},'确认删除',true);
  }
  else if(action==='delete-submission'){
   button.disabled=true;
   const inDetail=state.drawer?.kind==='detail'&&state.drawer.paper?.id===button.dataset.paperId;
   const p=inDetail?state.drawer.paper:await api(`/api/papers/${encodeURIComponent(button.dataset.paperId)}`);
   const s=p.submissions.find(s=>s.id===button.dataset.id);
   if(!s)throw new Error('这次投稿已不存在，请刷新列表');
   confirmModal('删除这次投稿？',`将删除“${s.journal}”的这次投稿和账号资料，论文、收支与其他投稿记录保留。`,async()=>{
    const saved=await request('DELETE',`/api/papers/${p.id}/submissions/${s.id}`,{version:s.version});
    state.papers=state.papers.map(paper=>paper.id===saved.id?saved:paper);
    if(inDetail){state.modal=null;state.drawer={kind:'detail',paper:saved,tab:'submissions'};renderDetail();}else closeOverlay();
    renderShell();toast('投稿记录已删除');
    try{await loadPapers();}catch(error){if(state.authenticated)toast(`投稿已删除，列表同步暂时失败，请点击刷新。${error.message}`,true);}
   },'确认删除',true);
  }
  else if(action==='reveal-submission-password'){
   if(button.dataset.visible==='true'){hideCredential();return;}hideCredential();button.disabled=true;
   const p=state.drawer.paper,id=button.dataset.id;const result=await request('POST',`/api/papers/${p.id}/submissions/${id}/credentials`);
   if(!button.isConnected)return;
   const value=document.querySelector(`[data-secret-value="${id}"]`);if(value)value.textContent=result.password;
   button.dataset.visible='true';button.innerHTML=`${icon('eye')}隐藏`;credentialTimer=setTimeout(hideCredential,30000);
  }
  else if(action==='export-managed-papers')exportManagedPapers();else if(action==='export-submissions')exportSubmissions();else if(action==='export-customers')exportCustomers();
 }catch(error){const field=$('.error-message',$('#overlay-root'));if(field)field.textContent=error.message;else toast(error.message,true);}finally{if(button.isConnected)button.disabled=false;}
});
document.addEventListener('change',event=>{
 if(event.target.id==='submission-paper'&&state.drawer?.kind==='submission-edit'){
  const p=state.papers.find(p=>p.id===event.target.value),input=$('#f-title',$('#overlay-root'));
  if(p&&input&&(!input.value||input.dataset.automatic==='true')){input.value=p.title;input.dataset.automatic='true';}
  else if(!p&&input?.dataset.automatic==='true'){input.value='';delete input.dataset.automatic;}
  state.drawer.historyPaper=p||null;
  const history=$('#submission-history-root');if(history)history.innerHTML=submissionHistory(p);
  updateJournalNotice($('#f-journal',$('#overlay-root'))?.value||'');
 }
 if(event.target.id==='f-journal')updateJournalNotice(event.target.value);
});

document.addEventListener('input',event=>{
 if(event.target.id==='f-title'&&state.drawer?.kind==='submission-edit')delete event.target.dataset.automatic;
 if(event.target.id==='f-journal')updateJournalNotice(event.target.value);
});

document.addEventListener('submit',async event=>{
 const form=event.target;if(!['customer-form','submission-form'].includes(form.id))return;
 event.preventDefault();const submit=$('[type=submit]',form);if(submit.disabled)return;const submitLabel=submit.innerHTML;submit.disabled=true;submit.innerHTML='保存中…';const error=$('.error-message',form);error.textContent='';
 try{
  const data=Object.fromEntries(new FormData(form));
  if(form.id==='customer-form'){
   const c=state.drawer.customer;if(c)data.version=c.version;
   const saved=await request(c?'PUT':'POST',c?`/api/customers/${c.id}`:'/api/customers',data);await finishSave(saved,'客户信息已保存',{customer:true,view:'customers'});
  }else{
   const p=state.drawer.paper||state.papers.find(p=>p.id===data.paperId),s=state.drawer.submission;
   if(!p)throw new Error('请选择关联论文');
   delete data.paperId;delete data.clearPassword;data.version=s?s.version:p.version;
   if(s){if(form.elements.clearPassword?.checked)data.submissionPassword='';else if(data.submissionPassword==='')delete data.submissionPassword;}
   const saved=await request(s?'PUT':'POST',`/api/papers/${p.id}/submissions${s?'/'+s.id:''}`,data);
   await finishSave(saved,state.drawer.resubmit?'论文改投已保存，原投稿记录已保留':'投稿记录已保存',{view:'submissions'});
  }
 }catch(failure){if(error.isConnected)error.textContent=failure.message;else toast(failure.message,true);}finally{if(submit.isConnected){submit.disabled=false;submit.innerHTML=submitLabel;}}
});
