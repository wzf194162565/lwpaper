'use strict';

const writingStatuses = ['待分配','写作中','待修改','已交稿','已完成','已取消'];
const customerStatuses = ['待合作','合作中','已归档'];
const customerTypes = ['同行','终端客户（自主开发）','他人介绍'];
const customerTypeLabel = c => c.customerType==='他人介绍'?'他人推荐':c.customerType||'未分类';
function customerTypeBadge(c) { const color={'同行':'blue','终端客户（自主开发）':'green','他人介绍':'violet'}[c.customerType]||'slate';return `<span class="badge ${color}">${esc(customerTypeLabel(c))}</span>`; }
const hasWriting = p => (p.serviceType || 'full') === 'full';
const serviceEnded = p => p?.serviceStatus==='terminated'||!!p?.termination;
const effectiveContract = p => p.settlementContractCents??p.contractCents??0;
const effectiveWriterFee = p => hasWriting(p)?p.settlementWriterFeeCents??p.writerFeeCents??0:0;
const publicationFeeLabels={pending:'版面费待确认',included:'我方承担版面费',free:'无版面费',author:'作者自理版面费'};
const publicationMode=p=>p?.publicationFeeMode||'pending';
const publicationTypes=['outgoing_publication','incoming_publication_refund'];
function publicationFeeFields(p) {
 const mode=publicationMode(p);
 return `<div class="form-section"><h3 class="section-heading">${icon('document')}版面费约定</h3><div class="form-grid">${field('publicationFeeMode','版面费承担方式',mode,{select:Object.keys(publicationFeeLabels),optionLabels:publicationFeeLabels,required:true,full:true,hint:'尚不清楚是否收费或金额时选待确认；我方承担时同时填写金额。改投新期刊时重新确认。'})}${field('publicationFeeAmount','我方承担版面费（元）',((p?.publicationFeeCents||0)/100).toFixed(2),{type:'number',full:true,min:0.01,required:mode==='included',hint:'我方承担的版面费包含在服务报价中，作者自理不包含在报价中。实际付款另行登记，不会自动生成流水。'})}</div></div>`;
}
function submissionPublicationFields(p,s=null,reset=false) {
 if(s){const a=publicationAccounts(p).find(a=>a.submissionId===s.id);return publicationFeeFields(a?costAccountTerms(a):p);}
 const reconfirm=reset||(!s&&p?.submissions?.length>0);
 return `${reconfirm?`<p class="panel-hint">原版面费约定：${publicationFeeLabels[publicationMode(p)]}${publicationMode(p)==='included'?' '+yuan(publicationTotal(p)):''}。请按新期刊重新选择，历史流水保留。</p>`:''}${publicationFeeFields(reconfirm?null:p)}`;
}
function updateSubmissionPublication(journal) {
 const drawer=state.drawer;if(drawer?.kind!=='submission-edit')return;
 const block=$('#submission-publication-fees');if(!block)return;
 const key=journalKey(journal);if(key===drawer.feeJournalKey)return;
 drawer.feeJournalKey=key;
 block.innerHTML=submissionPublicationFields(drawer.paper||drawer.historyPaper,drawer.submission,key!==journalKey(drawer.submission?.journal||''));
 const form=$('#submission-form');if(form)prepareForms($('#overlay-root'));
}
function updatePublicationFeeForm(form) {
 const mode=form.elements?.namedItem?.('publicationFeeMode'),amount=form.elements?.namedItem?.('publicationFeeAmount');
 if(!mode||!amount)return;
 const included=mode.value==='included';amount.disabled=!included;amount.required=included;const container=amount.closest?.('.field');if(container)container.hidden=!included;markRequired(amount);
}
function publicationFeeEditor(id='') { return ledgerPublicationEditor(id); }
function publicationFeeSummary(p,actions=true) { return ledgerPublicationSummary(p,actions); }
function profitSummary(p) {
 const known=p.profitEstimateKnown===true;
 return `<section class="profit-summary"><div class="profit-figures"><div><label>预计利润</label><strong>${known?yuan(p.estimatedProfitCents):'待核算'}</strong><small>${known?'按费用约定及已登记其他收支计算':'请先确认版面费'}</small></div><div><label>已结清利润</label><strong>${p.profitSettled?yuan(p.settledProfitCents):'待结清'}</strong><small>${p.profitSettled?'约定款项均已收付结清':'客户款、稿酬及版面费需全部结清'}</small></div><div><label>现金净额</label><strong>${yuan(p.netCents)}</strong><small>实际已收 − 实际已付</small></div></div><p class="payment-formula">${serviceEnded(p)?'最终结算收入':'服务报价'} ${yuan(effectiveContract(p))} − 写作稿酬 ${yuan(effectiveWriterFee(p))} − 我方版面费 ${known?yuan(publicationTotal(p)):'待确认'} − 其他支出 ${yuan(p.otherExpenseCents)} + 其他收入 ${yuan(p.otherIncomeCents)}</p><p class="panel-hint">写作定金与尾款合计为总稿酬；客户定金与尾款为分期收款，不另作成本扣除。</p></section>`;
}
function serviceEndBadge(p) { return serviceEnded(p)?`<span class="badge red">服务已终止</span><span class="badge ${p.settlementComplete?'green':'amber'}">${p.settlementComplete?'已结清':'待结算'}</span>`:''; }
const settlementTypes=['incoming_settlement','outgoing_refund','outgoing_settlement','incoming_writer_refund'];
function transactionTypeAllowed(p,type) {
 if(type==='outgoing_publication')return publicationAccounts(p).length?publicationAccounts(p).some(a=>a.payableCents>0):publicationMode(p)==='included';
 if(type==='incoming_publication_refund')return (p.publicationPaidCents||0)>0;
 if(!hasWriting(p)&&['outgoing_deposit','outgoing_balance','outgoing_settlement','incoming_writer_refund'].includes(type))return false;
 return serviceEnded(p)?settlementTypes.includes(type)||['incoming_other','outgoing_other'].includes(type):!settlementTypes.includes(type);
}
function settlementPaymentConfirmation() { return '<div class="field full payment-confirm"><label><input type="checkbox" name="confirmSettlementPayment" value="yes" required>确认这笔款项已经实际收付。</label></div>'; }
function paperCsvDownload(name,rows,papers) {
 const headers=['服务状态','终止日期','终止原因','客户最终结算（元）','稿酬最终结算（元）','客户净收（元）','稿酬净付（元）','待退款（元）','待追回稿酬（元）','结算状态','版面费承担方式','我方版面费成本（元）','版面费净付（元）','待付版面费（元）','待退回版面费（元）','预计利润（元）','已结清利润（元）','现金净额（元）'];
 csvDownload(name,rows.map((row,index)=>index===0?[...row,...headers]:[...row,...((p)=>[serviceEnded(p)?'服务已终止':'服务中',p.termination?.terminatedAt||'',p.termination?.reason||'',effectiveContract(p)/100,effectiveWriterFee(p)/100,(p.contractReceivedCents||0)/100,(p.writerPaidCents||0)/100,(p.refundableCents||0)/100,(p.recoverableCents||0)/100,serviceEnded(p)?p.settlementComplete?'已结清':'待结算':'',publicationFeeLabels[publicationMode(p)],publicationMode(p)==='pending'?'待确认':publicationTotal(p)/100,(p.publicationPaidCents||0)/100,(p.publicationPayableCents||0)/100,(p.publicationRefundableCents||0)/100,p.profitEstimateKnown?p.estimatedProfitCents/100:'待核算',p.profitSettled?p.settledProfitCents/100:'待结清',(p.netCents||0)/100])(papers[index-1])]));
}
function settlementRemaining(p,type) { return ({incoming_settlement:p.receivableCents,outgoing_refund:p.refundableCents,outgoing_settlement:p.payableCents,incoming_writer_refund:p.recoverableCents})[type]||0; }
function transactionRemaining(p,type) {
 if(type==='outgoing_publication')return (costAccount(p)?.payableCents??p.publicationPayableCents)||0;
 if(type==='incoming_publication_refund')return (costAccount(p)?.paidCents??p.publicationPaidCents)||0;
 if(settlementTypes.includes(type))return settlementRemaining(p,type);
 const customer=['incoming_deposit','incoming_balance'].includes(type),writer=['outgoing_deposit','outgoing_balance'].includes(type);
 if(!customer&&!writer)return null;
 const target=customer?p.contractCents:p.writerFeeCents,paid=customer?p.contractReceivedCents:p.writerPaidCents;
 const deposit=customer?p.contractDepositCents:p.writerDepositCents;
 let remaining=(target||0)-(paid||0);
 if(deposit>0){const installment=type.endsWith('_deposit')?deposit:(target||0)-deposit;remaining=Math.min(remaining,installment-(p.transactions||[]).filter(tx=>tx.type===type).reduce((total,tx)=>total+transactionAmount(tx),0));}
 return Math.max(0,remaining);
}
function settlementSummary(p,actions=true) {
 if(!serviceEnded(p))return '';
 const closure=p.termination||{};
 const action=(type,label)=>actions&&settlementRemaining(p,type)>0?btn('settlement-payment',label,'wallet','small',`data-type="${type}"`):'';
 return `<section class="termination-summary"><div class="panel-header"><h3 class="panel-title">服务已终止</h3><span class="badge ${p.settlementComplete?'green':'amber'}">${p.settlementComplete?'已结清':'待结算'}</span></div><p>${dateLabel(closure.terminatedAt)} · ${esc(closure.reason)}</p><div class="money-grid"><div class="money-box"><label>客户最终结算 / 实际净收</label><strong>${yuan(effectiveContract(p))} / ${yuan(p.contractReceivedCents)}</strong><small>原服务费 ${yuan(p.contractCents)} · 已退 ${yuan(p.customerRefundedCents)}</small><small>待收 ${yuan(p.receivableCents)} · 待退 ${yuan(p.refundableCents)}</small></div>${hasWriting(p)?`<div class="money-box"><label>写作者最终结算 / 实际净付</label><strong>${yuan(effectiveWriterFee(p))} / ${yuan(p.writerPaidCents)}</strong><small>原稿酬 ${yuan(p.writerFeeCents)} · 已退回 ${yuan(p.writerRefundedCents)}</small><small>待付 ${yuan(p.payableCents)} · 待追回 ${yuan(p.recoverableCents)}</small></div>`:''}</div><div class="actions">${action('incoming_settlement','登记客户补款')}${action('outgoing_refund','登记退款')}${action('outgoing_settlement','登记结算稿酬')}${action('incoming_writer_refund','登记退回稿酬')}${actions?btn('terminate-service','调整结算','edit','small'):''}</div><p class="panel-hint">投稿及写作保留终止前进度，常规跟进已停止。结算金额不代表款项已实际收付；版面费仍需在收支明细中确认并结清。</p></section>`;
}
function openTerminationForm(p=state.drawer.paper) {
 const previous=state.drawer,returnToSubmission=previous?.kind==='submission-edit'?{drawer:previous,nodes:[...$('#overlay-root').childNodes]}:null;
 clearTimeout(credentialTimer);state.drawer={kind:'termination',paper:p,returnToSubmission};
 const closed=serviceEnded(p),closure=p.termination||{};
 setOverlay(`<div class="overlay"><section class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><header class="drawer-head"><div><h2 id="drawer-title">${closed?'调整终止结算':'终止服务'}</h2><p>${esc(p.title)} · ${esc(p.code)}</p></div><button class="icon-btn" data-action="close" aria-label="关闭">${icon('close')}</button></header><form id="termination-form" novalidate style="display:contents"><div class="drawer-body"><div class="notice green">${icon('info')}终止整篇论文的服务（含全部投稿），停止常规写作、投稿推进与跟进提醒。稿件、投稿状态、原费用约定及实际流水保留。</div><div class="termination-current"><p>原服务费用 ${yuan(p.contractCents)} · 已净收客户款 ${yuan(p.contractReceivedCents)}</p><p>${hasWriting(p)?`原稿酬 ${yuan(p.writerFeeCents)} · 已净付稿酬 ${yuan(p.writerPaidCents)}`:'半包论文，无写作稿酬'}</p></div><div class="form-grid">${field('terminatedAt','终止日期',closure.terminatedAt||today(),{type:'date',required:true,maxDate:today(),minDate:p.createdAt?.slice(0,10)})}${field('terminationReason','终止原因',closure.reason||'',{textarea:true,full:true,required:true,max:1000,placeholder:'例如：客户爽约，双方确认终止本篇论文服务。'})}${field('customerSettlement','客户最终结算金额（元）',((closure.customerCents??p.contractReceivedCents??0)/100).toFixed(2),{type:'number',required:true,hint:'最终应保留的客户款项。填写 0 表示全部退回；低于已净收金额时产生待退款，高于时产生待补款。'})}${hasWriting(p)?field('writerSettlement','写作者最终结算金额（元）',((closure.writerCents??p.writerPaidCents??0)/100).toFixed(2),{type:'number',required:true,hint:'与写作者确认的最终稿酬，低于已净付时产生待追回金额，高于时产生待付款。'}):'<input type="hidden" name="writerSettlement" value="0">'}<div class="field full payment-confirm"><label><input type="checkbox" name="confirmTermination" value="yes" required>确认以上终止原因与最终结算金额。实际退款、补款另行登记。</label></div></div></div><footer class="drawer-foot">${formFeedback()}<div class="actions">${btn('cancel-termination',returnToSubmission?'返回投稿':'返回')}<button type="submit" class="btn ${closed?'primary':'danger'}">${closed?'保存结算':'确认终止服务'}</button></div></footer></form></section></div>`);
}
function cancelTermination() {
 overlayRevision++;
 const previous=state.drawer.returnToSubmission;
 if(previous){state.drawer=previous.drawer;$('#overlay-root').replaceChildren(...previous.nodes);$('#f-status',$('#overlay-root'))?.focus();return;}
 state.drawer.kind='detail';state.drawer.tab='basic';renderDetail();
}
const serviceLabel = p => hasWriting(p) ? '全包 · 含论文写作' : '半包 · 客户供稿';
function serviceBadge(p) { return `<span class="badge ${hasWriting(p)?'green':'blue'}">${serviceLabel(p)}</span>${serviceEndBadge(p)}`; }
function newPaperActions(customerId=state.customerId,classes='') {
 const extra=customerId?`data-customer-id="${esc(customerId)}"`:'';
 return btn('new-paper','新增（半包）','document',`${classes} primary`,`${extra} title="半包：客户提供文章，管理投稿与收支"`)+btn('new-writing','新增（全包）','edit',`${classes} primary`,`${extra} title="全包：包含写作、投稿与收支"`);
}
const writingFinished = p => serviceEnded(p)||['已交稿','已完成','已取消'].includes(p.writingStatus);
function writingBadge(status) { const colors={'待分配':'slate','写作中':'blue','待修改':'amber','已交稿':'green','已完成':'green','已取消':'violet'};return `<span class="badge ${colors[status]||'slate'}">${esc(status||'待分配')}</span>`; }
function businessTabs(items) { return `<div class="tab-bar" role="tablist">${items.map(([id,label,count])=>`<button class="tab ${state.tab===id?'active':''}" data-action="tab" data-tab="${id}" role="tab" aria-selected="${state.tab===id}">${label}${count===undefined?'':`<span class="count">${count}</span>`}</button>`).join('')}</div>`; }
function customerOptions(selected='',empty='全部客户') { return `<option value="">${empty}</option>${state.customers.map(c=>`<option value="${esc(c.id)}" ${selected===c.id?'selected':''}>${esc(c.name)} · ${esc(customerTypeLabel(c))}${c.phone?' · '+esc(c.phone):''}</option>`).join('')}`; }
function businessFilters(placeholder,statusOptions,dateText='',statusLabel='全部状态') { return `<div class="filter-row business-filter-row"><div class="search-box">${icon('search')}<input id="search" type="search" aria-label="搜索记录" value="${esc(state.search)}" placeholder="${placeholder}"></div><select id="status-filter" aria-label="${esc(statusLabel)}"><option value="">${esc(statusLabel)}</option>${statusOptions.map(s=>`<option ${state.status===s?'selected':''}>${esc(s)}</option>`).join('')}</select>${state.view==='customers'?'':`<select id="customer-filter" aria-label="客户筛选">${customerOptions(state.customerId)}</select>`}${dateText?`<span class="filter-label">${dateText}</span><input class="date-filter" id="from-filter" type="date" aria-label="起始日期" value="${esc(state.from)}"><input class="date-filter" id="to-filter" type="date" aria-label="截止日期" value="${esc(state.to)}">`:''}${btn('clear-filters','重置')}</div>`; }
function customerLink(p) { return p.customerId?`<button class="text-btn customer-link" data-action="customer-detail" data-id="${esc(p.customerId)}">${esc(p.customer)}</button>`:esc(p.customer||'未关联客户'); }
function daysLabel(days) { return days===null||days===undefined?'未计算':`${days} 天`; }
function authorNames(byline='') {
 const names=new Map();
 for(const part of String(byline||'').split(/[、,，;；\r\n]+/)){
  const name=part.normalize('NFKC').replace(/[\s\p{Z}]+/gu,' ').trim(),key=name.toLowerCase();
  if(name&&!names.has(key))names.set(key,name);
 }
 return [...names.values()];
}
function linkedAuthors(papers) {
 const authors=new Map();
 for(const paper of papers)for(const name of authorNames(paper.authors)){
  const key=name.toLowerCase(),author=authors.get(key)||{name,paperCount:0};author.paperCount++;authors.set(key,author);
 }
 return [...authors.values()].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
}
function paperAuthorByline(paper) {
 const names=authorNames(paper.authors);
 if(names.length>3)return `<details class="paper-authors"><summary>作者：${esc(names.slice(0,3).join('、'))} 等 ${names.length} 位</summary><p>${esc(names.join('、'))}</p></details>`;
 return `<p>${names.length>1?'共同作者':'作者'}：${esc(names.join('、')||'未填写作者')}</p>`;
}
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
  if(state.tab==='terminated'&&!serviceEnded(p))return false;
  const full=hasWriting(p);
  if(state.tab==='full'&&!full||state.tab==='half'&&full)return false;
  if(state.tab==='active'&&(!full||writingFinished(p)))return false;
  if(state.tab==='overdue'&&(serviceEnded(p)||!full||!p.writingOverdue))return false;
  if(state.tab==='payable'&&(!full||!(p.payableCents>0)))return false;
  if(state.tab==='finished'&&(!full||!writingFinished(p)))return false;
  return (!state.status||(full&&p.writingStatus===state.status))&&(!state.customerId||p.customerId===state.customerId)&&filterDate(paperCreatedDate(p))&&searchText([p.title,p.code,full?p.writer:'',p.customer,p.authors,p.journal,p.followUpReason,p.notes]);
 }).sort((a,b)=>Number(hasWriting(b)&&b.writingOverdue)-Number(hasWriting(a)&&a.writingOverdue)||String(hasWriting(a)&&a.writingDueAt||'9999').localeCompare(String(hasWriting(b)&&b.writingDueAt||'9999'))||String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
}
function renderPaperManagement() {
 const papers=state.papers,full=papers.filter(hasWriting),active=full.filter(p=>!writingFinished(p)),overdue=full.filter(p=>!serviceEnded(p)&&p.writingOverdue);
 $('#content').innerHTML=`${pageHeading('论文管理','统一管理全包与半包论文，关联客户、写作安排、服务费用和投稿。',btn('export-managed-papers','导出论文档案','down')+newPaperActions())}
 <div class="stats-grid paper-summary">${stat('论文总数',papers.length,'document',`全包 <strong>${full.length} 篇</strong> · 半包 <strong>${papers.length-full.length} 篇</strong>`,'','篇')}${stat('写作进行中',active.length,'edit',`<span>已交稿 / 完成 <strong>${full.filter(p=>['已交稿','已完成'].includes(p.writingStatus)).length} 篇</strong></span><span>逾期未交 <strong>${overdue.length} 篇</strong></span>`,'blue','篇')}${stat('待收服务费',yuan(sum(papers,'receivableCents')),'arrowDown',`<span>应收总额 <strong>${yuan(papers.reduce((total,p)=>total+effectiveContract(p),0))}</strong></span><span>已收定金 <strong>${yuan(papers.reduce((total,p)=>total+customerReceiptTotals(p).deposit,0))}</strong> · 已收尾款 <strong>${yuan(papers.reduce((total,p)=>total+customerReceiptTotals(p).balance,0))}</strong></span>`,'gold','',true)}${stat('待付写作稿酬',yuan(sum(full,'payableCents')),'wallet',`约定稿酬 <strong>${yuan(papers.reduce((total,p)=>total+effectiveWriterFee(p),0))}</strong>`,'purple','',true)}</div>
 <section class="panel"><div class="panel-header"><h2 class="panel-title">论文档案 <small>PAPER MANAGEMENT</small></h2><span class="panel-hint">全包安排写作，半包由客户供稿</span></div>
 ${businessTabs([['all','全部论文',papers.length],['terminated','服务已终止',papers.filter(serviceEnded).length],['full','全包论文',full.length],['half','半包论文',papers.length-full.length],['active','写作进行中',active.length],['overdue','逾期未交',overdue.length],['payable','待付稿酬',full.filter(p=>p.payableCents>0).length],['finished','已交稿 / 结束',full.filter(writingFinished).length]])}
 ${businessFilters('搜索论文题目、编号、客户、写作人或期刊…',writingStatuses,'论文建档日期','全部写作状态')}<div id="results"></div></section>${footer()}`;
 renderManagedPaperResults();
}
function writingProgressBadge(p) { return serviceEnded(p)?'<span class="badge slate">写作已终止</span>':writingBadge(p.writingStatus); }
function terminatedWritingSummary(p) { return `<div class="paper-writing-person">${writingProgressBadge(p)}</div><div class="cell-sub">终止前状态：${esc(p.writingStatus||'未安排')}</div><div class="cell-sub">终止前写作人：${esc(p.writer||'未分配')}</div><div class="cell-sub">终止日期 ${dateLabel(p.termination?.terminatedAt)}</div>`; }
function managedPaperRow(p,index) {
 const full=hasWriting(p);
 return `<tr>${sequenceCell(index)}<td class="paper-cell" data-label="论文题目 / 编号"><button class="paper-title" data-action="detail" data-id="${esc(p.id)}">${esc(p.title)}</button><div class="paper-meta"><span>${esc(p.code)}</span><span>建档 ${dateLabel(paperCreatedDate(p))}</span></div><div class="cell-sub">${serviceBadge(p)}</div>${manuscriptShortcut(p)}</td>
 <td data-label="客户 / 作者">${customerLink(p)}<div class="cell-sub">${esc(p.authors||'未填写作者')}</div></td>
 <td data-label="关联期刊"><div class="journal-name" title="${esc(p.journal||'暂未关联期刊')}">${esc(p.journal||'暂未关联期刊')}</div><div class="cell-sub">${p.submissions?.length?`${badge(p.status)} <span>${p.submissions.length} 次投稿</span>`:'可先关联期刊，稍后补充投稿资料'}</div></td>
 <td data-label="写作安排 / 进度">${full&&serviceEnded(p)?terminatedWritingSummary(p):full?`<div class="paper-writing-person"><span>${esc(p.writer||'尚未分配')}</span>${writingProgressBadge(p)}</div><div class="cell-sub paper-writing-dates"><div><span>开始</span> <span class="paper-date">${dateLabel(p.writingStartAt)}</span></div><div class="${p.writingOverdue?'due-date':''}"><span>预计交稿</span> <span class="paper-date">${dateLabel(p.writingDueAt)}</span>${p.writingOverdue?' <span>已逾期</span>':''}</div><div><span>实际交稿</span> <span class="paper-date">${dateLabel(p.writingDeliveredAt)}</span></div><div>写作时长 ${daysLabel(p.writingDays)}</div></div>`:'客户供稿<div class="cell-sub">无需安排写作</div>'}</td>
 <td class="paper-costs" data-label="服务费用"><div class="paper-amount"><span>服务费</span> <strong>${yuan(p.contractCents)}</strong></div><div class="cell-sub paper-terms"><span>约定收款定金 ${yuan(p.contractDepositCents)}</span></div><div class="paper-fee-block">${customerReceiptsCell(p)}</div></td>
 <td class="paper-payments" data-label="写作费用">${full?`<div class="paper-amount"><span>约定总稿酬</span> <strong>${yuan(p.writerFeeCents)}</strong></div><div class="cell-sub paper-terms"><span>约定写作定金 ${yuan(p.writerDepositCents)}</span><span>约定尾款 ${yuan(p.writerBalanceCents)}</span></div><div class="paper-fee-block">${writingPaymentsCell(p)}</div>`:'<span class="panel-hint">无需写作稿酬</span>'}</td>
 <td class="paper-actions-cell" data-label="操作"><div class="paper-row-actions" role="group" aria-label="论文操作">${serviceEnded(p)?`<button class="text-btn" data-action="detail" data-id="${esc(p.id)}">${icon('eye')}详情</button><button class="text-btn" data-action="detail-finance" data-id="${esc(p.id)}">${icon('wallet')}结算</button>`:`<button class="text-btn" data-action="edit-paper" data-id="${esc(p.id)}">${icon('edit')}编辑</button><button class="text-btn" data-action="detail-finance" data-id="${esc(p.id)}">${icon('wallet')}收支</button><button class="text-btn" data-action="${p.submissions?.length?'resubmit-paper':'new-submission'}" data-paper-id="${esc(p.id)}">${icon(p.submissions?.length?'refresh':'link')}${p.submissions?.length?'改投':'关联期刊'}</button>`}${`<button class="text-btn paper-delete" data-action="delete-paper" data-id="${esc(p.id)}">${icon('trash')}删除</button>`}</div></td></tr>`;
}
function renderManagedPaperResults() {
 if(!validDateRange()){$('#results').innerHTML='<div class="empty-state"><h3>起始日期不能晚于截止日期</h3></div>';return;}
 const papers=filteredManagedPapers(),paging=pagination(papers.length);
 const category={terminated:'服务已终止',all:'全部论文',full:'全包论文',half:'半包论文',active:'写作进行中',overdue:'逾期未交',payable:'待付稿酬',finished:'已交稿 / 结束'}[state.tab]||'全部论文';
 const summary=`<div class="results-note">${category} · 当前筛选 ${papers.length} 篇${state.tab==='payable'?` · 待付写作稿酬 ${yuan(sum(papers,'payableCents'))}`:''}</div>`;
 $('#results').innerHTML=papers.length?`${summary}<div class="table-scroll"><table class="managed-paper-table"><thead><tr><th class="sequence-cell" scope="col">序号</th><th scope="col">论文题目 / 编号</th><th scope="col">客户 / 作者</th><th scope="col">关联期刊</th><th scope="col">写作安排 / 进度</th><th scope="col">服务费用</th><th scope="col">写作费用</th><th scope="col">操作</th></tr></thead><tbody>${papers.slice((state.page-1)*state.pageSize,state.page*state.pageSize).map(managedPaperRow).join('')}</tbody></table></div>${paging}`:state.papers.length?`<div class="empty-state"><h3>没有符合条件的论文</h3><p>试试其他关键词、服务类型或写作状态，或重置筛选条件。</p>${btn('clear-filters','重置筛选','refresh')}</div>`:`<div class="empty-state"><div class="empty-illustration">${icon('document')}</div><h3>还没有论文档案</h3><p>使用页面右上方的新增入口，选择全包或半包，建立论文并关联客户。</p></div>`;
}

