// Itineraries: each person's flight and hotel for an event, the airport transfer each way, the traveler's My travel
// card, "Add to expenses" (with a required receipt), and the report. Times are wall-clock times in the event's
// time zone. Server rules decide who may edit and lock costs once a linked expense is approved.
import { RECEIPT_MAX, receiptType, shrinkPhoto, sizeText } from './expenses.js';
import { VIEWS, openReport, downloadReportXlsx } from './itinerary-report.js';
import { readSpreadsheet, planRooming, rowEffect, matchPerson } from './rooming-import.js';
import { planFlights, flightEffect } from './flight-import.js';

export const CARRIERS = ['American Airlines', 'Delta Air Lines', 'United Airlines', 'Southwest Airlines', 'Alaska Airlines', 'JetBlue Airways',
  'Spirit Airlines', 'Frontier Airlines', 'Hawaiian Airlines', 'Allegiant Air', 'Sun Country Airlines', 'Breeze Airways', 'Avelo Airlines',
  'Air Canada', 'WestJet', 'Porter Airlines', 'Copa Airlines', 'Aeromexico', 'British Airways', 'Lufthansa', 'Iberia', 'Air France', 'KLM', 'Virgin Atlantic', 'TAP Air Portugal'];
export const TRAVEL_PAYS = [['personal_card', 'Personal card'], ['corporate_amex', 'Company Amex'], ['points', 'Points'], ['event', 'Event / master bill']];
export const TRANSFERS = [['car', 'Car service'], ['shuttle', 'Group shuttle'], ['own', 'Own arrangement']];
const label = (list, k) => (list.find(([v]) => v === k) || [k, k])[1];
export const payText = k => label(TRAVEL_PAYS, k), transferText = k => label(TRANSFERS, k);
// What the traveler is told for each way.
export const transferHelp = (k, way) => k === 'car' ? (way === 'in' ? 'A car service will meet you at the airport and take you to the hotel.' : 'A car service will take you from the hotel to the airport.')
  : k === 'shuttle' ? (way === 'in' ? 'Take the event\'s group shuttle from the airport to the hotel.' : 'Take the event\'s group shuttle from the hotel to the airport.')
  : 'Arrange your own ride (cab, Uber, or the hotel\'s shuttle if offered). Submit any fare as a Transportation expense with the receipt.';

// US airports (the 50 states, DC, Puerto Rico, USVI, Guam), for telling domestic from international departures.
// A code not on this list counts as international (the safer, earlier pickup); the tick on the flight can correct it.
const US_AIRPORTS = new Set(('ATL LAX ORD DFW DEN JFK SFO SEA LAS MCO EWR CLT PHX IAH MIA BOS MSP FLL DTW PHL LGA BWI SLC SAN IAD DCA MDW TPA BNA AUS HNL DAL '
  + 'PDX STL HOU RDU MSY SJC SMF SNA MCI OAK SAT RSW CLE IND PIT CMH CVG JAX OGG BDL MKE ONT BUR PBI ABQ OMA ANC BOI RNO TUS CHS SDF OKC RIC ELP '
  + 'BUF ORF GRR MEM BHM PVD SAV TUL DSM ALB GSP PSP KOA SFB LGB MYR ROC SYR LIT CAK ICT LIH GEG MHT PWM SRQ COS PIE TYS PNS CID MSN XNA DAY HSV '
  + 'BZN JAN LEX GSO FAT SBA ECP VPS ITO CHA AVL MDT ILM HPN ISP MAF LBB AMA SGF FAR FSD GPT MOB SHV BTR LFT CRP BRO HRL MFE SBN FWA TOL EVV '
  + 'PIA BMI CMI DBQ MLI RST FNT LAN AZO TVC MKG MBS ELM ITH BGM SWF ACY ABE AVP BTV BGR PVC ACK MVY ORH TTN EYW MLB DAB GNV TLH JAX SAV AGS CAE '
  + 'FAY OAJ EWN PGV ROA CHO LYH SHD CRW HTS CKB BKW LNS SCE ERI JST AOO IPT DUJ MGW BLI PSC YKM ALW EAT PUW SUN IDA PIH TWF LWS MSO GTF HLN BIL '
  + 'FCA JAC CPR CYS COD GJT ASE EGE HDN DRO MTJ GUC ALS PUB RAP GFK BIS MOT MHK GCK SLN JLN SPI LAW SJT ABI ACT TYR GGG CLL BPT AEX MLU LCH '
  + 'TXK FSM HOT JBR GTR CBM TUP MEI PIB HBG DHN ABY VLD BQK SSI CSG MCN PGD PIB FLG YUM PRC GCN SAF ROW HOB SVC FMN CDC SGU OGD PVU EKO ELY '
  + 'MRY SBP SMX STS ACV RDD CEC MOD MCE VIS BFL IYK TVL MMH SCK JNU FAI KTN SIT BET OME OTZ ADQ CDV DLG AKN BRW SCC YAK WRG PSG LNY MKK HNM '
  + 'JHM SJU BQN PSE MAZ VQS CPX STT STX GUM SPN').split(' '));
export const isIntl = (from, to) => [from, to].some(c => c && c.length === 3 && !US_AIRPORTS.has(c));
// Default pickup for the hotel-to-airport car or shuttle: 3 hours before the flight (4 if international),
// rounded down to the hour. Same rule as the server. "2026-11-12T16:10" -> "2026-11-12T13:00".
export function pickupDefault(f) {
  if (!f || !f.outDepart) return '';
  const [d, t] = f.outDepart.split('T'), [y, m, day] = d.split('-').map(Number), [hh] = (t || '00:00').split(':').map(Number);
  const at = new Date(Date.UTC(y, m - 1, day, hh - (f.intl ? 4 : 3)));
  return at.toISOString().slice(0, 13) + ':00';
}
// The rides that get a pickup time and the 30-minute reminder.
export const hasPickup = k => k === 'car' || k === 'shuttle';
export const rideText = k => k === 'car' ? 'car service' : 'shuttle';

const money = n => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const cents = v => Math.round(Number(String(v || '0').replace(/[$,]/g, '')) * 100) || 0;
// "2026-11-06T14:35" in the event's zone -> "Fri, Nov 6, 2:35 PM AST".
export function whenText(local, tz) {
  if (!local) return '';
  const [d, t] = local.split('T'), [y, m, day] = d.split('-').map(Number), [hh, mm] = (t || '00:00').split(':').map(Number);
  const wall = new Date(Date.UTC(y, m - 1, day, hh, mm));
  const text = wall.toLocaleString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  let zone = '';
  try { zone = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/New_York', timeZoneName: 'short' }).formatToParts(wall).find(p => p.type === 'timeZoneName')?.value || ''; } catch { zone = ''; }
  return text + (zone ? ' ' + zone : '');
}
export const dayText = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
export const nights = (a, b) => a && b ? Math.max(0, Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000)) : 0;
const leg = (carrier, num, from, to) => [carrier, num].filter(Boolean).join(' ') + (from || to ? ' · ' + (from || '?') + ' → ' + (to || '?') : '');

