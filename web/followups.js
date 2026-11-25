'use strict';

const followUpStatuses={pending:'待处理',in_progress:'跟进中',completed:'已完成',cancelled:'已取消'};
const followUpActive=t=>['pending','in_progress'].includes(t.status);
function paperFollowUps(p) {
 if(Array.isArray(p.followUps))return p.followUps;
 return p.followUpAt&&!terminal(p)?[{id:'legacy',content:p.followUpReason||'',date:p.followUpAt,status:'pending',note:''}]:[];
}
function allFollowUps() {
 return state.papers.flatMap(p=>paperFollowUps(p).map(t=>({...p,followUpTask:t,followUpAt:t.date,followUpReason:t.content})))
  .sort((a,b)=>a.followUpAt.localeCompare(b.followUpAt)||String(a.code||a.id).localeCompare(String(b.code||b.id)));
}
function filteredFollowUps() {
 const query=state.search.trim().toLocaleLowerCase();
 return allFollowUps().filter(p=>{
  const t=p.followUpTask,active=followUpActive(t);
  if(['completed','cancelled'].includes(state.tab)){if(t.status!==state.tab)return false;}
  else if(state.tab!=='history'&&!active)return false;
  if(state.tab==='due'&&t.date>today())return false;
  if(state.tab==='upcoming'&&!upcoming().some(x=>x.id===p.id&&x.followUpTask.id===t.id))return false;
  if(state.status&&t.status!==state.status)return false;
  if(state.from&&t.date<state.from||state.to&&t.date>state.to)return false;
  return !query||[p.title,p.code,p.customer,p.authors,p.writer,p.journal,t.content,t.note].join(' ').toLocaleLowerCase().includes(query);
 });
}
function followUpBadge(t) {
 return `<span class="badge ${t.status==='completed'?'green':t.status==='in_progress'?'blue':'slate'}">${esc(followUpStatuses[t.status]||t.status)}</span>`;
}
function followUpButtons(p,t,withDetail=false) {
 const extra=`data-id="${esc(p.id)}" data-task-id="${esc(t.id)}"`;
 const glyphs={'edit-followup':'edit','complete-followup':'checkCircle','reopen-followup':'refresh','followup-task-detail':'eye'};
 const action=(name,label)=>`<button type="button" class="text-btn" data-action="${name}" ${extra}>${icon(glyphs[name])}${label}</button>`;
 return action('edit-followup','编辑')+action(followUpActive(t)?'complete-followup':'reopen-followup',followUpActive(t)?'完结':'重新打开')+(withDetail?action('followup-task-detail','详情'):'');
}