function allSubmissions() { return state.papers.flatMap(p=>(p.submissions||[]).map(s=>({...s,paper:p,current:p.activeSubmissionId===s.id}))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)); }
function currentSubmissions() {
 return state.papers.flatMap(p=>{
  const submissions=p.submissions||[];
  const current=submissions.find(s=>s.id===p.activeSubmissionId)||[...submissions].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))[0];
  return current?[{...current,paper:p,current:true}]:[];
 }).sort((a,b)=>String(b.paper.createdAt||'').localeCompare(String(a.paper.createdAt||'')));
}
function submissionActive(s) { return !serviceEnded(s.paper)&&['已投稿','审稿中','修改中'].includes(s.status); }
function submissionFinished(s) { return serviceEnded(s.paper)||['已录用','已发表','已拒稿','已撤稿'].includes(s.status); }
function submissionStatusBadge(s) { return serviceEnded(s.paper)?`${serviceEndBadge(s.paper)}<div class="cell-sub">终止前：${badge(s.status)}</div>`:badge(s.status); }
function filteredSubmissions() {
 return currentSubmissions().filter(s=>{
  if(state.tab==='active'&&!submissionActive(s))return false;
  if(state.tab==='finished'&&!submissionFinished(s))return false;
  if(state.tab==='terminated'&&!serviceEnded(s.paper))return false;
  if(state.tab==='long'&&(!submissionActive(s)||s.durationDays<30))return false;
  return (state.status==='服务已终止'?serviceEnded(s.paper):!state.status||s.status===state.status)&&(!state.customerId||s.paper.customerId===state.customerId)&&filterDate(s.submittedAt)&&searchText([s.title,s.paper.title,s.paper.code,s.paper.customer,s.journal,s.submissionSystem,s.submissionAccount,s.boundEmail,s.boundPhone,s.notes]);
 });
}
function renderSubmissions() {
 const subs=currentSubmissions();
 $('#content').innerHTML=`${pageHeading('投稿管理','每篇论文显示一条当前投稿，历史投稿可在详情中查看。',btn('export-submissions','导出投稿记录','down')+btn('new-submission','新增','plus','primary'))}<div class="stats-grid">${stat('投稿论文总数',subs.length,'document',`关联 <strong>${state.papers.filter(p=>p.submissions?.length).length} 篇论文</strong>`,'','篇')}${stat('审稿 / 修改中',subs.filter(submissionActive).length,'clock','自动计算从投稿日起的时长','blue','篇')}${stat('已录用 / 发表',subs.filter(s=>['已录用','已发表'].includes(s.status)).length,'checkCircle',`已发表 <strong>${subs.filter(s=>s.status==='已发表').length} 篇</strong>`,'gold','篇')}${stat('已投稿满 30 天',subs.filter(s=>submissionActive(s)&&s.durationDays>=30).length,'calendar','仅统计尚在投稿流程中的记录','purple','篇')}</div><section class="panel"><div class="panel-header"><h2 class="panel-title">投稿记录 <small>SUBMISSION TRACKING</small></h2><span class="panel-hint">每篇论文仅统计一次，改投历史保留在详情中</span></div>${businessTabs([['all','全部投稿',subs.length],['active','进行中',subs.filter(submissionActive).length],['long','满 30 天',subs.filter(s=>submissionActive(s)&&s.durationDays>=30).length],['finished','已结束',subs.filter(submissionFinished).length],['terminated','服务已终止',subs.filter(s=>serviceEnded(s.paper)).length]])}${businessFilters('搜索题目、期刊、客户、账号、邮箱或手机号…',[...statuses,'服务已终止'],'投稿日期')}<div id="results"></div></section><div class="notice green" style="margin-top:20px">${icon('info')}<span>投稿时长从实际投稿日期计算至结束/录用日期；尚未结束则计算到今天。旧记录缺少结束日期时显示“未计算”，可编辑补录。列表、统计和导出均按论文去重，状态以当前投稿为准；历次投稿记录保留在详情中。</span></div>${footer()}`;renderSubmissionResults();
}
function submissionActions(s) {
 if(serviceEnded(s.paper))return `<button class="text-btn" data-action="submission-detail" data-paper-id="${esc(s.paper.id)}" data-id="${esc(s.id)}">${icon('eye')}详情</button>`;
 const ids=`data-paper-id="${esc(s.paper.id)}" data-id="${esc(s.id)}"`;
 return `<div class="submission-row-actions" role="group" aria-label="投稿操作"><button class="text-btn" data-action="edit-submission" ${ids}>${icon('edit')}编辑</button><button class="text-btn" data-action="resubmit-paper" ${ids}>${icon('refresh')}改投</button><button class="text-btn submission-delete" data-action="delete-submission" ${ids}>${icon('trash')}删除</button><button class="text-btn" data-action="submission-detail" ${ids}>${icon('eye')}详情</button></div>`;
}
function renderSubmissionResults() {
 if(!validDateRange()){$('#results').innerHTML='<div class="empty-state"><h3>起始日期不能晚于截止日期</h3></div>';return;}
 const subs=filteredSubmissions(),paging=pagination(subs.length);
 $('#results').innerHTML=subs.length?`<div class="table-scroll"><table><thead><tr><th class="sequence-cell" scope="col">序号</th><th>投稿题目 / 关联文章</th><th>客户 / 投稿期刊</th><th>投稿系统 / 账号</th><th>绑定邮箱 / 手机</th><th>投稿日期 / 时长</th><th>状态 / 发表日期</th><th>操作</th></tr></thead><tbody>${subs.slice((state.page-1)*state.pageSize,state.page*state.pageSize).map((s,index)=>`<tr>${sequenceCell(index)}<td class="paper-cell"><button class="paper-title" data-action="submission-detail" data-paper-id="${esc(s.paper.id)}" data-id="${esc(s.id)}">${esc(s.title)}</button><div class="paper-meta">${esc(s.paper.code)} · ${s.current?'当前投稿':'历史投稿'}</div>${s.title!==s.paper.title?`<div class="cell-sub">论文题目：${esc(s.paper.title)}</div>`:''}</td><td>${customerLink(s.paper)}<div class="cell-sub">${esc(s.journal)}</div></td><td>${esc(s.submissionSystem||'—')}<div class="cell-sub">${esc(s.submissionAccount||'未填写账号')}</div></td><td>${esc(s.boundEmail||'—')}<div class="cell-sub">${esc(s.boundPhone||'—')}</div></td><td>${dateLabel(s.submittedAt)}<div class="cell-sub ${submissionActive(s)&&s.durationDays>=30?'due-date':''}">${daysLabel(s.durationDays)}</div></td><td>${submissionStatusBadge(s)}<div class="cell-sub">${s.expectedPublishedAt?'预计 '+dateLabel(s.expectedPublishedAt):s.publishedAt?dateLabel(s.publishedAt):'尚未安排'}</div></td><td>${submissionActions(s)}</td></tr>`).join('')}</tbody></table></div>${paging}`:!state.papers.length?businessEmpty('document','尚无可投稿的论文','请先在论文管理中建立论文档案，再登记投稿。','navigate','前往论文管理','data-view="papers"'):businessEmpty('document','暂无符合条件的投稿记录','选择已有论文，登记其期刊、投稿账号和投稿时间。','new-submission','新增');
}

