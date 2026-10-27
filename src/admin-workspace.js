import React from 'react';
import htm from 'htm';
import { Icon, IconButton, Modal } from './ui.js';
import { BulkTestLogins, TestLoginPanel } from './test-logins.js';
import { BulkLogins, LoginPanel } from './logins.js';
import { ScheduleImport } from './schedule-import-dialog.js';
import { readSpreadsheet, planImport } from './people-import.js';
import { DeliveryLimits } from './push.js';
import { openStaffList } from './staff-list.js';

const html=htm.bind(React.createElement);
const {useState,useEffect,useRef}=React;

export function createAdminWorkspace(m,components){
 const {people,events,rooms,activities,current,days,cover,clash,span,evEnd,evStatus,need,roomAck,ackSupport}=m;
 if(!m.infoSupport)m.infoSupport={on:false};
 if(!m.runShowSupport)m.runShowSupport={on:false};
 if(!m.staffText)m.staffText=(s,c)=>c.as.length+' / '+s.n+' assigned';
 if(!m.eventInfoSupport)m.eventInfoSupport={on:false};
 if(!m.brandSupport)m.brandSupport={on:false};
 if(!m.itinSupport)m.itinSupport={on:false};
 const ackText=on=>on?'Required':'Not required';
 const qOf={room:null,yes:true,no:false};
 const {AdminSession,Grid,Floorplans,Incoming,Staff,ExpensesAdmin,EventLogo,Splash,DocumentsAdmin,AppSettings,ItinerariesAdmin,TravelInfoAdmin,MessagesAdmin}=components;
 const dateLabel=day=>{const event=events.find(e=>e.id===current.id);const date=new Date(event.start+'T12:00:00');date.setDate(date.getDate()+day);return date.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});};
 const field=(label,input)=>html`<label>${label}${input}</label>`;
 const minutes=value=>{const [h,n]=value.split(':').map(Number);return h*60+n;};
 const time=value=>`${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;
 const login=p=>p.login?['ok','Login active']:p.email?['warn','Login pending']:['','No email'];
 const Badge=({kind='',children})=>html`<span className=${'pill '+kind}>${children}</span>`;
 // Event time zones (reminders go out 30 minutes before each activity in the event's zone).
 const ZONES=[['America/Halifax','Atlantic (Halifax)'],['America/Puerto_Rico','Atlantic, no daylight saving (Puerto Rico)'],['America/New_York','Eastern (New York)'],['America/Chicago','Central (Chicago)'],['America/Denver','Mountain (Denver)'],['America/Phoenix','Arizona (Phoenix)'],['America/Los_Angeles','Pacific (Los Angeles)'],['America/Anchorage','Alaska (Anchorage)'],['Pacific/Honolulu','Hawaii (Honolulu)']];
 const zoneName=tz=>(ZONES.find(z=>z[0]===tz)||[tz,tz])[1];
 const when=iso=>new Date(iso).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
 const testText=t=>t.st==='sent'?'Test sent '+when(t.at):t.st==='failed'?'Test failed: '+(t.err||'unknown error'):t.st==='skipped'?'Test not sent: '+(t.err||''):'Test waiting to send';

 // Import people from a roster spreadsheet: preview, adjust, then save row by row.
 // Staff list PDF (name, phone, email): everyone shown in People (current filters), or only people assigned to this event.
 function StaffExport({S,shown,filtered,onClose}){
  const event=events.find(e=>e.id===current.id)||{},evActs=new Set(activities.filter(s=>s.ev===current.id).map(s=>s.id));
  const assigned=[...new Set((S.asg||[]).filter(a=>evActs.has(a.s)).map(a=>a.e))].map(e=>people[e]).filter(p=>p&&!p.gone);
  const [who,setWho]=useState('shown'),[msg,setMsg]=useState('');
  const list=who==='assigned'?assigned:shown,count=n=>n+(n===1?' person':' people');
  const make=()=>{const m2=openStaffList({eventName:event.name,dates:event.start?event.start+' through '+evEnd(event):'',scope:who==='assigned'?'People assigned to this event':filtered?'People list (filtered)':'Everyone in People',people:list.map(p=>({name:p.name,phone:p.phone||'',email:p.email||''}))});if(m2)setMsg(m2);else onClose()};
  return html`<${Modal} title="Export staff list" onClose=${onClose}><div className="staff-export">
   <p className="mute">A PDF with each person's name, phone, and email for ${event.name}.</p>
   <fieldset className="choice-list"><legend>Include</legend>
    <label className="chk"><input type="radio" name="staff-scope" checked=${who==='shown'} onChange=${()=>setWho('shown')}/>${filtered?'People shown in the list (your filters)':'Everyone in People'} · ${count(shown.length)}</label>
    <label className="chk"><input type="radio" name="staff-scope" checked=${who==='assigned'} onChange=${()=>setWho('assigned')}/>Only people assigned to ${event.name} · ${count(assigned.length)}</label>
   </fieldset>
   ${msg&&html`<p className="connection-error" role="alert">${msg}</p>`}
   <div className="dialog-actions"><button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${!list.length} onClick=${make}><${Icon} name="print"/>Create PDF</button></div>
  </div><//>`;
 }
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
 // Lunch and break scheduling for one person or a group, plus who is clocked out right now.
 function BreakEditor({editor,A,S,onClose,dayIndex}){
  const editing=editor.id!=null,ev=current.id;
  const [k,setK]=useState(editor.k||'lunch'),[d,setD]=useState(editor.d??dayIndex),[st,setSt]=useState(time(editor.a??720)),[en,setEn]=useState(time(editor.b??750));
  const [ids,setIds]=useState(new Set()),[q,setQ]=useState(''),[failed,setFailed]=useState('');
  const active=people.filter(p=>p&&!p.gone).sort((x,y)=>x.name.localeCompare(y.name));
  const dayActs=activities.filter(s=>s.ev===ev&&s.d===Number(d)).sort((x,y)=>x.a-y.a);
  const toggle=id=>setIds(v=>{const n=new Set(v);n.has(id)?n.delete(id):n.add(id);return n});
  const addFrom=sid=>{const s=activities.find(x=>x.id===Number(sid));if(!s)return;setIds(v=>new Set([...v,...S.asg.filter(a=>a.s===s.id&&people[a.e]&&!people[a.e].gone).map(a=>a.e)]));};
  const submit=async e=>{e.preventDefault();setFailed('');
   if(!editing&&!ids.size){setFailed('Choose at least one person.');return}
   const a=minutes(st),b=minutes(en);if(!(b>a)){setFailed('End time must be after start time.');return}
   const r=await(editing?A.editBreak(editor.id,k,Number(d),a,b):A.addBreak(k,Number(d),a,b,[...ids]));
   if(r!==false)onClose();else setFailed('Could not save. Check the values and try again.');};
  return html`<${Modal} title=${editing?'Edit '+(people[editor.e]?.name||'break'):'Add lunch or break'} onClose=${onClose}><form className="break-editor" onSubmit=${submit}>
   <div className="editor-fields">
    ${field('Type',html`<select value=${k} onChange=${e=>setK(e.target.value)}><option value="lunch">Lunch</option><option value="break">Break</option></select>`)}
    ${field('Day',html`<select value=${d} onChange=${e=>setD(e.target.value)}>${days.map((x,i)=>html`<option key=${i} value=${i}>${x}</option>`)}</select>`)}
    ${field('Start time',html`<input type="time" required value=${st} onChange=${e=>setSt(e.target.value)}/>`)}
    ${field('End time',html`<input type="time" required value=${en} onChange=${e=>setEn(e.target.value)}/>`)}
   </div>
   ${!editing&&html`<fieldset className="break-people"><legend>People <span className="mute">${ids.size} selected</span></legend>
    <div className="break-people-tools"><select aria-label="Add everyone assigned to an activity" value="" onChange=${e=>addFrom(e.target.value)}><option value="">Add everyone in an activity…</option>${dayActs.map(s=>html`<option key=${s.id} value=${s.id}>${s.t}, ${s.r}, ${span(s)}</option>`)}</select>
     <input type="search" aria-label="Filter people" placeholder="Filter people" value=${q} onChange=${e=>setQ(e.target.value)}/>${ids.size>0&&html`<button type="button" className="btn ghost" onClick=${()=>setIds(new Set())}>Clear</button>`}</div>
    <div className="break-people-list">${active.filter(p=>(p.name+' '+(p.role||'')).toLowerCase().includes(q.toLowerCase())).map(p=>html`<label key=${p.id} className="chk"><input type="checkbox" checked=${ids.has(p.id)} onChange=${()=>toggle(p.id)}/>${p.name}<span className="mute">${p.role||''}</span></label>`)}</div>
   </fieldset>`}
   ${failed&&html`<p className="connection-error editor-error" role="alert">${failed}</p>`}
   <div className="dialog-actions"><button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="submit" className="btn">${editing?'Save changes':ids.size>1?'Schedule for '+ids.size+' people':'Schedule'}</button></div>
  </form><//>`;
 }
 function BreaksPage({S,dayIndex,setDay,onAdd,onEdit,onRemove,table,actions}){
  const [,tick]=useState(0);useEffect(()=>{const t=setInterval(()=>tick(n=>n+1),30000);return()=>clearInterval(t)},[]);
  const who=e=>people[e]?.name||'Unknown';
  const out=(S.clocks||[]).filter(c=>!c.in&&people[c.e]).map(c=>({c,late:m.lateBy(S,c),br:c.bid!=null&&m.breakOf(S,c.bid)})).sort((x,y)=>y.late-x.late||x.c.out.localeCompare(y.c.out));
  const today=new Date().toDateString();
  const lateBack=(S.clocks||[]).filter(c=>c.in&&people[c.e]&&new Date(c.in).toDateString()===today&&m.lateBy(S,c)>0);
  const list=(S.breaks||[]).filter(b=>b.ev===current.id&&b.d===dayIndex&&people[b.e]).sort((x,y)=>x.a-y.a||who(x.e).localeCompare(who(y.e)));
  const statusOf=b=>{const c=(S.clocks||[]).find(x=>x.bid===b.id);if(!c)return html`<span className="mute">Scheduled</span>`;const lt=m.lateBy(S,c);
   return c.in?html`<${Badge} kind=${lt?'bad':'ok'}>${lt?'Back '+lt+' min late':'Back on time'}<//><span className="cell-secondary">Out ${m.clockTime(c.out)} · back ${m.clockTime(c.in)}</span>`:html`<${Badge} kind=${lt?'bad':'warn'}>${lt?'Out · '+lt+' min late':'Out now'}<//><span className="cell-secondary">Since ${m.clockTime(c.out)}</span>`;};
  return html`<div className="breaks-page">
   <section aria-labelledby="out-now"><h3 id="out-now">Out now</h3>
    ${out.length?table([{text:'Person'},{text:'Out for'},{text:'Since'},{text:'Scheduled until'},{text:'Status'}],out.map(({c,late,br})=>html`<tr key=${c.id} className=${late?'late-row':''}><td><b>${who(c.e)}</b></td><td>${m.BREAK[c.k][0]}</td><td>${m.clockTime(c.out)}</td><td>${br?span(br):html`<span className="mute">Not scheduled</span>`}</td><td><${Badge} kind=${late?'bad':'warn'}>${late?'Late return · '+late+' min':'Out'}<//></td></tr>`)):html`<p className="mute">Everyone is clocked in.</p>`}
   </section>
   ${lateBack.length>0&&html`<section aria-labelledby="late-back"><h3 id="late-back">Returned late today</h3>${table([{text:'Person'},{text:'Out for'},{text:'Out'},{text:'Back'},{text:'Late by'}],lateBack.map(c=>html`<tr key=${c.id}><td><b>${who(c.e)}</b></td><td>${m.BREAK[c.k][0]}</td><td>${m.clockTime(c.out)}</td><td>${m.clockTime(c.in)}</td><td><${Badge} kind="bad">${m.lateBy(S,c)} min<//></td></tr>`))}</section>`}
   <section aria-labelledby="scheduled"><div className="section-heading"><h3 id="scheduled">Scheduled lunches and breaks</h3></div>
    <div className="view-toolbar"><div className="seg day-tabs" role="group" aria-label="Event day">${(m.daysShort||days).map((x,i)=>html`<button key=${x} aria-pressed=${dayIndex===i} onClick=${()=>setDay(i)}>${x}</button>`)}</div></div>
    ${list.length?table([{text:'',className:'setup-actions'},{text:'Person'},{text:'Type'},{text:'Time'},{text:'Status'}],list.map(b=>html`<tr key=${b.id}><td className="setup-actions">${actions('Edit '+who(b.e)+' '+m.BREAK[b.k][0].toLowerCase(),()=>onEdit(b),'Delete '+who(b.e)+' '+m.BREAK[b.k][0].toLowerCase(),()=>onRemove(b))}</td><td><b>${who(b.e)}</b><span className="cell-secondary">${people[b.e].role||''}</span></td><td>${m.BREAK[b.k][0]}</td><td>${span(b)}</td><td>${statusOf(b)}</td></tr>`)):html`<div className="empty-state"><${Icon} name="clock" size=${28}/><h3>No lunches or breaks scheduled</h3><button className="btn" onClick=${onAdd}><${Icon} name="plus"/>Add lunch or break</button></div>`}
   </section></div>`;
 }
 function Editor({editor,A,error,onClose,testLogins,logins}){
  const [draft,setDraft]=useState(editor.draft),[failed,setFailed]=useState(false);
  const editing=editor.id!=null,version={expectedRevision:editor.revision};
  const set=key=>e=>setDraft(d=>({...d,[key]:e.target.type==='checkbox'?e.target.checked:e.target.value}));
  const title=editor.remove?'Delete '+editor.label:((editing?'Edit ':'Add ')+{person:'person',event:'event',room:'room',activity:'activity'}[editor.type]);
  const submit=async e=>{
   e.preventDefault();setFailed(false);let result;
   if(editor.remove)result=await ({person:A.delStaff,event:A.delEvent,room:A.delRoom,activity:A.delSession,break:A.delBreak}[editor.type])(editor.id);
   else if(editor.type==='person'){
    const value={n:draft.name.trim(),email:draft.email.trim().toLowerCase(),r:draft.title.trim(),acct:draft.type,phone:draft.phone.trim(),map:draft.map};
    result=await(editing?A.editStaff(editor.id,value,version):A.addStaff(value));
   }else if(editor.type==='event'){
    const value={n:draft.name.trim(),b:draft.start,d:Number(draft.days),...(m.pushSupport.on?{tz:draft.tz}:{}),...(m.eventInfoSupport.on?{venue:draft.venue.trim(),addr:draft.addr.trim(),notes:draft.notes.trim()}:{}),...(m.itinSupport.on?{staffFlights:!!draft.sf,staffHotels:!!draft.sh}:{})};
    result=await(editing?A.editEvent(editor.id,value,version):A.addEvent(value));
   }else if(editor.type==='room')result=await(editing?A.editRoom(editor.id,draft.name.trim(),!!draft.req,version):A.addRoom(draft.name.trim(),!!draft.req));
   else{
    const rs=m.runShowSupport.on,start=minutes(draft.start),end=rs&&draft.noEnd?start:minutes(draft.end);
    const args=[draft.name.trim(),draft.room,Number(draft.day),start,end,rs&&String(draft.needed).trim()===''?0:Number(draft.needed),qOf[draft.q]];
    // Details (everyone) and notes (admins only) ride along as one last argument on databases that support them,
    // with Managed by on databases that have it.
    if(m.infoSupport.on)args.push({det:(draft.det||'').trim(),nt:(draft.nt||'').trim(),...(rs?{by:(draft.by||'').trim()}:{})});
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
     ${field('Number of days',html`<input type="number" required min="1" max="14" value=${draft.days} onChange=${set('days')}/> `)}
     ${m.pushSupport.on&&field('Time zone',html`<select value=${draft.tz} onChange=${set('tz')}>${[...ZONES,...(ZONES.some(z=>z[0]===draft.tz)?[]:[[draft.tz,draft.tz]])].map(([v,l])=>html`<option key=${v} value=${v}>${l}</option>`)}</select>`)}
     ${m.pushSupport.on&&html`<p className="mute ack-hint">Reminders go out 30 minutes before each activity, in this time zone.</p>`}
     ${m.eventInfoSupport.on&&html`<label className="wide-field">Venue name<input maxLength="200" value=${draft.venue} placeholder="For example, El Conquistador Resort" onChange=${set('venue')}/></label>
     <label className="wide-field">Address<textarea rows="2" maxLength="500" value=${draft.addr} placeholder="Street, city, state, ZIP" onChange=${set('addr')}></textarea></label>
     <label className="wide-field">Notes<textarea rows="4" maxLength="4000" value=${draft.notes} onChange=${set('notes')}></textarea><span className="mute field-hint">Only admins see these notes.</span></label>`}
     ${m.itinSupport.on&&html`<fieldset className="choice-list wide-field"><legend>Travel (Itineraries)</legend><label className="chk"><input type="checkbox" checked=${draft.sf} onChange=${set('sf')}/>People can enter their own flights</label><label className="chk"><input type="checkbox" checked=${draft.sh} onChange=${set('sh')}/>People can enter their own hotel</label><span className="mute field-hint">Admins can always enter anyone's. People can change only bookings they entered, and only while this is on.</span></fieldset>`}`}
    ${editor.type==='activity'&&html`
     ${field('Room',html`<select required value=${draft.room} onChange=${set('room')}><option value="" disabled>Choose room</option>${rooms.map(r=>html`<option key=${r}>${r}</option>`)}</select>`)}
     ${field('Day',html`<select value=${draft.day} onChange=${set('day')}>${days.map((d,i)=>html`<option key=${i} value=${i}>${d}</option>`)}</select>`)}
     ${field('Start time',html`<input type="time" required value=${draft.start} onChange=${set('start')}/> `)}
     ${!(m.runShowSupport.on&&draft.noEnd)&&field('End time',html`<input type="time" required value=${draft.end} onChange=${set('end')}/> `)}
     ${m.runShowSupport.on&&html`<label className="chk wide-field"><input type="checkbox" checked=${!!draft.noEnd} onChange=${set('noEnd')}/>No end time (a one-moment action, such as "Close event hall doors")</label>`}
     ${m.runShowSupport.on?field('Staff needed',html`<input type="number" min="0" placeholder="Optional" value=${draft.needed} onChange=${set('needed')}/> `):field('Staff needed',html`<input type="number" required min="1" value=${draft.needed} onChange=${set('needed')}/> `)}
     ${m.runShowSupport.on&&field('Managed by',html`<input maxLength="120" placeholder="For example, Encore AV" value=${draft.by} onChange=${set('by')}/> `)}
     ${m.runShowSupport.on&&html`<p className="mute ack-hint">Leave Staff needed blank when no set number is needed, for example when AV or Encore runs it. You can still assign staff or contractors.</p>`}
     ${ackSupport.on&&field('Acknowledgment and check-in',html`<select value=${draft.q} onChange=${set('q')}><option value="room">Same as room (${roomAck[draft.room]!==false?'required':'not required'})</option><option value="yes">Required</option><option value="no">Not required</option></select>`)}
     ${ackSupport.on&&html`<p className="mute ack-hint">When not required, assigned people are told about the activity but are not asked to acknowledge or check in.</p>`}
     ${m.infoSupport.on&&html`<label className="wide-field">Details<textarea rows="3" maxLength="2000" value=${draft.det} onChange=${set('det')}></textarea><span className="mute field-hint">Everyone assigned sees this on their schedule.</span></label>
     <label className="wide-field">Notes<textarea rows="3" maxLength="2000" value=${draft.nt} onChange=${set('nt')}></textarea><span className="mute field-hint">Only admins see these notes.</span></label>
     <p className="mute ack-hint">Team leads are chosen from the people assigned, in the activity's panel on the Schedule page.</p>`}`}
    ${editor.type==='room'&&ackSupport.on&&html`
     <label className="chk"><input type="checkbox" checked=${draft.req} onChange=${set('req')}/>Requires acknowledgment and check-in</label>
     <p className="mute ack-hint">Default for this room's activities. Each activity can override it.</p>`}
   </div>`}
   ${!editor.remove&&editing&&editor.type==='person'&&logins&&html`<${LoginPanel} personId=${editor.id} name=${editor.draft.name} api=${logins} dirty=${draft.email.trim().toLowerCase()!==editor.draft.email||draft.type!==editor.draft.type}/>`}
   ${!editor.remove&&editing&&editor.type==='person'&&testLogins&&!!editor.draft.email&&html`<${TestLoginPanel} personId=${editor.id} api=${testLogins} dirty=${draft.email.trim().toLowerCase()!==editor.draft.email||draft.type!==editor.draft.type}/>`}
   ${(failed||error)&&html`<p className="connection-error editor-error" role="alert">${error||'Could not save. Check the values and try again.'}</p>`}
   <div className="dialog-actions"><button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="submit" className=${'btn '+(editor.remove?'danger':'')}>${editor.remove?'Confirm delete':editing?'Save changes':editor.type==='person'?'Add person':editor.type==='event'?'Create event':editor.type==='room'?'Add room':'Create activity'}</button></div>
  </form><//>`;
 }

 return function AdminWorkspace({S,A,me=null,error='',testLogins,logins,push=null}){
  const [view,setView]=useState('schedule'),[day,setDay]=useState(0),[mode,setMode]=useState('list'),[filter,setFilter]=useState('all');
  const [logoBusy,setLogoBusy]=useState(null),[logoMsg,setLogoMsg]=useState(''),[showImport,setShowImport]=useState(false);
  const logoOn=!!(m.logoSupport&&m.logoSupport.on),splashOn=!!(m.splashSupport&&m.splashSupport.on),[preview,setPreview]=useState(null);
  // Event images: kind 'logo' (next to module headings) or 'splash' (welcome screen after signing in).
  const pickImage=(id,kind)=>async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;setLogoBusy(id+kind);setLogoMsg('');const r=await (kind==='splash'?m.prepSplash:m.prepLogo)(f).catch(()=>'This image could not be read on this device.');if(typeof r==='string'){setLogoBusy(null);setLogoMsg(r);return}await (kind==='splash'?A.setEventSplash:A.setEventLogo)(id,r);setLogoBusy(null)};
  const imageCell=(e,kind)=>{const name=kind==='splash'?'welcome splash':'logo',has=!!e[kind];return html`<div className="image-slot"><span className="image-label">${kind==='splash'?'Welcome splash':'Logo'}</span>${logoBusy===e.id+kind?html`<span className="cell-secondary" role="status">Resizing and saving…</span>`:html`${has&&html`<${EventLogo} ev=${e} kind=${kind} className=${kind==='splash'?'splash-thumb':'logo-thumb'}/>`}<div className="acts"><label className="btn ghost file-pick"><${Icon} name="upload"/>${has?'Replace':'Add '+name}<input type="file" accept="image/*,.svg" aria-label=${(has?'Replace ':'Add ')+name+' for '+e.name} onChange=${pickImage(e.id,kind)}/></label>${has&&kind==='splash'&&html`<button className="btn ghost" onClick=${()=>setPreview(e)}><${Icon} name="eye"/>Preview</button>`}${has&&html`<button className="btn ghost" aria-label=${'Remove '+name+' from '+e.name} onClick=${()=>(kind==='splash'?A.setEventSplash:A.setEventLogo)(e.id,null)}>Remove</button>`}</div>`}</div>`};
  const [staffPdf,setStaffPdf]=useState(false),[addingDoc,setAddingDoc]=useState(false);
  const [closing,setClosing]=useState(null),[importing,setImporting]=useState(false),[breakEd,setBreakEd]=useState(null),[exportMsg,setExportMsg]=useState(''),[selected,setSelected]=useState(null),[query,setQuery]=useState(''),[type,setType]=useState('all'),[tab,setTab]=useState('events'),[editor,setEditor]=useState(null),[limits,setLimits]=useState(false);
  // Push notification enrollment (only on databases with the push migration).
  const pushOn=Array.isArray(S.pushStatus),ps=Object.fromEntries((S.pushStatus||[]).map(p=>[p.e,p])),pt=Object.fromEntries((S.pushTests||[]).map(t=>[t.e,t]));
  const pushCell=p=>{const st=ps[p.id]||{n:0,devices:[]},t=pt[p.id];return html`<td className="push-column">${st.n?html`<span title=${(st.devices||[]).join(', ')}><${Badge} kind="ok">On · ${st.n} device${st.n===1?'':'s'}<//></span><span className="cell-secondary">${st.ok?'Last delivered '+when(st.ok):'Nothing delivered yet'}</span>`:html`<${Badge} kind="warn">Not enrolled<//>`}${t&&html`<span className=${'cell-secondary'+(t.st==='failed'||t.st==='skipped'?' import-error':'')}>${testText(t)}</span>`}<button type="button" className="btn ghost push-test" disabled=${!st.n} title=${st.n?'':'They need to turn on notifications first'} aria-label=${'Send test notification to '+p.name} onClick=${()=>A.pushTest(p.id)}><${Icon} name="bell-ring"/>Send test</button></td>`;};
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
  const coverNote=s=>{if(!m.breaksOn(S))return null;const as=S.asg.filter(a=>a.s===s.id&&people[a.e]),first=e=>people[e].name.split(' ')[0];
   const outs=as.map(a=>[a.e,m.openClock(S,a.e)]).filter(([,c])=>c),brs=as.flatMap(a=>m.breaksDuring(S,a.e,s).map(b=>[a.e,b]));
   return html`${m.liveNow(s)&&html`<p className="coverage-live"><b>Active now: ${as.length-outs.length} of ${as.length}</b>${outs.length>0&&html` · ${outs.map(([e,c])=>first(e)+' '+m.BREAK[c.k][1].toLowerCase()+(m.lateBy(S,c)?' (late)':'')).join(', ')}`}</p>`}${brs.length>0&&html`<p className="mute coverage-breaks">Breaks: ${brs.map(([e,b])=>first(e)+' '+m.BREAK[b.k][0].toLowerCase()+' '+span(b)).join(', ')}</p>`}`;};
  const navigate=next=>{setExportMsg('');setView(next);setSelected(null);setFilter('all');};
  const open=(entity,record=null)=>{
   let draft,id;
   if(entity==='person'){id=record?.id;draft={name:record?.name||'',email:record?.email||'',title:record?.role||'Room Host',type:record?.acct||'staff',phone:record?.phone||'',map:record?!!record.map:true};}
   else if(entity==='event'){id=record?.id;draft={name:record?.name||'',start:record?.start||'',days:record?.days||3,tz:record?.tz||'America/New_York',venue:record?.venue||'',addr:record?.addr||'',notes:record?.notes||'',sf:!!record?.staffFlights,sh:!!record?.staffHotels};}
   else if(entity==='room'){id=record;draft={name:record||'',req:record?roomAck[record]!==false:true};}
   else{id=record?.id;draft={name:record?.t||'',room:record?.r||rooms[0]||'',day:record?.d??dayIndex,start:time(record?.a??540),end:time(record?.b??600),needed:m.runShowSupport.on?(record?.n||''):record?.n||2,noEnd:!!record&&record.a===record.b,by:record?.m||'',q:record?.q==null?'room':record.q?'yes':'no',det:record?.det||'',nt:record?.nt||''};}
   setEditor({type:entity,id,draft,revision:S.revision});
  };
  const shownPeople=people.filter(p=>!p.gone&&(type==='all'||p.acct===type)&&(p.name+' '+p.email+' '+p.role).toLowerCase().includes(query.toLowerCase()));
  const remove=(entity,id,label,warning)=>setEditor({type:entity,id,label,warning,remove:true,revision:S.revision});
  const planning=[['schedule','calendar','Schedule'],['coverage','coverage','Coverage'],['people','people','People'],...(m.breaksOn(S)?[['breaks','clock','Breaks']]:[]),...(me!=null?[['mine','user','My schedule']]:[])];
  const nav=[...planning,['setup','settings','Event setup'],...(m.travelInfoSupport.on&&m.itinSupport.on?[['travelinfo','bus','Arrival & departure info']]:[]),...(Array.isArray(S.expenses)?[['expenses','receipt','Expenses']]:[]),['log','activity','Activity log'],...(m.floorSupport.on?[['plans','map','Floorplans']]:[]),...(Array.isArray(S.documents)?[['documents','file','Documents']]:[]),...(m.itinSupport.on?[['itineraries','plane','Itineraries']]:[]),...(m.remindersSupport.on?[['messages','bell','Messages']]:[]),...(m.brandSupport.on?[['appsettings','sliders','App settings']]:[]),...(!m.connected?[['incoming','package','Incoming goods']]:[])];
  const navButton=([id,icon,label])=>html`<button key=${id} type="button" className="nav-item" aria-current=${view===id?'page':undefined} onClick=${()=>navigate(id)}><${Icon} name=${icon}/><span>${label}</span></button>`;
  const title={expenses:'Expenses',breaks:'Breaks',mine:'My schedule',schedule:'Schedule',coverage:'Coverage',people:'People',setup:'Event setup',log:'Activity log',plans:'Floorplans',documents:'Documents',itineraries:'Itineraries',travelinfo:'Arrival & departure info',messages:'Messages',appsettings:'App settings',incoming:'Incoming goods'}[view];
  const sub=['schedule','coverage','breaks'].includes(view)?dateLabel(dayIndex):view==='appsettings'?'For the whole app, every event':event.name;
  const actions=(editLabel,onEdit,deleteLabel,onDelete,disabled=false)=>html`<div className="row-actions"><${IconButton} name="edit" label=${editLabel} onClick=${onEdit}/><${IconButton} name="delete" label=${deleteLabel} onClick=${onDelete} disabled=${disabled}/></div>`;
  const table=(headers,body)=>html`<div className="data-surface"><table className="data-table"><thead><tr>${headers.map((h,i)=>html`<th key=${i} scope="col" className=${h.className||''}>${h.text}</th>`)}</tr></thead><tbody>${body.length?body:html`<tr><td colSpan=${headers.length} className="empty-table">No records found.</td></tr>`}</tbody></table></div>`;
  return html`<div className="workspace-layout"><nav className="sidebar" aria-label="Main navigation"><span className="nav-group">Planning</span>${nav.slice(0,planning.length).map(navButton)}<span className="nav-group">Manage</span>${nav.slice(planning.length).map(navButton)}</nav>
  <main className="workspace-main">${preview&&html`<${Splash} url=${()=>m.imageUrl(preview,'splash')} label=${'Welcome to '+preview.name} onClose=${()=>setPreview(null)}/>`}${event?.closed&&html`<div className="closed-banner" role="status"><b>${event.name} is closed.</b> Staff and contractors can't see it or anything in it. You can still view and change it.<button className="btn ghost" onClick=${()=>A.setEventClosed(event.id,false)}>Reopen event</button></div>`}<div className="page-heading"><div className="page-title"><div><h2>${title}</h2><p className="mute">${sub}</p></div>${logoOn&&event&&html`<${EventLogo} ev=${event}/>`}</div>
   ${view==='schedule'&&m.scheduleImportSupport&&m.scheduleImportSupport.on&&html`<button className="btn ghost" onClick=${()=>setShowImport(true)}><${Icon} name="upload"/>Import run of show</button>`}${view==='schedule'&&html`<button className="btn" onClick=${()=>open('activity')} disabled=${!rooms.length}><${Icon} name="plus"/>New activity</button>`}
   ${view==='breaks'&&html`<div className="heading-actions">${(()=>{const none=!(S.breaks||[]).some(b=>b.ev===current.id);return html`<button className="btn ghost" disabled=${none} title=${none?'No lunches or breaks to export':''} onClick=${()=>setExportMsg(m.breakExport.pdf(S))}><${Icon} name="print"/>PDF</button><button className="btn ghost" disabled=${none} onClick=${async()=>setExportMsg(await m.breakExport.xlsx(S))}><${Icon} name="download"/>Excel</button>`})()}<button className="btn" onClick=${()=>setBreakEd({})}><${Icon} name="plus"/>Add lunch or break</button></div>`}
   ${view==='documents'&&Array.isArray(S.documents)&&html`<button className="btn" onClick=${()=>setAddingDoc(true)}><${Icon} name="plus"/>Add document</button>`}
   ${view==='people'&&html`<div className="heading-actions">${pushOn&&html`<button className="btn ghost" onClick=${()=>setLimits(true)}><${Icon} name="bell"/>Delivery limits</button>`}<button className="btn ghost" onClick=${()=>setStaffPdf(true)}><${Icon} name="print"/>Export PDF</button><button className="btn ghost" onClick=${()=>setImporting(true)}><${Icon} name="upload"/>Import from Excel</button><button className="btn" onClick=${()=>open('person')}><${Icon} name="plus"/>Add person</button></div>`}
   ${view==='setup'&&html`<button className="btn" onClick=${()=>open(tab==='events'?'event':tab==='rooms'?'room':'activity')} disabled=${tab==='activities'&&!rooms.length}><${Icon} name="plus"/>${tab==='events'?'Add event':tab==='rooms'?'Add room':'New activity'}</button>`}
  </div>
  ${view==='people'&&testLogins&&html`<${BulkTestLogins} api=${testLogins}/>`}${view==='people'&&logins&&html`<${BulkLogins} api=${logins} people=${people.filter(p=>p&&!p.gone)}/>`}
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
     <td><button className="activity-link" onClick=${()=>setSelected(s.id)}><b>${s.t}</b><span className="mute">${s.r}${s.m?' · '+s.m:''}</span><span className="mute mobile-time">${span(s)}</span></button>${conflict&&html`<span className="inline-warning"><${Icon} name="warning" size=${13}/>Overlap</span>`}</td><td className="time-column">${span(s)}</td><td><${Badge} kind=${c.as.length<s.n?'warn':s.n||c.as.length?'ok':''}>${m.staffText(s,c)}<//></td><td className="ack-column">${need(s)?`${c.as.filter(a=>a.ack).length} / ${c.as.length}`:html`<span className="mute">Not required</span>`}</td><td><${IconButton} name="right" label=${'Manage '+s.t} onClick=${()=>setSelected(s.id)}/></td></tr>`;})):
     html`<div className="coverage-list">${[...visible].sort((a,b)=>(b.n-cover(b,S.asg).as.length)-(a.n-cover(a,S.asg).as.length)).map(s=>{const c=cover(s,S.asg);return html`<div className="coverage-row" key=${s.id}><div><b>${s.r}</b><p className="mute">${s.t} · ${span(s)}</p>${coverNote(s)}</div><div className="coverage-count"><b>${s.n?c.p+' / '+s.n:c.p}</b><span className="mute">present</span></div><${Badge} kind=${c.as.length<s.n?'warn':s.n||c.as.length?'ok':''}>${s.n||c.as.length?c.as.length+' assigned':'No staff needed'}<//><button className="btn ghost" onClick=${()=>setSelected(s.id)}>${c.as.length<s.n?'Fill gap':'View staff'}<${Icon} name="right"/></button></div>`;})}</div>`:
     html`<div className="empty-state"><${Icon} name="calendar" size=${28}/><h3>${today.length?'No activities match this filter':'No activities scheduled'}</h3>${today.length?html`<button className="btn ghost" onClick=${()=>setFilter('all')}>Show all activities</button>`:html`<button className="btn" disabled=${!rooms.length} onClick=${()=>open('activity')}><${Icon} name="plus"/>Add activity</button>`}</div>`}
    </div>${currentActivity&&html`<aside ref=${detail} tabIndex=${-1} className="activity-detail" aria-label="Assignment details"><div className="detail-heading"><h3>Assignment details</h3><${IconButton} name="close" label="Close activity" onClick=${()=>setSelected(null)}/></div><${AdminSession} key=${currentActivity.id} s=${currentActivity} S=${S} A=${A} coordinator=${view==='coverage'}/><button className="btn ghost detail-edit" onClick=${()=>open('activity',currentActivity)}><${Icon} name="edit"/>Edit activity</button></aside>`}</div>`}
  `}
  ${view==='people'&&html`<div className="people-toolbar"><label className="search-field"><${Icon} name="search"/><input type="search" aria-label="Search people" placeholder="Search people" value=${query} onChange=${e=>setQuery(e.target.value)}/></label><select aria-label="Person type" value=${type} onChange=${e=>setType(e.target.value)}><option value="all">All people</option><option value="staff">Staff</option><option value="contractor">Contractors</option><option value="admin">Admins</option></select><span className="mute">${people.filter(p=>!p.gone).length} people</span></div>
   ${table([{text:'',className:'setup-actions'},{text:'Person'},{text:'Type'},{text:'Phone',className:'phone-column'},{text:'Login access'},...(pushOn?[{text:'Notifications'}]:[])],shownPeople.map(p=>{const [kind,label]=login(p);return html`<tr key=${p.id}><td className="setup-actions">${actions('Edit '+p.name,()=>open('person',p),'Delete '+p.name,()=>remove('person',p.id,p.name,'Their assignments will be cancelled and app access disabled.'))}</td><td><b>${p.name}</b><span className="cell-secondary">${p.email||p.role}</span></td><td>${p.acct==='contractor'?'Contractor':p.acct==='admin'?'Admin':'Staff'}</td><td className="phone-column">${p.phone||'Not provided'}</td><td><${Badge} kind=${kind}>${label}<//></td>${pushOn&&pushCell(p)}</tr>`;}))}
   ${pushOn&&(S.pushLog||[]).length>0&&html`<details className="delivery-log"><summary>Delivery log · ${S.pushLog.length} recent failed ${S.pushLog.length===1?'send':'sends'}</summary>${table([{text:'Time'},{text:'Person'},{text:'Device'},{text:'Type'},{text:'Problem'}],S.pushLog.map((l,i)=>html`<tr key=${i}><td>${when(l.t)}</td><td>${people[l.e]?.name||'Unknown'}</td><td>${l.dev||html`<span className="mute">Removed</span>`}</td><td>${{assignment:'Assignment',reminder:'Reminder',test:'Test'}[l.k]||l.k}</td><td>${l.err||'Failed'}</td></tr>`))}</details>`}`}
  ${view==='setup'&&html`<div className="seg setup-tabs" role="group" aria-label="Event setup sections">${[['events','Event details'],['rooms','Rooms'],['activities','Activities']].map(([id,label])=>html`<button key=${id} aria-pressed=${tab===id} onClick=${()=>setTab(id)}>${label}</button>`)}</div>
   ${tab==='events'&&logoMsg&&html`<p className="connection-error" role="alert">${logoMsg}</p>`}
   ${tab==='events'&&table([{text:'',className:'setup-actions'},{text:'Event'},{text:'Dates'},{text:'Activities'},...(logoOn?[{text:splashOn?'Logo and welcome splash':'Logo'}]:[]),...(m.closeSupport.on?[{text:'Staff access'}]:[])],events.map(e=>{const [kind,label]=evStatus(e);return html`<tr key=${e.id} className=${e.closed?'closed-row':''}><td className="setup-actions">${actions('Edit '+e.name,()=>open('event',e),'Delete '+e.name,()=>remove('event',e.id,e.name,'All of its activities and assignments will be removed.'),events.length<2)}</td><td><b>${e.name}</b><${Badge} kind=${kind}>${label}<//>${m.eventInfoSupport.on&&e.venue&&html`<span className="cell-secondary">${e.venue}</span>`}${m.eventInfoSupport.on&&e.addr&&html`<span className="cell-secondary event-addr">${e.addr}</span>`}</td><td>${e.start}<span className="cell-secondary">through ${evEnd(e)}${m.pushSupport.on&&e.tz?' · '+zoneName(e.tz):''}</span></td><td>${activities.filter(s=>s.ev===e.id).length}</td>${logoOn&&html`<td className="logo-cell">${imageCell(e,'logo')}${splashOn&&imageCell(e,'splash')}</td>`}${m.closeSupport.on&&html`<td>${e.closed?html`<span className="cell-secondary">Hidden from staff and contractors</span><button className="btn ghost" onClick=${()=>A.setEventClosed(e.id,false)}>Reopen event</button>`:closing===e.id?html`<span className="cell-secondary">Hide everything in this event from staff and contractors?</span><div className="acts"><button className="btn danger" onClick=${async()=>{setClosing(null);await A.setEventClosed(e.id,true)}}>Confirm close</button><button className="btn ghost" onClick=${()=>setClosing(null)}>Cancel</button></div>`:html`<span className="cell-secondary">Visible to assigned people</span><button className="btn ghost" onClick=${()=>setClosing(e.id)}>Close event</button>`}</td>`}</tr>`;}))}
   ${tab==='rooms'&&table([{text:'',className:'setup-actions'},{text:'Room'},...(ackSupport.on?[{text:'Acknowledgment and check-in'}]:[]),{text:'Activities'}],rooms.map(r=>{const count=activities.filter(s=>s.r===r).length;return html`<tr key=${r}><td className="setup-actions">${actions('Edit '+r,()=>open('room',r),'Delete '+r,()=>remove('room',r,r,'This room will be removed.'),!!count)}</td><td><b>${r}</b></td>${ackSupport.on&&html`<td>${ackText(roomAck[r]!==false)}</td>`}<td>${count}</td></tr>`;}))}
   ${tab==='activities'&&table([{text:'',className:'setup-actions'},{text:'Activity'},{text:'Room'},{text:'Day / time'},...(ackSupport.on?[{text:'Acknowledgment and check-in'}]:[])],allActivities.map(s=>html`<tr key=${s.id}><td className="setup-actions">${actions('Edit '+s.t,()=>open('activity',s),'Delete '+s.t,()=>remove('activity',s.id,s.t,'Assigned people will receive a cancellation notice.'))}</td><td><b>${s.t}</b>${s.m&&html`<span className="cell-secondary">Managed by ${s.m}</span>`}</td><td>${s.r}</td><td>${days[s.d]}<span className="cell-secondary">${span(s)}</span></td>${ackSupport.on&&html`<td>${ackText(need(s))}${s.q==null&&html`<span className="cell-secondary">Room default</span>`}</td>`}</tr>`))}
  `}
  ${view==='log'&&table([{text:'Time'},{text:'Action'},{text:'Details'}],S.log.map((entry,i)=>{
   const names={assign:'Assigned person',move:'Moved assignment',remove:'Removed assignment',ack:'Acknowledged assignment',checkIn:'Checked in',confirm:'Confirmed attendance',addEvent:'Added event',editEvent:'Updated event',delEvent:'Deleted event',addRoom:'Added room',editRoom:'Renamed room',delRoom:'Deleted room',addSession:'Added activity',editSession:'Updated activity',delSession:'Deleted activity',addStaff:'Added person',editStaff:'Updated person',delStaff:'Archived person',dismiss:'Dismissed notice',calAdd:'Updated calendar',calSkip:'Dismissed calendar prompt',pushTest:'Sent test notification'};
   const date=new Date(entry.t),details=entry.details;
   const description=details&&!Array.isArray(details)?details.name||'':Array.isArray(details)?typeof details[0]==='string'?details[0]:details[0]?.n||'':'';
   return html`<tr key=${i}><td>${Number.isNaN(date.valueOf())?entry.t:date.toLocaleString()}</td><td>${names[entry.x]||entry.x}</td><td>${description}</td></tr>`;
  }))}
  ${view==='breaks'&&exportMsg&&html`<p className="mute export-msg" role="status">${exportMsg}</p>`}${view==='breaks'&&m.breaksOn(S)&&html`<${BreaksPage} S=${S} table=${table} actions=${actions} dayIndex=${dayIndex} setDay=${setDay} onAdd=${()=>setBreakEd({})} onEdit=${b=>setBreakEd(b)} onRemove=${b=>remove('break',b.id,(people[b.e]?.name||'')+' '+m.BREAK[b.k][0].toLowerCase(),'They will be notified that this '+m.BREAK[b.k][0].toLowerCase()+' was cancelled.')}/>`}${view==='mine'&&me!=null&&html`<${Staff} S=${S} A=${A} me=${me} embedded=${true} push=${push}/>`}${view==='expenses'&&Array.isArray(S.expenses)&&html`<${ExpensesAdmin} S=${S} A=${A} table=${table} actions=${actions} onReport=${m.hrPdf}/>`}${view==='appsettings'&&m.brandSupport.on&&html`<${AppSettings} A=${A}/>`}${view==='itineraries'&&m.itinSupport.on&&html`<${ItinerariesAdmin} S=${S} A=${A} me=${me}/>`}${view==='messages'&&m.remindersSupport.on&&html`<${MessagesAdmin} S=${S} A=${A}/>`}${view==='travelinfo'&&m.travelInfoSupport.on&&html`<${TravelInfoAdmin} key=${'ti'+current.id} S=${S} A=${A}/>`}${view==='documents'&&Array.isArray(S.documents)&&html`<${DocumentsAdmin} S=${S} A=${A} adding=${addingDoc} onAdded=${()=>setAddingDoc(false)}/>`}${view==='plans'&&html`<${Floorplans} A=${A}/>`}${view==='incoming'&&html`<${Incoming} A=${A}/>`}
  </main>${showImport&&html`<${ScheduleImport} S=${S} A=${A} moments=${m.runShowSupport.on} people=${people} events=${events} activities=${activities} rooms=${rooms} current=${current} onClose=${()=>setShowImport(false)}/>`}${breakEd&&html`<${BreakEditor} key=${breakEd.id??'new'} editor=${breakEd} A=${A} S=${S} dayIndex=${dayIndex} onClose=${()=>setBreakEd(null)}/>`}${staffPdf&&html`<${StaffExport} S=${S} shown=${shownPeople} filtered=${type!=='all'||!!query.trim()} onClose=${()=>setStaffPdf(false)}/>`}${importing&&html`<${ImportPeople} A=${A} error=${error} onClose=${()=>setImporting(false)}/>`}${limits&&html`<${DeliveryLimits} onClose=${()=>setLimits(false)}/>`}${editor&&html`<${Editor} key=${editor.type+'-'+editor.id} editor=${editor} A=${A} error=${error} testLogins=${testLogins} logins=${logins} onClose=${()=>setEditor(null)}/>`}</div>`;
 };
}
