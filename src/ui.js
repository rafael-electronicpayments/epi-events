import React from 'react';
import htm from 'htm';
import { CalendarDays, Radio, Users, Settings2, Activity, RefreshCw, LogOut, ChevronDown, ChevronRight, Plus, X, Pencil, Trash2, Search, List, LayoutGrid, CircleAlert, Check, UserRound, Map, Package, Undo2, RotateCcw, Eye, EyeOff, KeyRound, Copy, Download, Printer, Upload, Clock, Receipt, Bell, BellRing, FileText } from 'lucide-react';

const html=htm.bind(React.createElement);
const icons={calendar:CalendarDays,coverage:Radio,people:Users,settings:Settings2,activity:Activity,refresh:RefreshCw,logout:LogOut,down:ChevronDown,right:ChevronRight,plus:Plus,close:X,edit:Pencil,delete:Trash2,search:Search,list:List,grid:LayoutGrid,warning:CircleAlert,check:Check,user:UserRound,map:Map,package:Package,undo:Undo2,reset:RotateCcw,eye:Eye,'eye-off':EyeOff,key:KeyRound,copy:Copy,download:Download,print:Printer,upload:Upload,clock:Clock,receipt:Receipt,bell:Bell,'bell-ring':BellRing,file:FileText};
export function Icon({name,size=16}){const Component=icons[name]||CircleAlert;return html`<${Component} size=${size} strokeWidth=${1.75} aria-hidden="true"/>`;}
export function IconButton({name,label,onClick,disabled=false,className=''}){
 return html`<button type="button" className=${'btn icon-button '+className} aria-label=${label} title=${label} onClick=${onClick} disabled=${disabled}><${Icon} name=${name}/></button>`;
}
export function AppHeader({events=[],current,onEventChange,email='',role='admin',busy=false,error='',onRefresh,onSignOut,children}){
 const selected=events.find(e=>e.id===current);
 return html`<header className="app-header"><div className="app-brand"><span className="brand-mark">I</span><h1>Impact Event Ops</h1></div>
 ${events.length>0&&html`<div className="event-picker"><select aria-label="Event" value=${current} disabled=${busy} onChange=${e=>onEventChange(Number(e.target.value))}>${events.map(e=>html`<option key=${e.id} value=${e.id}>${e.name}</option>`)}</select><span className="event-date">${selected?.start}</span></div>`}
 <div className="header-tools">${children}${email&&html`<span className="save-status" role="status">${busy?'Saving...':error?'Sync needs attention':'All changes saved'}</span>`}
 ${onRefresh&&html`<${IconButton} name="refresh" label="Refresh" onClick=${onRefresh} disabled=${busy}/>`}
 ${email&&html`<details className="account-menu"><summary aria-label="Account menu" title="Account"><${Icon} name="user"/><${Icon} name="down" size=${12}/></summary><div className="account-popover"><b>${email}</b><span className="mute">${role.charAt(0).toUpperCase()+role.slice(1)}</span><button type="button" className="btn ghost" onClick=${onSignOut} disabled=${busy}><${Icon} name="logout"/>Sign out</button></div></details>`}</div></header>`;
}
export function Modal({title,onClose,children}){
 const ref=React.useRef(null),id=React.useId();
 React.useEffect(()=>{const dialog=ref.current;dialog.showModal();dialog.querySelector('input,select')?.focus();return()=>dialog.close();},[]);
 return html`<dialog ref=${ref} className="editor-dialog" aria-labelledby=${id} onCancel=${e=>{e.preventDefault();onClose();}} onClick=${e=>{if(e.target===ref.current){const r=ref.current.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose();}}}>
 <div className="dialog-heading"><h2 id=${id}>${title}</h2><${IconButton} name="close" label="Close dialog" onClick=${onClose}/></div>${children}</dialog>`;
}