function filteredCustomers() { return state.customers.filter(c=>(!customerTypes.includes(state.tab)||c.customerType===state.tab)&&(state.tab!=='unclassified'||!c.customerType)&&(!state.status||c.status===state.status)&&searchText([c.name,customerTypeLabel(c),c.referrer,c.phone,c.email,c.wechat,c.organization,c.notes])); }
function renderCustomers() {
 const c=state.customers;
 $('#content').innerHTML=`${pageHeading('客户管理','区分同行、自主开发终端客户与他人推荐，关联论文和费用往来。',btn('export-customers','导出客户汇总','down')+btn('new-customer','新增','plus','primary'))}<div class="stats-grid">${stat('客户总数',c.length,'users',`合作中 <strong>${c.filter(x=>x.status==='合作中').length} 位</strong>`,'','位')}${stat('关联论文',sum(c,'paperCount'),'document',`已发表 <strong>${sum(c,'publishedPaperCount')} 篇</strong>`,'blue','篇')}${stat('约定服务费用',yuan(sum(c,'contractCents')),'wallet','按论文汇总，多次投稿不重复计费','gold','',true)}${stat('客户待付款',yuan(sum(c,'receivableCents')),'clock',`已收定金及尾款 <strong>${yuan(sum(c,'receivedCents'))}</strong>${sum(c,'refundableCents')?` · 待退款 ${yuan(sum(c,'refundableCents'))}`:''}`,'purple','',true)}</div><section class="panel"><div class="panel-header"><h2 class="panel-title">客户信息 <small>CUSTOMER RELATIONSHIPS</small></h2><span class="panel-hint">同名客户可分别建档，以编号区分</span></div>${businessTabs([['all','全部客户',c.length],...customerTypes.map(type=>[type,customerTypeLabel({customerType:type}),c.filter(x=>x.customerType===type).length]),['unclassified','未分类',c.filter(x=>!x.customerType).length]])}${businessFilters('搜索客户姓名、类型、介绍人、手机号或单位…',customerStatuses)}<div id="results"></div></section>${footer()}`;renderCustomerResults();
}
function renderCustomerResults() {
 const clients=filteredCustomers(),paging=pagination(clients.length);
 const rows=clients.slice((state.page-1)*state.pageSize,state.page*state.pageSize).map((c,index)=>`<tr>${sequenceCell(index)}
  <td><button class="paper-title" data-action="customer-detail" data-id="${esc(c.id)}">${esc(c.name)}</button><div class="cell-sub">${customerTypeBadge(c)}</div><div class="cell-sub">${esc(c.status)}${c.referrer?` · 介绍人：${esc(c.referrer)}`:''}</div></td>
  <td>${c.paperCount?`<button class="text-btn" data-action="customer-papers" data-id="${esc(c.id)}" aria-label="查看${esc(c.name)}的 ${c.paperCount} 篇论文">${c.paperCount} 篇论文${icon('chevron')}</button>`:'<span class="panel-hint">暂无论文</span>'}<div class="cell-sub">已发表 ${c.publishedPaperCount} 篇</div></td>
  <td>${esc(c.phone||'—')}<div class="cell-sub">${esc(c.email||'—')}</div></td><td>${esc(c.organization||'—')}<div class="cell-sub">${esc(c.wechat||'—')}</div></td><td>${c.cooperationStartedAt?dateLabel(c.cooperationStartedAt):'未记录'}</td>
  <td><div class="journal-name" title="${esc(c.publishedJournals.join('、'))}">${esc(c.publishedJournals.join('、')||'暂无发表')}</div></td>
  <td class="cell-money">${yuan(c.contractCents)}<div class="cell-sub">已收 ${yuan(c.receivedCents)}</div></td><td class="cell-money">${yuan(c.receivableCents)}${c.refundableCents?`<div class="cell-sub">待退款 ${yuan(c.refundableCents)}</div>`:''}</td><td><button class="text-btn" data-action="customer-detail" data-id="${esc(c.id)}">${icon('eye')}详情</button></td></tr>`).join('');
 $('#results').innerHTML=clients.length?`<div class="table-scroll"><table><thead><tr><th class="sequence-cell" scope="col">序号</th><th>客户姓名 / 类型</th><th>关联论文</th><th>联系方式</th><th>单位 / 微信</th><th>合作开始日期</th><th>已发表期刊</th><th>服务费用 / 已收</th><th>待收款</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>${paging}`:businessEmpty('users','还没有符合条件的客户','建立客户信息后，可以在全包或半包论文中选择并关联客户。','new-customer','新增');
}