export function createItineraries({ React, html, Modal, Icon, people, events, activities, current, demo = false }) {
  const { useState } = React;
  const field = (text, input, hint) => html`<label>${text}${input}${hint && html`<span className="mute field-hint">${hint}</span>`}</label>`;
  const evOf = id => events.find(e => e.id === id) || {};
  const active = () => people.filter(p => p && !p.gone).sort((a, b) => a.name.localeCompare(b.name));
  const nameOf = e => people[e]?.name || 'Unknown person';
  const pickOn = S => !!S.travelInfo || demo; // database with the pickup-time migration
  const compOn = S => !!S.companions || demo; // database with the accompanying-person migration
  const flightImportOn = S => !!S.flightImport || demo; // database with the flight import migration
  const isCopy = h => !!h && h.primary === false; // the shared copy of someone else's reservation
  // "Thu, Nov 12, 1:00 PM AST", or why there's none yet.
  const pickupLine = (h, tz) => h.pickup ? whenText(h.pickup, tz) : 'set once the departing flight is entered';
  const booker = b => b.byEvent ? 'Event' : b.by != null ? nameOf(b.by) : '';
  const CarrierField = ({ text, value, onChange }) => {
    const known = !value || CARRIERS.includes(value), [other, setOther] = useState(!known);
    return html`<label>${text}<select value=${other ? '__other' : value} onChange=${e => { if (e.target.value === '__other') { setOther(true); onChange(''); } else { setOther(false); onChange(e.target.value); } }}>
      <option value="">Choose carrier</option>${CARRIERS.map(c => html`<option key=${c} value=${c}>${c}</option>`)}<option value="__other">Other…</option></select>
      ${other && html`<input aria-label=${text + ' name'} maxLength="60" placeholder="Carrier name" value=${value} onChange=${e => onChange(e.target.value)}/>`}</label>`;
  };
  const BookedBy = ({ d, set, allowEvent }) => html`<label>Booked by<select value=${d.byEvent ? 'event' : String(d.by ?? '')} onChange=${e => set(e.target.value === 'event' ? { byEvent: true, by: null } : { byEvent: false, by: e.target.value === '' ? null : Number(e.target.value) })}>
    ${allowEvent && html`<option value="event">Event (group booking)</option>`}${active().map(p => html`<option key=${p.id} value=${p.id}>${p.name}</option>`)}</select></label>`;
  const Paid = ({ d, set }) => field('How paid', html`<select value=${d.paid} onChange=${e => set({ paid: e.target.value })}>${TRAVEL_PAYS.map(([k, t]) => html`<option key=${k} value=${k}>${t}</option>`)}</select>`);
  const Footer = ({ busy, err, onClose, onDelete, saveText }) => html`${err && html`<p className="connection-error editor-error" role="alert">${err}</p>`}
    <div className="dialog-actions">${onDelete && html`<button type="button" className="btn danger push-left" disabled=${busy} onClick=${onDelete}>Delete booking</button>`}<button type="button" className="btn ghost" disabled=${busy} onClick=${onClose}>Cancel</button><button type="submit" className="btn" disabled=${busy}>${busy ? 'Saving…' : saveText}</button></div>`;

  // "Add to expenses" for a booking: eligibility, reimburse, required receipt, and the linked expenses' status.
  const expenseOk = (kind, d) => kind === 'flight' ? (!['points', 'event'].includes(d.paid) && cents(d.cost) > 0) || cents(d.bags) > 0 : !['points', 'event'].includes(d.paid) && cents(d.total) > 0;
  function ExpenseBox({ kind, d, set, linked, locked, file, setFile, on }) {
    if (!on) return null; // database without the Add to expenses migration
    const ok = expenseOk(kind, d), has = linked.length > 0, [shrinking, setShrinking] = useState(false), [msg, setMsg] = useState('');
    const pick = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; const t = receiptType(f); setMsg('');
      if (!t) { setMsg('Receipts must be a photo (JPG, PNG, HEIC, WebP) or a PDF.'); return; }
      let use = f, type = t;
      if (f.size > RECEIPT_MAX) { if (t === 'application/pdf') { setMsg('This PDF is ' + sizeText(f.size) + '. Receipts must be 7 MB or smaller.'); return; }
        setShrinking(true); use = await shrinkPhoto(f).catch(() => null); setShrinking(false); type = 'image/jpeg';
        if (!use) { setMsg('This photo is ' + sizeText(f.size) + ' and could not be made smaller on this device. Receipts must be 7 MB or smaller.'); return; } }
      setFile({ data: new Uint8Array(await use.arrayBuffer()), type, name: use.name || f.name, size: use.size }); };
    const status = has ? linked.map(x => (x.cat === 'baggage' ? 'Bag fee ' : x.cat === 'hotel' ? 'Hotel ' : 'Airfare ') + money(x.amt) + (x.ok ? ' · approved' : ' · pending approval')).join('; ') : '';
    if (!ok && !d.addExpense && !has) return html`<p className="mute travel-expense-note">${['points', 'event'].includes(d.paid) ? (kind === 'flight' ? 'Paid with ' + payText(d.paid).toLowerCase() + ': nothing to add to expenses unless there is a bag fee.' : 'Paid with ' + payText(d.paid).toLowerCase() + ': nothing to add to expenses.') : 'Enter the cost to add it to expenses.'}</p>`;
    return html`<fieldset className="travel-leg travel-expense"><legend>Expenses</legend>
      ${locked ? html`<p className="mute">${status}. The costs are locked because the expense was approved; ask an administrator to change them.</p>` : html`
      <label className="chk"><input type="checkbox" checked=${d.addExpense} disabled=${!ok && !d.addExpense} onChange=${e => set({ addExpense: e.target.checked })}/>Add to expenses</label>
      ${d.addExpense && html`<label className="chk"><input type="checkbox" checked=${d.reimb} onChange=${e => set({ reimb: e.target.checked, reimbTouched: true })}/>Reimburse me</label>
        <div className="receipt-field"><b>Receipt <span className="required-tag">${has ? 'Attached' : 'Required'}</span></b>
          ${shrinking ? html`<p className="mute" role="status">Making the photo smaller…</p>` : file ? html`<p>${file.name} <span className="mute">(${sizeText(file.size)}, ready to upload)</span> <button type="button" className="btn ghost" onClick=${() => setFile(null)}>Remove</button></p>` : has ? html`<p className="mute">The receipt already on file is kept unless you choose a new one.</p>` : html`<p className="receipt-missing">Attach a photo or PDF of the receipt to add this to expenses.</p>`}
          <label className="btn ghost file-pick"><${Icon} name="upload"/>${file || has ? 'Replace receipt' : 'Attach photo or PDF'}<input type="file" accept="image/*,application/pdf,.heic,.heif" onChange=${pick}/></label>
          ${msg && html`<p className="connection-error" role="alert">${msg}</p>`}</div>
        <p className="mute field-hint">${kind === 'flight' ? 'Creates an Airfare expense for the flight' + (cents(d.bags) > 0 ? ' and a Baggage expense for the bag fee' : '') : 'Creates a Hotel expense for the folio total'}, in the traveler's expenses, with this receipt.</p>`}
      ${status && html`<p className="mute">In expenses: ${status}</p>`}`}
    </fieldset>`;
  }
  const linkedOf = (S, b, kind) => !b ? [] : (S.expenses || []).filter(x => kind === 'flight' ? x.id === b.exp || x.id === b.bagExp : x.id === b.exp);

  function FlightEditor({ ev, who, booking, me, admin, A, S, onClose }) {
    const b = booking || {};
    const [d, setD] = useState({ inCarrier: b.inCarrier || '', inFlight: b.inFlight || '', inFrom: b.inFrom || '', inTo: b.inTo || '', inArrive: b.inArrive || '',
      outCarrier: b.outCarrier || '', outFlight: b.outFlight || '', outFrom: b.outFrom || '', outTo: b.outTo || '', outDepart: b.outDepart || '',
      byEvent: !!b.byEvent, by: b.by ?? (me ?? who), paid: b.paid || 'personal_card', ref: b.ref || '', cost: b.cost != null ? Number(b.cost).toFixed(2) : '', bags: b.bags != null && Number(b.bags) ? Number(b.bags).toFixed(2) : '',
      addExpense: !!b.addExp, reimb: b.reimb ?? (b.paid || 'personal_card') === 'personal_card', reimbTouched: !!booking,
      intl: booking ? !!b.intl : false, intlTouched: !!booking && !!b.intl !== isIntl(b.outFrom, b.outTo) });
    const [file, setFile] = useState(null), linked = linkedOf(S, booking, 'flight'), locked = !admin && linked.some(x => x.ok);
    const [outTouched, setOutTouched] = useState(!!booking), [busy, setBusy] = useState(false), [err, setErr] = useState(''), [confirm, setConfirm] = useState(false);
    // International follows the departing airports until the tick is changed by hand.
    const auto = n => { if (!n.intlTouched) n.intl = isIntl(n.outFrom, n.outTo); return n; };
    const set = patch => setD(v => { const n = { ...v, ...patch }; if ('paid' in patch && !n.reimbTouched) n.reimb = n.paid === 'personal_card'; return auto(n); });
    // The departing carrier follows the arriving one until it's changed; airports default to the reverse trip.
    const setIn = patch => setD(v => { const n = { ...v, ...patch }; if (!outTouched) { n.outCarrier = n.inCarrier; n.outFrom = n.inTo; n.outTo = n.inFrom; } return auto(n); });
    const code = k => e => (k.startsWith('in') ? setIn : set)({ [k]: e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) });
    const total = (cents(d.cost) + cents(d.bags)) / 100, e0 = evOf(ev);
    const submit = async e => { e.preventDefault(); setErr('');
      if (!d.inFlight.trim() && !d.outFlight.trim() && !d.inArrive && !d.outDepart) { setErr('Enter the arriving or departing flight.'); return; }
      if (d.inArrive && d.outDepart && d.outDepart <= d.inArrive) { setErr('The departing flight must be after the arrival.'); return; }
      for (const [k, t] of [['cost', 'Flight cost'], ['bags', 'Bag fee']]) if (d[k] && !/^\$?\d{1,6}(\.\d{1,2})?$/.test(d[k].trim().replace(/,/g, ''))) { setErr(t + ' must be an amount up to two decimals.'); return; }
      const clean = { ...d, cost: d.cost.trim().replace(/[$,]/g, ''), bags: d.bags.trim().replace(/[$,]/g, '') }; delete clean.reimbTouched; delete clean.intlTouched;
      if (d.addExpense && !expenseOk('flight', d)) clean.addExpense = false;
      if (clean.addExpense && !file && !linked.length) { setErr('Attach a photo or PDF of the receipt to add this to expenses.'); return; }
      setBusy(true); const r = await A.saveFlight(ev, who, clean, file); setBusy(false);
      if (r !== false) onClose(); else setErr('Could not save. Check the values and try again.'); };
    const del = async () => { if (!confirm) { setConfirm(true); return; } setBusy(true); const r = await A.delFlight(b.id); setBusy(false); if (r !== false) onClose(); };
    return html`<${Modal} title=${(booking ? 'Edit flight' : 'Add flight') + (admin && who !== me ? ' for ' + nameOf(who) : '')} onClose=${busy ? () => {} : onClose}><form className="travel-editor" onSubmit=${submit}>
      <p className="mute">${e0.name}. Times are local to the event (${e0.tz || 'America/New_York'}).</p>
      <fieldset className="travel-leg"><legend>Arriving</legend><div className="editor-fields">
        <${CarrierField} text="Carrier" value=${d.inCarrier} onChange=${v => setIn({ inCarrier: v })}/>
        ${field('Flight #', html`<input maxLength="60" value=${d.inFlight} placeholder="B6 1234" onChange=${e => set({ inFlight: e.target.value })}/>`)}
        ${field('From (airport)', html`<input maxLength="3" value=${d.inFrom} placeholder="BOS" onChange=${code('inFrom')}/>`)}
        ${field('To (airport)', html`<input maxLength="3" value=${d.inTo} placeholder="SJU" onChange=${code('inTo')}/>`)}
        ${field('Arrival date and time', html`<input type="datetime-local" value=${d.inArrive} onChange=${e => set({ inArrive: e.target.value })}/>`)}
      </div></fieldset>
      <fieldset className="travel-leg"><legend>Departing</legend><div className="editor-fields">
        <${CarrierField} text="Carrier" value=${d.outCarrier} onChange=${v => { setOutTouched(true); set({ outCarrier: v }); }}/>
        ${field('Flight #', html`<input maxLength="60" value=${d.outFlight} placeholder="B6 1235" onChange=${e => set({ outFlight: e.target.value })}/>`)}
        ${field('From (airport)', html`<input maxLength="3" value=${d.outFrom} placeholder="SJU" onChange=${e => { setOutTouched(true); code('outFrom')(e); }}/>`)}
        ${field('To (airport)', html`<input maxLength="3" value=${d.outTo} placeholder="BOS" onChange=${e => { setOutTouched(true); code('outTo')(e); }}/>`)}
        ${field('Departure date and time', html`<input type="datetime-local" value=${d.outDepart} onChange=${e => set({ outDepart: e.target.value })}/>`)}
        ${pickOn(S) && html`<label className="chk wide-field"><input type="checkbox" checked=${d.intl} onChange=${e => set({ intl: e.target.checked, intlTouched: true })}/>International flight<span className="mute field-hint">${d.intlTouched ? 'Set by hand.' : 'Set from the airports.'} A hotel car or shuttle picks up ${d.intl ? '4' : '3'} hours before the flight.</span></label>`}
      </div></fieldset>
      <fieldset className="travel-leg"><legend>Purchase</legend><div className="editor-fields">
        <${BookedBy} d=${d} set=${set} allowEvent=${admin}/>
        <${Paid} d=${d} set=${set}/>
        ${field('Receipt #', html`<input maxLength="100" value=${d.ref} onChange=${e => set({ ref: e.target.value })}/>`)}
        ${field('Flight cost (USD)', html`<input inputMode="decimal" value=${d.cost} placeholder="0.00" disabled=${locked} onChange=${e => set({ cost: e.target.value })}/>`)}
        ${field('Bag fee (USD)', html`<input inputMode="decimal" value=${d.bags} placeholder="0.00" disabled=${locked} onChange=${e => set({ bags: e.target.value })}/>`)}
        <div className="travel-total"><span className="mute">Total cost</span><b>${money(total)}</b></div>
      </div></fieldset>
      <${ExpenseBox} kind="flight" d=${d} set=${set} linked=${linked} locked=${locked} file=${file} setFile=${f => { setErr(''); setFile(f); }} on=${!!S.travelExpenses || demo}/>
      <${Footer} busy=${busy} err=${err} onClose=${onClose} onDelete=${booking && del} saveText=${booking ? 'Save flight' : 'Add flight'}/>
      ${confirm && html`<p className="mute" role="status">Tap Delete booking again to remove this flight.</p>`}
    </form><//>`;
  }

  function HotelEditor({ ev, who, booking, me, admin, A, S, onClose }) {
    const b = booking || {}, e0 = evOf(ev);
    const [d, setD] = useState({ name: b.name || e0.venue || '', conf: b.conf || '', in: b.in || '', out: b.out || '', byEvent: booking ? !!b.byEvent : admin,
      by: b.by ?? (admin ? null : me), paid: b.paid || (admin ? 'event' : 'personal_card'), ref: b.ref || '',
      nightly: b.nightly != null && Number(b.nightly) ? Number(b.nightly).toFixed(2) : '', charges: b.charges != null && Number(b.charges) ? Number(b.charges).toFixed(2) : '',
      total: b.total != null && Number(b.total) ? Number(b.total).toFixed(2) : '', tIn: b.tIn || 'own', tOut: b.tOut || 'own', tNotes: b.tNotes || '',
      addExpense: !!b.addExp, reimb: b.reimb ?? (b.paid || (admin ? 'event' : 'personal_card')) === 'personal_card', reimbTouched: !!booking,
      pickupManual: !!b.pickupManual, pickup: b.pickupManual ? b.pickup || '' : '',
      companion: b.companion || '', link: b.companionId != null });
    const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [confirm, setConfirm] = useState(false);
    const fl = (S.flights || []).find(x => x.ev === ev && x.e === who), auto = pickupDefault(fl);
    const [file, setFile] = useState(null), linked = linkedOf(S, booking, 'hotel'), locked = !admin && linked.some(x => x.ok);
    const set = patch => setD(v => { const x = { ...v, ...patch }; if ('paid' in patch && !x.reimbTouched) x.reimb = x.paid === 'personal_card'; return x; }), n = nights(d.in, d.out);
    const estimate = (cents(d.nightly) * n + cents(d.charges)) / 100;
    // Accompanying person: a People name (exact match) can be linked so they share this reservation.
    const copy = isCopy(booking), cm = d.companion.trim() ? matchPerson(d.companion, people) : null;
    const match = cm && cm.how === 'exact' && cm.person.id !== who ? cm.person : null;
    const submit = async e => { e.preventDefault(); setErr('');
      if (!d.in || !d.out) { setErr('Enter the hotel arrival and departure dates.'); return; }
      if (d.out <= d.in) { setErr('The hotel departure date must be after the arrival date.'); return; }
      for (const [k, t] of [['nightly', 'Nightly cost'], ['charges', 'Room charges'], ['total', 'Total cost']]) if (d[k] && !/^\$?\d{1,7}(\.\d{1,2})?$/.test(d[k].trim().replace(/,/g, ''))) { setErr(t + ' must be an amount up to two decimals.'); return; }
      const clean = k => d[k].trim().replace(/[$,]/g, ''), o = { ...d, nightly: clean('nightly'), charges: clean('charges'), total: clean('total') }; delete o.reimbTouched;
      if (admin && pickOn(S)) { o.pickupManual = hasPickup(d.tOut) && d.pickupManual; if (!o.pickupManual) o.pickup = '';
        else if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d.pickup)) { setErr('Enter the pickup date and time.'); return; } }
      else { delete o.pickupManual; delete o.pickup; }
      delete o.link;
      if (compOn(S) && !copy) { o.companion = d.companion.trim(); if (admin) o.companionId = d.link && match ? match.id : null; } else delete o.companion;
      if (d.addExpense && !expenseOk('hotel', d)) o.addExpense = false;
      if (o.addExpense && !file && !linked.length) { setErr('Attach a photo or PDF of the receipt to add this to expenses.'); return; }
      setBusy(true); const r = await A.saveHotel(ev, who, o, file); setBusy(false);
      if (r !== false) onClose(); else setErr('Could not save. Check the values and try again.'); };
    const del = async () => { if (!confirm) { setConfirm(true); return; } setBusy(true); const r = await A.delHotel(b.id); setBusy(false); if (r !== false) onClose(); };
    return html`<${Modal} title=${(booking ? 'Edit hotel' : 'Add hotel') + (admin && who !== me ? ' for ' + nameOf(who) : '')} onClose=${busy ? () => {} : onClose}><form className="travel-editor" onSubmit=${submit}>
      <p className="mute">${e0.name}</p>
      <fieldset className="travel-leg"><legend>Stay</legend><div className="editor-fields">
        <label className="wide-field">Hotel name<input maxLength="200" value=${d.name} placeholder=${e0.venue || 'Hotel name'} onChange=${e => set({ name: e.target.value })}/>${e0.venue && d.name !== e0.venue && html`<span className="mute field-hint">Event venue: ${e0.venue}. <button type="button" className="link-button" onClick=${() => set({ name: e0.venue })}>Use it</button></span>`}</label>
        ${field('Confirmation #', html`<input maxLength="60" value=${d.conf} onChange=${e => set({ conf: e.target.value })}/>`)}
        <div className="travel-total"><span className="mute">Total nights</span><b>${n || '–'}</b></div>
        ${field('Arrival date', html`<input type="date" required value=${d.in} onChange=${e => set({ in: e.target.value })}/>`)}
        ${field('Departure date', html`<input type="date" required value=${d.out} min=${d.in || undefined} onChange=${e => set({ out: e.target.value })}/>`)}
        ${compOn(S) && (copy ? html`<p className="wide-field shared-note">Shared room with <b>${b.companion || nameOf(b.companionId)}</b>. Hotel, confirmation #, and dates change on both bookings. Costs and expenses are on ${b.companion || nameOf(b.companionId)}'s booking.</p>`
          : html`<label className="wide-field">Accompanying person<input list="itin-people" maxLength="120" value=${d.companion} placeholder="Optional" onChange=${e => set({ companion: e.target.value, link: d.link || !b.companionId })}/>
            ${admin && match ? html`<span className="chk companion-link"><input type="checkbox" checked=${d.link} onChange=${e => set({ link: e.target.checked })}/>Share this reservation with ${match.name} (they get the same booking)</span>`
              : html`<span className="mute field-hint">${!d.companion.trim() ? 'A spouse or partner staying in the same room.' : admin ? 'Not in People: the name is kept on this booking only.' : 'If they\'re on the roster, an administrator can share the booking with them.'}</span>`}
            <datalist id="itin-people">${active().filter(p => p.id !== who).map(p => html`<option key=${p.id} value=${p.name}/>`)}</datalist></label>`)}
      </div></fieldset>
      <fieldset className="travel-leg"><legend>Purchase</legend><div className="editor-fields">
        <${BookedBy} d=${d} set=${set} allowEvent=${admin}/>
        <${Paid} d=${d} set=${set}/>
        ${field('Receipt #', html`<input maxLength="100" value=${d.ref} onChange=${e => set({ ref: e.target.value })}/>`)}
        ${!copy && field('Nightly cost (USD)', html`<input inputMode="decimal" value=${d.nightly} placeholder="0.00" onChange=${e => set({ nightly: e.target.value })}/>`)}
        ${!copy && field('Room charges (USD)', html`<input inputMode="decimal" value=${d.charges} placeholder="0.00" onChange=${e => set({ charges: e.target.value })}/>`)}
        ${!copy && field('Total cost (USD)', html`<input inputMode="decimal" value=${d.total} placeholder="0.00" disabled=${locked} onChange=${e => set({ total: e.target.value })}/>`, 'From the hotel folio: the whole stay, including taxes and fees.' + (estimate ? ' Nightly × nights + room charges = ' + money(estimate) + '.' : ''))}
      </div></fieldset>
      ${!copy && html`<${ExpenseBox} kind="hotel" d=${d} set=${set} linked=${linked} locked=${locked} file=${file} setFile=${f => { setErr(''); setFile(f); }} on=${!!S.travelExpenses || demo}/>`}
      ${admin ? html`<fieldset className="travel-leg"><legend>Airport transfer</legend><div className="editor-fields">
        ${field('Airport to hotel', html`<select value=${d.tIn} onChange=${e => set({ tIn: e.target.value })}>${TRANSFERS.map(([k, t]) => html`<option key=${k} value=${k}>${t}</option>`)}</select>`)}
        ${field('Hotel to airport', html`<select value=${d.tOut} onChange=${e => set({ tOut: e.target.value })}>${TRANSFERS.map(([k, t]) => html`<option key=${k} value=${k}>${t}</option>`)}</select>`)}
        ${pickOn(S) && hasPickup(d.tOut) && html`<div className="wide-field pickup-field"><b>Pickup time at the hotel</b>
          ${d.pickupManual ? html`<input type="datetime-local" aria-label="Pickup date and time" value=${d.pickup} onChange=${e => set({ pickup: e.target.value })}/>
            <span className="mute field-hint">Set by hand; it stays even if the flight changes.${auto ? ' Default: ' + whenText(auto, e0.tz) + '.' : ''} <button type="button" className="link-button" onClick=${() => set({ pickupManual: false })}>Use the default</button></span>`
          : html`<p className="pickup-time">${auto ? whenText(auto, e0.tz) : 'Set automatically once the departing flight is entered.'}</p>
            <span className="mute field-hint">${auto ? (fl.intl ? '4' : '3') + ' hours before ' + (fl.outFlight || 'the departing flight') + (fl.intl ? ' (international)' : '') + ', rounded down to the hour; it moves if the flight changes. ' : ''}<button type="button" className="link-button" onClick=${() => set({ pickupManual: true, pickup: auto || (d.out ? d.out + 'T09:00' : '') })}>Set a different time</button></span>`}
          <span className="mute field-hint">The traveler gets a reminder 30 minutes before pickup.</span></div>`}
        <label className="wide-field">Transfer details<input maxLength="300" value=${d.tNotes} placeholder="Company, meeting point, phone" onChange=${e => set({ tNotes: e.target.value })}/><span className="mute field-hint">Shown to the traveler. Own arrangement tells them to submit any fare as a Transportation expense.</span></label>
      </div></fieldset>` : html`<p className="mute">Your administrator sets how you'll get between the airport and the hotel.</p>`}
      <${Footer} busy=${busy} err=${err} onClose=${onClose} onDelete=${booking && del} saveText=${booking ? 'Save hotel' : 'Add hotel'}/>
      ${confirm && html`<p className="mute" role="status">Tap Delete booking again to remove this hotel.</p>`}
    </form><//>`;
  }

  // Short summaries, used on the admin page and the traveler's card.
  const FlightSummary = ({ f, tz }) => html`<div className="travel-sum">
    ${(f.inFlight || f.inArrive) && html`<p><b>Arrive</b> ${leg(f.inCarrier, f.inFlight, f.inFrom, f.inTo)}${f.inArrive && html`<span className="cell-secondary">${whenText(f.inArrive, tz)}</span>`}</p>`}
    ${(f.outFlight || f.outDepart) && html`<p><b>Depart</b> ${leg(f.outCarrier, f.outFlight, f.outFrom, f.outTo)}${f.outDepart && html`<span className="cell-secondary">${whenText(f.outDepart, tz)}</span>`}</p>`}</div>`;
  const HotelSummary = ({ h }) => html`<div className="travel-sum"><p><b>${h.name || 'Hotel'}</b>${h.conf && html` · Confirmation ${h.conf}`}<span className="cell-secondary">${dayText(h.in)} – ${dayText(h.out)} · ${nights(h.in, h.out)} night${nights(h.in, h.out) === 1 ? '' : 's'}</span>${h.companion && html`<span className="cell-secondary">${isCopy(h) ? 'Shared room with ' : 'Accompanying: '}${h.companion}${!isCopy(h) && h.companionId != null ? ' (shared room)' : ''}</span>`}</p></div>`;
  const Details = ({ b, kind }) => html`<dl className="travel-details">
    <div><dt>Booked by</dt><dd>${booker(b) || '–'}</dd></div><div><dt>How paid</dt><dd>${payText(b.paid)}</dd></div>${b.ref && html`<div><dt>Receipt #</dt><dd>${b.ref}</dd></div>`}
    ${kind === 'flight' ? html`<div><dt>Flight</dt><dd>${money(b.cost)}</dd></div><div><dt>Bag fee</dt><dd>${money(b.bags)}</dd></div><div><dt>Total</dt><dd><b>${money(Number(b.cost) + Number(b.bags))}</b></dd></div>`
      : isCopy(b) ? html`<div><dt>Costs</dt><dd>On ${b.companion || 'the other guest'}'s booking</dd></div>`
      : html`<div><dt>Nightly</dt><dd>${money(b.nightly)}</dd></div><div><dt>Room charges</dt><dd>${money(b.charges)}</dd></div><div><dt>Total (folio)</dt><dd><b>${money(b.total)}</b></dd></div>`}</dl>`;

  const slug = t => String(t || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event';
  // Admin report: one person, selected people, or everyone shown; any view; with or without costs; PDF or Excel.
  function ReportDialog({ S, shown, onClose }) {
    const ev = current.id, e0 = evOf(ev);
    const [who, setWho] = useState('shown'), [one, setOne] = useState(shown[0]?.id ?? ''), [ids, setIds] = useState(new Set()), [q, setQ] = useState('');
    const [view, setView] = useState('combined'), [costs, setCosts] = useState(false), [msg, setMsg] = useState('');
    const pool = active();
    const list = who === 'one' ? pool.filter(p => p.id === Number(one)) : who === 'selected' ? pool.filter(p => ids.has(p.id)) : shown;
    const toggle = id => setIds(v => { const n = new Set(v); n.has(id) ? n.delete(id) : n.add(id); return n; });
    const opts = { view, list, flights: (S.flights || []).filter(x => x.ev === ev), hotels: (S.hotels || []).filter(x => x.ev === ev), tz: e0.tz, costs, booker,
      title: e0.name + ': ' + label(VIEWS, view).toLowerCase(), scope: who === 'one' ? 'One person' : who === 'selected' ? 'Selected people' : 'Everyone shown', sheet: label(VIEWS, view) };
    return html`<${Modal} title="Itineraries report" onClose=${onClose}><div className="staff-export">
      <fieldset className="choice-list"><legend>Who</legend>
        <label className="chk"><input type="radio" name="itin-who" checked=${who === 'shown'} onChange=${() => setWho('shown')}/>Everyone shown on the page · ${shown.length}</label>
        <label className="chk"><input type="radio" name="itin-who" checked=${who === 'one'} onChange=${() => setWho('one')}/>One person</label>
        ${who === 'one' && html`<select aria-label="Person" value=${one} onChange=${e => setOne(e.target.value)}>${pool.map(p => html`<option key=${p.id} value=${p.id}>${p.name}</option>`)}</select>`}
        <label className="chk"><input type="radio" name="itin-who" checked=${who === 'selected'} onChange=${() => setWho('selected')}/>Selected people · ${ids.size}</label>
      </fieldset>
      ${who === 'selected' && html`<fieldset className="break-people"><legend>People <span className="mute">${ids.size} selected</span></legend>
        <div className="break-people-tools"><input type="search" aria-label="Filter people" placeholder="Filter people" value=${q} onChange=${e => setQ(e.target.value)}/>
          <button type="button" className="btn ghost" onClick=${() => setIds(new Set(shown.map(p => p.id)))}>Select everyone shown</button>${ids.size > 0 && html`<button type="button" className="btn ghost" onClick=${() => setIds(new Set())}>Clear</button>`}</div>
        <div className="break-people-list">${pool.filter(p => p.name.toLowerCase().includes(q.toLowerCase())).map(p => html`<label key=${p.id} className="chk"><input type="checkbox" checked=${ids.has(p.id)} onChange=${() => toggle(p.id)}/>${p.name}<span className="mute">${p.role || ''}</span></label>`)}</div></fieldset>`}
      <div className="editor-fields">${field('View', html`<select value=${view} onChange=${e => setView(e.target.value)}>${VIEWS.map(([k, t]) => html`<option key=${k} value=${k}>${t}</option>`)}</select>`, view === 'departures' ? 'Grouped by day and hotel pickup time, so people riding together are listed together, with each flight and transfer.' : view === 'arrivals' ? 'Grouped by day and time, with each person\'s airport transfer, for planning cars and shuttles.' : '')}
        <label className="chk"><input type="checkbox" checked=${costs} disabled=${view === 'arrivals' || view === 'departures'} onChange=${e => setCosts(e.target.checked)}/>Include costs and receipts</label></div>
      ${msg && html`<p className="connection-error" role="alert">${msg}</p>`}
      <div className="dialog-actions"><button type="button" className="btn ghost" onClick=${onClose}>Close</button>
        <button type="button" className="btn ghost" disabled=${!list.length} onClick=${() => setMsg(downloadReportXlsx(opts, slug(e0.name) + '-' + view + '.xlsx'))}><${Icon} name="download"/>Excel</button>
        <button type="button" className="btn" disabled=${!list.length} onClick=${() => setMsg(openReport(opts))}><${Icon} name="print"/>PDF</button></div>
    </div><//>`;
  }

  // Venue hotel rooming list: choose the file, review each row's match, then save in one step.
  function RoomingImport({ S, A, onClose }) {
    const ev = current.id, e0 = evOf(ev), hotels = (S.hotels || []).filter(h => h.ev === ev);
    const [plan, setPlan] = useState(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false), [removes, setRemoves] = useState(new Set()), [done, setDone] = useState('');
    const pool = active();
    const pick = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; setErr(''); setDone('');
      try { const { rows } = await readSpreadsheet(f); const p = planRooming(rows, people, hotels);
        setPlan({ ...p, file: f.name }); setRemoves(new Set(p.items.filter(x => !x.reserved && x.e != null && hotels.some(h => h.e === x.e)).map(x => x.e))); }
      catch (ex) { setPlan(null); setErr(ex.message || 'Could not read the file.'); } };
    const setItem = (i, patch) => setPlan(p => ({ ...p, items: p.items.map((x, j) => j === i ? { ...x, ...patch } : x) }));
    const items = plan ? plan.items : [], ok = items.filter(x => x.reserved && x.e != null);
    const count = {}; ok.forEach(x => { count[x.e] = (count[x.e] || 0) + 1; });
    const own = new Set(ok.map(x => x.e));
    // A companion who has their own row on the list has their own reservation: keep the name only.
    const ceOf = x => x.ce != null && !own.has(x.ce) && x.ce !== x.e ? x.ce : null;
    const dup = Object.keys(count).filter(k => count[k] > 1).map(Number);
    const effect = x => dup.includes(x.e) && x.reserved ? { kind: 'error', text: 'Same person on two rows' } : rowEffect({ ...x, ce: ceOf(x) }, hotels, people);
    const fx = items.map(effect), sendable = items.filter((x, i) => ['new', 'update', 'same'].includes(fx[i].kind));
    const tally = k => fx.filter(f => f.kind === k).length, bad = fx.some(f => f.kind === 'error');
    const save = async () => { setBusy(true); setErr('');
      const rows = sendable.map(x => ({ e: x.e, conf: x.conf, in: x.in, out: x.out, companion: x.companion ? x.companion.display : '', companionId: ceOf(x) }));
      const r = await A.importHotels(ev, rows, [...removes].filter(e => items.some(x => !x.reserved && x.e === e)));
      setBusy(false);
      if (r !== false) setDone(tally('new') + ' added, ' + tally('update') + ' updated, ' + [...removes].length + ' removed. Travelers were notified of their bookings.'); else setErr('Could not import. Check the rows and try again.'); };
    const sel = (x, i) => html`<select aria-label=${'Person for ' + x.name.display} value=${x.e ?? ''} onChange=${e => setItem(i, { e: e.target.value === '' ? null : Number(e.target.value), how: 'chosen' })}>
      <option value="">Skip this row</option>${x.others.length > 0 && html`<optgroup label="Same last name">${x.others.map(p => html`<option key=${'o' + p.id} value=${p.id}>${p.name}</option>`)}</optgroup>`}
      <optgroup label="Everyone">${pool.map(p => html`<option key=${p.id} value=${p.id}>${p.name}</option>`)}</optgroup></select>`;
    const compCell = (x, i) => { if (!x.companion) return html`<span className="mute">–</span>`;
      const sug = x.ceSuggest != null ? people[x.ceSuggest] : null, linked = ceOf(x);
      if (x.ce != null && own.has(x.ce)) return html`${x.companion.display}<span className="cell-secondary">Has their own reservation on this list; name only</span>`;
      if (sug && sug.id !== x.e) return html`<label className="chk"><input type="checkbox" checked=${linked != null} onChange=${e => setItem(i, { ce: e.target.checked ? sug.id : null })}/>${x.companion.display}</label><span className="cell-secondary">${linked != null ? 'Shares this reservation with ' + sug.name + ' in People' : (x.ceHow === 'close' ? 'Possible match: ' + sug.name + '. Tick to share the reservation' : 'Tick to share with ' + sug.name)}</span>`;
      return html`${x.companion.display}<span className="cell-secondary">Not in People: name kept on the booking</span>`; };
    return html`<${Modal} title="Import rooming list" onClose=${busy ? () => {} : onClose}><div className="rooming-import">
      <p className="mute">For ${e0.name}. Choose the venue hotel's rooming list (Excel or CSV). It's read on this device; nothing is saved until you review the rows and choose Import. New bookings use ${e0.venue || 'the event venue'}, booked by Event, paid by Event / master bill; existing bookings get the confirmation #, dates, and accompanying person, and keep their costs, transfers, and pickup times.</p>
      <label className="btn ghost file-pick"><${Icon} name="upload"/>${plan ? 'Choose a different file' : 'Choose file'}<input type="file" accept=".xlsx,.csv" onChange=${pick}/></label>
      ${err && html`<p className="connection-error" role="alert">${err}</p>`}
      ${plan && !done && html`<p className="import-summary"><b>${plan.file}</b>: ${items.length} rows · ${tally('new')} new · ${tally('update')} updates · ${tally('same')} no change · ${tally('skip')} need a person · ${tally('cancelled') + tally('cancelled-has')} not reserved${bad ? ' · ' + tally('error') + ' to fix' : ''}</p>
        <div className="data-surface rooming-table"><table className="data-table"><thead><tr><th scope="col">On the list</th><th scope="col">Person in People</th><th scope="col">Accompanying</th><th scope="col">Result</th></tr></thead><tbody>
        ${items.map((x, i) => html`<tr key=${x.line} className=${'imp-' + fx[i].kind}>
          <td><b>${x.name.display}</b><span className="cell-secondary">${x.conf ? '#' + x.conf + ' · ' : ''}${dayText(x.in)} – ${dayText(x.out)}${x.status ? ' · ' + x.status : ''}</span></td>
          <td>${x.reserved ? html`${sel(x, i)}${x.e != null && x.how === 'close' && html`<span className="cell-secondary warn-text">Close match: check it's the right person</span>`}${x.e == null && html`<span className="cell-secondary warn-text">${x.others.length ? 'Not sure: same last name as ' + x.others.map(p => p.name).join(', ') : 'No match found'}</span>`}` : html`<span className="mute">${x.e != null ? people[x.e]?.name : 'Not matched'}</span>`}</td>
          <td>${x.reserved ? compCell(x, i) : x.companion ? x.companion.display : html`<span className="mute">–</span>`}</td>
          <td>${fx[i].text}${fx[i].kind === 'cancelled-has' && html`<label className="chk"><input type="checkbox" checked=${removes.has(x.e)} onChange=${e => setRemoves(v => { const n = new Set(v); e.target.checked ? n.add(x.e) : n.delete(x.e); return n; })}/>Remove their booking</label>`}</td></tr>`)}
        </tbody></table></div>`}
      ${done && html`<p className="mute" role="status">${done}</p>`}
      <div className="dialog-actions"><button type="button" className="btn ghost" disabled=${busy} onClick=${onClose}>${done ? 'Close' : 'Cancel'}</button>
        ${plan && !done && html`<button type="button" className="btn" disabled=${busy || bad || !(sendable.length || removes.size)} onClick=${save}>${busy ? 'Importing…' : 'Import ' + sendable.length + ' booking' + (sendable.length === 1 ? '' : 's')}</button>`}</div>
      ${bad && html`<p className="connection-error" role="alert">Fix the rows marked in red (or skip them) before importing.</p>`}
    </div><//>`;
  }

  // Flights manifest: choose the file, review each row's match and flights, then save in one step.
  function FlightImport({ S, A, onClose }) {
    const ev = current.id, e0 = evOf(ev), flights = (S.flights || []).filter(f => f.ev === ev), hotels = (S.hotels || []).filter(h => h.ev === ev);
    const [items, setItems] = useState(null), [file, setFile] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false), [done, setDone] = useState('');
    const pool = active(), year = Number((e0.start || String(new Date().getFullYear())).slice(0, 4));
    const pick = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; setErr(''); setDone('');
      try { const { rows } = await readSpreadsheet(f); setItems(planFlights(rows, people, year)); setFile(f.name); } catch (ex) { setItems(null); setErr(ex.message || 'Could not read the file.'); } };
    const setItem = (i, patch) => setItems(v => v.map((x, j) => j === i ? { ...x, ...patch } : x));
    const list = items || [], count = {}; list.forEach(x => { if (x.e != null) count[x.e] = (count[x.e] || 0) + 1; });
    const fx = list.map(x => x.e != null && count[x.e] > 1 ? { kind: 'error', text: 'Same person on two rows' } : flightEffect(x, flights, hotels));
    const sendable = list.filter((x, i) => ['new', 'update', 'same'].includes(fx[i].kind)), tally = k => fx.filter(f => f.kind === k).length, bad = fx.some(f => f.kind === 'error');
    const save = async () => { setBusy(true); setErr('');
      const rows = sendable.map(x => ({ e: x.e, inCarrier: x.inCarrier, inFlight: x.inFlight, inArrive: x.inArrive, outCarrier: x.outCarrier, outFlight: x.outFlight, outDepart: x.outDepart, intl: x.intl, vip: x.vip }));
      const r = await A.importFlights(ev, rows); setBusy(false);
      if (r !== false) setDone(tally('new') + ' added, ' + tally('update') + ' updated. Travelers were notified.'); else setErr('Could not import. Check the rows and try again.'); };
    const leg = (f, t, tz) => f || t ? html`<span>${f || '–'}</span><span className="cell-secondary">${t ? whenText(t, tz) : 'No time'}</span>` : html`<span className="mute">–</span>`;
    return html`<${Modal} title="Import flights" onClose=${busy ? () => {} : onClose}><div className="rooming-import">
      <p className="mute">For ${e0.name}. Choose the flights manifest (Excel or CSV). It's read on this device; nothing is saved until you review the rows and choose Import. Rows match People by email, then by name. Dates without a year use ${year}; times are local to the event. New flights are booked by the traveler, paid by personal card; existing flights get the new flights and times and keep their costs and receipts. VIP / solo rider rows get car service both ways on their hotel booking.</p>
      <label className="btn ghost file-pick"><${Icon} name="upload"/>${items ? 'Choose a different file' : 'Choose file'}<input type="file" accept=".xlsx,.csv" onChange=${pick}/></label>
      ${err && html`<p className="connection-error" role="alert">${err}</p>`}
      ${items && !done && html`<p className="import-summary"><b>${file}</b>: ${list.length} rows · ${tally('new')} new · ${tally('update')} updates · ${tally('same')} no change · ${tally('skip')} need a person${bad ? ' · ' + tally('error') + ' to fix' : ''} · ${list.filter(x => x.warns.length).length} to check</p>
        <div className="data-surface rooming-table"><table className="data-table"><thead><tr><th scope="col">On the list</th><th scope="col">Person in People</th><th scope="col">Arriving</th><th scope="col">Departing</th><th scope="col">Result</th></tr></thead><tbody>
        ${list.map((x, i) => html`<tr key=${x.line} className=${'imp-' + fx[i].kind}>
          <td><b>${x.name}</b><span className="cell-secondary">${x.email || ''}${x.vip ? ' · VIP / solo rider' : ''}</span></td>
          <td><select aria-label=${'Person for ' + x.name} value=${x.e ?? ''} onChange=${e => setItem(i, { e: e.target.value === '' ? null : Number(e.target.value), how: 'chosen' })}>
            <option value="">Skip this row</option>${x.others.length > 0 && html`<optgroup label="Same last name">${x.others.map(p => html`<option key=${'o' + p.id} value=${p.id}>${p.name}</option>`)}</optgroup>`}
            <optgroup label="Everyone">${pool.map(p => html`<option key=${p.id} value=${p.id}>${p.name}</option>`)}</optgroup></select>
            ${x.e != null && x.how === 'close' && html`<span className="cell-secondary warn-text">Close name match: check it's the right person</span>`}${x.e == null && html`<span className="cell-secondary warn-text">${x.others.length ? 'Not sure: same last name as ' + x.others.map(p => p.name).join(', ') : 'Not found in People'}</span>`}</td>
          <td>${leg(x.inFlight, x.inArrive, e0.tz)}</td><td>${leg(x.outFlight, x.outDepart, e0.tz)}${x.intl && html`<span className="cell-secondary">International (4-hour pickup)</span>`}</td>
          <td>${fx[i].text}${x.warns.map(w => html`<span key=${w} className="cell-secondary warn-text">${w}</span>`)}</td></tr>`)}
        </tbody></table></div>`}
      ${done && html`<p className="mute" role="status">${done}</p>`}
      <div className="dialog-actions"><button type="button" className="btn ghost" disabled=${busy} onClick=${onClose}>${done ? 'Close' : 'Cancel'}</button>
        ${items && !done && html`<button type="button" className="btn" disabled=${busy || bad || !sendable.length} onClick=${save}>${busy ? 'Importing…' : 'Import ' + sendable.length + ' flight' + (sendable.length === 1 ? '' : 's')}</button>`}</div>
      ${bad && html`<p className="connection-error" role="alert">Fix the rows marked in red (or skip them) before importing.</p>`}
    </div><//>`;
  }

  // Admin page: everyone working the event (plus anyone with a booking); optional full roster.
  function ItinerariesAdmin({ S, A, me }) {
    const [q, setQ] = useState(''), [show, setShow] = useState('event'), [ed, setEd] = useState(null), [open, setOpen] = useState(null), [report, setReport] = useState(false), [importing, setImporting] = useState(false), [importingFlights, setImportingFlights] = useState(false);
    const ev = current.id, e0 = evOf(ev), acts = new Set(activities.filter(s => s.ev === ev).map(s => s.id));
    const working = new Set((S.asg || []).filter(a => acts.has(a.s)).map(a => a.e));
    const fl = (S.flights || []).filter(x => x.ev === ev), ho = (S.hotels || []).filter(x => x.ev === ev);
    const fOf = e => fl.find(x => x.e === e), hOf = e => ho.find(x => x.e === e);
    let list = active().filter(p => show === 'all' || working.has(p.id) || fOf(p.id) || hOf(p.id));
    if (show === 'noflight') list = list.filter(p => !fOf(p.id)); if (show === 'nohotel') list = list.filter(p => !hOf(p.id));
    list = list.filter(p => (p.name + ' ' + (p.role || '')).toLowerCase().includes(q.toLowerCase()));
    const counts = { f: fl.length, h: ho.length, car: ho.filter(h => h.tIn === 'car' || h.tOut === 'car').length, shuttle: ho.filter(h => h.tIn === 'shuttle' || h.tOut === 'shuttle').length };
    return html`<div className="itineraries-admin">
      <p className="mute">${counts.f} flight${counts.f === 1 ? '' : 's'} · ${counts.h} hotel booking${counts.h === 1 ? '' : 's'} · ${counts.car} with car service · ${counts.shuttle} on the group shuttle. People can enter their own flights: <b>${e0.staffFlights ? 'yes' : 'no'}</b>, hotels: <b>${e0.staffHotels ? 'yes' : 'no'}</b> (change in Event setup).</p>
      <div className="people-toolbar"><label className="search-field"><${Icon} name="search"/><input type="search" aria-label="Search people" placeholder="Search people" value=${q} onChange=${e => setQ(e.target.value)}/></label>
        <select aria-label="Show" value=${show} onChange=${e => setShow(e.target.value)}><option value="event">Working this event</option><option value="noflight">No flight yet</option><option value="nohotel">No hotel yet</option><option value="all">Everyone in People</option></select>
        <span className="mute">${list.length} ${list.length === 1 ? 'person' : 'people'}</span><div className="heading-actions">${flightImportOn(S) && html`<button className="btn ghost" onClick=${() => setImportingFlights(true)}><${Icon} name="upload"/>Import flights</button>`}${compOn(S) && html`<button className="btn ghost" onClick=${() => setImporting(true)}><${Icon} name="upload"/>Import rooming list</button>`}<button className="btn ghost" onClick=${() => setReport(true)}><${Icon} name="print"/>Report</button></div></div>
      <div className="data-surface"><table className="data-table travel-table"><thead><tr><th scope="col">Person</th><th scope="col">Flights</th><th scope="col">Hotel</th><th scope="col">Airport transfer</th></tr></thead><tbody>
      ${list.length ? list.map(p => { const f = fOf(p.id), h = hOf(p.id); return html`<tr key=${p.id}>
        <td><b>${p.name}</b><span className="cell-secondary">${p.role || ''}${!working.has(p.id) ? ' · not on this event' : ''}</span></td>
        <td>${f ? html`<${FlightSummary} f=${f} tz=${e0.tz}/>` : html`<span className="mute">No flight</span>`}
          <div className="acts"><button className="btn ghost" onClick=${() => setEd({ kind: 'flight', who: p.id, b: f })}>${f ? 'Edit flight' : 'Add flight'}</button>${f && html`<button className="btn ghost" aria-expanded=${open === 'f' + p.id} onClick=${() => setOpen(open === 'f' + p.id ? null : 'f' + p.id)}>Details</button>`}</div>
          ${f && open === 'f' + p.id && html`<${Details} b=${f} kind="flight"/>`}</td>
        <td>${h ? html`<${HotelSummary} h=${h}/>` : html`<span className="mute">No hotel</span>`}
          <div className="acts"><button className="btn ghost" onClick=${() => setEd({ kind: 'hotel', who: p.id, b: h })}>${h ? 'Edit hotel' : 'Add hotel'}</button>${h && html`<button className="btn ghost" aria-expanded=${open === 'h' + p.id} onClick=${() => setOpen(open === 'h' + p.id ? null : 'h' + p.id)}>Details</button>`}</div>
          ${h && open === 'h' + p.id && html`<${Details} b=${h} kind="hotel"/>`}</td>
        <td>${h ? html`<p>To hotel: <b>${transferText(h.tIn)}</b></p><p>To airport: <b>${transferText(h.tOut)}</b></p>${pickOn(S) && hasPickup(h.tOut) && html`<p>Pickup: <b>${pickupLine(h, e0.tz)}</b>${h.pickupManual ? ' (set by hand)' : ''}</p>`}${h.tNotes && html`<span className="cell-secondary">${h.tNotes}</span>`}` : html`<span className="mute">Set with the hotel</span>`}</td></tr>`; })
        : html`<tr><td colSpan="4" className="empty-table">No people match.</td></tr>`}
      </tbody></table></div>
      ${report && html`<${ReportDialog} S=${S} shown=${list} onClose=${() => setReport(false)}/>`}
      ${importing && html`<${RoomingImport} S=${S} A=${A} onClose=${() => setImporting(false)}/>`}
      ${importingFlights && html`<${FlightImport} S=${S} A=${A} onClose=${() => setImportingFlights(false)}/>`}
      ${ed && ed.kind === 'flight' && html`<${FlightEditor} ev=${ev} who=${ed.who} booking=${ed.b} me=${me} admin=${true} A=${A} S=${S} onClose=${() => setEd(null)}/>`}
      ${ed && ed.kind === 'hotel' && html`<${HotelEditor} ev=${ev} who=${ed.who} booking=${ed.b} me=${me} admin=${true} A=${A} S=${S} onClose=${() => setEd(null)}/>`}
    </div>`;
  }

  // Traveler's card (phone and web): summary, transfer instructions, own details, and add/edit when allowed.
  function MyTravel({ S, A, me }) {
    const [ed, setEd] = useState(null), [open, setOpen] = useState(false), [msg, setMsg] = useState('');
    const ev = current.id, e0 = evOf(ev), f = (S.flights || []).find(x => x.ev === ev && x.e === me), h = (S.hotels || []).find(x => x.ev === ev && x.e === me);
    const canF = !!e0.staffFlights && (!f || f.mine), canH = !!e0.staffHotels && (!h || h.mine);
    if (!f && !h && !canF && !canH) return null;
    return html`<div className="card travel-card"><b>My travel</b>
      ${f ? html`<${FlightSummary} f=${f} tz=${e0.tz}/>` : canF && html`<p className="mute">No flight entered yet.</p>`}
      ${h ? html`<${HotelSummary} h=${h}/><div className="travel-transfer"><p><b>Airport to hotel:</b> ${transferText(h.tIn)}. ${transferHelp(h.tIn, 'in')}</p><p><b>Hotel to airport:</b> ${transferText(h.tOut)}. ${transferHelp(h.tOut, 'out')}</p>${pickOn(S) && hasPickup(h.tOut) && html`<p className="pickup-line"><b>Your pickup:</b> ${pickupLine(h, e0.tz)}${h.pickup ? ' at the hotel. You\'ll get a reminder 30 minutes before.' : '.'}</p>`}${h.tNotes && html`<p className="mute">${h.tNotes}</p>`}</div>`
        : canH && html`<p className="mute">No hotel entered yet.</p>`}
      ${!f && !canF && html`<p className="mute">Your flight hasn't been added yet.</p>`}${!h && !canH && html`<p className="mute">Your hotel hasn't been added yet.</p>`}
      <div className="acts">${canF && html`<button className="btn ghost" onClick=${() => setEd('flight')}>${f ? 'Edit my flight' : 'Add my flight'}</button>`}${canH && html`<button className="btn ghost" onClick=${() => setEd('hotel')}>${h ? 'Edit my hotel' : 'Add my hotel'}</button>`}
        ${(f || h) && html`<button className="btn ghost" aria-expanded=${open} onClick=${() => setOpen(!open)}>${open ? 'Hide details' : 'Booking details'}</button>`}
        ${(f || h) && html`<button className="btn ghost" onClick=${() => setMsg(openReport({ view: 'combined', list: [people[me]], flights: f ? [f] : [], hotels: h ? [h] : [], tz: e0.tz, costs: true, booker, title: e0.name + ': my itinerary', scope: nameOf(me) }))}><${Icon} name="print"/>Print my itinerary</button>`}</div>
      ${msg && html`<p className="connection-error" role="alert">${msg}</p>`}
      ${open && f && html`<h4>Flight</h4><${Details} b=${f} kind="flight"/>`}${open && h && html`<h4>Hotel</h4><${Details} b=${h} kind="hotel"/>`}
      ${ed === 'flight' && html`<${FlightEditor} ev=${ev} who=${me} booking=${f} me=${me} admin=${false} A=${A} S=${S} onClose=${() => setEd(null)}/>`}
      ${ed === 'hotel' && html`<${HotelEditor} ev=${ev} who=${me} booking=${h} me=${me} admin=${false} A=${A} S=${S} onClose=${() => setEd(null)}/>`}
    </div>`;
  }

  return { ItinerariesAdmin, MyTravel };
}
