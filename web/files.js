// Manuscript files are immutable revisions; submission records keep their selected revision.
let fileTransferBusy=false;
const fileUploadTokens=new WeakMap();
function fileSize(bytes) { return bytes>=1024*1024?`${(bytes/1024/1024).toFixed(1)} MB`:`${Math.ceil(bytes/1024)} KB`; }
function sortedManuscripts(p) { return [...(p?.files||[])].sort((a,b)=>b.revision-a.revision); }
function manuscriptShortcut(p) {
 const count=p.files?.length||0;
 return `<div class="cell-sub"><button class="text-btn manuscript-shortcut" data-action="paper-files" data-id="${esc(p.id)}">${icon('document')}${count?`稿件 ${count} 个`:'上传稿件'}</button></div>`;
}
function uploadedManuscripts(p) {
 const files=sortedManuscripts(p);
 return `<div class="uploaded-manuscripts"><h4>已上传稿件 <small>${files.length} 个</small></h4>${files.length?files.map((f,index)=>`<article class="uploaded-manuscript"><div class="uploaded-manuscript-main"><strong>V${f.revision}${index===0?' <span class="file-latest">最新版本</span>':''}</strong><p class="file-name">${esc(f.filename)}</p><p class="panel-hint">${fileSize(f.size)} · ${instantLabel(f.uploadedAt)}</p>${f.note?`<p class="manuscript-note">${esc(f.note)}</p>`:''}</div><a class="btn small" href="/api/papers/${encodeURIComponent(p.id)}/files/${encodeURIComponent(f.id)}">${icon('down')}下载</a></article>`).join(''):'<p class="panel-hint">尚未上传稿件，选择文件后点击保存。</p>'}</div>`;
}
function manuscriptSummary(p) {
 const files=sortedManuscripts(p),latest=files[0];
 return `<section class="manuscript-summary"><div class="panel-header"><h3 class="panel-title">${icon('document')}论文文件 <small>${files.length} 个</small></h3>${btn('detail-tab',files.length?'全部版本 / 上传':'上传稿件','upload','small','data-tab="files"')}</div>${latest?`<p class="panel-hint">最新稿件</p><div class="latest-manuscript">${manuscriptLink(p,latest.id)}</div><p class="panel-hint">${fileSize(latest.size)} · ${instantLabel(latest.uploadedAt)}</p>`:'<p class="panel-hint">尚未上传稿件。</p>'}</section>`;
}
function fileUploadFields(required=false,p=null) {
 const limit=state.fileMaxBytes||50*1024*1024;
 return `<div class="form-section"><h3 class="section-heading">${icon('document')}论文文件</h3>${required?'':uploadedManuscripts(p)}<div class="form-grid"><div class="field full"><label for="manuscript-file">${required?'上传新版本':p?.files?.length?'上传新版本（选填）':'上传稿件（选填）'}</label><input id="manuscript-file" type="file" accept=".doc,.docx,.pdf" ${required?'required':''}><small>支持 Word、PDF，单文件最多 ${fileSize(limit)}。${required?'每次上传保留为独立版本。':'选择文件后点击下方“保存”，保存后上传；已有版本继续保留。'}</small></div><div class="field full"><label for="manuscript-note">修改说明（选填）</label><textarea id="manuscript-note" maxlength="1000" rows="2" placeholder="例如：初稿、根据审稿意见修改、录用终稿"></textarea></div></div><div class="file-transfer-status" role="status" aria-live="polite" hidden><progress max="100" value="0" aria-label="文件上传进度"></progress><span></span></div></div>`;
}
function manuscriptOptions(p,selected='') {
 return `<option value="">暂不关联稿件</option>${[...(p?.files||[])].reverse().map(f=>`<option value="${esc(f.id)}" ${f.id===selected?'selected':''}>V${f.revision} · ${esc(f.filename)}</option>`).join('')}`;
}
function manuscriptSelect(p,s) {
 return `<div class="field full"><label for="submission-manuscript">本次投稿稿件</label><select id="submission-manuscript" name="manuscriptId">${manuscriptOptions(p,s?.manuscriptId)}</select><small>选择本次实际使用的版本。后续上传新稿将保留此次关联。</small></div>`;
}
function manuscriptLink(p,id) {
 const file=(p.files||[]).find(f=>f.id===id);
 return file?`<a class="text-btn" href="/api/papers/${encodeURIComponent(p.id)}/files/${encodeURIComponent(file.id)}">${icon('down')}V${file.revision} · ${esc(file.filename)}</a>`:'未关联稿件';
}
function fileVersions(p) {
 const files=sortedManuscripts(p);
 return `<div class="notice green">${icon('info')}每次上传生成独立版本，历史稿件可随时下载。</div><form id="file-form" novalidate>${fileUploadFields(true)}${formFeedback()}<button class="btn primary" type="submit">${icon('upload')}上传${files.length?'新版本':'初稿'}</button></form><div class="panel-header file-list-heading"><h3 class="panel-title">历史版本 <small>${files.length} 个</small></h3></div>${files.length?files.map((f,index)=>`<article class="submission-card file-version"><div class="submission-card-head"><div><h3>V${f.revision}${index===0?' <span class="file-latest">最新版本</span>':''}</h3><p class="file-name">${esc(f.filename)}</p></div><a class="btn small" href="/api/papers/${encodeURIComponent(p.id)}/files/${encodeURIComponent(f.id)}">${icon('down')}下载</a></div><p class="panel-hint">${fileSize(f.size)} · ${instantLabel(f.uploadedAt)}</p>${f.note?`<div class="detail-note">${esc(f.note)}</div>`:''}</article>`).join(''):'<div class="empty-small">尚未上传稿件，可先上传初稿。</div>'}`;
}
function selectedManuscript(form) {
 const file=$('#manuscript-file',form)?.files?.[0];
 if(file) {
  if(!/\.(docx?|pdf)$/i.test(file.name))throw new Error('仅支持 DOC、DOCX、PDF 文件');
  if(!file.size)throw new Error('不能上传空文件');
  if(file.size>(state.fileMaxBytes||50*1024*1024))throw new Error('文件超过允许大小');
 }
 return file;
}
function binaryRequest(path,file,headers={},form=null) {
 return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();xhr.open('POST',path);xhr.timeout=10*60*1000;
  xhr.setRequestHeader('Content-Type','application/octet-stream');xhr.setRequestHeader('X-CSRF-Token',state.csrf);
  for(const [name,value] of Object.entries(headers))xhr.setRequestHeader(name,value);
  const progress=form&&$('.file-transfer-status',form);if(progress)progress.hidden=false;
  xhr.upload.onprogress=event=>{if(!progress)return;const percent=event.lengthComputable?Math.round(event.loaded/event.total*100):0;const bar=$('progress',progress),label=$('span',progress);if(bar)bar.value=percent;if(label)label.textContent=percent===100?'上传完成，正在校验保存…':`正在上传 ${percent}%`;};
  xhr.onload=()=>{let result;try{result=JSON.parse(xhr.responseText);}catch{reject(new Error('服务器响应异常，请刷新后核对文件版本'));return;}if(xhr.status>=200&&xhr.status<300)resolve(result);else reject(new Error(result.error||'文件传输失败'));};
  xhr.onerror=()=>reject(new Error('网络连接中断，请检查连接后重试'));
  xhr.ontimeout=()=>reject(new Error('文件传输超时，请重试'));xhr.onabort=()=>reject(new Error('文件传输已取消'));
  xhr.send(file);
 });
}
async function uploadManuscript(p,file,form) {
 fileTransferBusy=true;
 if(!fileUploadTokens.has(file))fileUploadTokens.set(file,crypto.randomUUID());
 try{return await binaryRequest(`/api/papers/${encodeURIComponent(p.id)}/files`,file,{'X-Paper-Version':String(p.version),'X-Upload-Id':fileUploadTokens.get(file),'X-File-Name':encodeURIComponent(file.name),'X-File-Note':encodeURIComponent($('#manuscript-note',form)?.value||'')},form);}
 finally{fileTransferBusy=false;}
}
document.addEventListener('submit',async event=>{
 const form=event.target;if(form.id!=='file-form')return;event.preventDefault();const button=$('[type=submit]',form);if(button.disabled||fileTransferBusy)return;
 const label=button.innerHTML;button.disabled=true;button.innerHTML='上传中…';
 try {
  const file=selectedManuscript(form);if(!file)throw new Error('请选择稿件文件');
  const updated=await uploadManuscript(state.drawer.paper,file,form);
  state.papers=state.papers.map(p=>p.id===updated.id?updated:p);state.drawer={kind:'detail',paper:updated,tab:'files'};renderShell();renderDetail();toast('稿件上传成功');
 }catch(error){showFormError(form,error.message);}finally{if(button.isConnected){button.disabled=false;button.innerHTML=label;}}
});