function openWritingEditor(p=null,customerId='') { openPaperEditor(p,p?.serviceType||'full',customerId); }
function moneyCents(value) {
 const match=String(value??'').trim().match(/^(\d*)(?:\.(\d{0,2}))?$/);
 return match?(Number(match[1]||0)*100+Number((match[2]||'').padEnd(2,'0'))):NaN;
}
function customerReceiptTotals(p) {
 const sum=type=>(p.transactions||[]).filter(tx=>tx.type===type).reduce((total,tx)=>total+transactionAmount(tx),0);
 return {deposit:sum('incoming_deposit'),balance:sum('incoming_balance'),pending:p.receivableCents??Math.max(0,effectiveContract(p)-(p.contractReceivedCents||0))};
}
function customerReceiptActions(p) {
 if(serviceEnded(p))return '';
 const extra=`data-id="${esc(p.id)}"`;
 return `<div class="actions writing-payment-actions">${transactionRemaining(p,'incoming_deposit')>0?btn('customer-payment','登记收款定金','wallet','small',`${extra} data-type="incoming_deposit"`):''}${transactionRemaining(p,'incoming_balance')>0?btn('customer-payment','登记收款尾款','wallet','small',`${extra} data-type="incoming_balance"`):''}</div>`;
}
function customerReceiptsCell(p) {
 const t=customerReceiptTotals(p);
 return `<div class="paper-payment-list"><div><span>已收定金</span> <span class="paper-amount-value">${yuan(t.deposit)}</span></div><div><span>已收尾款</span> <span class="paper-amount-value">${yuan(t.balance)}</span></div><div class="cell-money"><span>待收尾款</span> <span class="paper-amount-value">${yuan(t.pending)}</span></div></div>${customerReceiptActions(p)}`;
}
function customerReceiptSummary(p) {
 if(serviceEnded(p))return '';
 return `<section class="writing-payment-summary"><div class="panel-header"><h3 class="panel-title">客户 / 作者收款</h3></div>${customerReceiptsCell(p)}<p class="panel-hint">仅登记已经实际收到的款项；约定定金不代表已收款，写作付款单独记录。</p></section>`;
}
function writingPaymentTotals(p={}) {
 p=p||{};
 const fee=p.writerFeeCents||0,deposit=p.writerDepositCents||0,paidDeposit=p.outgoing_depositCents||0,paidBalance=p.outgoing_balanceCents||0;
 return {fee,deposit,balance:fee-deposit,paidDeposit,paidBalance,remainingDeposit:Math.max(0,deposit-paidDeposit),remainingBalance:Math.max(0,fee-deposit-paidBalance),pending:Math.max(0,fee-paidDeposit-paidBalance)};
}
function writingPaymentFormula(totals) { return `${yuan(totals.fee)} − 已付定金 ${yuan(totals.paidDeposit)} − 已付尾款 ${yuan(totals.paidBalance)} = ${yuan(totals.pending)}`; }
function writingPaymentStatus(totals) {
 const paid=totals.paidDeposit+totals.paidBalance;
 return paid>totals.fee?'已付超过约定':totals.fee===0?'暂无稿酬约定':totals.pending===0?'已付清':paid?'部分已付':'尚未付款';
}
function writingPaymentActions(p) {
 if(!hasWriting(p))return '';
 const t=writingPaymentTotals(p),extra=`data-id="${esc(p.id)}"`;
 return `<div class="actions writing-payment-actions">${t.remainingDeposit&&t.pending?btn('writer-payment','登记定金','wallet','small',`${extra} data-type="outgoing_deposit"`):''}${t.remainingBalance&&t.pending?btn('writer-payment','登记尾款','wallet','small',`${extra} data-type="outgoing_balance"`):''}</div>`;
}
function writingPaymentSummary(p,actions=false) {
 if(serviceEnded(p))return '';
 if(!hasWriting(p))return '';
 const t=writingPaymentTotals(p);
 return `<div class="writing-payment-summary"><div class="panel-header"><h3 class="panel-title">写作稿酬 <small>${writingPaymentStatus(t)}</small></h3>${actions?writingPaymentActions(p):''}</div><div class="writing-payment-figures"><span>约定总稿酬 <strong>${yuan(t.fee)}</strong></span><span>约定定金 <strong>${yuan(t.deposit)}</strong></span><span>约定尾款 <strong>${yuan(t.balance)}</strong></span></div><p class="payment-formula">待付稿酬：${writingPaymentFormula(t)}</p><p class="panel-hint">约定金额不代表已付款；登记实际支付后自动扣减，其他支出不抵扣稿酬。</p></div>`;
}
function writingPaymentsCell(p) {
 if(serviceEnded(p))return `<div class="paper-payment-list"><div>最终稿酬 ${yuan(effectiveWriterFee(p))}</div><div>已净付 ${yuan(p.writerPaidCents)}</div><div>待付 ${yuan(p.payableCents)} · 待追回 ${yuan(p.recoverableCents)}</div></div>`;
 if(!hasWriting(p))return '<span class="panel-hint">无需写作稿酬</span>';
 const t=writingPaymentTotals(p);
 return `<div class="paper-payment-list"><div><span>实际已付定金</span> <span class="paper-amount-value">${yuan(t.paidDeposit)}</span></div><div><span>实际已付尾款</span> <span class="paper-amount-value">${yuan(t.paidBalance)}</span></div><div class="cell-money" title="${esc(writingPaymentFormula(t))}"><span>待付稿酬</span> <span class="paper-amount-value">${yuan(t.pending)}</span></div><div class="panel-hint">${writingPaymentStatus(t)}</div></div>${writingPaymentActions(p)}`;
}
function serviceFeeFields(p) {
 const t=customerReceiptTotals(p||{});
 return `<section class="fee-entry-section" aria-label="服务费用"><h3 class="section-heading">${icon('wallet')}服务费用（作者／客户付给我）</h3><div class="form-grid">
 ${field('contractAmount','服务费用（元）',((p?.contractCents||0)/100).toFixed(2),{type:'number',full:true})}
 ${field('contractDepositAmount','约定定金（元）',((p?.contractDepositCents||0)/100).toFixed(2),{type:'number'})}
 ${field('customerReceivedDeposit','已收定金（元）',(t.deposit/100).toFixed(2),{type:'number'})}
 ${field('customerPendingBalance','待收尾款（元）',(t.pending/100).toFixed(2),{type:'number',readOnly:true,hint:'自动计算：服务费用 − 已收定金 − 已收尾款。'})}
 ${field('customerReceivedBalance','已收尾款（元）',(t.balance/100).toFixed(2),{type:'number'})}
 </div></section>`;
}
function customerFormAmounts(form) {
 const value=name=>form.elements?.namedItem?.(name)?.value,p=state.drawer?.paper||{},base=customerReceiptTotals(p);
 return {p,base,fee:moneyCents(value('contractAmount')??(p.contractCents||0)/100),deposit:moneyCents(value('contractDepositAmount')??(p.contractDepositCents||0)/100),receivedDeposit:moneyCents(value('customerReceivedDeposit')??base.deposit/100),receivedBalance:moneyCents(value('customerReceivedBalance')??base.balance/100)};
}
function updateCustomerReceiptForm(form) {
 if(form.id!=='paper-form'||!form.elements?.namedItem?.('customerReceivedDeposit'))return;
 const {fee,receivedDeposit,receivedBalance}=customerFormAmounts(form),pending=form.elements.namedItem('customerPendingBalance');
 if(pending)pending.value=[fee,receivedDeposit,receivedBalance].every(Number.isFinite)?(Math.max(0,fee-receivedDeposit-receivedBalance)/100).toFixed(2):'';
}
function customerReceiptIssues(form) {
 if(!form.elements?.namedItem?.('customerReceivedDeposit'))return [];
 const {p,base,fee,deposit,receivedDeposit,receivedBalance}=customerFormAmounts(form),issues=[];
 for(const [name,amount] of [['contractAmount',fee],['contractDepositAmount',deposit],['customerReceivedDeposit',receivedDeposit],['customerReceivedBalance',receivedBalance]])if(!Number.isFinite(amount)||amount<0)issues.push([name,'请输入有效的非负金额，最多两位小数']);
 const changed=fee!==(p.contractCents||0)||deposit!==(p.contractDepositCents||0)||receivedDeposit!==base.deposit||receivedBalance!==base.balance;
 if(changed){
  if(receivedDeposit+receivedBalance>fee)issues.push(['customerReceivedBalance','已收定金与已收尾款合计不能超过服务费用']);
  if(deposit>0&&receivedDeposit>deposit)issues.push(['customerReceivedDeposit','已收定金不能超过约定定金']);
  if(deposit>0&&receivedBalance>fee-deposit)issues.push(['customerReceivedBalance','已收尾款不能超过服务费用减约定定金']);
 }
 return issues;
}
function customerReceiptPayload(data) {
 const result={...data};
 if(Object.hasOwn(data,'customerReceivedDeposit')||Object.hasOwn(data,'customerReceivedBalance'))result.customerReceiptTotals={deposit:data.customerReceivedDeposit||'0',balance:data.customerReceivedBalance||'0'};
 delete result.customerReceivedDeposit;delete result.customerReceivedBalance;delete result.customerPendingBalance;
 return result;
}
function clearRecordedCustomerReceipts(form,paper,drawer=state.drawer) {
 const t=customerReceiptTotals(paper);
 for(const [name,amount] of [['customerReceivedDeposit',t.deposit],['customerReceivedBalance',t.balance]]){const control=form.elements?.namedItem?.(name);if(control)control.value=(amount/100).toFixed(2);}
 if(drawer)drawer.paper=paper;if(state.drawer===drawer)updateCustomerReceiptForm(form);
}

