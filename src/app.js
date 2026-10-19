import { createConnection } from './connection.js';
import { createAdminWorkspace } from './admin-workspace.js';
import { AppHeader, Icon, IconButton } from './ui.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import htm from 'htm';
const {useState,useRef,useEffect}=React, html=htm.bind(React.createElement);
const CONNECTED=!!window.eventOpsRepository;
const FN='Alex Priya Marcus Dana Jordan Sofia Ethan Maya Luis Hana Omar Chloe Ravi Nina Tomas Zoe Kwame Elena Ben Aisha Diego Leah Sam Mei Carlos'.split(' ');
const LN='Rivera Shah Bell Okafor Lee Costa Nguyen Park Torres Ito Haddad Reed Patel Moore Silva Grant Mensah Rossi Cohen Khan Vega Stone Webb Chen Ortiz'.split(' ');
const RL=['Demo Lead','Room Host','Registration','Hospitality','Room Host'];
const EMPS=FN.map((f,i)=>({id:i,name:f+' '+LN[i],role:RL[i%5],acct:'staff',phone:'555-01'+(10+i),map:1}));
[['Pat Quinn','AV Technician (Encore AV)'],['Dr. Lena Ford','Speaker'],['Vic Mercer','Entertainment'],['Jo Adler','AV Technician (Encore AV)']].forEach(([n,r])=>EMPS.push({id:EMPS.length,name:n,role:r,acct:'contractor',phone:'555-01'+(60+EMPS.length),map:0}));
const nm=e=>EMPS[e].name+(e===0?' (Employee A)':'')+(EMPS[e].acct==='contractor'?' (contractor)':'');
const DAYS=[],DAYS_SHORT=[];
// Day labels show the weekday and date, e.g. "Saturday, Nov 7" (short: "Sat, Nov 7").
const dayDate=(start,i,short)=>{const [y,m,d]=String(start).split('-').map(Number);return new Date(Date.UTC(y,m-1,d+i)).toLocaleDateString('en-US',{weekday:short?'short':'long',month:'short',day:'numeric',timeZone:'UTC'})};
const fillDays=(start,n)=>{DAYS.length=0;DAYS_SHORT.length=0;for(let i=0;i<n;i++){DAYS.push(dayDate(start,i));DAYS_SHORT.push(dayDate(start,i,true))}};
const EVS=[{id:1,name:'IMPACT27',start:'2027-03-02',days:3},{id:2,name:'IMPACT26',start:'2026-11-07',days:6}];
const CUR={id:1};
const FP=[];
const INV=[{id:1,ev:1,type:'Swag',vendor:'Northwind Apparel',inv:'NW-20418',date:'2027-01-15',amt:2450,unit:'lb',files:[],lines:[{q:300,d:'Event t-shirts',c:6.5,w:0.4,sb:'',disp:'Promotional Give Away - No Return'},{q:100,d:'Tote bags',c:5,w:0.5,sb:'',disp:'Promotional Give Away - No Return'}]},{id:2,ev:1,type:'Equipment',vendor:'Brightline Systems (supplier loan)',inv:'',date:'2027-01-20',amt:0,unit:'lb',files:[],lines:[{q:4,d:'Demo tablets',c:0,w:1.5,sb:'',disp:'Temporary Use - Returning'}]}];
const WORKER='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const kb=n=>n>1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';
const evOf=id=>EVS.find(e=>e.id===id);
const evEnd=e=>{const [y,m,d]=e.start.split('-').map(Number);return new Date(Date.UTC(y,m-1,d+e.days-1)).toISOString().slice(0,10)};
const evStatus=e=>{const t=new Date().toISOString().slice(0,10);return t<e.start?['','Upcoming']:t>evEnd(e)?['','Past']:['ok','Current']};
const SESS=[[1,0,'POS Lab: demo support','Salon 3',540,660,3],[2,0,'Breakout A: retail trends','Salon 5',540,660,2],[3,0,'Registration desk','Salon 1',480,720,4],[4,0,'Demo showcase','Salon 3',780,900,2],[5,0,'Partner workshop','Salon 7',780,930,2],[6,0,'Keynote rehearsal','Grand Ballroom',930,1020,3],[7,1,'Opening keynote','Grand Ballroom',540,630,5],[8,1,'Hands-on lab','Salon 2',570,660,3],[9,1,'Breakout B: payments','Salon 5',660,750,2],[10,1,'Customer panel','Salon 4',840,960,3],[11,2,'Closing workshop','Salon 6',540,660,2],[12,2,'Closing session','Grand Ballroom',690,750,4]].map(r=>({id:r[0],ev:1,d:r[1],t:r[2],r:r[3],a:r[4],b:r[5],n:r[6]}));
const SM=Object.fromEntries(SESS.map(s=>[s.id,s]));
const ROOMS=['Grand Ballroom',...[1,2,3,4,5,6,7].map(n=>'Salon '+n)];
// [employee, session, acknowledged, checkedIn, tag]
const SEED=[[1,1,1,0,''],[2,1,1,0,''],[3,2,0,0,'changed'],[4,3,1,1,''],[5,3,1,1,''],[6,3,1,0,''],[2,3,1,0,''],[0,4,1,0,''],[9,4,1,0,''],[9,5,1,0,''],[10,5,0,0,'new'],[11,6,1,0,''],[8,6,1,0,''],[12,7,1,0,''],[13,7,1,0,''],[14,7,1,0,''],[15,7,1,0,''],[16,8,1,0,''],[20,8,1,0,''],[17,9,1,0,''],[18,9,1,0,''],[19,10,1,0,''],[20,10,1,0,''],[21,11,1,0,''],[22,11,1,0,''],[23,12,1,0,''],[24,12,1,0,''],[12,12,1,0,''],[25,7,1,0,''],[26,10,1,0,''],[27,12,1,0,''],[28,8,0,0,'new']];
const fmt=m=>{const h=Math.floor(m/60),x=m%60;return (h%12||12)+':'+String(x).padStart(2,'0')+(h<12?' AM':' PM')};
const span=s=>fmt(s.a)+'–'+fmt(s.b);
const ntext=(a,p)=>p+': '+SM[a.s].t+', '+SM[a.s].r+', '+span(SM[a.s])+' ('+dayDate(evOf(SM[a.s].ev).start,SM[a.s].d)+')'+(EVS.length>1?' ['+evOf(SM[a.s].ev).name+']':'');
let uid=100;
const H=[];
const seed=()=>{const asg=SEED.map((r,i)=>({id:i+1,e:r[0],s:r[1],ack:r[2],in:r[3],conf:0,tag:r[4]}));
 return {asg,log:[],notes:asg.filter(a=>!a.ack).map(a=>({id:++uid,e:a.e,aid:a.id,done:0,x:ntext(a,a.tag==='new'?'New assignment':'Changed assignment')}))}};
const clash=(asg,a)=>asg.filter(x=>x.id!==a.id&&x.e===a.e&&SM[x.s].ev===SM[a.s].ev&&SM[x.s].d===SM[a.s].d&&SM[x.s].a<SM[a.s].b&&SM[a.s].a<SM[x.s].b).map(x=>SM[x.s]);
const st=a=>a.in||a.conf?['ok',a.conf&&!a.in?'Confirmed by coordinator':'Checked in']:a.ack?['','Acknowledged']:['warn',(a.tag==='changed'?'Changed':'New')+', needs acknowledgment'];
const cover=(s,asg)=>{const as=asg.filter(x=>x.s===s.id),p=as.filter(x=>x.in||x.conf).length;
 return {as,p,k:p>=s.n?'ok':p>0?'warn':'bad',l:p>=s.n?'Covered':p>0?'Partly covered':'Not covered'}};
