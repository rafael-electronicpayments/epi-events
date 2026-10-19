import React from 'react';
import htm from 'htm';
import { Icon, IconButton, Modal } from './ui.js';
import { BulkTestLogins, TestLoginPanel } from './test-logins.js';
import { readSpreadsheet, planImport } from './people-import.js';

const html=htm.bind(React.createElement);
const {useState,useEffect,useRef}=React;

export function createAdminWorkspace(m,components){
 const {people,events,rooms,activities,current,days,cover,clash,span,evEnd,evStatus,need,roomAck,ackSupport}=m;
 const ackText=on=>on?'Required':'Not required';
 const qOf={room:null,yes:true,no:false};
 const {AdminSession,Grid,Floorplans,Incoming,Staff}=components;
 const dateLabel=day=>{const event=events.find(e=>e.id===current.id);const date=new Date(event.start+'T12:00:00');date.setDate(date.getDate()+day);return date.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});};
 const field=(label,input)=>html`<label>${label}${input}</label>`;
 const minutes=value=>{const [h,n]=value.split(':').map(Number);return h*60+n;};
 const time=value=>`${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;
 const login=p=>p.login?['ok','Login active']:p.email?['warn','Login pending']:['','No email'];
 const Badge=({kind='',children})=>html`<span className=${'pill '+kind}>${children}</span>`;

 // Import people from a roster spreadsheet: preview, adjust, then save row by row.
 function ImportPeople({A,error,onClose}){
  const [plan,setPlan]=useState(null),[file,setFile]=useState(''),[problem,setProblem]=useState(''),[progress,setProgress]=useState(null),[result,setResult]=useState(null);
  const choose=async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;setProblem('');setResult(null);setFile(f.name);
   try{const {rows,sheet}=await readSpreadsheet(f);setPlan({sheet,rows:planImport(rows,people)});}catch(x){setPlan(null);setProblem(x.message||'Could not read that file.');}};
  const edit=(i,patch)=>setPlan(p=>({...p,rows:p.rows.map((r,j)=>j===i?{...r,...patch,person:{...r.person,...(patch.person||{})}}:r)}));
  const chosen=plan?plan.rows.filter(r=>r.include&&r.status!=='error'):[];
  const count=k=>plan.rows.filter(r=>r.status===k).length;
  const run=async()=>{
   const done={added:0,updated:0,failed:[]};
   for(let i=0;i<chosen.length;i++){
    const r=chosen[i];setProgress(i+1);
    const ok=await(r.id!=null?A.editStaff(r.id,r.person):A.addStaff(r.person));
    if(ok===false)done.failed.push(r.person.n+(r.line?' (row '+r.line+')':''));else done[r.id!=null?'updated':'added']++;
   }
   setProgress(null);setResult(done);setPlan(null);
  };
  const label={new:['ok','New'],update:['warn','Update'],same:['','No change'],error:['bad','Cannot import']};
  return html`<${Modal} title="Import people from Excel" onClose=${progress?()=>{}:onClose}><div className="import-people">
   ${!plan&&!result&&html`<p className="mute">Choose an Excel (.xlsx) or CSV file with a header row. Recognized columns: Name, Email, Phone, Type (Admin, Staff, or Contractor), and Role or Title. People are matched by email, then by name. The file is read on this device and is not uploaded or stored.</p>`}
   ${!progress&&html`<label className="btn ghost file-pick"><${Icon} name="upload"/>${plan?'Choose a different file':'Choose file'}<input type="file" accept=".xlsx,.csv" onChange=${choose}/></label>`}
   ${problem&&html`<p className="connection-error editor-error" role="alert">${problem}</p>`}
   ${plan&&html`<p className="import-summary"><b>${file}</b> · ${plan.rows.length} rows: ${count('new')} new, ${count('update')} updates, ${count('same')} unchanged${count('error')?html`, <b>${count('error')} cannot be imported</b>`:''}</p>
    <div className="import-table"><table className="data-table"><thead><tr><th scope="col">Import</th><th scope="col">Name</th><th scope="col">Email / phone</th><th scope="col">Type</th><th scope="col">Status</th></tr></thead><tbody>
    ${plan.rows.map((r,i)=>html`<tr key=${i}>
     <td><input type="checkbox" aria-label=${'Import '+(r.person.n||'row '+r.line)} checked=${r.include&&r.status!=='error'} disabled=${r.status==='error'||!!progress} onChange=${e=>edit(i,{include:e.target.checked})}/></td>
     <td><input aria-label=${'Name, row '+r.line} value=${r.person.n} disabled=${!!progress} onChange=${e=>edit(i,{person:{n:e.target.value},include:true})}/></td>
     <td><span>${r.person.email||html`<span className="mute">No email</span>`}</span><span className="cell-secondary">${r.person.phone||'No phone'}</span></td>
     <td><select aria-label=${'Type, row '+r.line} value=${r.person.acct} disabled=${!!progress} onChange=${e=>edit(i,{person:{acct:e.target.value},include:true})}><option value="staff">Staff</option><option value="contractor">Contractor</option><option value="admin">Admin</option></select></td>
     <td><${Badge} kind=${label[r.status][0]}>${label[r.status][1]}<//>${r.status==='update'&&html`<span className="cell-secondary">${r.changes.join(', ')}</span>`}${[...r.errors,...r.notes].map(n=>html`<span key=${n} className=${'cell-secondary'+(r.errors.includes(n)?' import-error':'')}>${n}</span>`)}</td></tr>`)}
    </tbody></table></div>`}
   ${progress&&html`<p role="status">Saving ${progress} of ${chosen.length}…</p>`}
   ${result&&html`<div role="status"><p><b>Import finished.</b> ${result.added} added, ${result.updated} updated${result.failed.length?`, ${result.failed.length} failed`:''}.</p>${result.failed.length>0&&html`<p className="connection-error">Not saved: ${result.failed.join(', ')}. ${error}</p>`}</div>`}
   <div className="dialog-actions"><button type="button" className="btn ghost" disabled=${!!progress} onClick=${onClose}>${result?'Close':'Cancel'}</button>
    ${plan&&html`<button type="button" className="btn" disabled=${!chosen.length||!!progress} onClick=${run}>Import ${chosen.length} ${chosen.length===1?'person':'people'}</button>`}</div>
  </div><//>`;
 }
 function Editor({editor,A,error,onClose,testLogins}){
  const [draft,setDraft]=useState(editor.draft),[failed,setFailed]=useState(false);
  const editing=editor.id!=null,version={expectedRevision:editor.revision};
  const set=key=>e=>setDraft(d=>({...d,[key]:e.target.type==='checkbox'?e.target.checked:e.target.value}));
  const title=editor.remove?'Delete '+editor.label:((editing?'Edit ':'Add ')+{person:'person',event:'event',room:'room',activity:'activity'}[editor.type]);
  const submit=async e=>{
   e.preventDefault();setFailed(false);let result;
   if(editor.remove)result=await ({person:A.delStaff,event:A.delEvent,room:A.delRoom,activity:A.delSession}[editor.type])(editor.id);
   else if(editor.type==='person'){
    const value={n:draft.name.trim(),email:draft.email.trim().toLowerCase(),r:draft.title.trim(),acct:draft.type,phone:draft.phone.trim(),map:draft.map};
    result=await(editing?A.editStaff(editor.id,value,version):A.addStaff(value));
   }else if(editor.type==='event'){
    const value={n:draft.name.trim(),b:draft.start,d:Number(draft.days)};
    result=await(editing?A.editEvent(editor.id,value,version):A.addEvent(value));
   }else if(editor.type==='room')result=await(editing?A.editRoom(editor.id,draft.name.trim(),!!draft.req,version):A.addRoom(draft.name.trim(),!!draft.req));
   else{
    const args=[draft.name.trim(),draft.room,Number(draft.day),minutes(draft.start),minutes(draft.end),Number(draft.needed),qOf[draft.q]];
    result=await(editing?A.editSession(editor.id,...args,version):A.addSession(...args));
   }
   if(result!==false)onClose();else setFailed(true);
  };
  return html`<${Modal} title=${title} onClose=${onClose}><form onSubmit=${submit}>
   ${editor.remove?html`<p className="delete-description">${editor.warning}</p>`:html`<div className="editor-fields">
    ${field(editor.type==='person'?'Name':editor.type==='event'?'Event name':editor.type==='room'?'Room name':'Activity name',html`<input required value=${draft.name} onChange=${set('name')}/> `)}
    ${editor.type==='person'&&html`
     ${field('Email',html`<input type="email" autoComplete="off" value=${draft.email} onChange=${set('email')}/> `)}
     ${field('Role or title',html`<input value=${draft.title} onChange=${set('title')}/> `)}
     ${field('Type',html`<select value=${draft.type} onChange=${set('type')}><option value="staff">Staff</option><option value="contractor">Contractor</option><option value="admin">Admin</option></select>`)}
     ${draft.type==='admin'&&html`<p className="mute">Admins have full access to the entire system, including setup, people, and phone numbers.</p>`}
     ${field('Phone',html`<input type="tel" value=${draft.phone} onChange=${set('phone')}/> `)}
     <label className="chk"><input type="checkbox" checked=${draft.map} onChange=${set('map')}/>Venue map access</label>`}
    ${editor.type==='event'&&html`
     ${field('Start date',html`<input type="date" required value=${draft.start} onChange=${set('start')}/> `)}
     ${field('Number of days',html`<input type="number" required min="1" max="14" value=${draft.days} onChange=${set('days')}/> `)}`}
    ${editor.type==='activity'&&html`
     ${field('Room',html`<select required value=${draft.room} onChange=${set('room')}><option value="" disabled>Choose room</option>${rooms.map(r=>html`<option key=${r}>${r}</option>`)}</select>`)}
     ${field('Day',html`<select value=${draft.day} onChange=${set('day')}>${days.map((d,i)=>html`<option key=${i} value=${i}>${d}</option>`)}</select>`)}
     ${field('Start time',html`<input type="time" required value=${draft.start} onChange=${set('start')}/> `)}
     ${field('End time',html`<input type="time" required value=${draft.end} onChange=${set('end')}/> `)}
     ${field('Staff needed',html`<input type="number" required min="1" value=${draft.needed} onChange=${set('needed')}/> `)}
     ${ackSupport.on&&field('Acknowledgment and check-in',html`<select value=${draft.q} onChange=${set('q')}><option value="room">Same as room (${roomAck[draft.room]!==false?'required':'not required'})</option><option value="yes">Required</option><option value="no">Not required</option></select>`)}
     ${ackSupport.on&&html`<p className="mute ack-hint">When not required, assigned people are told about the activity but are not asked to acknowledge or check in.</p>`}`}
    ${editor.type==='room'&&ackSupport.on&&html`
     <label className="chk"><input type="checkbox" checked=${draft.req} onChange=${set('req')}/>Requires acknowledgment and check-in</label>
     <p className="mute ack-hint">Default for this room's activities. Each activity can override it.</p>`}
   </div>`}
   ${!editor.remove&&editing&&editor.type==='person'&&testLogins&&editor.draft.email.endsWith('@epieventstest.com')&&html`<${TestLoginPanel} personId=${editor.id} api=${testLogins} dirty=${draft.email.trim().toLowerCase()!==editor.draft.email||draft.type!==editor.draft.type}/>`}
   ${(failed||error)&&html`<p className="connection-error editor-error" role="alert">${error||'Could not save. Check the values and try again.'}</p>`}
   <div className="dialog-actions"><button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="submit" className=${'btn '+(editor.remove?'danger':'')}>${editor.remove?'Confirm delete':editing?'Save changes':editor.type==='person'?'Add person':editor.type==='event'?'Create event':editor.type==='room'?'Add room':'Create activity'}</button></div>
  </form><//>`;
 }

 return function AdminWorkspace({S,A,me=null,error='',testLogins}){
  const [view,setView]=useState('schedule'),[day,setDay]=useState(0),[mode,setMode]=useState('list'),[filter,setFilter]=useState('all');
  const [importing,setImporting]=useState(false),[selected,setSelected]=useState(null),[query,setQuery]=useState(''),[type,setType]=useState('all'),[tab,setTab]=useState('events'),[editor,setEditor]=useState(null);
  const detail=useRef(null);
  const dayIndex=Math.min(day,days.length-1),event=events.find(e=>e.id===current.id);
  useEffect(()=>{setDay(0);setSelected(null);setFilter('all');setEditor(null);},[current.id]);
  useEffect(()=>{if(selected&&detail.current&&window.matchMedia('(max-width:1250px)').matches){detail.current.focus({preventScroll:true});detail.current.scrollIntoView({block:'start'});}},[selected]);
  const allActivities=activities.filter(s=>s.ev===current.id),today=allActivities.filter(s=>s.d===dayIndex).sort((a,b)=>a.a-b.a);
  const todayAssignments=S.asg.filter(a=>today.some(s=>s.id===a.s));
  const overlapPeople=new Set(todayAssignments.filter(a=>clash(S.asg,a).length).map(a=>a.e));
  const unack=todayAssignments.filter(a=>!a.ack&&need(activities.find(s=>s.id===a.s))).length,short=today.filter(s=>cover(s,S.asg).as.length<s.n).length;
  const visible=today.filter(s=>filter==='all'||filter==='short'&&cover(s,S.asg).as.length<s.n||filter==='overlap'&&S.asg.some(a=>a.s===s.id&&clash(S.asg,a).length)||filter==='unack'&&need(s)&&S.asg.some(a=>a.s===s.id&&!a.ack));
  const currentActivity=activities.find(s=>s.id===selected&&s.ev===current.id);
  const navigate=next=>{setView(next);setSelected(null);setFilter('all');};
  const open=(entity,record=null)=>{
   let draft,id;
   if(entity==='person'){id=record?.id;draft={name:record?.name||'',email:record?.email||'',title:record?.role||'Room Host',type:record?.acct||'staff',phone:record?.phone||'',map:record?!!record.map:true};}
   else if(entity==='event'){id=record?.id;draft={name:record?.name||'',start:record?.start||'',days:record?.days||3};}
   else if(entity==='room'){id=record;draft={name:record||'',req:record?roomAck[record]!==false:true};}
   else{id=record?.id;draft={name:record?.t||'',room:record?.r||rooms[0]||'',day:record?.d??dayIndex,start:time(record?.a??540),end:time(record?.b??600),needed:record?.n||2,q:record?.q==null?'room':record.q?'yes':'no'};}
   setEditor({type:entity,id,draft,revision:S.revision});
  };
  const remove=(entity,id,label,warning)=>setEditor({type:entity,id,label,warning,remove:true,revision:S.revision});
  const planning=[['schedule','calendar','Schedule'],['coverage','coverage','Coverage'],['people','people','People'],...(me!=null?[['mine','user','My schedule']]:[])];
  const nav=[...planning,['setup','settings','Event setup'],['log','activity','Activity log'],...(!m.connected?[['plans','map','Floorplans'],['incoming','package','Incoming goods']]:[])];
  const navButton=([id,icon,label])=>html`<button key=${id} type="button" className="nav-item" aria-current=${view===id?'page':undefined} onClick=${()=>navigate(id)}><${Icon} name=${icon}/><span>${label}</span></button>`;
  const title={mine:'My schedule',schedule:'Schedule',coverage:'Coverage',people:'People',setup:'Event setup',log:'Activity log',plans:'Floorplans',incoming:'Incoming goods'}[view];
  const sub=['schedule','coverage'].includes(view)?dateLabel(dayIndex):event.name;
  const actions=(editLabel,onEdit,deleteLabel,onDelete,disabled=false)=>html`<div className="row-actions"><${IconButton} name="edit" label=${editLabel} onClick=${onEdit}/><${IconButton} name="delete" label=${deleteLabel} onClick=${onDelete} disabled=${disabled}/></div>`;
  const table=(headers,body)=>html`<div className="data-surface"><table className="data-table"><thead><tr>${headers.map((h,i)=>html`<th key=${i} scope="col" className=${h.className||''}>${h.text}</th>`)}</tr></thead><tbody>${body.length?body:html`<tr><td colSpan=${headers.length} className="empty-table">No records found.</td></tr>`}</tbody></table></div>`;
  return html`<div className="workspace-layout"><nav className="sidebar" aria-label="Main navigation"><span className="nav-group">Planning</span>${nav.slice(0,planning.length).map(navButton)}<span className="nav-group">Manage</span>${nav.slice(planning.length).map(navButton)}</nav>
  <main className="workspace-main"><div className="page-heading"><div><h2>${title}</h2><p className="mute">${sub}</p></div>
   ${view==='schedule'&&html`<button className="btn" onClick=${()=>open('activity')} disabled=${!rooms.length}><${Icon} name="plus"/>New activity</button>`}
   ${view==='people'&&html`<div className="heading-actions"><button className="btn ghost" onClick=${()=>setImporting(true)}><${Icon} name="upload"/>Import from Excel</button><button className="btn" onClick=${()=>open('person')}><${Icon} name="plus"/>Add person</button></div>`}
   ${view==='setup'&&html`<button className="btn" onClick=${()=>open(tab==='events'?'event':tab==='rooms'?'room':'activity')} disabled=${tab==='activities'&&!rooms.length}><${Icon} name="plus"/>${tab==='events'?'Add event':tab==='rooms'?'Add room':'New activity'}</button>`}
  </div>
  ${view==='people'&&testLogins&&html`<${BulkTestLogins} api=${testLogins}/>`}
  ${['schedule','coverage'].includes(view)&&html`
   <div className="summary-strip" aria-label="Daily schedule status">
    <button aria-pressed=${filter==='all'} onClick=${()=>setFilter('all')}><b>${today.length}</b>activities today</button>
    <button aria-pressed=${filter==='short'} onClick=${()=>setFilter('short')}><${Icon} name="warning"/><b>${short}</b>understaffed</button>
    <button aria-pressed=${filter==='overlap'} onClick=${()=>setFilter('overlap')}><b>${overlapPeople.size}</b>people with overlaps</button>
    <button aria-pressed=${filter==='unack'} onClick=${()=>setFilter('unack')}><b>${unack}</b>awaiting acknowledgment</button>
   </div>
   <div className="view-toolbar"><div className="seg day-tabs" role="group" aria-label="Event day">${(m.daysShort||days).map((d,i)=>html`<button key=${d} aria-pressed=${dayIndex===i} onClick=${()=>{setDay(i);setSelected(null);}}>${d}</button>`)}</div>
    ${view==='schedule'&&html`<div className="seg view-switch" role="group" aria-label="Schedule view"><button aria-label="List view" title="List view" aria-pressed=${mode==='list'} onClick=${()=>setMode('list')}><${Icon} name="list"/></button><button aria-label="Schedule grid" title="Schedule grid" aria-pressed=${mode==='grid'} onClick=${()=>setMode('grid')}><${Icon} name="grid"/></button></div>`}
   </div>
   ${view==='schedule'&&mode==='grid'?html`<${Grid} S=${S}/>`:html`<div className=${'schedule-work '+(currentActivity?'with-detail':'')}><div>
    ${visible.length?view==='schedule'?table([{text:'Activity / room'},{text:'Time',className:'time-column'},{text:'Staffing'},{text:'Acknowledged',className:'ack-column'},{text:''}],visible.map(s=>{const c=cover(s,S.asg),conflict=c.as.some(a=>clash(S.asg,a).length);return html`<tr key=${s.id} className=${selected===s.id?'selected-row':''}>
     <td><button className="activity-link" onClick=${()=>setSelected(s.id)}><b>${s.t}</b><span className="mute">${s.r}</span><span className="mute mobile-time">${span(s)}</span></button>${conflict&&html`<span className="inline-warning"><${Icon} name="warning" size=${13}/>Overlap</span>`}</td><td className="time-column">${span(s)}</td><td><${Badge} kind=${c.as.length<s.n?'warn':'ok'}>${c.as.length} / ${s.n} assigned<//></td><td className="ack-column">${need(s)?`${c.as.filter(a=>a.ack).length} / ${c.as.length}`:html`<span className="mute">Not required</span>`}</td><td><${IconButton} name="right" label=${'Manage '+s.t} onClick=${()=>setSelected(s.id)}/></td></tr>`;})):
     html`<div className="coverage-list">${[...visible].sort((a,b)=>(b.n-cover(b,S.asg).as.length)-(a.n-cover(a,S.asg).as.length)).map(s=>{const c=cover(s,S.asg);return html`<div className="coverage-row" key=${s.id}><div><b>${s.r}</b><p className="mute">${s.t} · ${span(s)}</p></div><div className="coverage-count"><b>${c.p} / ${s.n}</b><span className="mute">present</span></div><${Badge} kind=${c.as.length<s.n?'warn':'ok'}>${c.as.length} assigned<//><button className="btn ghost" onClick=${()=>setSelected(s.id)}>${c.as.length<s.n?'Fill gap':'View staff'}<${Icon} name="right"/></button></div>`;})}</div>`:
     html`<div className="empty-state"><${Icon} name="calendar" size=${28}/><h3>${today.length?'No activities match this filter':'No activities scheduled'}</h3>${today.length?html`<button className="btn ghost" onClick=${()=>setFilter('all')}>Show all activities</button>`:html`<button className="btn" disabled=${!rooms.length} onClick=${()=>open('activity')}><${Icon} name="plus"/>Add activity</button>`}</div>`}
    </div>${currentActivity&&html`<aside ref=${detail} tabIndex=${-1} className="activity-detail" aria-label="Assignment details"><div className="detail-heading"><h3>Assignment details</h3><${IconButton} name="close" label="Close activity" onClick=${()=>setSelected(null)}/></div><${AdminSession} key=${currentActivity.id} s=${currentActivity} S=${S} A=${A} coordinator=${view==='coverage'}/><button className="btn ghost detail-edit" onClick=${()=>open('activity',currentActivity)}><${Icon} name="edit"/>Edit activity</button></aside>`}</div>`}
  `}
  ${view==='people'&&html`<div className="people-toolbar"><label className="search-field"><${Icon} name="search"/><input type="search" aria-label="Search people" placeholder="Search people" value=${query} onChange=${e=>setQuery(e.target.value)}/></label><select aria-label="Person type" value=${type} onChange=${e=>setType(e.target.value)}><option value="all">All people</option><option value="staff">Staff</option><option value="contractor">Contractors</option><option value="admin">Admins</option></select><span className="mute">${people.filter(p=>!p.gone).length} people</span></div>
   ${table([{text:'',className:'setup-actions'},{text:'Person'},{text:'Type'},{text:'Phone',className:'phone-column'},{text:'Login access'}],people.filter(p=>!p.gone&&(type==='all'||p.acct===type)&&(p.name+' '+p.email+' '+p.role).toLowerCase().includes(query.toLowerCase())).map(p=>{const [kind,label]=login(p);return html`<tr key=${p.id}><td className="setup-actions">${actions('Edit '+p.name,()=>open('person',p),'Delete '+p.name,()=>remove('person',p.id,p.name,'Their assignments will be cancelled and app access disabled.'))}</td><td><b>${p.name}</b><span className="cell-secondary">${p.email||p.role}</span></td><td>${p.acct==='contractor'?'Contractor':p.acct==='admin'?'Admin':'Staff'}</td><td className="phone-column">${p.phone||'Not provided'}</td><td><${Badge} kind=${kind}>${label}<//></td></tr>`;}))}`}
  ${view==='setup'&&html`<div className="seg setup-tabs" role="group" aria-label="Event setup sections">${[['events','Event details'],['rooms','Rooms'],['activities','Activities']].map(([id,label])=>html`<button key=${id} aria-pressed=${tab===id} onClick=${()=>setTab(id)}>${label}</button>`)}</div>
   ${tab==='events'&&table([{text:'',className:'setup-actions'},{text:'Event'},{text:'Dates'},{text:'Activities'}],events.map(e=>{const [kind,label]=evStatus(e);return html`<tr key=${e.id}><td className="setup-actions">${actions('Edit '+e.name,()=>open('event',e),'Delete '+e.name,()=>remove('event',e.id,e.name,'All of its activities and assignments will be removed.'),events.length<2)}</td><td><b>${e.name}</b><${Badge} kind=${kind}>${label}<//></td><td>${e.start}<span className="cell-secondary">through ${evEnd(e)}</span></td><td>${activities.filter(s=>s.ev===e.id).length}</td></tr>`;}))}
   ${tab==='rooms'&&table([{text:'',className:'setup-actions'},{text:'Room'},...(ackSupport.on?[{text:'Acknowledgment and check-in'}]:[]),{text:'Activities'}],rooms.map(r=>{const count=activities.filter(s=>s.r===r).length;return html`<tr key=${r}><td className="setup-actions">${actions('Edit '+r,()=>open('room',r),'Delete '+r,()=>remove('room',r,r,'This room will be removed.'),!!count)}</td><td><b>${r}</b></td>${ackSupport.on&&html`<td>${ackText(roomAck[r]!==false)}</td>`}<td>${count}</td></tr>`;}))}
   ${tab==='activities'&&table([{text:'',className:'setup-actions'},{text:'Activity'},{text:'Room'},{text:'Day / time'},...(ackSupport.on?[{text:'Acknowledgment and check-in'}]:[])],allActivities.map(s=>html`<tr key=${s.id}><td className="setup-actions">${actions('Edit '+s.t,()=>open('activity',s),'Delete '+s.t,()=>remove('activity',s.id,s.t,'Assigned people will receive a cancellation notice.'))}</td><td><b>${s.t}</b></td><td>${s.r}</td><td>${days[s.d]}<span className="cell-secondary">${span(s)}</span></td>${ackSupport.on&&html`<td>${ackText(need(s))}${s.q==null&&html`<span className="cell-secondary">Room default</span>`}</td>`}</tr>`))}
  `}
  ${view==='log'&&table([{text:'Time'},{text:'Action'},{text:'Details'}],S.log.map((entry,i)=>{
   const names={assign:'Assigned person',move:'Moved assignment',remove:'Removed assignment',ack:'Acknowledged assignment',checkIn:'Checked in',confirm:'Confirmed attendance',addEvent:'Added event',editEvent:'Updated event',delEvent:'Deleted event',addRoom:'Added room',editRoom:'Renamed room',delRoom:'Deleted room',addSession:'Added activity',editSession:'Updated activity',delSession:'Deleted activity',addStaff:'Added person',editStaff:'Updated person',delStaff:'Archived person',dismiss:'Dismissed notice',calAdd:'Updated calendar',calSkip:'Dismissed calendar prompt'};
   const date=new Date(entry.t),details=entry.details;
   const description=details&&!Array.isArray(details)?details.name||'':Array.isArray(details)?typeof details[0]==='string'?details[0]:details[0]?.n||'':'';
   return html`<tr key=${i}><td>${Number.isNaN(date.valueOf())?entry.t:date.toLocaleString()}</td><td>${names[entry.x]||entry.x}</td><td>${description}</td></tr>`;
  }))}
  ${view==='mine'&&me!=null&&html`<${Staff} S=${S} A=${A} me=${me} embedded=${true}/>`}${view==='plans'&&html`<${Floorplans} A=${A}/>`}${view==='incoming'&&html`<${Incoming} A=${A}/>`}
  </main>${importing&&html`<${ImportPeople} A=${A} error=${error} onClose=${()=>setImporting(false)}/>`}${editor&&html`<${Editor} key=${editor.type+'-'+editor.id} editor=${editor} A=${A} error=${error} testLogins=${testLogins} onClose=${()=>setEditor(null)}/>`}</div>`;
 };
}
