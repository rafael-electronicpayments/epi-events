import React from 'react';
import htm from 'htm';
import { Icon, IconButton, Modal } from './ui.js';

const html=htm.bind(React.createElement);
const {useState,useEffect,useRef}=React;

export function createAdminWorkspace(m,components){
 const {people,events,rooms,activities,current,days,cover,clash,span,evEnd,evStatus}=m;
 const {AdminSession,Grid,Floorplans,Incoming}=components;
 const dateLabel=day=>{const event=events.find(e=>e.id===current.id);const date=new Date(event.start+'T12:00:00');date.setDate(date.getDate()+day);return date.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});};
 const field=(label,input)=>html`<label>${label}${input}</label>`;
 const minutes=value=>{const [h,n]=value.split(':').map(Number);return h*60+n;};
 const time=value=>`${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;
 const login=p=>p.login?['ok','Login active']:p.email?['warn','Login pending']:['','No email'];
 const Badge=({kind='',children})=>html`<span className=${'pill '+kind}>${children}</span>`;

 function Editor({editor,A,error,onClose}){
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
   }else if(editor.type==='room')result=await(editing?A.editRoom(editor.id,draft.name.trim(),version):A.addRoom(draft.name.trim()));
   else{
    const args=[draft.name.trim(),draft.room,Number(draft.day),minutes(draft.start),minutes(draft.end),Number(draft.needed)];
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
     ${field('Type',html`<select value=${draft.type} onChange=${set('type')}><option value="staff">Staff</option><option value="contractor">Contractor</option></select>`)}
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
     ${field('Staff needed',html`<input type="number" required min="1" value=${draft.needed} onChange=${set('needed')}/> `)}`}
   </div>`}
   ${(failed||error)&&html`<p className="connection-error editor-error" role="alert">${error||'Could not save. Check the values and try again.'}</p>`}
   <div className="dialog-actions"><button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="submit" className=${'btn '+(editor.remove?'danger':'')}>${editor.remove?'Confirm delete':editing?'Save changes':editor.type==='person'?'Add person':editor.type==='event'?'Create event':editor.type==='room'?'Add room':'Create activity'}</button></div>
  </form><//>`;
 }

 return function AdminWorkspace({S,A,error=''}){
  const [view,setView]=useState('schedule'),[day,setDay]=useState(0),[mode,setMode]=useState('list'),[filter,setFilter]=useState('all');
  const [selected,setSelected]=useState(null),[query,setQuery]=useState(''),[type,setType]=useState('all'),[tab,setTab]=useState('events'),[editor,setEditor]=useState(null);
  const detail=useRef(null);
  const dayIndex=Math.min(day,days.length-1),event=events.find(e=>e.id===current.id);
  useEffect(()=>{setDay(0);setSelected(null);setFilter('all');setEditor(null);},[current.id]);
  useEffect(()=>{if(selected&&detail.current&&window.matchMedia('(max-width:1250px)').matches){detail.current.focus({preventScroll:true});detail.current.scrollIntoView({block:'start'});}},[selected]);
  const allActivities=activities.filter(s=>s.ev===current.id),today=allActivities.filter(s=>s.d===dayIndex).sort((a,b)=>a.a-b.a);
  const todayAssignments=S.asg.filter(a=>today.some(s=>s.id===a.s));
  const overlapPeople=new Set(todayAssignments.filter(a=>clash(S.asg,a).length).map(a=>a.e));
  const unack=todayAssignments.filter(a=>!a.ack).length,short=today.filter(s=>cover(s,S.asg).as.length<s.n).length;
  const visible=today.filter(s=>filter==='all'||filter==='short'&&cover(s,S.asg).as.length<s.n||filter==='overlap'&&S.asg.some(a=>a.s===s.id&&clash(S.asg,a).length)||filter==='unack'&&S.asg.some(a=>a.s===s.id&&!a.ack));
  const currentActivity=activities.find(s=>s.id===selected&&s.ev===current.id);
  const navigate=next=>{setView(next);setSelected(null);setFilter('all');};
  const open=(entity,record=null)=>{
   let draft,id;
   if(entity==='person'){id=record?.id;draft={name:record?.name||'',email:record?.email||'',title:record?.role||'Room Host',type:record?.acct||'staff',phone:record?.phone||'',map:record?!!record.map:true};}
   else if(entity==='event'){id=record?.id;draft={name:record?.name||'',start:record?.start||'',days:record?.days||3};}
   else if(entity==='room'){id=record;draft={name:record||''};}
   else{id=record?.id;draft={name:record?.t||'',room:record?.r||rooms[0]||'',day:record?.d??dayIndex,start:time(record?.a??540),end:time(record?.b??600),needed:record?.n||2};}
   setEditor({type:entity,id,draft,revision:S.revision});
  };
  const remove=(entity,id,label,warning)=>setEditor({type:entity,id,label,warning,remove:true,revision:S.revision});
  const nav=[['schedule','calendar','Schedule'],['coverage','coverage','Coverage'],['people','people','People'],['setup','settings','Event setup'],['log','activity','Activity log'],...(!m.connected?[['plans','map','Floorplans'],['incoming','package','Incoming goods']]:[])];
  const navButton=([id,icon,label])=>html`<button key=${id} type="button" className="nav-item" aria-current=${view===id?'page':undefined} onClick=${()=>navigate(id)}><${Icon} name=${icon}/><span>${label}</span></button>`;
  const title={schedule:'Schedule',coverage:'Coverage',people:'People',setup:'Event setup',log:'Activity log',plans:'Floorplans',incoming:'Incoming goods'}[view];
  const sub=['schedule','coverage'].includes(view)?dateLabel(dayIndex)+' · '+days[dayIndex]:event.name;
  const actions=(editLabel,onEdit,deleteLabel,onDelete,disabled=false)=>html`<div className="row-actions"><${IconButton} name="edit" label=${editLabel} onClick=${onEdit}/><${IconButton} name="delete" label=${deleteLabel} onClick=${onDelete} disabled=${disabled}/></div>`;
  const table=(headers,body)=>html`<div className="data-surface"><table className="data-table"><thead><tr>${headers.map((h,i)=>html`<th key=${i} scope="col" className=${h.className||''}>${h.text}</th>`)}</tr></thead><tbody>${body.length?body:html`<tr><td colSpan=${headers.length} className="empty-table">No records found.</td></tr>`}</tbody></table></div>`;
  return html`<div className="workspace-layout"><nav className="sidebar" aria-label="Main navigation"><span className="nav-group">Planning</span>${nav.slice(0,3).map(navButton)}<span className="nav-group">Manage</span>${nav.slice(3).map(navButton)}</nav>
  <main className="workspace-main"><div className="page-heading"><div><h2>${title}</h2><p className="mute">${sub}</p></div>
   ${view==='schedule'&&html`<button className="btn" onClick=${()=>open('activity')} disabled=${!rooms.length}><${Icon} name="plus"/>New activity</button>`}
   ${view==='people'&&html`<button className="btn" onClick=${()=>open('person')}><${Icon} name="plus"/>Add person</button>`}
   ${view==='setup'&&html`<button className="btn" onClick=${()=>open(tab==='events'?'event':tab==='rooms'?'room':'activity')} disabled=${tab==='activities'&&!rooms.length}><${Icon} name="plus"/>${tab==='events'?'Add event':tab==='rooms'?'Add room':'New activity'}</button>`}
  </div>
  ${['schedule','coverage'].includes(view)&&html`
   <div className="summary-strip" aria-label="Daily schedule status">
    <button aria-pressed=${filter==='all'} onClick=${()=>setFilter('all')}><b>${today.length}</b>activities today</button>
    <button aria-pressed=${filter==='short'} onClick=${()=>setFilter('short')}><${Icon} name="warning"/><b>${short}</b>understaffed</button>
    <button aria-pressed=${filter==='overlap'} onClick=${()=>setFilter('overlap')}><b>${overlapPeople.size}</b>people with overlaps</button>
    <button aria-pressed=${filter==='unack'} onClick=${()=>setFilter('unack')}><b>${unack}</b>awaiting acknowledgment</button>
   </div>
   <div className="view-toolbar"><div className="seg day-tabs" role="group" aria-label="Event day">${days.map((d,i)=>html`<button key=${d} aria-pressed=${dayIndex===i} onClick=${()=>{setDay(i);setSelected(null);}}>${d}</button>`)}</div>
    ${view==='schedule'&&html`<div className="seg view-switch" role="group" aria-label="Schedule view"><button aria-label="List view" title="List view" aria-pressed=${mode==='list'} onClick=${()=>setMode('list')}><${Icon} name="list"/></button><button aria-label="Schedule grid" title="Schedule grid" aria-pressed=${mode==='grid'} onClick=${()=>setMode('grid')}><${Icon} name="grid"/></button></div>`}
   </div>
   ${view==='schedule'&&mode==='grid'?html`<${Grid} S=${S}/>`:html`<div className=${'schedule-work '+(currentActivity?'with-detail':'')}><div>
    ${visible.length?view==='schedule'?table([{text:'Activity / room'},{text:'Time',className:'time-column'},{text:'Staffing'},{text:'Acknowledged',className:'ack-column'},{text:''}],visible.map(s=>{const c=cover(s,S.asg),conflict=c.as.some(a=>clash(S.asg,a).length);return html`<tr key=${s.id} className=${selected===s.id?'selected-row':''}>
     <td><button className="activity-link" onClick=${()=>setSelected(s.id)}><b>${s.t}</b><span className="mute">${s.r}</span><span className="mute mobile-time">${span(s)}</span></button>${conflict&&html`<span className="inline-warning"><${Icon} name="warning" size=${13}/>Overlap</span>`}</td><td className="time-column">${span(s)}</td><td><${Badge} kind=${c.as.length<s.n?'warn':'ok'}>${c.as.length} / ${s.n} assigned<//></td><td className="ack-column">${c.as.filter(a=>a.ack).length} / ${c.as.length}</td><td><${IconButton} name="right" label=${'Manage '+s.t} onClick=${()=>setSelected(s.id)}/></td></tr>`;})):
     html`<div className="coverage-list">${[...visible].sort((a,b)=>(b.n-cover(b,S.asg).as.length)-(a.n-cover(a,S.asg).as.length)).map(s=>{const c=cover(s,S.asg);return html`<div className="coverage-row" key=${s.id}><div><b>${s.r}</b><p className="mute">${s.t} · ${span(s)}</p></div><div className="coverage-count"><b>${c.p} / ${s.n}</b><span className="mute">present</span></div><${Badge} kind=${c.as.length<s.n?'warn':'ok'}>${c.as.length} assigned<//><button className="btn ghost" onClick=${()=>setSelected(s.id)}>${c.as.length<s.n?'Fill gap':'View staff'}<${Icon} name="right"/></button></div>`;})}</div>`:
     html`<div className="empty-state"><${Icon} name="calendar" size=${28}/><h3>${today.length?'No activities match this filter':'No activities scheduled'}</h3>${today.length?html`<button className="btn ghost" onClick=${()=>setFilter('all')}>Show all activities</button>`:html`<button className="btn" disabled=${!rooms.length} onClick=${()=>open('activity')}><${Icon} name="plus"/>Add activity</button>`}</div>`}
    </div>${currentActivity&&html`<aside ref=${detail} tabIndex=${-1} className="activity-detail" aria-label="Assignment details"><div className="detail-heading"><h3>Assignment details</h3><${IconButton} name="close" label="Close activity" onClick=${()=>setSelected(null)}/></div><${AdminSession} key=${currentActivity.id} s=${currentActivity} S=${S} A=${A} coordinator=${view==='coverage'}/><button className="btn ghost detail-edit" onClick=${()=>open('activity',currentActivity)}><${Icon} name="edit"/>Edit activity</button></aside>`}</div>`}
  `}
  ${view==='people'&&html`<div className="people-toolbar"><label className="search-field"><${Icon} name="search"/><input type="search" aria-label="Search people" placeholder="Search people" value=${query} onChange=${e=>setQuery(e.target.value)}/></label><select aria-label="Person type" value=${type} onChange=${e=>setType(e.target.value)}><option value="all">All people</option><option value="staff">Staff</option><option value="contractor">Contractors</option></select><span className="mute">${people.filter(p=>!p.gone).length} people</span></div>
   ${table([{text:'Person'},{text:'Type'},{text:'Phone',className:'phone-column'},{text:'Login access'},{text:''}],people.filter(p=>!p.gone&&(type==='all'||p.acct===type)&&(p.name+' '+p.email+' '+p.role).toLowerCase().includes(query.toLowerCase())).map(p=>{const [kind,label]=login(p);return html`<tr key=${p.id}><td><b>${p.name}</b><span className="cell-secondary">${p.email||p.role}</span></td><td>${p.acct==='contractor'?'Contractor':'Staff'}</td><td className="phone-column">${p.phone||'Not provided'}</td><td><${Badge} kind=${kind}>${label}<//></td><td>${actions('Edit '+p.name,()=>open('person',p),'Delete '+p.name,()=>remove('person',p.id,p.name,'Their assignments will be cancelled and app access disabled.'))}</td></tr>`;}))}`}
  ${view==='setup'&&html`<div className="seg setup-tabs" role="group" aria-label="Event setup sections">${[['events','Event details'],['rooms','Rooms'],['activities','Activities']].map(([id,label])=>html`<button key=${id} aria-pressed=${tab===id} onClick=${()=>setTab(id)}>${label}</button>`)}</div>
   ${tab==='events'&&table([{text:'Event'},{text:'Dates'},{text:'Activities'},{text:''}],events.map(e=>{const [kind,label]=evStatus(e);return html`<tr key=${e.id}><td><b>${e.name}</b><${Badge} kind=${kind}>${label}<//></td><td>${e.start}<span className="cell-secondary">through ${evEnd(e)}</span></td><td>${activities.filter(s=>s.ev===e.id).length}</td><td>${actions('Edit '+e.name,()=>open('event',e),'Delete '+e.name,()=>remove('event',e.id,e.name,'All of its activities and assignments will be removed.'),events.length<2)}</td></tr>`;}))}
   ${tab==='rooms'&&table([{text:'Room'},{text:'Activities'},{text:''}],rooms.map(r=>{const count=activities.filter(s=>s.r===r).length;return html`<tr key=${r}><td><b>${r}</b></td><td>${count}</td><td>${actions('Edit '+r,()=>open('room',r),'Delete '+r,()=>remove('room',r,r,'This room will be removed.'),!!count)}</td></tr>`;}))}
   ${tab==='activities'&&table([{text:'Activity'},{text:'Room'},{text:'Day / time'},{text:''}],allActivities.map(s=>html`<tr key=${s.id}><td><b>${s.t}</b></td><td>${s.r}</td><td>${days[s.d]}<span className="cell-secondary">${span(s)}</span></td><td>${actions('Edit '+s.t,()=>open('activity',s),'Delete '+s.t,()=>remove('activity',s.id,s.t,'Assigned people will receive a cancellation notice.'))}</td></tr>`))}
  `}
  ${view==='log'&&table([{text:'Time'},{text:'Action'},{text:'Details'}],S.log.map((entry,i)=>{
   const names={assign:'Assigned person',move:'Moved assignment',remove:'Removed assignment',ack:'Acknowledged assignment',checkIn:'Checked in',confirm:'Confirmed attendance',addEvent:'Added event',editEvent:'Updated event',delEvent:'Deleted event',addRoom:'Added room',editRoom:'Renamed room',delRoom:'Deleted room',addSession:'Added activity',editSession:'Updated activity',delSession:'Deleted activity',addStaff:'Added person',editStaff:'Updated person',delStaff:'Archived person',dismiss:'Dismissed notice',calAdd:'Updated calendar',calSkip:'Dismissed calendar prompt'};
   const date=new Date(entry.t),details=entry.details;
   const description=details&&!Array.isArray(details)?details.name||'':Array.isArray(details)?typeof details[0]==='string'?details[0]:details[0]?.n||'':'';
   return html`<tr key=${i}><td>${Number.isNaN(date.valueOf())?entry.t:date.toLocaleString()}</td><td>${names[entry.x]||entry.x}</td><td>${description}</td></tr>`;
  }))}
  ${view==='plans'&&html`<${Floorplans} A=${A}/>`}${view==='incoming'&&html`<${Incoming} A=${A}/>`}
  </main>${editor&&html`<${Editor} key=${editor.type+'-'+editor.id} editor=${editor} A=${A} error=${error} onClose=${()=>setEditor(null)}/>`}</div>`;
 };
}