const Pill=({k,children})=>html`<span className=${'pill '+(k||'')}>${children}</span>`;
function Head({s,asg}){const c=cover(s,asg);
 return html`<div><h3>${s.t}</h3><p className="mute">${s.r} · ${span(s)} · ${DAYS[s.d]}</p>
 <p className="mute"><${Pill} k=${c.k}>${c.l}<//> ${c.as.length<s.n&&html`<${Pill} k="warn">${s.n-c.as.length} short<//>`} Assigned ${c.as.length} of ${s.n} · Present ${c.p}</p></div>`}
const DISP=['Promotional Give Away - No Return','Temporary Use - Returning'];
const TYPES=['Swag','Product','Equipment','Supplies','Other'];
const sbn=x=>{const d=(x||'').replace(/\D/g,'');return d.length===10?d.slice(0,4)+'.'+d.slice(4,6)+'.'+d.slice(6):''};
const num=x=>parseFloat(x)||0, r2=n=>Math.round(n*100)/100, money=n=>'$'+Number(n).toFixed(2);
const lext=l=>r2(num(l.q)*num(l.c)), ltot=L=>r2(L.reduce((t,l)=>t+lext(l),0)), lwt=L=>L.reduce((t,l)=>t+num(l.q)*num(l.w),0);
const newLine=()=>({q:'1',d:'',c:'',w:'',sb:'',disp:DISP[0]});
const blankInv=()=>({id:null,type:'Swag',vendor:'',inv:'',date:new Date().toISOString().slice(0,10),amt:'',unit:'lb',lines:[newLine()],files:[]});
const saveFile=async f=>{const d=window.claude&&await window.claude.use('downloads');if(!d)return 'Saving is not available here.';try{await d.save({filename:f.name,data:f.data.slice(0)});return ''}catch(e){return e&&e.code==='declined'?'':e&&e.code==='rejected_extension'?'This file type cannot be saved from the preview. The production app would allow it.':'Could not save the file.'}};
function AttView({f,onClose}){
 const pdf=/pdf/i.test(f.mime||'')||/\.pdf$/i.test(f.name),img=/^image\//.test(f.mime||'')||/\.(png|jpe?g|gif|webp|svg)$/i.test(f.name);
 const [u,setU]=useState(''),[m,setM]=useState('');
 useEffect(()=>{setU('');if(!img)return;let dead=false;const fr=new FileReader();fr.onload=()=>{if(!dead)setU(fr.result)};fr.readAsDataURL(new Blob([f.data],{type:f.mime||'image/png'}));return()=>{dead=true}},[f.id]);
 if(pdf)return html`<${PdfView} f=${f} onClose=${onClose}/>`;
 return html`<div className="card"><h3>${f.name}</h3>${img&&u&&html`<img src=${u} alt=${f.name} style=${{maxWidth:'100%'}}/>`}${!img&&html`<p className="mute">This file type cannot be previewed. Use Download.</p>`}
 <div className="acts"><button className="btn ghost" onClick=${async()=>setM(await saveFile(f))}>Download</button><button className="btn" onClick=${onClose}>Close</button></div>${m&&html`<p className="mute" role="status">${m}</p>`}</div>`}
function Incoming({A}){
 const [f,setF]=useState(null),[view,setView]=useState(null),[msg,setMsg]=useState('');
 const list=INV.filter(i=>i.ev===CUR.id).sort((a,b)=>b.date.localeCompare(a.date)),vw=INV.flatMap(i=>i.files).find(x=>x.id===view);
 const set=(k,v)=>setF(q=>({...q,[k]:v})), setL=(i,k,v)=>setF(q=>({...q,lines:q.lines.map((l,j)=>j===i?{...l,[k]:v}:l)}));
 const pick=async e=>{const fs=[...e.target.files];e.target.value='';const add=[];for(const x of fs){if(x.size>26214400){setMsg(x.name+' is over 25 MB and was skipped');continue}add.push({id:++uid,name:x.name,mime:x.type,size:x.size,data:new Uint8Array(await x.arrayBuffer())})}setF(q=>({...q,files:[...q.files,...add]}))};
 const save=()=>{const o={type:f.type,vendor:f.vendor.trim(),inv:f.inv.trim(),date:f.date,amt:f.amt===''?null:num(f.amt),unit:f.unit,lines:f.lines.map(l=>({q:num(l.q),d:l.d.trim(),c:num(l.c),w:num(l.w),sb:l.sb.trim(),disp:l.disp})),files:f.files};const ok=f.id===null?A.addInv(o):A.editInv(f.id,o);ok&&setF(null)};
 const edit=i=>setF({id:i.id,type:i.type,vendor:i.vendor,inv:i.inv,date:i.date,amt:String(i.amt),unit:i.unit,lines:i.lines.map(l=>({q:String(l.q),d:l.d,c:String(l.c),w:String(l.w),sb:l.sb,disp:l.disp})),files:i.files});
 const sp=list.reduce((t,i)=>t+i.amt,0),wl=list.filter(i=>i.unit==='lb').reduce((t,i)=>t+lwt(i.lines),0),wk=list.filter(i=>i.unit==='kg').reduce((t,i)=>t+lwt(i.lines),0);
 const Th=t=>html`<th scope="col" style=${{minWidth:0}}>${t}</th>`;
 return html`<div>
 ${!f&&html`<div className="acts" style=${{marginBottom:12}}><button className="btn" onClick=${()=>setF(blankInv())}>New incoming entry</button><span className="mute" style=${{alignSelf:'center'}}>${list.length} entries · ${money(sp)} total${wl?' · '+wl.toFixed(1)+' lb':''}${wk?' · '+wk.toFixed(1)+' kg':''}</span></div>`}
 ${f&&html`<div className="card"><h3>${f.id===null?'New incoming entry':'Edit entry'}</h3>
  <div className="form">
   <label>Type<br/><select value=${f.type} onChange=${e=>set('type',e.target.value)}>${TYPES.map(t=>html`<option key=${t}>${t}</option>`)}</select></label>
   <label>Vendor name<br/><input value=${f.vendor} onChange=${e=>set('vendor',e.target.value)}/></label>
   <label>Invoice number<br/><input placeholder="Blank if none" value=${f.inv} onChange=${e=>set('inv',e.target.value)}/></label>
   <label>Date<br/><input type="date" value=${f.date} onChange=${e=>set('date',e.target.value)}/></label>
   <label>Invoice amount ($)<br/><input type="number" min="0" step="0.01" value=${f.amt} onChange=${e=>set('amt',e.target.value)}/></label>
   <label>Weight unit<br/><select value=${f.unit} onChange=${e=>set('unit',e.target.value)}><option>lb</option><option>kg</option></select></label></div>
  <h3 style=${{marginTop:14}}>Line items</h3>
  ${f.lines.map((l,i)=>html`<div className="ln" key=${i}><div className="form">
   <label>Quantity<br/><input type="number" min="0" step="1" value=${l.q} onChange=${e=>setL(i,'q',e.target.value)}/></label>
   <label>Description<br/><input value=${l.d} onChange=${e=>setL(i,'d',e.target.value)}/></label>
   <label>Item cost ($)<br/><input type="number" min="0" step="0.01" value=${l.c} onChange=${e=>setL(i,'c',e.target.value)}/></label>
   <div>Extended cost<br/><b>${money(lext(l))}</b></div>
   <label>Weight each (${f.unit})<br/><input type="number" min="0" step="0.01" value=${l.w} onChange=${e=>setL(i,'w',e.target.value)}/></label>
   <label>Schedule B code<br/><input placeholder="0000.00.0000" value=${l.sb} onChange=${e=>setL(i,'sb',e.target.value)}/></label>
   <label>Disposition<br/><select value=${l.disp} onChange=${e=>setL(i,'disp',e.target.value)}>${DISP.map(d=>html`<option key=${d}>${d}</option>`)}</select></label></div>
   <button className="btn ghost" disabled=${f.lines.length<2} onClick=${()=>setF(q=>({...q,lines:q.lines.filter((_,j)=>j!==i)}))}>Remove line</button></div>`)}
  <div className="acts"><button className="btn ghost" onClick=${()=>setF(q=>({...q,lines:[...q.lines,newLine()]}))}>Add line item</button></div>
  <p>Line items total <b>${money(ltot(f.lines))}</b> · Total weight <b>${lwt(f.lines).toFixed(2)} ${f.unit}</b> ${f.amt!==''&&Math.abs(num(f.amt)-ltot(f.lines))>0.005&&html`<${Pill} k="warn">Differs from invoice amount<//> <button className="btn ghost" onClick=${()=>set('amt',String(ltot(f.lines)))}>Use line items total</button>`}</p>
  <h3>Supporting files</h3><label><input type="file" multiple onChange=${pick}/></label><p className="mute">PDF, image, or any other file type, up to 25 MB each. ${msg}</p>
  <ul className="rows">${f.files.map(x=>html`<li key=${x.id}>${x.name} <span className="mute">${kb(x.size)}</span> <button className="btn ghost" onClick=${()=>setF(q=>({...q,files:q.files.filter(y=>y.id!==x.id)}))}>Remove</button></li>`)}</ul>
  <div className="acts"><button className="btn" onClick=${save}>Save entry</button><button className="btn ghost" onClick=${()=>{setF(null);setMsg('')}}>Cancel</button></div></div>`}
 ${vw&&html`<${AttView} f=${vw} onClose=${()=>setView(null)}/>`}
 ${!f&&!list.length&&html`<p className="mute">No incoming goods recorded for this event yet.</p>`}
 ${!f&&list.map(i=>html`<div className="card" key=${i.id}><h3>${i.vendor} <span className="mute">· ${i.type}${i.inv?' · Invoice '+i.inv:' · No invoice number'} · ${i.date}</span></h3>
  <p><b>${money(i.amt)}</b> ${Math.abs(i.amt-ltot(i.lines))>0.005&&html`<${Pill} k="warn">Line items total ${money(ltot(i.lines))}<//>`}</p>
  <p className="mute">${i.lines.length} line item(s) · ${i.lines.reduce((t,l)=>t+l.q,0)} items · ${lwt(i.lines).toFixed(2)} ${i.unit} total</p>
  <p className="mute">${DISP.map(d=>d+': '+i.lines.filter(l=>l.disp===d).reduce((t,l)=>t+l.q,0)).join(' · ')}</p>
  <details><summary>Line items</summary><div className="gridwrap"><table className="sg"><thead><tr>${Th('Qty')}${Th('Description')}${Th('Item cost')}${Th('Extended')}${Th('Weight each ('+i.unit+')')}${Th('Schedule B')}${Th('Disposition')}</tr></thead>
   <tbody>${i.lines.map((l,j)=>html`<tr key=${j}><td>${l.q}</td><td>${l.d}</td><td>${money(l.c)}</td><td>${money(lext(l))}</td><td>${l.w}</td><td>${l.sb||'Not entered'}</td><td>${l.disp}</td></tr>`)}</tbody></table></div></details>
  <div className="acts">${i.files.map(x=>html`<button key=${x.id} className="btn ghost" onClick=${()=>setView(x.id)}>${x.name}</button>`)}${!i.files.length&&html`<span className="mute">No supporting files</span>`}</div>
  <div className="acts"><button className="btn" onClick=${()=>edit(i)}>Edit</button><button className="btn ghost" onClick=${()=>A.delInv(i.id)}>Delete</button></div></div>`)}</div>`}
function PdfView({f,onClose}){
 const cv=useRef(null),doc=useRef(null),[pg,setPg]=useState(1),[n,setN]=useState(0),[err,setErr]=useState('');
 useEffect(()=>{let dead=false;doc.current=null;setN(0);setPg(1);setErr('');(async()=>{try{const L=window.pdfjsLib;if(!L)throw 0;L.GlobalWorkerOptions.workerSrc=WORKER;const d=await L.getDocument({data:f.data.slice(0)}).promise;if(dead)return;doc.current=d;setN(d.numPages)}catch(e){setErr('This PDF could not be displayed here. Use Download instead.')}})();return()=>{dead=true}},[f.id]);
 useEffect(()=>{(async()=>{const d=doc.current,c=cv.current;if(!d||!c||pg<1||pg>d.numPages)return;try{const p=await d.getPage(pg),w=Math.min(c.parentElement.clientWidth||800,1400),v0=p.getViewport({scale:1}),v=p.getViewport({scale:w/v0.width*(window.devicePixelRatio||1)});c.width=v.width;c.height=v.height;c.style.width='100%';await p.render({canvasContext:c.getContext('2d'),viewport:v}).promise}catch(e){}})()},[pg,n]);
 const dl=async()=>{try{const d=window.claude&&await window.claude.use('downloads');if(!d){setErr('Saving is not available here.');return}await d.save({filename:f.name,data:f.data.slice(0)})}catch(e){if(!e||e.code!=='declined')setErr('Could not save the file.')}};
 return html`<div className="card"><h3>${f.name}</h3><div className="acts"><button className="btn ghost" disabled=${pg<=1} onClick=${()=>setPg(pg-1)}>Previous page</button><span className="mute" style=${{alignSelf:'center'}}>Page ${pg} of ${n||'…'}</span><button className="btn ghost" disabled=${pg>=n} onClick=${()=>setPg(pg+1)}>Next page</button><button className="btn ghost" onClick=${dl}>Download</button><button className="btn" onClick=${onClose}>Close</button></div>
 ${err&&html`<p className="mute" role="status">${err}</p>`}<div style=${{marginTop:12,overflow:'auto'}}><canvas ref=${cv} aria-label=${'Floorplan '+f.name+', page '+pg}></canvas></div></div>`}
function Floorplans({A}){
 const [up,setUp]=useState(null),[open,setOpen]=useState(null),target=up!==null&&evOf(up)?up:CUR.id,vf=FP.find(f=>f.id===open);
 const pick=async e=>{const files=[...e.target.files];e.target.value='';for(const f of files){const data=new Uint8Array(await f.arrayBuffer());A.addFloorplan({name:f.name,data},target)}};
 return html`<div><div className="card"><h3>Add floorplan PDFs</h3><div className="form"><label>Assign to event<br/><select value=${target} onChange=${e=>setUp(+e.target.value)}>${EVS.map(e=>html`<option key=${e.id} value=${e.id}>${e.name}</option>`)}</select></label>
  <label>PDF files (one or more)<br/><input type="file" accept="application/pdf,.pdf" multiple onChange=${pick}/></label></div>
  <p className="mute">Most events have one floorplan PDF, but you can add several. Only people with venue map access see them. Files stay in this preview only until you reload.</p></div>
 ${vf&&html`<${PdfView} f=${vf} onClose=${()=>setOpen(null)}/>`}
 ${EVS.slice().sort((a,b)=>(b.id===CUR.id)-(a.id===CUR.id)).map(e=>html`<div className="card" key=${e.id}><h3>${e.name} <span className="mute">${FP.filter(f=>f.ev===e.id).length} floorplan(s)</span></h3>
  <ul className="rows">${FP.filter(f=>f.ev===e.id).map(f=>html`<li key=${f.id}><div><b>${f.name}</b> <span className="mute">${kb(f.size)}</span></div><div className="acts"><button className="btn ghost" onClick=${()=>setOpen(f.id)}>View</button>
   <select aria-label=${'Event for '+f.name} value=${f.ev} onChange=${ev=>A.moveFloorplan(f.id,+ev.target.value)}>${EVS.map(x=>html`<option key=${x.id} value=${x.id}>${x.name}</option>`)}</select><button className="btn ghost" onClick=${()=>A.delFloorplan(f.id)}>Remove</button></div></li>`)}</ul>
  ${!FP.some(f=>f.ev===e.id)&&html`<p className="mute">No floorplans assigned.</p>`}</div>`)}</div>`}
const EVD={d:'2027-03-02'};
const syncEv=()=>{const e=evOf(CUR.id);fillDays(e.start,e.days);EVD.d=e.start};
if(evOf(CUR.id))syncEv();
const icsDate=(day,min,st)=>{const [y,m,d]=st.split('-').map(Number),t=new Date(Date.UTC(y,m-1,d+day,0,min)),q=n=>String(n).padStart(2,'0');return t.getUTCFullYear()+q(t.getUTCMonth()+1)+q(t.getUTCDate())+'T'+q(t.getUTCHours())+q(t.getUTCMinutes())+'00'};
const ics=a=>{const s=SM[a.s];return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//IMPACT27//Staff Portal//EN','BEGIN:VEVENT','UID:impact27-'+a.id+'@staff.example','SEQUENCE:'+(a.seq||0),'DTSTAMP:'+new Date().toISOString().replace(/[-:]/g,'').slice(0,15)+'Z','DTSTART:'+icsDate(s.d,s.a,evOf(s.ev).start),'DTEND:'+icsDate(s.d,s.b,evOf(s.ev).start),'SUMMARY:IMPACT27: '+s.t,'LOCATION:'+s.r,'DESCRIPTION:Your IMPACT27 assignment','BEGIN:VALARM','ACTION:DISPLAY','DESCRIPTION:Starts in 30 minutes','TRIGGER:-PT30M','END:VALARM','END:VEVENT','END:VCALENDAR'].join('\r\n')};
const slug=t=>String(t).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'schedule';
// One person's own assignments for the current event, for one day (index) or all days (null).
function myDoc(S,me,day,autoPrint=false){
 const p=EMPS[me],ev=evOf(CUR.id),days=day==null?DAYS.map((_,i)=>i):[day];
 const mine=S.asg.filter(a=>a.e===me&&SM[a.s]&&SM[a.s].ev===CUR.id).sort((x,y)=>SM[x.s].d-SM[y.s].d||SM[x.s].a-SM[y.s].a);
 const body=days.map(i=>{const list=mine.filter(a=>SM[a.s].d===i);
  return `<h3>${esc(DAYS[i])}</h3>`+(list.length?`<table><thead><tr><th class="t">Time</th><th>Activity</th><th>Room</th><th class="s">Status</th></tr></thead><tbody>${list.map(a=>{const s=SM[a.s];return `<tr><td class="t">${esc(span(s))}</td><td><b>${esc(s.t)}</b></td><td>${esc(s.r)}</td><td class="s">${esc(st(a)[1])}</td></tr>`}).join('')}</tbody></table>`:'<p class="m">No assignments.</p>')}).join('');
 const scope=day==null?'All days':DAYS[day];
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.name)} schedule, ${esc(ev.name)}</title><style>@page{size:letter portrait;margin:.5in}body{font:12px/1.4 system-ui,sans-serif;color:#000;margin:16px;max-width:8in}h2{margin:0 0 2px}h3{margin:18px 0 6px;font-size:13px;border-bottom:2px solid #0f766e;padding-bottom:3px}p.m{color:#555;margin:4px 0}.m{color:#555}table{border-collapse:collapse;width:100%}th,td{border-top:1px solid #bbb;padding:5px 6px;text-align:left;vertical-align:top}thead th{background:#e8eeed;font-weight:700}.t{white-space:nowrap;width:1%}.s{width:28%}tr,h3{break-inside:avoid}h3{break-after:avoid}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}button{font:inherit;padding:10px 16px;margin:0 0 12px;min-height:44px}@media print{body{margin:0}button{display:none}}</style></head><body><button onclick="window.print()">Print</button><h2>${esc(p.name)}</h2><p class="m">${esc(ev.name)} · ${esc(scope)} · ${(n=>n+' assignment'+(n===1?'':'s'))(mine.filter(a=>days.includes(SM[a.s].d)).length)} · Printed ${esc(new Date().toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'}))}</p>${body}${autoPrint?'<script>addEventListener("load",()=>setTimeout(()=>print(),200))</script>':''}</body></html>`}
function MyExport({S,me,day}){
 const [msg,setMsg]=useState('');
 const name=()=>slug(evOf(CUR.id).name)+'-'+slug(EMPS[me].name)+'-'+(day==null?'all-days':slug(DAYS_SHORT[day]))+'.html';
 const save=async()=>{try{const d=window.claude&&await window.claude.use('downloads');if(!d){setMsg('Saving is not available here.');return}await d.save({filename:name(),data:myDoc(S,me,day)});setMsg('Saved. Open the file to view or print it.')}catch(e){setMsg(e&&e.code==='declined'?'Download canceled.':'Could not save the file.')}};
 const print=()=>{const url=URL.createObjectURL(new Blob([myDoc(S,me,day,true)],{type:'text/html'})),w=window.open(url,'_blank');setTimeout(()=>URL.revokeObjectURL(url),60000);setMsg(w?'':'Your browser blocked the print window. Allow pop-ups or use Download.')};
 const label=day==null?'all days':DAYS_SHORT[day];
 return html`<div className="acts my-export"><button className="btn ghost" onClick=${print} aria-label=${'Print my schedule, '+label}><${Icon} name="print"/>Print</button><button className="btn ghost" onClick=${save} aria-label=${'Download my schedule, '+label}><${Icon} name="download"/>Download</button><span className="mute">My assignments, ${label}</span>${msg&&html`<p className="mute" role="status" style=${{flexBasis:'100%',margin:0}}>${msg}</p>`}</div>`}
function Staff({S,A,me,canFull=false,embedded=false}){
 const [d0,setD]=useState(0),d=Math.min(d0,DAYS.length-1);
 // Staff can switch to the full event schedule; contractors only ever see their own.
 const [view,setView]=useState('mine'),[all,setAll]=useState(false),full=canFull&&view==='full';
 const dayActs=i=>SESS.filter(s=>s.ev===CUR.id&&s.d===i).sort((x,y)=>x.a-y.a||x.b-y.b);
 const FullCard=({s})=>{const who=S.asg.filter(a=>a.s===s.id&&EMPS[a.e]);return html`<div className=${'card'+(who.some(a=>a.e===me)?' mine':'')}>
  <h3>${s.t}</h3><p className="mute">${s.r} · ${span(s)}</p>
  <p>${who.length?who.map((a,j)=>html`<span key=${a.id}>${j?', ':''}${a.e===me?html`<b>You</b>`:EMPS[a.e].name}</span>`):html`<span className="mute">No one assigned yet</span>`}</p></div>`};
 const mine=S.asg.filter(a=>a.e===me&&SM[a.s].ev===CUR.id).sort((x,y)=>SM[x.s].d-SM[y.s].d||SM[x.s].a-SM[y.s].a);
 const next=mine.find(a=>!a.in&&!a.conf), notes=S.notes.filter(n=>n.e===me&&!n.done);
 const [shown,setShown]=useState(null),[fv,setFv]=useState(null),sa=mine.find(a=>a.id===shown);
 const Card=({a,cls})=>{const s=SM[a.s],[k,l]=st(a);return html`<div className=${'card '+(cls||'')}>
  <h3>${s.t}</h3><p className="mute">${s.r} · ${span(s)} · ${DAYS[s.d]}</p><p><${Pill} k=${k}>${l}<//> ${a.cal!=null&&html`<${Pill} k=${a.cal===(a.seq||0)?'ok':'warn'}>${a.cal===(a.seq||0)?'On your calendar':'Calendar out of date'}<//>`}</p>
  <div className="acts"><button className="btn" disabled=${!!a.ack} onClick=${()=>A.ack(a.id)}>Acknowledge</button>
  <button className="btn ghost" disabled=${!a.ack||!!a.in||!!a.conf} onClick=${()=>A.checkIn(a.id)}>Check in</button>${!!a.ack&&a.cal!==(a.seq||0)&&html`<button className="btn ghost" onClick=${()=>{A.calAdd(a.id);setShown(a.id)}}>${a.cal==null?'Add to calendar':'Update calendar'}</button>`}</div></div>`};
 return html`<div className=${embedded?'my-schedule':'wrap m'}>${!embedded&&html`<h2>Hi, ${EMPS[me].name.split(' ')[0]}</h2><p className="mute">${EMPS[me].role} · ${evOf(CUR.id).name}</p>`}
 ${notes.map(n=>html`<div className="card note" key=${n.id} role="status"><b>${n.x}</b>${n.from&&html`<p className="mute">${n.from}</p>`}
  <button className="btn" onClick=${()=>n.aid?A.ack(n.aid):A.dismiss(n.id)}>${n.aid?'Acknowledge':'Got it'}</button></div>`)}
 ${mine.filter(a=>a.pc).map(a=>html`<div className="card note" key=${'c'+a.id} role="status"><b>${a.cal==null?'Add to your calendar?':'Update your calendar?'}</b><p className="mute">${SM[a.s].t}, ${SM[a.s].r}, ${span(SM[a.s])} (${DAYS[SM[a.s].d]}). Reminder 30 minutes before.</p><div className="acts"><button className="btn" onClick=${()=>{A.calAdd(a.id);setShown(a.id)}}>${a.cal==null?'Add to calendar':'Update calendar'}</button><button className="btn ghost" onClick=${()=>A.calSkip(a.id)}>Not now</button></div></div>`)}
 ${sa&&html`<div className="card"><b>Calendar event ready</b><p className="mute">${SM[sa.s].t}, ${SM[sa.s].r}, ${span(SM[sa.s])}. Reminder 30 minutes before.</p><p className="mute">In the real app this opens your phone's calendar (Apple, Google, or Outlook). This preview can't open a phone calendar, so the file it would send is shown below.</p><details><summary>Calendar file (for developers)</summary><pre style=${{whiteSpace:'pre-wrap',fontSize:'.8rem'}}>${ics(sa)}</pre></details><button className="btn ghost" onClick=${()=>setShown(null)}>Close</button></div>`}
 ${!embedded&&html`<div className="card"><b>Venue floorplan</b>${EMPS[me].map?(FP.some(f=>f.ev===CUR.id)?html`<div className="acts">${FP.filter(f=>f.ev===CUR.id).map(f=>html`<button key=${f.id} className="btn ghost" onClick=${()=>setFv(f.id)}>${f.name}</button>`)}</div>`:html`<p className="mute">No floorplan has been added for this event yet.</p>`):html`<p className="mute">Your administrator has not turned on access for you.</p>`}</div>`}
 ${!embedded&&!!EMPS[me].map&&FP.find(f=>f.id===fv&&f.ev===CUR.id)&&html`<${PdfView} f=${FP.find(f=>f.id===fv)} onClose=${()=>setFv(null)}/>`}
 <h2>Next assignment</h2>${next?html`<${Card} a=${next} cls="next"/>`:html`<p className="mute">Nothing coming up. Your admin will notify you of new assignments.</p>`}
 <h2>${full?'Full schedule':'My schedule'}</h2>
 ${canFull&&html`<div className="seg" role="group" aria-label="Schedule view" style=${{marginBottom:8}}><button aria-pressed=${!full} onClick=${()=>setView('mine')}>My schedule</button><button aria-pressed=${full} onClick=${()=>setView('full')}>Full schedule</button></div>`}
 <div className="seg" role="group" aria-label="Schedule days" style=${{marginBottom:12}}><button aria-pressed=${all} onClick=${()=>setAll(true)}>All days</button>${DAYS_SHORT.map((x,i)=>html`<button key=${i} aria-pressed=${!all&&d===i} onClick=${()=>{setAll(false);setD(i)}}>${x}</button>`)}</div>
 <${MyExport} S=${S} me=${me} day=${all?null:d}/>
 ${(all?DAYS.map((_,i)=>i):[d]).map(i=>html`<div key=${i}>${all&&html`<h3 className="day-heading">${DAYS[i]}</h3>`}
  ${full?html`${dayActs(i).map(s=>html`<${FullCard} key=${s.id} s=${s}/>`)}${!dayActs(i).length&&html`<p className="mute">No activities on ${DAYS[i]}.</p>`}`
   :html`${mine.filter(a=>SM[a.s].d===i).map(a=>html`<${Card} key=${a.id} a=${a}/>`)}${!mine.some(a=>SM[a.s].d===i)&&html`<p className="mute">No assignments on ${DAYS[i]}.</p>`}`}</div>`)}</div>`}
function AdminSession({s,S,A,coordinator=false}){
 const [pick,setPick]=useState('');
 const as=S.asg.filter(x=>x.s===s.id), free=EMPS.filter(e=>!e.gone&&!as.some(x=>x.e===e.id)), same=SESS.filter(o=>o.ev===s.ev&&o.d===s.d&&o.id!==s.id);
 return html`<div className="session-panel"><${Head} s=${s} asg=${S.asg}/>
 <ul className="rows">${as.map(a=>{const c=clash(S.asg,a),[k,l]=st(a);return html`<li key=${a.id} className="lead-actions"><${IconButton} name="delete" label=${'Remove '+EMPS[a.e].name} onClick=${()=>A.remove(a.id)}/><div>
  <div><b>${nm(a.e)}</b> <${Pill} k=${k}>${l}<//> ${c.length>0&&html`<${Pill} k="bad">Overlaps ${c.map(o=>o.t).join(', ')}<//>`}</div>
  <div className="acts"><select aria-label=${'Move '+EMPS[a.e].name} value="" onChange=${ev=>ev.target.value&&A.move(a.id,+ev.target.value)}>
   <option value="">Move to…</option>${same.map(o=>html`<option key=${o.id} value=${o.id}>${o.r}, ${span(o)}, ${o.t}</option>`)}</select>
  ${coordinator&&html`<button className="btn ghost" disabled=${!!a.in||!!a.conf} onClick=${()=>A.confirm(a.id)}>Confirm present</button>`}</div></div></li>`})}</ul>
 ${!as.length&&html`<p className="mute">No one assigned yet.</p>`}
 <div className="acts"><select aria-label=${'Employee to assign to '+s.t} value=${pick} onChange=${e=>setPick(e.target.value)}><option value="">Choose employee…</option>
  ${free.map(e=>html`<option key=${e.id} value=${e.id}>${nm(e.id)}</option>`)}</select>
  <button className="btn" disabled=${pick===''} onClick=${async()=>{const ok=await A.assign(+pick,s.id);if(ok!==false)setPick('')}}>Assign</button></div></div>`}
const desc=s=>'Was '+s.t+', '+s.r+', '+span(s)+' ('+dayDate(evOf(s.ev).start,s.d)+')';
const bump=(s,sid,from)=>{const ids=s.asg.filter(a=>a.s===sid).map(a=>a.id);
 return {...s,asg:s.asg.map(a=>ids.includes(a.id)?{...a,ack:0,in:0,conf:0,tag:'changed',seq:(a.seq||0)+1,pc:0}:a),
 notes:[...s.notes.filter(n=>!ids.includes(n.aid)),...s.asg.filter(a=>ids.includes(a.id)).map(a=>({id:++uid,e:a.e,aid:a.id,done:0,x:ntext(a,'Changed assignment'),from}))]}};
const col=(e,al)=>`hsl(${(e*137.508)%360} 65% ${e%2?40:52}% / ${al})`;
const esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function schedDoc(S){
 const rows=SESS.filter(s=>s.ev===CUR.id).sort((x,y)=>ROOMS.indexOf(x.r)-ROOMS.indexOf(y.r)||x.d-y.d||x.a-y.a);
 const body=rows.map(s=>{const c=cover(s,S.asg);
  return `<tr class="p"><th>${esc(s.t)}<br><small>${esc(s.r)} · ${span(s)}</small></th>${DAYS.map((_,d)=>`<td>${d===s.d?`<b>${c.l}</b> · ${c.as.length} of ${s.n} staffed`:''}</td>`).join('')}</tr>`
  +c.as.map(a=>`<tr><th class="k"><i style="background:${col(a.e,1)}"></i>${esc(nm(a.e))}</th>${DAYS.map((_,d)=>`<td>${d===s.d?`<div class="c" style="background:${col(a.e,.22)};border-color:${col(a.e,1)}">${esc(st(a)[1])}${clash(S.asg,a).length?' · Overlap':''}</div>`:''}</td>`).join('')}</tr>`).join('')}).join('');
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(evOf(CUR.id).name)} staff schedule</title><style>@page{size:letter landscape;margin:.4in}body{font:11px/1.35 system-ui,sans-serif;color:#000;margin:12px}table{border-collapse:collapse;width:100%}th,td{border-top:1px solid #999;padding:3px 6px;text-align:left;vertical-align:top;font-weight:400}tr.p th,tr.p td{background:#e8eeed}tr.p th{font-weight:700}th.k{padding-left:20px;font-weight:600}i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:6px;vertical-align:-1px}.c{border-left:5px solid;border-radius:4px;padding:2px 5px;font-size:10px}thead th{font-weight:700;background:#d9e2e0}tr{break-inside:avoid}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}button{font:inherit;padding:8px 14px;margin:0 0 8px}@media print{body{margin:0}button{display:none}}</style></head><body><button onclick="window.print()">Print (Letter, landscape)</button><h2>${esc(evOf(CUR.id).name)} staff schedule</h2><table><thead><tr><th>Activity and staff</th>${DAYS.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></body></html>`}
function Grid({S}){
 const [shut,setShut]=useState({}),[msg,setMsg]=useState('');
 const save=async()=>{try{const d=window.claude&&await window.claude.use('downloads');if(!d){setMsg('Saving is not available here.');return}await d.save({filename:'impact27-schedule.html',data:schedDoc(S)});setMsg('Saved. Open the file and click Print.')}catch(e){setMsg(e&&e.code==='declined'?'Download canceled.':'Could not save the file.')}};
 const rows=SESS.filter(s=>s.ev===CUR.id).sort((x,y)=>ROOMS.indexOf(x.r)-ROOMS.indexOf(y.r)||x.d-y.d||x.a-y.a);
 const used=[...new Set(S.asg.filter(a=>SM[a.s].ev===CUR.id).map(a=>a.e))].sort((x,y)=>x-y);
 return html`<div><div className="acts noprint"><button className="btn" onClick=${save}>Download printable schedule</button></div>
 <p className="mute noprint">The download is a Letter, landscape, color file with every activity expanded. Open it and click Print. ${msg}</p>
 <h2 className="onlyprint">${evOf(CUR.id).name} staff schedule</h2><div className="gridwrap"><table className="sg"><thead><tr><th scope="col">Activity and staff</th>${DAYS.map(x=>html`<th scope="col" key=${x}>${x}</th>`)}</tr></thead>
 <tbody>${rows.map(s=>{const c=cover(s,S.asg),open=!shut[s.id];return html`<${React.Fragment} key=${s.id}>
  <tr className="par"><th scope="row"><button className="tgl" aria-expanded=${open} onClick=${()=>setShut(q=>({...q,[s.id]:open}))}>${open?'▾':'▸'} <b>${s.t}</b></button><div className="mute">${s.r} · ${span(s)}</div></th>
   ${DAYS.map((_,d)=>html`<td key=${d}>${d===s.d&&html`<${Pill} k=${c.k}>${c.l}<//> <span className="mute">${c.as.length} of ${s.n} staffed</span>`}</td>`)}</tr>
  ${open&&c.as.map(a=>{const l=st(a)[1],cl=clash(S.asg,a);return html`<tr key=${a.id}><th scope="row" className="kid"><i className="sw" style=${{background:col(a.e,1)}}></i>${nm(a.e)}</th>
   ${DAYS.map((_,d)=>html`<td key=${d}>${d===s.d&&html`<div className="chip" style=${{background:col(a.e,.22),borderLeftColor:col(a.e,1)}}>${l}${cl.length>0&&' · Overlap'}</div>`}</td>`)}</tr>`})}
 <//>`})}</tbody></table></div>
 ${!rows.length&&html`<p className="mute">No activities yet for this event.</p>`}
 <h3 style=${{marginTop:16}}>Staff colors</h3><div className="legend">${used.map(e=>html`<span key=${e}><i className="sw" style=${{background:col(e,1)}}></i>${EMPS[e].name}</span>`)}</div></div>`}
const Admin=createAdminWorkspace({people:EMPS,events:EVS,rooms:ROOMS,activities:SESS,current:CUR,days:DAYS,daysShort:DAYS_SHORT,cover,clash,span,evEnd,evStatus,connected:CONNECTED},{AdminSession,Grid,Floorplans,Incoming,Staff});
function App({connected}){
 const [demoS,setS]=useState(()=>connected?connected.snapshot:seed()),[demoRole,setRole]=useState('admin'),[demoMe,setMe]=useState(0),[toast,setToast]=useState('');
 const S=connected?connected.snapshot:demoS,role=connected?connected.snapshot.role:demoRole,me=connected?connected.snapshot.me:demoMe;
 const say=m=>{setToast(m);setTimeout(()=>setToast(''),3200)};
 const Lg=(s,x)=>({...s,log:[{t:new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'}),x},...s.log]});
 const L=(s,x)=>{const t=H[H.length-1];if(t&&!t.label)t.label=x;return Lg(s,x)};
 const snap=()=>{H.push({s:S,emps:EMPS.map(e=>({...e})),rooms:[...ROOMS],sess:SESS.map(o=>({...o})),evs:EVS.map(e=>({...e})),cur:CUR.id,fp:FP.map(f=>({...f})),inv:INV.map(i=>({...i}))});if(H.length>30)H.shift()};
 const evv=o=>{const m=!o.n?'Enter an event name':!o.b?'Choose a start date':!(o.d>=1&&o.d<=14)?'Days must be 1 to 14':'';if(m)say(m);return !m};
 const invv=o=>{const L=o.lines,m=!o.vendor?'Enter a vendor name':!o.date?'Choose a date':!L.length?'Add at least one line item':L.some(l=>!l.d)?'Every line item needs a description':L.some(l=>!(l.q>0))?'Quantity must be more than 0':L.some(l=>l.c<0||l.w<0)?'Cost and weight cannot be negative':L.some(l=>l.sb&&!sbn(l.sb))?'Schedule B code needs 10 digits':'';if(m)say(m);return !m};
 const nrm=o=>({...o,amt:o.amt==null?ltot(o.lines):o.amt,lines:o.lines.map(l=>({...l,sb:sbn(l.sb)}))});
 const A={
  assign:(e,sid)=>{const c=clash(S.asg,{id:0,e,s:sid});if(c.length)say('Overlap: '+EMPS[e].name+' is already in '+c[0].t+' at '+span(c[0]));else say(EMPS[e].name.split(' ')[0]+' notified of new assignment');
   setS(s=>{const a={id:++uid,e,s:sid,ack:0,in:0,conf:0,tag:'new'};return L({...s,asg:[...s.asg,a],notes:[...s.notes,{id:++uid,e,aid:a.id,done:0,x:ntext(a,'New assignment')}]},'Assigned '+EMPS[e].name+' to '+SM[sid].r+' ('+SM[sid].t+', '+span(SM[sid])+')')})},
  move:(id,sid)=>{say('Change published. Employee notified.');setS(s=>{const o=s.asg.find(a=>a.id===id),old=SM[o.s],n={...o,s:sid,ack:0,in:0,conf:0,tag:'changed',seq:(o.seq||0)+1,pc:0};
   return L({...s,asg:s.asg.map(a=>a.id===id?n:a),notes:[...s.notes.filter(x=>x.aid!==id),{id:++uid,e:o.e,aid:id,done:0,x:ntext(n,'Changed assignment'),from:'Was '+old.t+', '+old.r+', '+span(old)}]},'Moved '+EMPS[o.e].name+' from '+old.r+' to '+SM[sid].r+' ('+SM[sid].t+')')})},
  remove:id=>{setS(s=>{const o=s.asg.find(a=>a.id===id);return L({...s,asg:s.asg.filter(a=>a.id!==id),notes:[...s.notes.filter(x=>x.aid!==id),{id:++uid,e:o.e,aid:null,done:0,x:'Removed from '+SM[o.s].t+', '+SM[o.s].r+' ('+DAYS[SM[o.s].d]+')'+(o.cal!=null?'. Delete it from your calendar.':'')}]},'Removed '+EMPS[o.e].name+' from '+SM[o.s].r+' ('+SM[o.s].t+')')});say('Assignment removed. Employee notified.')},
  ack:id=>setS(s=>{const o=s.asg.find(a=>a.id===id);return L({...s,asg:s.asg.map(a=>a.id===id?{...a,ack:1,pc:1}:a),notes:s.notes.map(n=>n.aid===id?{...n,done:1}:n)},EMPS[o.e].name+' acknowledged '+SM[o.s].t+' in '+SM[o.s].r)}),
  dismiss:id=>setS(s=>({...s,notes:s.notes.map(n=>n.id===id?{...n,done:1}:n)})),
  checkIn:id=>{setS(s=>{const o=s.asg.find(a=>a.id===id);return L({...s,asg:s.asg.map(a=>a.id===id?{...a,in:1}:a)},EMPS[o.e].name+' checked in to '+SM[o.s].r)});say('Checked in')},
  confirm:id=>{setS(s=>{const o=s.asg.find(a=>a.id===id);return L({...s,asg:s.asg.map(a=>a.id===id?{...a,conf:1}:a)},'Coordinator confirmed '+EMPS[o.e].name+' present in '+SM[o.s].r)});say('Attendance confirmed')},
  addStaff:o=>{if(!o.n){say('Enter a name');return false}EMPS.push({id:EMPS.length,name:o.n,email:o.email,role:o.r,acct:o.acct,phone:o.phone,map:o.map?1:0});setS(s=>L({...s},'Added '+o.acct+' '+o.n+' ('+o.r+')'));say(o.n+' added');return true},
  addRoom:n=>{if(!n||ROOMS.includes(n)){say(n?'That room already exists':'Enter a room name');return false}ROOMS.push(n);setS(s=>L({...s},'Added room '+n));say(n+' added');return true},
  addSession:(t,r,d,a,b,n)=>{if(!t){say('Enter an activity name');return false}if(!(b>a)){say('End time must be after start time');return false}if(!(n>=1)){say('Staff needed must be at least 1');return false}const o={id:Math.max(0,...SESS.map(x=>x.id))+1,ev:CUR.id,d:+d,t,r,a,b,n};SESS.push(o);SM[o.id]=o;setS(s=>L({...s},'Created activity '+t+' in '+r+', '+DAYS[o.d]+', '+span(o)));say(t+' created');return true},
  editStaff:(id,o)=>{if(!o.n){say('Enter a name');return false}Object.assign(EMPS[id],{name:o.n,email:o.email,role:o.r,acct:o.acct,phone:o.phone,map:o.map?1:0});setS(s=>L({...s},'Updated '+o.n+' ('+o.r+', '+o.acct+', map access '+(o.map?'on':'off')+')'));say('Saved');return true},
  delStaff:id=>{const n=EMPS[id].name;EMPS[id].gone=1;if(me===id)setMe(EMPS.find(e=>!e.gone).id);setS(s=>L({...s,asg:s.asg.filter(a=>a.e!==id),notes:s.notes.filter(x=>x.e!==id)},'Deleted staff member '+n+' and cancelled their assignments'));say(n+' deleted');return true},
  editRoom:(o,n)=>{if(!n||(n!==o&&ROOMS.includes(n))){say(n?'That room already exists':'Enter a room name');return false}const ss=SESS.filter(s=>s.r===o).map(s=>[s.id,desc(s)]);ROOMS[ROOMS.indexOf(o)]=n;ss.forEach(([id])=>{SM[id].r=n});setS(s=>L(ss.reduce((x,[id,f])=>bump(x,id,f),s),'Renamed room '+o+' to '+n));say('Saved');return true},
  delRoom:r=>{if(SESS.some(s=>s.r===r)){say('Move or delete its activities first');return false}ROOMS.splice(ROOMS.indexOf(r),1);setS(s=>L({...s},'Deleted room '+r));say(r+' deleted');return true},
  editSession:(id,t,r,d,a,b,n)=>{if(!t){say('Enter an activity name');return false}if(!(b>a)){say('End time must be after start time');return false}if(!(n>=1)){say('Staff needed must be at least 1');return false}const o=SM[id],f=desc(o),ch=o.t!==t||o.r!==r||o.d!==+d||o.a!==a||o.b!==b;Object.assign(o,{t,r,d:+d,a,b,n});setS(s=>L(ch?bump(s,id,f):s,'Updated activity '+t+' in '+r+', '+DAYS[o.d]+', '+span(o)));say(ch?'Saved. Assigned staff notified.':'Saved');return true},
  delSession:id=>{const o=SM[id],txt=ntext({s:id},'Cancelled');setS(s=>{const g=s.asg.filter(a=>a.s===id);return L({...s,asg:s.asg.filter(a=>a.s!==id),notes:[...s.notes.filter(n=>!g.some(a=>a.id===n.aid)),...g.map(a=>({id:++uid,e:a.e,aid:null,done:0,x:txt+(a.cal!=null?'. Delete it from your calendar.':'')}))]},'Deleted activity '+o.t+' ('+g.length+' staff notified)')});SESS.splice(SESS.indexOf(o),1);delete SM[id];say(o.t+' deleted');return true},
  addEvent:o=>{if(!evv(o))return false;const id=Math.max(0,...EVS.map(e=>e.id))+1;EVS.push({id,name:o.n,start:o.b,days:Math.floor(o.d)});CUR.id=id;syncEv();setS(s=>L({...s},'Created event '+o.n));say(o.n+' created and opened');return true},
  editEvent:(id,o)=>{if(!evv(o))return false;const n=Math.floor(o.d),bad=SESS.find(s=>s.ev===id&&s.d>=n);if(bad){say('Move or delete activities on '+dayDate(evOf(id).start,bad.d)+' first');return false}Object.assign(evOf(id),{name:o.n,start:o.b,days:n});if(id===CUR.id)syncEv();setS(s=>L({...s},'Updated event '+o.n));say('Saved');return true},
  delEvent:id=>{if(EVS.length<2){say('At least one event must remain');return false}const e=evOf(id),ids=SESS.filter(s=>s.ev===id).map(s=>s.id);setS(s=>{const g=s.asg.filter(a=>ids.includes(a.s));return L({...s,asg:s.asg.filter(a=>!ids.includes(a.s)),notes:[...s.notes.filter(n=>!g.some(a=>a.id===n.aid)),...[...new Set(g.map(a=>a.e))].map(x=>({id:++uid,e:x,aid:null,done:0,x:'Event removed: '+e.name}))]},'Deleted event '+e.name+' with '+ids.length+' activities')});for(let i=SESS.length-1;i>=0;i--)if(ids.includes(SESS[i].id)){delete SM[SESS[i].id];SESS.splice(i,1)}for(let i=FP.length-1;i>=0;i--)if(FP[i].ev===id)FP.splice(i,1);for(let i=INV.length-1;i>=0;i--)if(INV[i].ev===id)INV.splice(i,1);EVS.splice(EVS.indexOf(e),1);if(CUR.id===id){CUR.id=EVS[0].id;syncEv()}say(e.name+' deleted');return true},
  addFloorplan:(f,ev)=>{if(String.fromCharCode(...f.data.slice(0,4))!=='%PDF'){say(f.name+' is not a PDF file');return false}if(f.data.length>26214400){say(f.name+' is over 25 MB');return false}FP.push({id:Math.max(0,...FP.map(x=>x.id))+1,ev,name:/\.pdf$/i.test(f.name)?f.name:f.name+'.pdf',size:f.data.length,data:f.data});setS(s=>L({...s},'Added floorplan '+f.name+' to '+evOf(ev).name));say(f.name+' added to '+evOf(ev).name);return true},
  moveFloorplan:(id,ev)=>{const f=FP.find(x=>x.id===id);f.ev=ev;setS(s=>L({...s},'Moved floorplan '+f.name+' to '+evOf(ev).name));say('Moved to '+evOf(ev).name);return true},
  delFloorplan:id=>{const i=FP.findIndex(x=>x.id===id),f=FP[i];FP.splice(i,1);setS(s=>L({...s},'Removed floorplan '+f.name));say(f.name+' removed. Undo brings it back.');return true},
  addInv:o=>{if(!invv(o))return false;o=nrm(o);INV.push({...o,id:Math.max(0,...INV.map(x=>x.id))+1,ev:CUR.id});setS(s=>L({...s},'Recorded '+o.type+' from '+o.vendor+(o.inv?' (invoice '+o.inv+')':'')));say('Entry saved');return true},
  editInv:(id,o)=>{if(!invv(o))return false;o=nrm(o);const i=INV.findIndex(x=>x.id===id);INV[i]={...INV[i],...o};setS(s=>L({...s},'Updated incoming entry from '+o.vendor+(o.inv?' (invoice '+o.inv+')':'')));say('Entry saved');return true},
  delInv:id=>{const i=INV.findIndex(x=>x.id===id),e=INV[i];INV.splice(i,1);setS(s=>L({...s},'Deleted incoming entry from '+e.vendor));say('Entry deleted. Undo brings it back.');return true},
  switchEv:id=>{CUR.id=id;syncEv();setS(s=>({...s}))},
  calAdd:id=>{setS(s=>{const o=s.asg.find(a=>a.id===id);return L({...s,asg:s.asg.map(a=>a.id===id?{...a,cal:a.seq||0,pc:0}:a)},EMPS[o.e].name+' added '+SM[o.s].t+' to their calendar with a 30-minute reminder')})},
  calSkip:id=>setS(s=>({...s,asg:s.asg.map(a=>a.id===id?{...a,pc:0}:a)})),
  setStart:v=>{if(!v)return false;EVD.d=v;setS(s=>L({...s},'Set event start date to '+v));say('Start date saved');return true},
  setDays:n=>{n=Math.floor(+n);if(!(n>=1&&n<=14)){say('Enter 1 to 14 days');return false}if(n===DAYS.length){say('Already '+n+' days');return false}const bad=SESS.find(s=>s.d>=n);if(bad){say('Move or delete activities on '+DAYS[bad.d]+' first');return false}const was=DAYS.length;fillDays(EVD.d,n);setS(s=>L({...s},'Changed event length from '+was+' to '+n+' days'));say('Event is now '+n+' days');return true}};
 Object.keys(A).forEach(k=>{if(['dismiss','calAdd','calSkip','switchEv'].includes(k))return;const f=A[k];A[k]=(...a)=>{snap();const r=f(...a);if(r===false)H.pop();return r}});
 A.undo=()=>{const h=H.pop();if(!h)return;EMPS.length=0;EMPS.push(...h.emps);ROOMS.length=0;ROOMS.push(...h.rooms);SESS.length=0;SESS.push(...h.sess);Object.keys(SM).forEach(k=>delete SM[k]);SESS.forEach(o=>{SM[o.id]=o});EVS.length=0;EVS.push(...h.evs);CUR.id=h.cur;FP.length=0;FP.push(...h.fp);INV.length=0;INV.push(...h.inv);syncEv();setS(Lg(h.s,'Undid: '+h.label));say('Undid: '+h.label)};
 if(connected)Object.keys(A).forEach(k=>{
  if(k==='switchEv')return;
  A[k]=async(...args)=>{
   const options=args.at(-1);
   const expectedRevision=k.startsWith('edit')&&options&&typeof options==='object'&&Object.hasOwn(options,'expectedRevision')?args.pop().expectedRevision:undefined;
   if(k==='addSession')args.push(CUR.id);
   return connected.command(k,args,expectedRevision);
  };
 });
 const ul=H.length?(H[H.length-1].label||'last change'):'';
 const R=[['admin','Admin'],['staff','Staff'],['contractor','Contractor']];
 return html`<div><${AppHeader} events=${EVS} current=${CUR.id} onEventChange=${A.switchEv} email=${connected?.email} role=${role} busy=${connected?.busy} error=${connected?.error} onRefresh=${connected?.refresh} onSignOut=${connected?.signOut}>
  ${!connected&&html`<${IconButton} name="undo" label=${H.length?'Undo: '+ul:'Nothing to undo'} disabled=${!H.length} onClick=${A.undo}/>
  <div className="seg" role="group" aria-label="Demo role">${R.map(([k,l])=>html`<button key=${k} aria-pressed=${role===k} onClick=${()=>{setRole(k);const f=EMPS.find(e=>!e.gone&&e.acct===k);if(f)setMe(f.id)}}>${l}</button>`)}</div><${IconButton} name="reset" label="Reset demo" onClick=${()=>{H.length=0;setS(seed());say('Demo reset')}}/>`}
 <//>
 ${connected?.error&&html`<p className="app-error connection-error" role="alert">${connected.error}</p>`}
 ${!connected&&role!=='admin'&&html`<div className="wrap m" style=${{paddingBottom:0}}><label>Viewing as <select value=${me} onChange=${e=>setMe(+e.target.value)}>${EMPS.filter(e=>!e.gone&&e.acct===role).map(e=>html`<option key=${e.id} value=${e.id}>${nm(e.id)}</option>`)}</select></label></div>`}
 <fieldset className="workspace" disabled=${!!connected?.busy}>${role!=='admin'&&html`<${Staff} S=${S} A=${A} me=${me} canFull=${role==='staff'}/>`}${role==='admin'&&html`<${Admin} S=${S} A=${A} me=${me!=null&&EMPS[me]&&!EMPS[me].gone&&EMPS[me].acct==='admin'?me:null} error=${connected?.error} testLogins=${connected?.testLogins}/>`}</fieldset>
 ${toast&&html`<div className="toast" role="status">${toast}</div>`}</div>`}
function hydrate(data){
 EMPS.length=0;data.people.forEach(e=>{EMPS[e.id]=e});
 EVS.splice(0,EVS.length,...data.events);ROOMS.splice(0,ROOMS.length,...data.rooms);
 SESS.splice(0,SESS.length,...data.activities);Object.keys(SM).forEach(k=>delete SM[k]);SESS.forEach(s=>{SM[s.id]=s});
 FP.length=0;INV.length=0;H.length=0;
 if(EVS.length){if(!evOf(CUR.id))CUR.id=EVS[0].id;syncEv()}
}
const Root=CONNECTED?createConnection(React,html,window.eventOpsRepository,App,hydrate):App;
ReactDOM.createRoot(document.getElementById('root')).render(html`<${Root}/>`);
