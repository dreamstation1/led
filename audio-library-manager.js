/* Owner-only GitHub audio editor. Credentials stay in this tab's memory. */
(function(root){
'use strict';
const REPO='dreamstation1/led',BRANCH='main',MAX_AUDIO_BYTES=20*1024*1024;
const EXT=/\.(wav|mp3|m4a|ogg)$/i;
const normalize=name=>String(name||'').replace(/\s*\(1\)$/,'').replace(/[\s.·ㆍ]/g,'');
function fileInfo(name){const english=/ \(1\)\.(wav|mp3|m4a|ogg)$/i.test(name);return {name,station:name.replace(EXT,'').replace(/ \(1\)$/,''),language:english?'english':'korean'};}
function filename(station,language,original){
 const name=String(station||'').trim().replace(/\s*\(1\)$/,'');
 if(!name||name.length>120||/[\\/\x00-\x1f]/.test(name)||name==='.'||name==='..'||name.startsWith('.'))throw Error('정류소명을 올바르게 입력해 주세요.');
 const ext=String(original||'').match(EXT)?.[1]?.toLowerCase();if(!ext)throw Error('WAV·MP3·M4A·OGG 파일을 선택해 주세요.');
 if(!['korean','english'].includes(language))throw Error('언어를 선택해 주세요.');
 return name+(language==='english'?' (1)':'')+'.'+ext;
}
function settingsCopy(settings){const out={version:1,stops:Object.create(null)};if(settings?.version===1)for(const [name,rule] of Object.entries(settings.stops||{})){const r={};if(['auto','tts'].includes(rule?.korean))r.korean=rule.korean;if(['auto','tts','off'].includes(rule?.english))r.english=rule.english;out.stops[normalize(name)]=r;}return out;}
function planChanges(snapshot,{uploads=new Map(),deletes=new Set(),rules=new Map()}){
 const files=new Set(snapshot.files),settings=settingsCopy(snapshot.settings),tree=[];
 for(const name of deletes){if(!EXT.test(name)||/[\\/]/.test(name))throw Error('잘못된 음원 경로입니다.');if(files.has(name)){files.delete(name);tree.push({path:'audio/'+name,mode:'100644',type:'blob',sha:null});}const info=fileInfo(name),key=normalize(info.station),rule=settings.stops[key]||(settings.stops[key]={});if(rule[info.language]!=='off')rule[info.language]='tts';}
 for(const [name] of uploads){if(!EXT.test(name)||/[\\/]/.test(name))throw Error('잘못된 음원 경로입니다.');const info=fileInfo(name);
  for(const old of files){const prior=fileInfo(old);if(old!==name&&prior.station===info.station&&prior.language===info.language){files.delete(old);tree.push({path:'audio/'+old,mode:'100644',type:'blob',sha:null});}}
  files.add(name);
 }
 for(const {station,language,mode} of rules.values()){if(!(language==='korean'?['auto','tts']:['auto','tts','off']).includes(mode))throw Error('잘못된 안내 설정입니다.');const key=normalize(station);(settings.stops[key]||(settings.stops[key]={}))[language]=mode;}
 return {files:[...files].sort((a,b)=>a.localeCompare(b,'ko')),settings,tree};
}
function decodeText(base64){const raw=atob(base64.replace(/\s/g,''));return new TextDecoder().decode(Uint8Array.from(raw,c=>c.charCodeAt(0)));}
function toBase64(buffer){const data=new Uint8Array(buffer);let s='';for(let i=0;i<data.length;i+=0x8000)s+=String.fromCharCode(...data.subarray(i,i+0x8000));return btoa(s);}
class GithubAudioStore{
 constructor(fetcher=(url,options)=>globalThis.fetch(url,options)){this.fetcher=fetcher;this.token='';}
 disconnect(){this.token='';}
 async request(path,method='GET',body){
  if(!this.token)throw Error('먼저 GitHub에 연결해 주세요.');
  const response=await this.fetcher('https://api.github.com/repos/'+REPO+path,{method,cache:'no-store',headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+this.token,'X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(90000)});
  if(!response.ok){if(response.status===401)throw Error('연결 키가 맞지 않거나 만료됐습니다. 다시 연결해 주세요.');if(response.status===403)throw Error('저장 권한이 없습니다. led 저장소의 Contents 읽기·쓰기 권한을 확인해 주세요.');if([409,422].includes(response.status))throw Error('다른 변경이 먼저 저장됐습니다. 변경 목록은 유지되니 저장을 다시 눌러 주세요.');throw Error('GitHub 요청 실패 ('+response.status+'). 변경 목록은 유지됩니다.');}
  return response.status===204?null:response.json();
 }
 async connect(token){this.token=String(token||'').trim();try{const repo=await this.request('');if(repo.permissions?.push===false)throw Error('이 저장소를 수정할 권한이 없습니다.');return repo;}catch(e){this.disconnect();throw e;}}
 async snapshot(){
  const ref=await this.request('/git/ref/heads/'+BRANCH),head=ref.object.sha,commit=await this.request('/git/commits/'+head),treeSha=commit.tree.sha;
  const tree=await this.request('/git/trees/'+treeSha+'?recursive=1');if(tree.truncated)throw Error('저장소 목록이 너무 커서 안전하게 저장할 수 없습니다.');
  const blobs=new Map(tree.tree.filter(e=>e.type==='blob').map(e=>[e.path,e.sha]));
  const read=async(path,optional=false)=>{if(!blobs.has(path)){if(optional)return {version:1,stops:{}};throw Error('음원 목록 파일이 없습니다.');}const b=await this.request('/git/blobs/'+blobs.get(path));return JSON.parse(decodeText(b.content));};
  const [files,settings]=await Promise.all([read('audio-files.json'),read('audio-settings.json',true)]);if(!Array.isArray(files)||!files.every(f=>typeof f==='string'))throw Error('음원 목록 형식이 잘못됐습니다.');return {head,treeSha,files,settings,blobs};
 }
 async publish(changes,progress=()=>{}){
  progress('최신 목록 확인 중…');const snapshot=await this.snapshot(),plan=planChanges(snapshot,changes),tree=plan.tree.filter(e=>snapshot.blobs.has(e.path));
  let done=0;for(const [name,file] of changes.uploads){if(file.size>MAX_AUDIO_BYTES)throw Error('파일 하나는 20MB 이하로 선택해 주세요.');progress('음원 업로드 '+(++done)+'/'+changes.uploads.size+'…');const blob=await this.request('/git/blobs','POST',{content:toBase64(await file.arrayBuffer()),encoding:'base64'});tree.push({path:'audio/'+name,mode:'100644',type:'blob',sha:blob.sha});}
  tree.push({path:'audio-files.json',mode:'100644',type:'blob',content:JSON.stringify(plan.files,null,2)+'\n'},{path:'audio-settings.json',mode:'100644',type:'blob',content:JSON.stringify(plan.settings,null,2)+'\n'});
  progress('목록과 안내 설정 저장 중…');const made=await this.request('/git/trees','POST',{base_tree:snapshot.treeSha,tree}),commit=await this.request('/git/commits','POST',{message:'Manage stop audio from audio library',tree:made.sha,parents:[snapshot.head]});
  // force:false rejects a concurrent branch change rather than overwriting it.
  await this.request('/git/refs/heads/'+BRANCH,'PATCH',{sha:commit.sha,force:false});return {...plan,sha:commit.sha};
 }
}
const core={normalize,fileInfo,filename,planChanges,GithubAudioStore,MAX_AUDIO_BYTES};
if(typeof module!=='undefined'&&module.exports){module.exports=core;return;}
if(!root.document||!root.AudioLibrary)return;
const $=id=>document.getElementById(id),library=root.AudioLibrary,store=new GithubAudioStore();
const uploads=new Map(),deletes=new Set(),rules=new Map(),previews=new Map();let settings={version:1,stops:{}},busy=false;
const panel=document.createElement('section');panel.id='audioManager';panel.className='manager';
panel.innerHTML=`<details id="manageDetails"><summary>음원 관리 · 추가 / 삭제 / TTS 설정</summary><p class="manager-note">녹음 삭제는 해당 언어를 TTS로 대체합니다. 영어를 아예 끄려면 ‘영어 안내 안 함’을 선택하세요. 변경 목록을 확인하고 저장하면 사이트 전체에 적용됩니다.</p><div class="manager-connection"><button type="button" id="connectGithub">GitHub 연결</button><button type="button" id="disconnectGithub" hidden>연결 해제</button><span id="connectionState">연결 안 됨</span></div><div class="manager-fields"><label>정류소명<input id="manageStation" list="audioStationNames" placeholder="실제 정류소명" maxlength="120" autocomplete="off"></label><label>언어<select id="manageLanguage"><option value="korean">한국어</option><option value="english">영어</option></select></label><label>안내 방식<select id="manageMode"><option value="auto">녹음 우선</option><option value="tts">TTS로 안내</option></select></label></div><datalist id="audioStationNames"></datalist><div class="manager-buttons"><button type="button" id="queueMode">안내 설정 변경</button></div><label class="manager-upload">추가·교체할 음원<input id="manageFile" type="file" accept=".wav,.mp3,.m4a,.ogg,audio/wav,audio/mpeg,audio/mp4,audio/ogg"></label><p id="manageFilename" class="manager-note">영어는 파일명 뒤에 ‘ (1)’을 자동으로 붙입니다. 같은 정류소·언어의 기존 녹음은 교체됩니다.</p><button type="button" id="queueUpload">음원 추가·교체</button><p class="manager-note">기존 TTS·영어 끄기 설정은 업로드만으로 바뀌지 않습니다. 새 녹음을 사용하려면 안내 방식을 ‘녹음 우선’으로 변경해 주세요.</p><div class="manager-pending"><strong id="pendingCount">저장할 변경 없음</strong><ul id="pendingList"></ul><div class="manager-buttons"><button type="button" id="saveAudioChanges" disabled>변경 저장</button><button type="button" id="discardAudioChanges" disabled>변경 취소</button></div></div><p id="manageStatus" role="status" aria-live="polite"></p></details>`;
panel.querySelector('summary').textContent='음원 관리 · 추가 / 삭제 / TTS 설정';document.querySelector('.tools').before(panel);
const dialog=document.createElement('dialog');dialog.id='githubConnectDialog';dialog.innerHTML=`<form id="githubConnectForm" class="modal"><h2>GitHub 연결</h2><p>dreamstation1/led만 선택한 연결 키를 입력하세요. 저장하려면 Contents 권한을 읽기 및 쓰기로 설정해야 합니다.</p><p><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">GitHub에서 연결 키 만들기 ↗</a></p><details class="manager-note"><summary>연결 키 설정 순서</summary><ol><li>위 링크에서 GitHub에 로그인합니다.</li><li>Repository access에서 Only select repositories를 고르고 led만 선택합니다.</li><li>Repository permissions의 Contents를 Read and write로 설정합니다.</li><li>Generate token으로 만든 키를 아래에 붙여 넣습니다.</li></ol></details><label>연결 키<input id="githubToken" class="password" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" required></label><p class="manager-note">키는 이 탭의 메모리에서만 사용하며, 파일이나 브라우저 저장소에 저장하지 않습니다. 탭을 닫으면 다시 연결해야 합니다.</p><div id="githubConnectError" class="error" role="alert"></div><div class="modal-actions"><button id="githubConnectCancel" type="button">취소</button><button id="githubConnectSubmit" type="submit" class="ok">연결</button></div></form>`;document.body.append(dialog);
const css=document.createElement('style');css.textContent=`.manager{border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:12px;margin:0 0 12px;overflow-wrap:anywhere}.manager summary{font-weight:750;min-height:36px;cursor:pointer;display:list-item}.manager-note{color:var(--muted);font-size:13px;line-height:1.6}.manager-connection,.manager-buttons{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:10px 0}.manager button,.manager select,.manager input:not([type=file]){min-height:44px;border:1px solid #435267;border-radius:10px;background:#202d3d;color:var(--text);padding:8px 10px;font-size:14px;max-width:100%}.manager button:disabled{opacity:.5}.manager-fields{display:grid;grid-template-columns:2fr 1fr 2fr;gap:8px}.manager-fields label{min-width:0;font-size:13px;display:grid;gap:5px}.manager-fields input,.manager-fields select{width:100%}.manager-upload{display:grid;gap:8px;font-size:14px;margin-top:16px}.manager input[type=file]{width:100%;font-size:14px}.manager-pending{border-top:1px solid var(--line);margin-top:14px;padding-top:14px}#pendingList{padding-left:22px}#pendingList li{margin:10px 0;font-size:13px}#pendingList audio{display:block;width:100%;max-width:360px;margin-top:6px}#pendingList button{margin:5px;min-height:36px}.item.pending-delete{opacity:.65}.item .manage-delete{font-size:13px;color:#ff9ba3}.item{grid-template-columns:minmax(0,1fr) auto auto auto}.manager-mode{font-size:12px;background:#182535;color:var(--text);border:1px solid #435267;border-radius:7px;padding:5px;min-height:36px;max-width:100%}.meta{flex-wrap:wrap}#saveAudioChanges{background:#176bb2}#manageStatus{font-size:14px;line-height:1.6}#githubConnectDialog a{color:var(--blue)}@media(max-width:560px){.manager-fields{grid-template-columns:1fr 1fr}.manager-fields label:first-child{grid-column:1/-1}.item{grid-template-columns:minmax(0,1fr) 40px 40px 44px;gap:5px}.item .action{min-width:40px;padding:0;font-size:16px}.item .manage-delete{font-size:12px}.manager-mode{width:100%}}`;document.head.append(css);
function status(message,error=false){$('manageStatus').textContent=message;$('manageStatus').style.color=error?'#ff9ba3':'';}
function count(){return uploads.size+deletes.size+rules.size;}
function mode(station,language){return rules.get(normalize(station)+':'+language)?.mode||settings.stops?.[normalize(station)]?.[language]||'auto';}
function setRule(station,language,value){rules.set(normalize(station)+':'+language,{station,language,mode:value});}
function busyState(on){busy=on;panel.querySelectorAll('button,input,select').forEach(e=>e.disabled=on);$('saveAudioChanges').disabled=on||!count()||!store.token;$('discardAudioChanges').disabled=on||!count();library.render();}
function pending(){
 $('pendingCount').textContent=count()?'저장할 변경 '+count()+'개':'저장할 변경 없음';
 $('pendingList').replaceChildren();
 const item=(text,remove,preview)=>{const li=document.createElement('li'),label=document.createElement('span'),button=document.createElement('button');label.textContent=text;button.type='button';button.textContent='취소';button.disabled=busy;button.onclick=remove;li.append(label,button);if(preview){const audio=document.createElement('audio');audio.controls=true;audio.preload='metadata';audio.src=preview;li.append(audio);}$('pendingList').append(li);};
 for(const [name] of uploads)item('추가·교체: '+name,()=>{uploads.delete(name);URL.revokeObjectURL(previews.get(name));previews.delete(name);pending();},previews.get(name));
 for(const name of deletes)item('녹음 삭제 → TTS: '+name,()=>{deletes.delete(name);pending();});
 for(const [key,r] of rules)item(r.station+' · '+(r.language==='english'?'영어':'한국어')+' → '+({auto:'녹음 우선',tts:'TTS',off:'영어 안내 안 함'})[r.mode],()=>{rules.delete(key);pending();});
 $('saveAudioChanges').disabled=busy||!count()||!store.token;$('discardAudioChanges').disabled=busy||!count();library.render();
}
function queueDelete(name){if(busy)return;uploads.delete(name);if(previews.has(name)){URL.revokeObjectURL(previews.get(name));previews.delete(name);}deletes.add(name);$('manageDetails').open=true;pending();status('변경 목록에 추가했습니다. 저장하면 이 녹음이 삭제됩니다.');}
function decorateRow(row,info){
 const x=fileInfo(info.file);row.classList.toggle('pending-delete',deletes.has(info.file));
 const select=document.createElement('select');select.className='manager-mode';select.setAttribute('aria-label',x.station+' '+(x.language==='english'?'영어':'한국어')+' 안내 방식');
 for(const [value,label] of [['auto','녹음 우선'],['tts','TTS로 안내'],...(x.language==='english'?[['off','영어 안내 안 함']]:[])]){const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o);}select.value=mode(x.station,x.language);select.disabled=busy;select.onchange=()=>{setRule(x.station,x.language,select.value);$('manageDetails').open=true;pending();};row.querySelector('.meta').append(select);
 const del=document.createElement('button');del.type='button';del.className='action manage-delete';del.textContent=deletes.has(info.file)?'취소':'삭제';del.title='녹음 삭제 · TTS로 대체';del.setAttribute('aria-label',x.station+' '+(x.language==='english'?'영어':'한국어')+' 녹음 '+del.textContent);del.disabled=busy;del.onclick=()=>{if(deletes.has(info.file)){deletes.delete(info.file);pending();}else queueDelete(info.file);};row.append(del);
}
root.AudioLibraryManager={decorateRow};
function fillModes(){const selected=$('manageMode').value;$('manageMode').replaceChildren();for(const [value,label] of [['auto','녹음 우선'],['tts','TTS로 안내'],...($('manageLanguage').value==='english'?[['off','영어 안내 안 함']]:[])]){const o=document.createElement('option');o.value=value;o.textContent=label;$('manageMode').append(o);}$('manageMode').value=mode($('manageStation').value,$('manageLanguage').value)||selected;}
$('manageLanguage').onchange=fillModes;$('manageStation').addEventListener('change',fillModes);
$('manageFile').onchange=()=>{const f=$('manageFile').files[0];if(f&&!$('manageStation').value){const info=fileInfo(f.name);$('manageStation').value=info.station;$('manageLanguage').value=info.language;fillModes();}};
$('queueMode').onclick=()=>{const station=$('manageStation').value.trim();try{filename(station,$('manageLanguage').value,'check.wav');setRule(station,$('manageLanguage').value,$('manageMode').value);pending();status('안내 설정을 변경 목록에 추가했습니다.');}catch(e){status(e.message,true);}};
$('queueUpload').onclick=()=>{try{const file=$('manageFile').files[0];if(!file)throw Error('추가할 음원을 선택해 주세요.');if(file.size>MAX_AUDIO_BYTES)throw Error('파일 하나는 20MB 이하로 선택해 주세요.');if(!file.size)throw Error('빈 파일은 추가할 수 없습니다.');const name=filename($('manageStation').value,$('manageLanguage').value,file.name);if(previews.has(name))URL.revokeObjectURL(previews.get(name));uploads.set(name,file);previews.set(name,URL.createObjectURL(file));deletes.delete(name);pending();status(name+'을 변경 목록에 추가했습니다.');}catch(e){status(e.message,true);}};
function discard(){for(const url of previews.values())URL.revokeObjectURL(url);previews.clear();uploads.clear();deletes.clear();rules.clear();pending();}
$('discardAudioChanges').onclick=()=>{discard();status('저장 전 변경을 취소했습니다.');};
$('connectGithub').onclick=()=>{$('githubConnectError').textContent='';$('githubConnectDialog').showModal();$('githubToken').focus();};
$('githubConnectCancel').onclick=()=>{if(!$('githubConnectSubmit').disabled){$('githubToken').value='';dialog.close();}};
dialog.addEventListener('cancel',e=>{if($('githubConnectSubmit').disabled)e.preventDefault();else $('githubToken').value='';});
$('githubConnectForm').onsubmit=async e=>{e.preventDefault();const input=$('githubToken'),token=input.value;input.value='';$('githubConnectSubmit').disabled=true;$('githubConnectCancel').disabled=true;$('githubConnectError').textContent='연결 중…';try{await store.connect(token);const snapshot=await store.snapshot();settings=settingsCopy(snapshot.settings);library.setFiles(snapshot.files);$('connectionState').textContent='GitHub 연결됨';$('connectGithub').textContent='다시 연결';$('disconnectGithub').hidden=false;dialog.close();pending();status('연결했습니다. 변경 목록을 확인한 뒤 저장하세요.');}catch(error){store.disconnect();$('connectionState').textContent='연결 안 됨';$('disconnectGithub').hidden=true;pending();$('githubConnectError').textContent=error.message;}finally{$('githubConnectSubmit').disabled=false;$('githubConnectCancel').disabled=false;}};
$('disconnectGithub').onclick=()=>{store.disconnect();$('connectionState').textContent='연결 안 됨';$('disconnectGithub').hidden=true;pending();};
$('saveAudioChanges').onclick=async()=>{if(busy||!count())return;busyState(true);library.stop();try{const result=await store.publish({uploads,deletes,rules},message=>status(message));settings=result.settings;library.setFiles(result.files);discard();$('manageFile').value='';status('GitHub에 저장했습니다. 사이트 배포에는 보통 1~3분이 걸립니다. 배포 후 지도를 새로고침하면 안내방송에도 적용됩니다.');const a=document.createElement('a');a.href='https://github.com/'+REPO+'/commit/'+result.sha;a.textContent='저장 내역 보기';a.target='_blank';a.rel='noopener noreferrer';$('manageStatus').append(' ',a);}catch(error){status(error.message,true);}finally{busyState(false);}};
addEventListener('pageshow',()=>{if(!store.token){$('connectionState').textContent='연결 안 됨';$('disconnectGithub').hidden=true;$('saveAudioChanges').disabled=true;}});
addEventListener('beforeunload',e=>{if(count()){e.preventDefault();e.returnValue='';}});addEventListener('pagehide',()=>{store.disconnect();$('githubToken').value='';});
fetch('./audio-settings.json',{cache:'no-cache'}).then(r=>r.ok?r.json():null).then(data=>{if(!data)return;if(!store.token)settings=settingsCopy(data);library.render();}).catch(()=>{});
fetch('./audio-files.json',{cache:'no-cache'}).then(r=>r.json()).then(files=>{const names=[...new Set(files.map(f=>fileInfo(f).station))].sort((a,b)=>a.localeCompare(b,'ko'));$('audioStationNames').replaceChildren(...names.map(name=>{const o=document.createElement('option');o.value=name;return o;}));}).catch(()=>{});
library.render();
})(typeof globalThis!=='undefined'?globalThis:this);
