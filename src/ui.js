import React from 'react';
import htm from 'htm';
import { useBrand, iconSrc } from './branding.js';
import { CalendarDays, Radio, Users, Settings2, Activity, RefreshCw, LogOut, ChevronDown, ChevronRight, Plus, X, Pencil, Trash2, Search, List, LayoutGrid, CircleAlert, Check, UserRound, Map, Package, Undo2, RotateCcw, Eye, EyeOff, KeyRound, Copy, Download, Printer, Upload, Clock, Receipt, Bell, BellRing, FileText, SlidersHorizontal, Plane, PlaneLanding, PlaneTakeoff, Bus, Bold, Italic, Underline, Highlighter, ListOrdered, Link, RemoveFormatting, Mic } from 'lucide-react';

const html=htm.bind(React.createElement);
const icons={calendar:CalendarDays,coverage:Radio,people:Users,settings:Settings2,activity:Activity,refresh:RefreshCw,logout:LogOut,down:ChevronDown,right:ChevronRight,plus:Plus,close:X,edit:Pencil,delete:Trash2,search:Search,list:List,grid:LayoutGrid,warning:CircleAlert,check:Check,user:UserRound,map:Map,package:Package,undo:Undo2,reset:RotateCcw,eye:Eye,'eye-off':EyeOff,key:KeyRound,copy:Copy,download:Download,print:Printer,upload:Upload,clock:Clock,receipt:Receipt,bell:Bell,'bell-ring':BellRing,file:FileText,sliders:SlidersHorizontal,plane:Plane,'plane-landing':PlaneLanding,'plane-takeoff':PlaneTakeoff,bus:Bus,bold:Bold,italic:Italic,underline:Underline,highlighter:Highlighter,'list-ordered':ListOrdered,link:Link,eraser:RemoveFormatting,mic:Mic};
export function Icon({name,size=16}){const Component=icons[name]||CircleAlert;return html`<${Component} size=${size} strokeWidth=${1.75} aria-hidden="true"/>`;}
export function IconButton({name,label,onClick,disabled=false,className=''}){
 return html`<button type="button" className=${'btn icon-button '+className} aria-label=${label} title=${label} onClick=${onClick} disabled=${disabled}><${Icon} name=${name}/></button>`;
}
// Change password from the account menu (signed in). changePassword(current, next) throws with a message on failure.
function ChangePasswordDialog({email,changePassword,onClose}){
 const [cur,setCur]=React.useState(''),[next,setNext]=React.useState(''),[again,setAgain]=React.useState(''),[show,setShow]=React.useState(false),[busy,setBusy]=React.useState(false),[err,setErr]=React.useState(''),[done,setDone]=React.useState(false);
 const submit=async e=>{e.preventDefault();setErr('');
  if(next.length<12){setErr('Use at least 12 characters for your new password.');return}
  if(next!==again){setErr('The new passwords do not match.');return}
  if(next===cur){setErr('Choose a password different from your current one.');return}
  setBusy(true);
  try{await changePassword(cur,next);setDone(true);setCur('');setNext('');setAgain('')}
  catch(x){setErr(x&&x.code==='wrong_password'?'Your current password is not correct.':/weak|pwned|characters|length/i.test(x&&x.message||'')?(x.message||'Choose a stronger password.'):(x&&x.message)||'Could not change your password. Try again.')}
  finally{setBusy(false)}};
 const type=show?'text':'password';
 return html`<${Modal} title="Change password" onClose=${busy?()=>{}:onClose}>${done?html`<div className="change-password"><p role="status">Your password has been changed. Use it the next time you sign in, on every device.</p><div className="dialog-actions"><button type="button" className="btn" onClick=${onClose}>Done</button></div></div>`
  :html`<form className="change-password" onSubmit=${submit}>
   <input type="email" name="username" autoComplete="username" value=${email} readOnly hidden/>
   <div className="editor-fields">
    <label>Current password<input type=${type} autoComplete="current-password" required value=${cur} disabled=${busy} onChange=${e=>setCur(e.target.value)}/></label>
    <label>New password<input type=${type} autoComplete="new-password" required minLength="12" value=${next} disabled=${busy} onChange=${e=>setNext(e.target.value)}/><span className="mute field-hint">At least 12 characters.</span></label>
    <label>Confirm new password<input type=${type} autoComplete="new-password" required minLength="12" value=${again} disabled=${busy} onChange=${e=>setAgain(e.target.value)}/></label>
    <label className="chk"><input type="checkbox" checked=${show} onChange=${e=>setShow(e.target.checked)}/>Show passwords</label>
   </div>
   ${err&&html`<p className="connection-error editor-error" role="alert">${err}</p>`}
   <div className="dialog-actions"><button type="button" className="btn ghost" disabled=${busy} onClick=${onClose}>Cancel</button><button type="submit" className="btn" disabled=${busy}>${busy?'Saving…':'Change password'}</button></div>
  </form>`}<//>`;
}
// App name and tagline from App settings; the mark shows the uploaded icon, or the name's first letter.
export function BrandMark({b}){const custom=!!(b.icon||b.iconData);return html`<span className=${'brand-mark'+(custom?' has-icon':'')}>${custom?html`<img src=${iconSrc(b,192)} alt=""/>`:(b.name||'E').trim().charAt(0).toUpperCase()}</span>`;}
export function BrandTitle({tag='h1'}){const b=useBrand(React);return html`<${BrandMark} b=${b}/><div className="brand-text">${React.createElement(tag,null,b.name)}${b.tagline&&html`<span className="app-tagline">${b.tagline}</span>`}</div>`;}
export function AppHeader({events=[],current,onEventChange,email='',role='admin',busy=false,error='',onRefresh,onSignOut,onChangePassword,children}){
 const selected=events.find(e=>e.id===current),[pw,setPw]=React.useState(false),menu=React.useRef(null);
 return html`<header className="app-header"><div className="app-brand"><${BrandTitle}/></div>
 ${events.length>0&&html`<div className="event-picker"><select aria-label="Event" value=${current} disabled=${busy} onChange=${e=>onEventChange(Number(e.target.value))}>${events.map(e=>html`<option key=${e.id} value=${e.id}>${e.name}</option>`)}</select><span className="event-date">${selected?.start}</span></div>`}
 <div className="header-tools">${children}${email&&html`<span className="save-status" role="status">${busy?'Saving...':error?'Sync needs attention':'All changes saved'}</span>`}
 ${onRefresh&&html`<${IconButton} name="refresh" label="Refresh" onClick=${onRefresh} disabled=${busy}/>`}
 ${email&&html`<details className="account-menu" ref=${menu}><summary aria-label="Account menu" title="Account"><${Icon} name="user"/><${Icon} name="down" size=${12}/></summary><div className="account-popover"><b>${email}</b><span className="mute">${role.charAt(0).toUpperCase()+role.slice(1)}</span>${onChangePassword&&html`<button type="button" className="btn ghost" onClick=${()=>{if(menu.current)menu.current.open=false;setPw(true)}} disabled=${busy}><${Icon} name="key"/>Change password</button>`}<button type="button" className="btn ghost" onClick=${onSignOut} disabled=${busy}><${Icon} name="logout"/>Sign out</button></div></details>`}</div>${pw&&html`<${ChangePasswordDialog} email=${email} changePassword=${onChangePassword} onClose=${()=>setPw(false)}/>`}</header>`;
}
export function Modal({title,onClose,children}){
 const ref=React.useRef(null),id=React.useId();
 React.useEffect(()=>{const dialog=ref.current;dialog.showModal();dialog.querySelector('input,select')?.focus();return()=>dialog.close();},[]);
 return html`<dialog ref=${ref} className="editor-dialog" aria-labelledby=${id} onCancel=${e=>{e.preventDefault();onClose();}} onClick=${e=>{if(e.target===ref.current){const r=ref.current.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose();}}}>
 <div className="dialog-heading"><h2 id=${id}>${title}</h2><${IconButton} name="close" label="Close dialog" onClick=${onClose}/></div>${children}</dialog>`;
}