async function openFollowUpTaskDetail(paperId,taskId) {
 const current=beginDrawerRequest();
 const paper=await api(`/api/papers/${encodeURIComponent(paperId)}`);
 if(!current())return;
 const task=paperFollowUps(paper).find(t=>t.id===taskId);
 if(!task)throw new Error('事项已更新，请刷新列表后重试');
 state.drawer={kind:'followup-detail',paper,task};renderFollowUpTaskDetail();
}
function renderFollowUpTaskDetail() {
 const {paper:p,task:t}=state.drawer;
 const history=(p.followUpHistory||[]).filter(e=>e.taskId===t.id).slice().reverse();
 setOverlay(`<div class="overlay"><section class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><header class="drawer-head"><div><h2 id="drawer-title">跟进事项详情</h2><p>${esc(p.code)} · ${esc(p.title)}</p></div><button class="icon-btn" data-action="close" aria-label="关闭">${icon('close')}</button></header><div class="drawer-body"><div class="detail-meta">${detailField('事项状态',followUpBadge(t))}${detailField('跟进日期',dateLabel(t.date))}${detailField('客户',esc(p.customer))}${detailField('作者',esc(p.authors))}${t.createdAt?detailField('创建时间',instantLabel(t.createdAt)):''}${t.updatedAt?detailField('最近更新',instantLabel(t.updatedAt)):''}${t.closedAt?detailField(t.status==='completed'?'完成时间':'取消时间',instantLabel(t.closedAt),true):''}</div><h3 class="section-heading">跟进事项 / 由来</h3><div class="detail-note">${esc(t.content||'待补充跟进事项')}</div><h3 class="section-heading follow-up-detail-heading">备注 / 处理结果</h3><div class="detail-note">${esc(t.note||'暂无备注')}</div><h3 class="section-heading follow-up-detail-heading">处理历史</h3>${history.length?history.map(e=>`<div class="follow-up-event"><p>${instantLabel(e.at)} · ${followUpBadge(e)} · ${dateLabel(e.date)}</p><div class="follow-up-reason">${esc(e.content)}</div><div class="follow-up-reason">${esc(e.note||'暂无备注')}</div></div>`).join(''):'<div class="empty-small">暂无处理历史，编辑或完结后将保留记录。</div>'}</div><footer class="drawer-foot"><button type="button" class="text-btn" data-action="followup-detail" data-id="${esc(p.id)}">${icon('document')}查看关联论文</button><div class="follow-up-row-actions" role="group" aria-label="跟进事项操作">${followUpButtons(p,t)}${btn('close','关闭')}</div></footer></section></div>`);
}
function cancelFollowUpEditor() {
 const {paper,task,returnToTask}=state.drawer||{};
 if(returnToTask&&paper&&task){state.drawer={kind:'followup-detail',paper,task};renderFollowUpTaskDetail();}
 else if(paper){state.drawer={kind:'detail',paper,tab:'followups'};renderDetail();}
 else closeOverlay();
}
function renderFollowUps() {
 const all=allFollowUps(),plans=followUpPlans();
 const tabs=[['all','全部计划',plans.length],['due','到期待跟进',plans.filter(p=>p.followUpAt<=today()).length],['upcoming','未来 7 天',upcoming().length],['completed','已完成',all.filter(p=>p.followUpTask.status==='completed').length],['cancelled','已取消',all.filter(p=>p.followUpTask.status==='cancelled').length],['history','全部事项',all.length]];
 $('#content').innerHTML=`${pageHeading('待跟进事项','安排、处理和完结事项；客户或作者有新要求时，可以新增事项或重新打开。',btn('export-papers','导出事项','down')+btn('new-followup','新增事项','plus','primary'))}${followUpStats()}<section class="panel"><div class="panel-header"><h2 class="panel-title">跟进事项 <small>FOLLOW-UPS</small></h2>${btn('refresh','刷新','refresh')}</div><div class="tab-bar overview-tabs" role="tablist">${tabs.map(([id,label,count])=>`<button class="tab ${state.tab===id?'active':''}" data-action="tab" data-tab="${id}" role="tab" aria-selected="${state.tab===id}">${label}<span class="count">${count}</span></button>`).join('')}</div><div class="filter-row"><div class="search-box">${icon('search')}<input id="search" type="search" placeholder="搜索论文、客户、作者、事项或备注…" aria-label="搜索跟进事项" value="${esc(state.search)}"></div><select id="status-filter" aria-label="事项状态"><option value="">全部事项状态</option>${Object.entries(followUpStatuses).map(([id,label])=>`<option value="${id}" ${state.status===id?'selected':''}>${label}</option>`).join('')}</select><span class="filter-label">跟进日期</span><input class="date-filter" id="from-filter" type="date" aria-label="跟进起始日期" value="${esc(state.from)}"><span class="date-sep">至</span><input class="date-filter" id="to-filter" type="date" aria-label="跟进截止日期" value="${esc(state.to)}">${btn('clear-filters','重置')}</div><div id="results"></div></section>${footer()}`;
 renderFollowUpResults();
}
function renderFollowUpResults() {
 if(state.from&&state.to&&state.from>state.to){$('#results').innerHTML='<div class="empty-state"><h3>起始日期不能晚于截止日期</h3></div>';return;}
 const list=filteredFollowUps(),paging=pagination(list.length);
 $('#results').innerHTML=list.length?`<div class="table-scroll"><table class="follow-up-table"><thead><tr><th class="sequence-cell" scope="col">序号</th><th>跟进日期 / 事项</th><th>关联论文 / 客户 / 作者</th><th>事项状态</th><th>备注 / 处理结果</th><th>操作</th></tr></thead><tbody>${list.slice((state.page-1)*state.pageSize,state.page*state.pageSize).map((p,i)=>{
  const t=p.followUpTask;
  return `<tr>${sequenceCell(i)}<td><div class="${followUpActive(t)&&t.date<=today()?'due-date':''}">${dateLabel(t.date)}</div><div class="follow-up-reason">${esc(t.content||'待补充跟进事项')}</div></td><td class="paper-cell"><button class="paper-title" data-action="followup-detail" data-id="${esc(p.id)}">${esc(p.title)}</button><div class="cell-sub">${esc(p.code)} · ${esc(p.customer||'未填写客户')}</div><div class="cell-sub">${esc(p.authors||'未填写作者')}</div></td><td>${followUpBadge(t)}${t.closedAt?`<div class="cell-sub">${t.status==='completed'?'完成':'取消'}于 ${instantLabel(t.closedAt)}</div>`:''}</td><td><div class="follow-up-reason">${esc(t.note||'暂无备注')}</div></td><td><div class="follow-up-row-actions" role="group" aria-label="跟进事项操作">${followUpButtons(p,t,true)}</div></td></tr>`;
 }).join('')}</tbody></table></div>${paging}`:`<div class="empty-state"><h3>暂无跟进计划或符合条件的事项</h3><p>可以为已有论文新增事项，也可以调整筛选条件查看历史事项。</p>${btn('new-followup','新增事项','plus')}${btn('clear-filters','重置筛选','refresh')}</div>`;
}
function followUpDetail(p) {
 const tasks=paperFollowUps(p),events=p.followUpHistory||[];
 return `<div class="panel-header"><h3 class="panel-title">跟进事项 <small>${tasks.length} 项</small></h3>${btn('new-followup','新增事项','plus','small',`data-id="${esc(p.id)}"`)}</div><p class="panel-hint">原事项需补充处理时重新打开；新的要求请新增事项，保留各次处理记录。</p>${tasks.length?tasks.map(t=>`<section class="follow-up-card"><div class="panel-header"><strong>${dateLabel(t.date)} ${followUpBadge(t)}</strong><div class="actions">${followUpButtons(p,t)}</div></div><div class="detail-note">${esc(t.content||'待补充跟进事项')}</div><p class="follow-up-reason">备注 / 处理结果：${esc(t.note||'暂无备注')}</p>${t.closedAt?`<p class="panel-hint">${t.status==='completed'?'完成':'取消'}于 ${instantLabel(t.closedAt)}</p>`:''}<details><summary>查看处理历史</summary>${events.filter(e=>e.taskId===t.id).reverse().map(e=>`<div class="follow-up-event"><p>${instantLabel(e.at)} · ${followUpBadge(e)} · ${dateLabel(e.date)}</p><div class="follow-up-reason">${esc(e.content)}</div><div class="follow-up-reason">${esc(e.note||'暂无备注')}</div></div>`).join('')||'<p class="panel-hint">历史计划迁入，暂无编辑记录。</p>'}</details></section>`).join(''):'<div class="empty-small">暂无跟进事项，可记录客户或作者的新要求。</div>'}`;
}
async function openFollowUpEditor(paperId='',taskId='',mode='edit') {
 if(!paperId&&!state.papers.length){toast('请先在论文管理中建立论文，再新增跟进事项',true);return;}
 const current=beginDrawerRequest();
 const paper=paperId?await api(`/api/papers/${encodeURIComponent(paperId)}`):null;
 if(!current())return;
 const task=taskId?paperFollowUps(paper).find(t=>t.id===taskId):null;
 if(taskId&&!task)throw new Error('事项已更新，请刷新列表后重试');
 const returnToTask=state.drawer?.kind==='followup-detail'&&state.drawer.task.id===taskId;
 state.drawer={kind:'followup-edit',paper,task,returnToTask};
 const title=mode==='complete'?'完结事项':mode==='reopen'?'重新打开事项':task?'编辑事项':'新增跟进事项';
 const options=[...state.papers].sort((a,b)=>a.title.localeCompare(b.title));
 const select=paper?`<p class="detail-note">${esc(paper.title)} · ${esc(paper.customer||'未填写客户')} · ${esc(paper.authors||'未填写作者')}</p>`:field('paperId','关联论文','',{select:['',...options.map(p=>p.id)],optionLabels:Object.fromEntries(options.map(p=>[p.id,`${p.code} · ${p.title} · ${p.customer||'未填写客户'}`])),emptyLabel:'请选择论文',required:true,full:true});
 setOverlay(`<div class="overlay"><section class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><header class="drawer-head"><div><h2 id="drawer-title">${title}</h2><p>跟进事项独立记录，不受论文投稿状态限制。</p></div>${btn('close','关闭')}</header><form id="followup-form" novalidate style="display:contents"><div class="drawer-body">${formGuide()}<div class="form-grid">${select}${field('content','跟进事项 / 由来',task?.content||'',{textarea:true,required:true,full:true,max:1000,placeholder:'记录客户或作者的要求，以及需要处理什么。'})}${field('date','跟进日期',task?.date||today(),{type:'date',required:true})}${field('status','事项状态',mode==='complete'?'completed':mode==='reopen'?'pending':task?.status||'pending',{select:Object.keys(followUpStatuses),optionLabels:followUpStatuses,required:true})}${field('note','备注 / 处理结果',task?.note||'',{textarea:true,full:true,max:5000,placeholder:'记录沟通情况、处理结果或重新打开的原因。',hint:'每次保存都会保留当时的内容、状态和备注。'})}</div></div><footer class="drawer-foot">${formFeedback()}<div class="actions">${btn('cancel-followup','取消')}<button class="btn primary" type="submit">${title==='完结事项'?'确认完结':'保存事项'}</button></div></footer></form></section></div>`);
}
async function saveFollowUpForm(form,data,origin) {
 const drawer=origin.drawer;
 let paper=drawer.paper;
 if(!paper){paper=await api(`/api/papers/${encodeURIComponent(data.paperId)}`);if(!origin.current())return;}
 const task=drawer.task;
 const saved=await request(task?'PUT':'POST',`/api/papers/${paper.id}/followups${task?'/'+task.id:''}`,{content:data.content,date:data.date,status:data.status,note:data.note,version:paper.version});
 if(origin.csrf!==state.csrf)return;
 dataLoadSequence++;state.papers=[saved,...state.papers.filter(p=>p.id!==saved.id)];syncCustomerSummaries();
 if(origin.current()){
  if(drawer.returnToTask){state.drawer={kind:'followup-detail',paper:saved,task:paperFollowUps(saved).find(t=>t.id===task.id)};renderFollowUpTaskDetail();}
  else {state.drawer={kind:'detail',paper:saved,tab:'followups'};renderDetail();}
 }
 renderShell();toast(data.status==='completed'?'事项已完结，历史记录已保留':'事项已保存');
}
function exportFollowUps() {
 const list=filteredFollowUps();if(!validDateRange()||!list.length)return toast('当前筛选下没有可导出的事项',true);
 paperCsvDownload(`跟进事项-${today()}.csv`,[['论文编号','论文题目','客户','作者','跟进日期','跟进事项 / 由来','事项状态','备注 / 处理结果','完结时间'],...list.map(p=>[p.code,p.title,p.customer,p.authors,p.followUpAt,p.followUpReason,followUpStatuses[p.followUpTask.status],p.followUpTask.note,p.followUpTask.closedAt||''])],list);
 toast(`导出成功，共 ${list.length} 条`);
}