function writingFeeFields(p) {
 const t=writingPaymentTotals(p);
 return `<section class="fee-entry-section" aria-label="写作费用"><h3 class="section-heading">${icon('wallet')}写作费用（我付给写作老师）</h3><div class="form-section"><h3 class="section-heading">1. 确认稿酬约定</h3><div class="form-grid">
 ${field('writerFee','约定总稿酬（元）',(t.fee/100).toFixed(2),{type:'number',full:true,hint:'本篇论文约定的全部写作费用。'})}
 ${field('writerDepositAmount','约定写作定金（元）',(t.deposit/100).toFixed(2),{type:'number',hint:'付款计划中的定金，不代表已支付。'})}
 ${field('writerBalanceAmount','约定写作尾款（元）',(t.balance/100).toFixed(2),{type:'number',readOnly:true,hint:'自动计算：总稿酬 − 约定定金。'})}</div></div>
 <div class="form-section"><h3 class="section-heading">${icon('wallet')}2. 登记实际已付款（付给写作老师） <small class="panel-hint">选填</small></h3>
 <p id="writer-payment-baseline" class="form-guide">${p?'已付给写作老师：定金 '+yuan(t.paidDeposit)+'，已付尾款 '+yuan(t.paidBalance)+'。下方只填本次新增金额。':'如已付给写作老师，可在这里登记；尚未付款请保持 0。'}保存时自动记入收支流水。</p><div class="form-grid">
 ${field('writerPaymentDeposit','本次付给写作老师的定金（元）','0.00',{type:'number'})}
 ${field('writerPaymentDepositDate','写作定金支付日期','',{type:'date',maxDate:today()})}
 ${field('writerPaymentBalance','本次付给写作老师的尾款（元）','0.00',{type:'number'})}
 ${field('writerPaymentBalanceDate','写作尾款支付日期','',{type:'date',maxDate:today()})}
 ${field('writerPaymentMethod','付给写作老师的方式','',{max:80,full:true,placeholder:'例如：微信、银行转账'})}
 <div class="field full payment-confirm" data-writer-payment-confirm hidden><label for="f-confirmWriterPayments"><input id="f-confirmWriterPayments" name="confirmWriterPayments" type="checkbox" value="yes">确认上述金额已实际付给写作老师，保存后记入支出。</label><p id="f-confirmWriterPayments-error" class="field-error" hidden></p></div></div>
 <div id="writer-payment-preview" class="writing-payment-preview" aria-live="polite">${writingPaymentSummary(p||{})}</div></div></section>`;
}
function writerFormAmounts(form) {
 const value=name=>form.elements?.namedItem?.(name)?.value;
 const p=state.drawer?.paper||{},base=writingPaymentTotals(p);
 return {base,fee:moneyCents(value('writerFee')??base.fee/100),deposit:moneyCents(value('writerDepositAmount')??base.deposit/100),newDeposit:moneyCents(value('writerPaymentDeposit')||0),newBalance:moneyCents(value('writerPaymentBalance')||0)};
}
function updateWriterPaymentForm(form) {
 if(form.id!=='paper-form'||!form.elements?.namedItem?.('writerFee'))return;
 const {base,fee,deposit,newDeposit,newBalance}=writerFormAmounts(form),control=name=>form.elements.namedItem(name);
 const tail=control('writerBalanceAmount');if(tail)tail.value=(Math.max(0,fee-deposit)/100).toFixed(2);
 for(const [name,amount] of [['writerPaymentDepositDate',newDeposit],['writerPaymentBalanceDate',newBalance]]){const date=control(name);if(date){date.required=amount>0;markRequired(date);}}
 const confirming=newDeposit+newBalance>0,confirmation=control('confirmWriterPayments');
 if(confirmation){confirmation.required=confirming;const block=$('[data-writer-payment-confirm]',form);if(block)block.hidden=!confirming;}
 const preview=$('#writer-payment-preview',form);
 if(preview){const totals={...base,fee,paidDeposit:base.paidDeposit+newDeposit,paidBalance:base.paidBalance+newBalance,pending:Math.max(0,fee-base.paidDeposit-base.paidBalance-newDeposit-newBalance)};
  preview.innerHTML=Object.values(totals).every(Number.isFinite)?`<strong>保存后：${writingPaymentStatus(totals)}</strong><p class="payment-formula">待付稿酬：${writingPaymentFormula(totals)}</p>`:'请填写有效金额，最多两位小数。';}
}
function writerPaymentPayload(form,data) {
 const result={...data},payments=[];
 for(const [name,type] of [['writerPaymentDeposit','outgoing_deposit'],['writerPaymentBalance','outgoing_balance']]){
  if(moneyCents(data[name]||0)>0)payments.push({type,amount:data[name],date:data[name+'Date'],method:data.writerPaymentMethod||'',note:'论文表单登记实际付款'});
  delete result[name];delete result[name+'Date'];
 }
 delete result.writerPaymentMethod;delete result.writerBalanceAmount;delete result.confirmWriterPayments;
 if(payments.length){result.writerPayments=payments;result.confirmWriterPayments=data.confirmWriterPayments==='yes';}
 return result;
}
function clearRecordedWriterPayments(form,paper,drawer=state.drawer) {
 for(const name of ['writerPaymentDeposit','writerPaymentBalance','writerPaymentDepositDate','writerPaymentBalanceDate','writerPaymentMethod']){const control=form.elements?.namedItem?.(name);if(control)control.value=name.endsWith('Date')||name.endsWith('Method')?'':'0.00';}
 const confirm=form.elements?.namedItem?.('confirmWriterPayments');if(confirm)confirm.checked=false;
 const baseline=$('#writer-payment-baseline',form);if(baseline)baseline.textContent=`已付给写作老师：定金 ${yuan(paper.outgoing_depositCents)}，已付尾款 ${yuan(paper.outgoing_balanceCents)}。下方只填本次新增金额，保存时自动记入收支流水。`;
 if(drawer)drawer.paper=paper;if(state.drawer===drawer)updateWriterPaymentForm(form);
}
function writerPaymentIssues(form) {
 if(!form.elements?.namedItem?.('writerPaymentDeposit'))return [];
 const {base,fee,deposit,newDeposit,newBalance}=writerFormAmounts(form),issues=[];
 for(const [name,amount] of [['writerFee',fee],['writerDepositAmount',deposit],['writerPaymentDeposit',newDeposit],['writerPaymentBalance',newBalance]])if(!Number.isFinite(amount))issues.push([name,'请输入有效金额，最多两位小数']);
 if(fee!==base.fee&&fee<base.paidDeposit+base.paidBalance)issues.push(['writerFee','稿酬总额不能低于累计已付稿酬']);
 if(deposit!==base.deposit&&deposit<base.paidDeposit)issues.push(['writerDepositAmount','约定定金不能低于累计已付定金']);
 if(fee-deposit!==base.balance&&fee-deposit<base.paidBalance)issues.push(['writerFee','约定尾款不能低于累计已付尾款']);
 if(newDeposit>0&&newDeposit>Math.max(0,deposit-base.paidDeposit))issues.push(['writerPaymentDeposit','本次定金不能超过剩余约定定金']);
 if(newBalance>0&&newBalance>Math.max(0,fee-deposit-base.paidBalance))issues.push(['writerPaymentBalance','本次尾款不能超过剩余约定尾款']);
 return issues;
}
function transactionPaymentFields() {
 return `<div class="field full payment-confirm" data-transaction-payment-confirm hidden><label for="f-confirmWriterPayment"><input id="f-confirmWriterPayment" name="confirmWriterPayment" type="checkbox" value="yes">确认本次金额已实际支付，保存后扣减待付稿酬。</label><p id="f-confirmWriterPayment-error" class="field-error" hidden></p></div><div id="transaction-payment-preview" class="writing-payment-preview full" aria-live="polite" hidden></div>`;
}
function updateTransactionPayment(form,prefill=false) {
 if(form.id!=='transaction-form')return;
 const type=form.elements?.namedItem?.('type')?.value,amount=form.elements?.namedItem?.('amount'),p=state.drawer?.paper;
 if(!p)return;
 const writing=['outgoing_deposit','outgoing_balance'].includes(type),t=writingPaymentTotals(p);
 if(prefill&&amount)amount.value=writing?(Math.min(t.pending,type==='outgoing_deposit'?t.remainingDeposit:t.remainingBalance)/100).toFixed(2):'';
 const confirm=form.elements?.namedItem?.('confirmWriterPayment');if(confirm){confirm.required=writing;confirm.disabled=!writing;if(!writing||prefill)confirm.checked=false;markRequired(confirm);}
 const block=$('[data-transaction-payment-confirm]',form);if(block)block.hidden=!writing;
 const publication=publicationTypes.includes(type),accountSelect=form.elements?.namedItem?.('publicationAccountId');if(accountSelect){accountSelect.required=publication;accountSelect.disabled=!publication;const box=$('[data-publication-account]',form);if(box)box.hidden=!publication;}const pubConfirm=form.elements?.namedItem?.('confirmPublicationPayment');
 if(pubConfirm){pubConfirm.required=publication;pubConfirm.disabled=!publication;if(!publication||prefill)pubConfirm.checked=false;markRequired(pubConfirm);}
 const pubBlock=$('[data-publication-payment-confirm]',form);if(pubBlock)pubBlock.hidden=!publication;
 const settlement=settlementTypes.includes(type),settlementConfirm=form.elements?.namedItem?.('confirmSettlementPayment');
 if(settlementConfirm){settlementConfirm.required=settlement;settlementConfirm.disabled=!settlement;if(!settlement||prefill)settlementConfirm.checked=false;markRequired(settlementConfirm);const section=settlementConfirm.closest?.('.field');if(section)section.hidden=!settlement;}
 const preview=$('#transaction-payment-preview',form);
 if(preview){const limit=transactionRemaining(p,type);preview.hidden=limit===null;if(writing){const paid=moneyCents(amount?.value||0),next={...t,paidDeposit:t.paidDeposit+(type==='outgoing_deposit'?paid:0),paidBalance:t.paidBalance+(type==='outgoing_balance'?paid:0),pending:Math.max(0,t.pending-paid)};
  preview.innerHTML=`<p>本次${type==='outgoing_deposit'?'支付定金':'支付尾款'}，最多可登记 ${yuan(limit)}。</p><p class="payment-formula">保存后待付稿酬：${writingPaymentFormula(next)}</p>`;
 }else if(limit!==null)preview.innerHTML=`<p>${esc(typeLabels[type])}：剩余可登记 ${yuan(limit)}。金额请按实际收付填写，超额不能保存。</p>`;}
}
function updateContractBalance(form) {
 const controls=form?.elements,amount=controls?.namedItem?.('contractAmount'),deposit=controls?.namedItem?.('contractDepositAmount'),balance=controls?.namedItem?.('contractBalanceAmount');
 if(!amount||!deposit||!balance)return;
 const total=Number(amount.value||0),paid=Number(deposit.value||0);
 balance.value=Number.isFinite(total)&&Number.isFinite(paid)?(Math.max(0,Math.round(total*100)-Math.round(paid*100))/100).toFixed(2):'0.00';
}
function updateWritingStatus(form) {
 const status=form?.elements?.namedItem?.('writingStatus'),delivered=form?.elements?.namedItem?.('writingDeliveredAt');
 if(delivered?.value&&status&&['待分配','写作中'].includes(status.value))status.value='已交稿';
}
function openPaperEditor(p=null,serviceType='half',customerId='') {
 if(serviceEnded(p)){toast('这篇论文服务已终止，请在详情中查看记录或调整结算');return;}
 const full=serviceType==='full';
 clearTimeout(credentialTimer);state.drawer={kind:'edit',paper:p,serviceType,createRequestId:p?null:crypto.randomUUID()};
 const writing=full?`<div class="form-section"><h3 class="section-heading">${icon('edit')}写作安排</h3><div class="form-grid">
  ${field('writer','写作人',p?.writer,{max:200,placeholder:'填写写作者或合作人'})}
  ${field('writingStatus','写作状态',p?.writingStatus||'待分配',{select:writingStatuses,hint:'填写实际交稿日期后，待分配或写作中会自动变为已交稿；重新写作请先清空交稿日期。'})}
  ${field('writingStartAt','写作开始日期',p?.writingStartAt,{type:'date'})}
  ${field('writingDueAt','预计交稿日期',p?.writingDueAt,{type:'date',hint:'不能早于写作开始日期。'})}
  ${field('writingDeliveredAt','实际交稿日期',p?.writingDeliveredAt,{type:'date',maxDate:today(),hint:'不能早于开始日期或晚于今天；标记已交稿或已完成时留空默认今天。'})}
 </div></div>${writingFeeFields(p)}`:'';
 setOverlay(`<div class="overlay"><section class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
  <header class="drawer-head"><div><h2 id="drawer-title">${p?'编辑':'新增'}记录（${full?'全包':'半包'}）</h2><p>${serviceLabel({serviceType})}${p?' · '+esc(p.code):''}</p></div><button class="icon-btn" data-action="close" aria-label="关闭">${icon('close')}</button></header>
  <form id="paper-form" novalidate style="display:contents"><input type="hidden" name="serviceType" value="${serviceType}"><div class="drawer-body">
   <div class="notice green service-notice">${icon('info')}<span>${full?'全包：由我们安排论文写作，并管理后续投稿与收支。':'半包：客户提供文章，直接管理论文、投稿与收支。'}</span></div>
   <div class="form-section"><h3 class="section-heading">${icon('document')}文章与客户</h3><div class="form-grid">
    ${field('title',full?'写作文章题目':'论文题目',p?.title,{required:true,full:true,max:300,placeholder:full?'填写写作题目，可关联多次投稿':'填写客户提供的文章题目'})}
    ${field('authors','作者',p?.authors,{max:200,hint:'多位作者用顿号、逗号或分号分隔，作者保存在这篇论文中，可填写多位作者。'})}
    <div class="field"><label for="f-customerId">关联客户</label><select id="f-customerId" name="customerId">${customerOptions(p?.customerId||customerId,'暂不关联客户')}</select><small>如无客户信息，请先到客户管理中建立。</small></div>
    ${field('authorBio','作者简介',p?.authorBio,{textarea:true,full:true,max:2000,placeholder:'例如：张发栋、1983-6、男、汉族、吉林省松原市人、中级工程师、本科、研究方向：建筑施工'})}
    ${field('followUpAt','下次业务跟进日期',p?.followUpAt,{type:'date'})}
    ${field('followUpReason','跟进事项 / 由来',p?.followUpReason,{textarea:true,full:true,max:1000,required:!!p?.followUpAt,placeholder:'例如：客户尚未确认修改意见，届时联系确认；审稿已满一个月，查询进度。',hint:'说明为什么需要跟进，以及当天需要处理什么；设置跟进日期时必填。'})}
   </div></div>
   ${serviceFeeFields(p)}
   <div class="form-section"><h3 class="section-heading">${icon('link')}关联期刊</h3><div class="form-grid">
    ${field('journal','当前关联期刊名称',p?.journal,{max:200,full:true,required:!!p?.submissions?.length,placeholder:'填写拟投或已投期刊名称',hint:p?.submissions?.length?'已有投稿时必填；更换期刊请用“改投”。':'选填，填写后建立一条待投稿记录。'})}
   </div></div>
   ${writing}${publicationFeeFields(p)}${fileUploadFields(false,p)}<div class="form-grid">${field('notes','备注',p?.notes,{textarea:true,full:true})}</div>
  </div><footer class="drawer-foot">${formFeedback()}<span class="panel-hint">保存后返回列表</span><div class="actions">${btn('close','关闭')}<button class="btn primary" type="submit">${icon('check')}保存</button></div></footer></form>
 </section></div>`);
}

function writingOverview(p) {
 const strip=`<div class="relationship-strip"><span>${serviceBadge(p)}</span><span>${icon('users')}${customerLink(p)}</span>${hasWriting(p)?`<span>${icon('edit')}${writingProgressBadge(p)}</span>`:''}<span>${icon('document')}${p.submissions?.length||0} 次投稿</span></div>`;
 const writing=hasWriting(p)?`<h3 class="section-heading">${icon('edit')}写作安排</h3><div class="detail-meta">${detailField('写作人',esc(p.writer))}${detailField('写作状态',writingProgressBadge(p))}${detailField('开始 / 预计交稿',`${dateLabel(p.writingStartAt)} / ${dateLabel(p.writingDueAt)}`)}${detailField('实际交稿 / 写作时长',`${dateLabel(p.writingDeliveredAt)} / ${daysLabel(p.writingDays)}`)}${detailField('约定稿酬 / 定金 / 尾款',`${yuan(p.writerFeeCents)} / ${yuan(p.writerDepositCents)} / ${yuan(p.writerBalanceCents)}`,true)}</div>`:'';
 const history=hasWriting(p)&&serviceEnded(p)?`<div class="cell-sub">终止前写作状态：${esc(p.writingStatus||'未安排')}；以下日期为历史记录。</div>`:'';
 return strip+history+writing+`<h3 class="section-heading">${icon('document')}当前投稿与基本资料</h3>`;
}
function submissionCards(p) {
 return `<div class="panel-header" style="padding:0 0 20px"><h3 class="panel-title">全部投稿 <small>${p.submissions.length} 次</small></h3>${serviceEnded(p)?serviceEndBadge(p):btn(p.submissions.length?'resubmit-paper':'new-submission',p.submissions.length?'改投':'新增','plus','small',`data-paper-id="${esc(p.id)}"`)}</div>${p.submissions.length?[...p.submissions].reverse().map((s,index)=>`<article class="submission-card" id="submission-${esc(s.id)}"><div class="submission-card-head"><div><h3>${sequenceBadge(index)}${esc(s.journal||'未填写期刊')}</h3><p>${esc(s.title)}</p></div>${badge(s.status)}</div><div class="detail-meta">${detailField('投稿系统',esc(s.submissionSystem))}${detailField('投稿时长',daysLabel(s.durationDays))}${detailField('投稿日期',dateLabel(s.submittedAt))}${detailField('结束 / 录用日期',dateLabel(s.endedAt))}${detailField('预计发表日期',dateLabel(s.expectedPublishedAt))}${detailField('实际发表日期',dateLabel(s.publishedAt))}${detailField('本次投稿稿件',manuscriptLink(p,s.manuscriptId),true)}${detailField('投稿账号',esc(s.submissionAccount))}${detailField('投稿密码',s.hasPassword?`<div class="password-row"><span class="password-value" data-secret-value="${esc(s.id)}">••••••••••</span><button class="text-btn" data-action="reveal-submission-password" data-id="${esc(s.id)}">${icon('eye')}显示</button></div>`:'未保存')}${detailField('绑定邮箱',esc(s.boundEmail))}${detailField('绑定手机号',esc(s.boundPhone))}${detailField('投稿网址',s.submissionUrl?`<a href="${esc(s.submissionUrl)}" target="_blank" rel="noopener noreferrer">${esc(s.submissionUrl)} ${icon('link')}</a>`:'',true)}</div>${s.notes?`<div class="detail-note">${esc(s.notes)}</div>`:''}<div class="submission-card-actions"><span class="panel-hint">${p.activeSubmissionId===s.id?'当前投稿记录':'此前投稿记录'}</span><div class="actions">${serviceEnded(p)?'':`${btn('resubmit-paper','改投','refresh','small',`data-paper-id="${esc(p.id)}" data-id="${esc(s.id)}"`)}${btn('delete-submission','删除','trash','small danger',`data-paper-id="${esc(p.id)}" data-id="${esc(s.id)}"`)}${btn('edit-submission','编辑','edit','small',`data-paper-id="${esc(p.id)}" data-id="${esc(s.id)}"`)}`}</div></div></article>`).join(''):'<div class="empty-small" style="padding:50px 10px">暂无投稿。点击“新增”，为这篇论文添加第一条投稿记录。</div>'}`;
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
  <dl class="submission-history-dates"><div><dt>投稿日期</dt><dd>${s.submittedAt?dateLabel(s.submittedAt):['草稿','待投稿'].includes(s.status)?'尚未投稿':'未填写'}</dd></div><div><dt>结束 / 录用日期</dt><dd>${dateLabel(s.endedAt)}</dd></div><div><dt>投稿时长</dt><dd>${daysLabel(s.durationDays)}</dd></div>${s.expectedPublishedAt?`<div><dt>预计发表日期</dt><dd>${dateLabel(s.expectedPublishedAt)}</dd></div>`:''}${s.publishedAt?`<div><dt>发表日期</dt><dd>${dateLabel(s.publishedAt)}</dd></div>`:''}</dl>
  ${s.notes?`<p class="submission-history-notes">备注：${esc(s.notes)}</p>`:''}</article>`).join('')}</div>`:'<p class="submission-history-empty">暂无投稿历史，本次将建立第一条投稿记录。</p>'}</details>`;
}
function journalRepeatNotice(p,journal,excludeId='') {
 const matches=matchingJournalRecords(p,journal,excludeId);
 if(!matches.length)return '';
 const unchanged=excludeId&&journalKey((p?.submissions||[]).find(s=>s.id===excludeId)?.journal)===journalKey(journal);
 const blocked=matches.some(s=>!['已拒稿','已撤稿'].includes(s.status));
 const hint=unchanged?'本次保存只更新正在编辑的记录。':blocked?'同一期刊已有进行中或已发表的投稿，请编辑原记录更新进度。':'原投稿均已拒稿或撤稿，核对后可继续保存新一轮投稿。';
 return `<div class="notice">${icon('info')}<span>这篇论文已有 <strong>${matches.length} 条</strong>“${esc(String(journal).trim())}”的同名期刊记录：${[...matches].reverse().slice(0,3).map(s=>`${esc(s.status)}（${s.submittedAt?dateLabel(s.submittedAt):'尚未填写投稿日期'}）`).join('、')}${matches.length>3?'，其余记录见上方投稿历史':''}。${hint}</span></div>`;
}
function updateJournalNotice(journal) {
 const drawer=state.drawer;
 if(drawer?.kind!=='submission-edit')return;
 const notice=$('#journal-history-notice');
 if(notice)notice.innerHTML=journalRepeatNotice(drawer.paper||drawer.historyPaper,journal,drawer.submission?.id);
}
let submissionOpenSequence=0;
function submissionStatusField(s) {
 const status=s?.status||'待投稿';
 return field('status','投稿状态',status,{select:[...statuses,'终止服务'],required:true,hint:'选择“终止服务”后，填写原因与最终结算并确认。'}).replace('<select ',`<select data-previous-status="${esc(status)}" `);
}
function openSubmissionTermination(form) {
 const drawer=state.drawer;
 if(drawer?.kind!=='submission-edit'||(form.dataset?.editorId!==undefined&&form.dataset.editorId!==String(drawer.editorId)))throw new Error('投稿记录已变更，请重新打开投稿');
 const status=form.elements?.namedItem?.('status')||form.elements?.status;
 if(status?.value==='终止服务')status.value=status.dataset.previousStatus||drawer.submission?.status||'待投稿';
 updateFormRequirements(form);
 const selected=form.elements?.namedItem?.('paperId')||form.elements?.paperId;
 const p=drawer.paper||state.papers.find(p=>p.id===selected?.value)||drawer.historyPaper;
 if(!p?.id)throw new Error('请先选择关联论文，再终止服务');
 if(serviceEnded(p))throw new Error('这篇论文的服务已终止，请查看结算记录');
 openTerminationForm(p);
}
function openSubmissionEditor(p=null,s=null,{resubmit=false,source=null,mode=s?'edit':resubmit?'resubmit':'create'}={}) {
 if(serviceEnded(p))throw new Error('这篇论文服务已终止，不能继续投稿');
 if(!['edit','create','resubmit'].includes(mode)||(mode==='edit'&&(!p?.id||!s?.id||!p.submissions?.some(item=>item.id===s.id))))throw new Error('投稿记录已不存在，请刷新列表后重新编辑');
 submissionOpenSequence++;
 const returnToDetails=state.drawer?.kind==='detail'&&state.drawer.paper?.id===p?.id;
 const target=mode==='edit'?Object.freeze({paperId:p.id,submissionId:s.id,version:s.version}):null;
 clearTimeout(credentialTimer);state.drawer={kind:'submission-edit',mode,target,editorId:submissionOpenSequence,paper:p,submission:s,resubmit,sourceSubmission:source,returnToDetails,historyPaper:p,feeJournalKey:journalKey(s?.journal||'')};
 setOverlay(`<div class="overlay"><section class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><header class="drawer-head"><div><h2 id="drawer-title">${s?'编辑投稿':resubmit?'论文改投':'新增投稿'}</h2><p>${s?'修改原投稿的状态和资料，保留同一条记录':'每次投稿保留独立期刊、账号、日期和时长'}</p></div><button class="icon-btn" data-action="close" aria-label="关闭">${icon('close')}</button></header><form id="submission-form" data-editor-id="${state.drawer.editorId}" novalidate style="display:contents"><div class="drawer-body"><div id="submission-history-root">${submissionHistory(p,source?.id)}</div><h3 class="section-heading">${icon('edit')}${resubmit?'填写本次改投':s?'编辑本次投稿':'填写本次投稿'}</h3><div class="form-grid"><div class="field full"><label for="submission-paper">关联论文 <span class="required-mark">必填</span></label><select id="submission-paper" name="paperId" required ${p?'disabled':''}><option value="">请选择已有论文</option>${state.papers.map(x=>`<option value="${esc(x.id)}" ${x.id===p?.id?'selected':''}>${esc(x.title)} · ${esc(x.customer||'未关联客户')}</option>`).join('')}</select></div>${field('title','投稿题目',s?.title||(resubmit?source?.title:'')||p?.title,{required:true,full:true,max:300,hint:'可以与论文题目不同，系统仍通过论文编号保持关联'})}${field('journal','投稿期刊名称',s?.journal,{required:true,max:200})}${submissionStatusField(s)}<div id="journal-history-notice" class="field full" aria-live="polite">${journalRepeatNotice(p,s?.journal||'',s?.id)}</div>${field('submissionSystem','投稿系统',s?.submissionSystem,{max:200})}${field('submissionUrl','投稿网址',s?.submissionUrl,{type:'url',max:200})}${field('submissionAccount','投稿账号',s?.submissionAccount,{max:200})}${field('submissionPassword',s?.hasPassword?'更换投稿密码':'投稿密码','',{type:'password',max:500,placeholder:s?.hasPassword?'留空保留原密码':'填写投稿系统密码',hint:s?.hasPassword?'<label class="choice-label"><input type="checkbox" name="clearPassword"> 清除原密码</label>':'密码不会出现在列表或 CSV 导出中'})}${field('boundEmail','绑定邮箱',s?.boundEmail,{type:'email',max:200})}${field('boundPhone','绑定手机号',s?.boundPhone,{type:'tel',max:200})}${field('submittedAt','实际投稿日期',s?.submittedAt,{type:'date',required:!!s&&!['草稿','待投稿'].includes(s.status),hint:!!s&&!['草稿','待投稿'].includes(s.status)?'当前状态必须填写实际投稿日期。':'草稿、待投稿可留空；已投稿及后续状态必须填写。'})}${field('endedAt','结束 / 录用日期',s?.endedAt,{type:'date',maxDate:today(),hint:'不能早于投稿日期；结束状态留空默认今天。'})}${field('expectedPublishedAt','预计发表日期',s?.expectedPublishedAt,{type:'date',hint:'可提前填写预计日期；填写录用日期后，预计发表日期必须晚于录用日期。'})}${manuscriptSelect(p,s)}${field('notes','本次投稿备注',s?.notes,{textarea:true,full:true})}</div><div id="submission-publication-fees">${submissionPublicationFields(p,s)}</div><div class="notice green" style="margin-top:19px">${icon('info')}${resubmit?`从“${esc(source?.journal||'原期刊')}”改投：保存后新增一次投稿，原期刊、状态、账号、日期与收支保留。请填写新的期刊及投稿资料。`:s?'保存只更新这条投稿的状态和资料，不会新增投稿。其他投稿记录保持原样。':'新增投稿会作为当前投稿，之前的记录仍完整保留。'}</div></div><footer class="drawer-foot">${formFeedback()}<span class="panel-hint">关联论文，独立记录</span><div class="actions">${btn('cancel-submission','取消')}<button class="btn primary" type="submit">${icon('check')}保存</button></div></footer></form></section></div>`);
}

async function openCustomer(id,showPapers=false) {
 const current=beginDrawerRequest(),c=await api(`/api/customers/${encodeURIComponent(id)}`);if(!current())return;clearTimeout(credentialTimer);
 state.drawer={kind:'customer-detail',customer:c,customerTab:showPapers?'papers':'info',paperSearch:'',paperPage:1,paperStatus:''};renderCustomerDetail();
}
const customerPaperPageSize=3;
function customerPaperPage() {
 const drawer=state.drawer,all=drawer.customer.papers||[],query=(drawer.paperSearch||'').trim().toLocaleLowerCase();
 const papers=all.filter(p=>(!drawer.paperStatus||p.status===drawer.paperStatus)&&[p.title,p.code,p.authors].join(' ').toLocaleLowerCase().includes(query));
 const pages=Math.max(1,Math.ceil(papers.length/customerPaperPageSize));
 drawer.paperPage=Math.min(pages,Math.max(1,drawer.paperPage||1));
 const start=(drawer.paperPage-1)*customerPaperPageSize;
 return {all,total:papers.length,papers:papers.slice(start,start+customerPaperPageSize),pages,start,page:drawer.paperPage};
}
function customerPaperCard(p,index) {
 const submissions=p.submissions||[],publications=submissions.filter(s=>s.status==='已发表');
 const latest=publications.reduce((found,s)=>!found||String(s.publishedAt||'')>String(found.publishedAt||'')?s:found,null);
 const journals=p.publishedJournals||[],journal=latest?.journal||journals[0]||'暂无发表';
 return `<article class="customer-paper"><button class="paper-title" data-action="detail" data-id="${esc(p.id)}" title="${esc(p.title)}">${sequenceBadge(index)}${esc(p.title)}</button><div class="paper-meta">${esc(p.code)}</div>${paperAuthorByline(p)}<div class="customer-paper-meta">${serviceBadge(p)}${hasWriting(p)?writingProgressBadge(p):''}${badge(p.status)}<span>${submissions.length} 次投稿</span></div><p class="customer-paper-money">服务费用 ${yuan(p.contractCents)} · 已收 ${yuan(p.contractReceivedCents)} · 待收 ${yuan(p.receivableCents)}</p><div class="customer-publication"><p title="${esc(journal)}">${latest||journals.length?'已发表期刊':'发表成果'}：${esc(journal)}${latest?.publishedAt?` · ${dateLabel(latest.publishedAt)}`:''}${publications.length>1?` · 共 ${publications.length} 次发表`:''}</p></div></article>`;
}
function customerPaperResults() {
 const {all,total,papers,start}=customerPaperPage();
 return total?papers.map((p,index)=>customerPaperCard(p,start+index)).join(''):`<div class="empty-small">${all.length?'没有符合条件的论文，请调整关键词或投稿状态。':'暂无关联论文。新增论文时，选择这位客户即可。'}</div>`;
}
function customerPaperPagination() {
 const {total,papers,pages,start,page}=customerPaperPage();
 return `<span aria-live="polite">共 ${total} 篇${total?`，显示 ${start+1}–${start+papers.length} 篇`:''}</span><div class="actions"><button class="btn small" data-action="customer-paper-page" data-page="${page-1}" ${page===1?'disabled':''} aria-label="关联论文上一页">上一页</button><span>${page} / ${pages}</span><button class="btn small" data-action="customer-paper-page" data-page="${page+1}" ${page===pages?'disabled':''} aria-label="关联论文下一页">下一页</button></div>`;
}
function customerPaperStatusOptions() { return [['','全部状态'],...statuses.map(status=>[status,status])]; }
function customerPaperStatusPicker() {
 const drawer=state.drawer,options=customerPaperStatusOptions(),selected=options.findIndex(([value])=>value===drawer.paperStatus);
 const active=Math.max(0,Math.min(options.length-1,drawer.paperStatusActiveIndex??Math.max(0,selected)));
 const label=options[Math.max(0,selected)]?.[1]||options[0][1],open=drawer.paperStatusOpen===true;
 return `<div class="customer-paper-status-control"><button type="button" class="customer-paper-status-trigger" id="customer-paper-status-button" data-action="customer-paper-status-toggle" aria-label="投稿状态：${esc(label)}" aria-haspopup="listbox" aria-expanded="${open}" aria-controls="customer-paper-status-options"><span class="customer-paper-status-value">${esc(label)}</span>${icon('chevron')}</button><div class="customer-paper-status-menu" id="customer-paper-status-options" role="listbox" aria-label="关联论文投稿状态" aria-activedescendant="customer-paper-status-option-${active}" tabindex="-1" ${open?'':'hidden'}>${options.map(([value,text],index)=>`<div class="customer-paper-status-option${index===selected?' is-selected':''}${open&&index===active?' is-active':''}" id="customer-paper-status-option-${index}" role="option" aria-selected="${index===selected}" data-action="customer-paper-status-option" data-option-index="${index}" data-status="${esc(value)}">${icon('check')}<span>${esc(text)}</span></div>`).join('')}</div></div>`;
}
function renderCustomerPaperStatusPicker(focusMenu=false,restoreFocus=false) {
 const picker=$('#customer-paper-status-picker');if(!picker)return;
 picker.innerHTML=customerPaperStatusPicker();
 if(focusMenu)requestAnimationFrame(()=>{
  const list=$('#customer-paper-status-options'),option=$(`#customer-paper-status-option-${state.drawer?.paperStatusActiveIndex||0}`);
  list?.focus({preventScroll:true});option?.scrollIntoView({block:'nearest'});
 });
 else if(restoreFocus)requestAnimationFrame(() => $('#customer-paper-status-button')?.focus({preventScroll:true}));
}
function setCustomerPaperStatusOpen(open,{focusMenu=false,restoreFocus=false}={}) {
 if(state.drawer?.kind!=='customer-detail')return;
 const drawer=state.drawer,options=customerPaperStatusOptions();
 drawer.paperStatusOpen=open;
 if(open)drawer.paperStatusActiveIndex=Math.max(0,options.findIndex(([value])=>value===drawer.paperStatus));
 renderCustomerPaperStatusPicker(focusMenu,restoreFocus);
}
function setCustomerPaperStatus(value) {
 if(state.drawer?.kind!=='customer-detail')return;
 state.drawer.paperStatus=customerPaperStatusOptions().some(([status])=>status===value)?value:'';
 state.drawer.paperPage=1;state.drawer.paperStatusOpen=false;
 renderCustomerPaperStatusPicker(false,true);renderCustomerPaperResults();
}
function handleCustomerPaperStatusKeydown(event) {
 if(state.drawer?.kind!=='customer-detail'||!state.drawer.paperStatusOpen)return;
 const options=customerPaperStatusOptions(),last=options.length-1,index=state.drawer.paperStatusActiveIndex||0;
 if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
  event.preventDefault();event.stopImmediatePropagation();
  state.drawer.paperStatusActiveIndex=event.key==='Home'?0:event.key==='End'?last:event.key==='ArrowDown'?Math.min(last,index+1):Math.max(0,index-1);
  const menu=$('#customer-paper-status-options'),active=$(`#customer-paper-status-option-${state.drawer.paperStatusActiveIndex}`);
  menu?.setAttribute('aria-activedescendant',active?.id||'');
  for(const option of menu?.querySelectorAll('[role="option"]')||[])option.classList.toggle('is-active',option===active);
  active?.scrollIntoView({block:'nearest'});
 } else if(event.key==='Enter'||event.key===' ') {
  event.preventDefault();event.stopImmediatePropagation();setCustomerPaperStatus(options[index]?.[0]||'');
 } else if(event.key==='Escape') {
  event.preventDefault();event.stopImmediatePropagation();setCustomerPaperStatusOpen(false,{restoreFocus:true});
 }
}
function renderCustomerPaperResults() {
 $('#customer-paper-results').innerHTML=customerPaperResults();
 $('#customer-paper-pagination').innerHTML=customerPaperPagination();
 $('#customer-paper-results').scrollTop=0;
}
function customerInfoDetail(c) {
 const classification=detailField('客户类型',customerTypeBadge(c))+((c.customerType==='他人介绍'||c.referrer)?detailField('介绍人',esc(c.referrer||'未填写')):'');
 return `<div class="detail-meta">${classification}${detailField('合作开始日期',c.cooperationStartedAt?dateLabel(c.cooperationStartedAt):'未记录')}${detailField('手机号',esc(c.phone))}${detailField('邮箱',esc(c.email))}${detailField('微信',esc(c.wechat))}${detailField('单位 / 机构',esc(c.organization))}${detailField('联系地址',esc(c.address),true)}</div><div class="money-grid"><div class="money-box"><label>约定服务费用 / 已收</label><strong>${yuan(c.contractCents)}</strong><small>已收 ${yuan(c.receivedCents)} · 待收 ${yuan(c.receivableCents)}${c.refundableCents?` · 待退款 ${yuan(c.refundableCents)}`:''}</small></div><div class="money-box"><label>关联论文 / 已发表论文</label><strong>${c.paperCount} / ${c.publishedPaperCount}</strong><small>费用按论文汇总，改投不重复计费</small></div></div><h3 class="section-heading">${icon('document')}客户备注</h3><div class="detail-note">${esc(c.notes||'暂无备注')}</div>`;
}
function customerPapersDetail(c) {
 return `<div class="customer-paper-toolbar"><div class="panel-header customer-paper-heading"><h3 class="panel-title" id="customer-paper-heading">关联论文与发表成果 <small>${c.paperCount} 篇</small></h3></div><div class="search-box customer-paper-search">${icon('search')}<input id="customer-paper-search" type="search" aria-label="搜索该客户的论文" value="${esc(state.drawer.paperSearch||'')}" placeholder="搜索论文题目、编号或作者…"></div><div class="customer-paper-filter"><div class="customer-paper-status-picker" id="customer-paper-status-picker">${customerPaperStatusPicker()}</div><span class="customer-paper-page-size">每页 <strong>${customerPaperPageSize}</strong> 篇</span></div></div><div class="customer-papers" id="customer-paper-results" aria-labelledby="customer-paper-heading">${customerPaperResults()}</div><div class="customer-paper-footer" id="customer-paper-pagination">${customerPaperPagination()}</div>`;
}
function renderCustomerDetail() {
 const c=state.drawer.customer,tab=state.drawer.customerTab==='papers'?'papers':'info';
 state.drawer.customerTab=tab;
 const tabs=[['info','客户资料'],['papers',`关联论文（${c.paperCount}）`]];
 setOverlay(`<div class="overlay"><section class="drawer customer-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><header class="drawer-head"><div><h2 id="drawer-title">${esc(c.name)}</h2><p>客户信息 · ${esc(c.status)}</p></div><button class="icon-btn" data-action="close" aria-label="关闭">${icon('close')}</button></header><div class="detail-tabs customer-detail-tabs" role="tablist" aria-label="客户详情">${tabs.map(([id,label])=>`<button type="button" class="tab ${tab===id?'active':''}" id="customer-tab-${id}" data-action="customer-detail-tab" data-tab="${id}" role="tab" aria-selected="${tab===id}" aria-controls="customer-detail-panel">${label}</button>`).join('')}</div><div class="${tab==='papers'?'customer-paper-panel':'drawer-body customer-info-body'}" id="customer-detail-panel" role="tabpanel" aria-labelledby="customer-tab-${tab}">${tab==='papers'?customerPapersDetail(c):customerInfoDetail(c)}<div class="error-message" role="alert"></div></div><footer class="drawer-foot">${c.paperCount?'<span class="panel-hint">有论文的客户可归档保留</span>':btn('delete-customer','删除','trash','danger small')}<div class="actions">${btn('edit-customer','编辑','edit','primary')}</div></footer></section></div>`);
}
function openCustomerEditor(c=null) {
 const context=state.drawer?.kind==='customer-detail'&&state.drawer.customer.id===c?.id?state.drawer:{};
 clearTimeout(credentialTimer);state.drawer={customerTab:context.customerTab,paperSearch:context.paperSearch,paperPage:context.paperPage,paperStatus:context.paperStatus,kind:'customer-edit',customer:c};
 setOverlay(`<div class="overlay"><section class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><header class="drawer-head"><div><h2 id="drawer-title">${c?'编辑客户':'新增客户'}</h2><p>客户信息修改后，关联论文仍保持对应</p></div><button class="icon-btn" data-action="close" aria-label="关闭">${icon('close')}</button></header><form id="customer-form" novalidate style="display:contents"><div class="drawer-body"><div class="form-grid">${field('name','客户姓名',c?.name,{required:true,max:200})}${field('status','合作状态',c?.status||'合作中',{select:customerStatuses})}
  ${field('customerType','客户类型',c?.customerType||'',{required:true,select:['',...customerTypes],optionLabels:{'他人介绍':'他人推荐'},emptyLabel:'请选择客户类型',hint:'终端客户指自己开发、直接一对一对接的客户。'})}
  ${field('referrer','介绍人',c?.referrer,{max:200,hint:'他人推荐可选填介绍人姓名或来源说明。'})}
  ${field('cooperationStartedAt','合作开始日期',c?.cooperationStartedAt,{type:'date',minDate:'1000-01-01',maxDate:today(),full:true,hint:'记录实际开始合作的日期；尚未合作或日期不确定时可留空。'})}${field('phone','手机号',c?.phone,{type:'tel',max:200})}${field('email','邮箱',c?.email,{type:'email',max:200})}${field('wechat','微信',c?.wechat,{max:200})}${field('organization','单位 / 机构',c?.organization,{max:200})}${field('address','联系地址',c?.address,{full:true,max:300})}${field('notes','客户备注',c?.notes,{textarea:true,full:true})}</div></div><footer class="drawer-foot">${formFeedback()}<span class="panel-hint">以独立客户编号关联业务</span><div class="actions">${btn('cancel-customer','取消')}<button class="btn primary" type="submit">${icon('check')}保存</button></div></footer></form></section></div>`);
}

function hideSubmissionCredentials() { for(const node of document.querySelectorAll?.('[data-secret-value]')||[])node.textContent='••••••••••';for(const button of document.querySelectorAll?.('[data-action="reveal-submission-password"]')||[]){button.innerHTML=`${icon('eye')}显示`;delete button.dataset.visible;} }
function isEditingDrawer() { return fileTransferBusy || ['edit','transaction','customer-edit','submission-edit','termination','publication-fee','reversal','receipt','followup-edit'].includes(state.drawer?.kind); }

function exportManagedPapers() {
 const list=filteredManagedPapers();if(!validDateRange()||!list.length)return toast('当前筛选下没有可导出的论文',true);
 const writingKeys=['writer','writingStatus','writingStartAt','writingDueAt','writingDeliveredAt'];
 const moneyKeys=['writerFeeCents','writerDepositCents','writerBalanceCents','outgoing_depositCents','outgoing_balanceCents','payableCents'];
 paperCsvDownload(`论文档案-${today()}.csv`,[['论文编号','论文题目','服务类型','客户','作者','关联期刊','建档日期','跟进日期','跟进事项 / 由来','服务费用（元）','收款定金（元）','收款尾款（元）','写作人','写作状态','开始日期','预计交稿','实际交稿','稿酬（元）','写作定金（元）','写作尾款（元）','已付定金（元）','已付尾款（元）','未付稿酬（元）'],...list.map(p=>[p.code,p.title,serviceLabel(p),p.customer,p.authors,p.journal,paperCreatedDate(p),p.followUpAt||'',p.followUpReason||'',(p.contractCents||0)/100,(p.contractDepositCents||0)/100,((p.contractCents||0)-(p.contractDepositCents||0))/100,...writingKeys.map(key=>hasWriting(p)?p[key]||'':''),...moneyKeys.map(key=>hasWriting(p)?(p[key]||0)/100:'')])],list);toast(`导出成功，共 ${list.length} 条`);
}
function exportSubmissions() {
 const list=filteredSubmissions();if(!validDateRange()||!list.length)return toast('当前筛选下没有可导出的投稿',true);
 csvDownload(`投稿记录-${today()}.csv`,[['论文编号','论文题目','投稿题目','客户','期刊名称','投稿系统','投稿日期','结束日期','实际发表日期','预计发表日期','投稿状态','投稿时长（天）','服务状态','终止日期','终止原因'],...list.map(s=>[s.paper.code,s.paper.title,s.title,s.paper.customer,s.journal,s.submissionSystem,s.submittedAt,s.endedAt,s.publishedAt,s.expectedPublishedAt||'',s.status,s.durationDays??'',serviceEnded(s.paper)?'服务已终止':'服务中',s.paper.termination?.terminatedAt||'',s.paper.termination?.reason||''])]);toast(`导出成功，共 ${list.length} 条`);
}
function exportCustomers() {
 const list=filteredCustomers();if(!list.length)return toast('当前筛选下没有可导出的客户',true);
 csvDownload(`客户汇总-${today()}.csv`,[['客户姓名','合作状态','合作开始日期','单位','关联论文数','已发表论文数','已发表期刊','约定服务费用（元）','已收款（元）','待收款（元）','客户类型','介绍人'],...list.map(c=>[c.name,c.status,c.cooperationStartedAt||'',c.organization,c.paperCount,c.publishedPaperCount,c.publishedJournals.join('、'),c.contractCents/100,c.receivedCents/100,c.receivableCents/100,customerTypeLabel(c),c.referrer||''])]);toast(`导出成功，共 ${list.length} 条`);
}

document.addEventListener('click',async event=>{
 if(state.drawer?.kind==='customer-detail'&&state.drawer.paperStatusOpen&&!event.target.closest('.customer-paper-status-picker'))setCustomerPaperStatusOpen(false);
 const button=event.target.closest('[data-action]');if(!button||button.disabled||fileTransferBusy)return;const action=button.dataset.action;
 const actions=['new-customer','customer-detail','customer-papers','customer-detail-tab','customer-paper-page','customer-paper-status-toggle','customer-paper-status-option','edit-customer','cancel-customer','delete-customer','new-submission','resubmit-paper','edit-submission','cancel-submission','submission-detail','delete-submission','reveal-submission-password','export-managed-papers','export-submissions','export-customers'];
 if(!actions.includes(action))return;
 try{
  if(action==='new-customer')openCustomerEditor();
  else if(action==='customer-detail')await openCustomer(button.dataset.id);
  else if(action==='customer-papers')await openCustomer(button.dataset.id,true);
  else if(action==='customer-detail-tab'&&state.drawer?.kind==='customer-detail'&&['info','papers'].includes(button.dataset.tab)){
   state.drawer.paperStatusOpen=false;
   state.drawer.customerTab=button.dataset.tab;renderCustomerDetail();
   requestAnimationFrame(()=>$(`#customer-tab-${button.dataset.tab}`)?.focus({preventScroll:true}));
  }
  else if(action==='customer-paper-status-toggle'&&state.drawer?.kind==='customer-detail')setCustomerPaperStatusOpen(!state.drawer.paperStatusOpen,{focusMenu:!state.drawer.paperStatusOpen,restoreFocus:state.drawer.paperStatusOpen});
  else if(action==='customer-paper-status-option'&&state.drawer?.kind==='customer-detail')setCustomerPaperStatus(button.dataset.status||'');
  else if(action==='customer-paper-page'&&state.drawer?.kind==='customer-detail'){
   state.drawer.paperPage=Number(button.dataset.page)||1;renderCustomerPaperResults();
  }
  else if(action==='edit-customer')openCustomerEditor(state.drawer.customer);
  else if(action==='cancel-customer'){if(state.drawer.customer){state.drawer.kind='customer-detail';renderCustomerDetail();}else closeOverlay();}
  else if(['resubmit-paper','new-submission','edit-submission'].includes(action)){
   const {paperId,id}=button.dataset;
   if(action==='edit-submission'&&(!paperId||!id))throw new Error('投稿记录已不存在，请刷新列表后重新编辑');
   if(!state.papers.length){navigateTo('papers');toast('请先在论文管理中新增记录，再登记投稿');return;}
   button.disabled=true;
   const current=beginDrawerRequest();
   const sequence=++submissionOpenSequence,drawer=state.drawer,drawerKind=drawer?.kind;
   const p=paperId?await api(`/api/papers/${encodeURIComponent(paperId)}`):null;
   if(!current()||sequence!==submissionOpenSequence||state.drawer!==drawer||state.drawer?.kind!==drawerKind||!button.isConnected)return;
   if(serviceEnded(p))throw new Error('这篇论文服务已终止，可查看历史投稿记录');
   if(paperId&&p?.id!==paperId)throw new Error('关联论文已变更，请刷新列表');
   if(action==='edit-submission'){
    const s=p.submissions?.find(s=>s.id===id);
    if(!s)throw new Error('投稿记录已不存在，请刷新列表后重新编辑');
    openSubmissionEditor(p,s,{mode:'edit'});
   }else if(action==='resubmit-paper'){
    const source=id?p?.submissions.find(s=>s.id===id):p?.submissions.find(s=>s.id===p.activeSubmissionId)||p?.submissions.at(-1);
    if(!source)throw new Error('原投稿记录已不存在，请刷新列表');
    openSubmissionEditor(p,null,{resubmit:true,source});
   }else openSubmissionEditor(p);
  }
  else if(action==='cancel-submission'){if(state.drawer.paper&&state.drawer.returnToDetails){state.drawer.kind='detail';state.drawer.tab='submissions';renderDetail();}else closeOverlay();}
  else if(action==='submission-detail') {
   const opened=await openDetail(button.dataset.paperId,'submissions');
   if(opened&&button.dataset.id)$(`#submission-${button.dataset.id}`)?.scrollIntoView({block:'start'});
  }
  else if(action==='delete-customer'){
   const c=state.drawer.customer;confirmModal('删除这位客户？',`确认删除客户“${c.name}”的基本资料？`,async()=>{
    const origin=saveContext();await request('DELETE',`/api/customers/${c.id}`,{version:c.version});
    if(origin.csrf!==state.csrf)return;dataLoadSequence++;state.customers=state.customers.filter(customer=>customer.id!==c.id);
    if(origin.current())closeOverlay();renderShell();toast('删除成功');
    try{await loadPapers();}catch(error){if(state.authenticated)toast('删除成功，列表刷新失败，请点击刷新。',true);}
   },'确认删除',true);
  }
  else if(action==='delete-submission'){
   button.disabled=true;
   const current=beginDrawerRequest();
   const inDetail=state.drawer?.kind==='detail'&&state.drawer.paper?.id===button.dataset.paperId;
   const p=inDetail?state.drawer.paper:await api(`/api/papers/${encodeURIComponent(button.dataset.paperId)}`);
   if(!current())return;
   const s=p.submissions.find(s=>s.id===button.dataset.id);
   if(!s)throw new Error('这次投稿已不存在，请刷新列表');
   confirmModal('删除这次投稿？',`将删除“${s.journal}”的这次投稿和账号资料，论文、收支与其他投稿记录保留。`,async()=>{
    const origin=saveContext();
    const saved=await request('DELETE',`/api/papers/${p.id}/submissions/${s.id}`,{version:s.version});
    if(origin.csrf!==state.csrf)return;dataLoadSequence++;
    state.papers=state.papers.map(paper=>paper.id===saved.id?saved:paper);
    syncCustomerSummaries();
    if(origin.current()){if(inDetail){state.modal=null;state.drawer={kind:'detail',paper:saved,tab:'submissions'};renderDetail();}else closeOverlay();}
    renderShell();toast('删除成功');
    try{await loadPapers();}catch(error){if(state.authenticated)toast('删除成功，列表刷新失败，请点击刷新。',true);}
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
document.addEventListener('keydown',handleCustomerPaperStatusKeydown);

document.addEventListener('change',event=>{
 if(event.target.name==='status'&&event.target.form?.id==='submission-form'&&state.drawer?.kind==='submission-edit'){
  if(event.target.value==='终止服务'){
   try{openSubmissionTermination(event.target.form);}catch(error){showFormError(event.target.form,error.message);}
   return;
  }
  event.target.dataset.previousStatus=event.target.value;
 }
 if(event.target.id==='submission-paper'&&state.drawer?.kind==='submission-edit'){
  const p=state.papers.find(p=>p.id===event.target.value),input=$('#f-title',$('#overlay-root'));
  if(p&&input&&(!input.value||input.dataset.automatic==='true')){input.value=p.title;input.dataset.automatic='true';}
  else if(!p&&input?.dataset.automatic==='true'){input.value='';delete input.dataset.automatic;}
  state.drawer.historyPaper=p||null;
  const manuscript=$('#submission-manuscript');if(manuscript)manuscript.innerHTML=manuscriptOptions(p);
  const history=$('#submission-history-root');if(history)history.innerHTML=submissionHistory(p);
  const fees=$('#submission-publication-fees');if(fees){fees.innerHTML=submissionPublicationFields(p);const form=$('#submission-form');if(form)prepareForms($('#overlay-root'));}
  updateJournalNotice($('#f-journal',$('#overlay-root'))?.value||'');
 }
 if(event.target.id==='f-journal'){updateJournalNotice(event.target.value);updateSubmissionPublication(event.target.value);}
});

document.addEventListener('input',event=>{
 if(event.target.id==='customer-paper-search'&&state.drawer?.kind==='customer-detail'){
  state.drawer.paperSearch=event.target.value;state.drawer.paperPage=1;
  renderCustomerPaperResults();
 }
 if(event.target.id==='f-title'&&state.drawer?.kind==='submission-edit')delete event.target.dataset.automatic;
 if(event.target.id==='f-journal'){updateJournalNotice(event.target.value);updateSubmissionPublication(event.target.value);}
});

document.addEventListener('submit',async event=>{
 const form=event.target;if(!['customer-form','submission-form'].includes(form.id))return;
 event.preventDefault();const submit=$('[type=submit]',form);if(submit.disabled)return;
 if(form.id==='submission-form'&&(form.elements?.namedItem?.('status')||form.elements?.status)?.value==='终止服务'){
  try{openSubmissionTermination(form);}catch(error){showFormError(form,error.message);}return;
 }
 if(!validateForm(form))return;const origin=saveContext(),submitLabel=submit.innerHTML;submit.disabled=true;submit.innerHTML='保存中…';const error=$('.error-message',form);error.textContent='';
 try{
  const data=Object.fromEntries(new FormData(form));
  if(form.id==='customer-form'){
   const c=origin.drawer.customer;if(c)data.version=c.version;
   const saved=await request(c?'PUT':'POST',c?`/api/customers/${c.id}`:'/api/customers',data);await finishSave(saved,c?'保存成功':'新增成功',{customer:true,view:'customers',origin});
  }else{
   if(data.status==='终止服务')throw new Error('请通过投稿状态选择终止服务，并确认最终结算');
   const drawer=state.drawer,editing=drawer?.mode==='edit',target=drawer?.target,s=drawer?.submission;
   if(drawer?.kind!=='submission-edit'||!['edit','create','resubmit'].includes(drawer.mode)||
      (form.dataset?.editorId!==undefined&&form.dataset.editorId!==String(drawer.editorId))||
      (editing&&(!target||!s?.id||s.id!==target.submissionId||drawer.paper?.id!==target.paperId))||(!editing&&s))
    throw new Error('投稿记录已变更，请刷新列表后重新编辑');
   const p=drawer.paper||state.papers.find(p=>p.id===data.paperId);
   if(!p)throw new Error('请选择关联论文');
   delete data.paperId;delete data.clearPassword;data.version=editing?target.version:p.version;
   if(editing&&data.publicationFeeMode)data.paperVersion=p.version;
   if(editing){if(form.elements.clearPassword?.checked)data.submissionPassword='';else if(data.submissionPassword==='')delete data.submissionPassword;}
   const saved=await request(editing?'PUT':'POST',`/api/papers/${p.id}/submissions${editing?'/'+target.submissionId:''}`,data);
   await finishSave(saved,drawer.resubmit?'改投成功':editing?'保存成功':'新增成功',{view:'submissions',origin});
  }
 }catch(failure){if(error.isConnected)showFormError(form,failure.message);else toast(failure.message,true);}finally{if(submit.isConnected){submit.disabled=false;submit.innerHTML=submitLabel;}}
});
