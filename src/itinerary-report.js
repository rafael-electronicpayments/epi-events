// Itineraries report: who (people list) x view (combined, flights, hotel, arrivals by day, departures by day),
// with or without costs. Printable (save as PDF) or Excel. Staff and contractors get only their own combined view.
import { xlsx } from './xlsx-writer.js';
import { whenText, dayText, nights, payText, transferText, transferHelp } from './itineraries.js';

export const VIEWS = [['combined', 'Flights and hotel'], ['flights', 'Flights only'], ['hotel', 'Hotel only'], ['arrivals', 'Arrivals by day'], ['departures', 'Departures by day']];
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = n => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const leg = (c, n, a, b) => [[c, n].filter(Boolean).join(' '), a || b ? (a || '?') + ' → ' + (b || '?') : ''].filter(Boolean).join(' · ');
const time = local => local ? local.slice(11, 16) : '';
const hm = local => { if (!local) return ''; const [h, m] = local.slice(11, 16).split(':').map(Number); return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' AM' : ' PM'); };

// rows for one view; each row is { cells: [...], group?: 'date heading' }
export function reportTable({ view, list, flights, hotels, tz, costs, booker }) {
  const fOf = e => flights.find(x => x.e === e), hOf = e => hotels.find(x => x.e === e);
  const flightCols = f => f ? [leg(f.inCarrier, f.inFlight, f.inFrom, f.inTo), whenText(f.inArrive, tz), leg(f.outCarrier, f.outFlight, f.outFrom, f.outTo), whenText(f.outDepart, tz)] : ['No flight', '', '', ''];
  const hotelCols = h => h ? [h.name || 'Hotel', h.conf || '', dayText(h.in), dayText(h.out), String(nights(h.in, h.out)), transferText(h.tIn), transferText(h.tOut)] : ['No hotel', '', '', '', '', '', ''];
  const fCost = f => f ? [booker(f), payText(f.paid), f.ref || '', money(f.cost), money(f.bags), money(Number(f.cost) + Number(f.bags))] : ['', '', '', '', '', ''];
  const hCost = h => h ? [booker(h), payText(h.paid), h.ref || '', money(h.nightly), money(h.charges), money(h.total)] : ['', '', '', '', '', ''];
  if (view === 'arrivals' || view === 'departures') {
    const out = view === 'departures', key = f => out ? f.outDepart : f.inArrive;
    const rows = list.map(p => ({ p, f: fOf(p.id), h: hOf(p.id) })).filter(r => r.f && key(r.f)).sort((a, b) => key(a.f).localeCompare(key(b.f)) || a.p.name.localeCompare(b.p.name));
    return { head: ['Time', 'Person', 'Flight', out ? 'To airport' : 'To hotel', 'Transfer details'], rows: rows.map(r => ({
      group: dayText(key(r.f).slice(0, 10)), cells: [hm(key(r.f)), r.p.name, out ? leg(r.f.outCarrier, r.f.outFlight, r.f.outFrom, r.f.outTo) : leg(r.f.inCarrier, r.f.inFlight, r.f.inFrom, r.f.inTo),
        r.h ? transferText(out ? r.h.tOut : r.h.tIn) : 'No hotel', r.h?.tNotes || ''] })),
      missing: list.filter(p => !fOf(p.id) || !key(fOf(p.id))).map(p => p.name) };
  }
  if (view === 'flights') return { head: ['Person', 'Arriving', 'Arrives', 'Departing', 'Departs', ...(costs ? ['Booked by', 'How paid', 'Receipt #', 'Flight', 'Bag fee', 'Total'] : [])],
    rows: list.map(p => ({ cells: [p.name, ...flightCols(fOf(p.id)), ...(costs ? fCost(fOf(p.id)) : [])] })) };
  if (view === 'hotel') return { head: ['Person', 'Hotel', 'Confirmation #', 'Check-in', 'Check-out', 'Nights', 'Airport to hotel', 'Hotel to airport', ...(costs ? ['Booked by', 'How paid', 'Receipt #', 'Nightly', 'Room charges', 'Total (folio)'] : [])],
    rows: list.map(p => ({ cells: [p.name, ...hotelCols(hOf(p.id)), ...(costs ? hCost(hOf(p.id)) : [])] })) };
  return { head: ['Person', 'Arriving', 'Arrives', 'Departing', 'Departs', 'Hotel', 'Confirmation #', 'Check-in', 'Check-out', 'Nights', 'Airport to hotel', 'Hotel to airport',
      ...(costs ? ['Flight total', 'Hotel total (folio)'] : [])],
    rows: list.map(p => { const f = fOf(p.id), h = hOf(p.id); return { cells: [p.name, ...flightCols(f), ...hotelCols(h), ...(costs ? [f ? money(Number(f.cost) + Number(f.bags)) : '', h ? money(h.total) : ''] : [])] }; }) };
}

// Printable page. Combined view prints one card per person (easier to read than a 14-column table).
export function reportDoc({ title, scope, view, list, flights, hotels, tz, costs, booker, autoPrint = false }) {
  const printed = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  let body;
  if (view === 'combined') {
    body = list.map(p => { const f = flights.find(x => x.e === p.id), h = hotels.find(x => x.e === p.id);
      return `<section><h2>${esc(p.name)}${p.role ? ` <span class="m">${esc(p.role)}</span>` : ''}</h2><table><tbody>
        ${f ? `<tr><th>Arriving</th><td>${esc(leg(f.inCarrier, f.inFlight, f.inFrom, f.inTo))}</td><td>${esc(whenText(f.inArrive, tz))}</td></tr>
          <tr><th>Departing</th><td>${esc(leg(f.outCarrier, f.outFlight, f.outFrom, f.outTo))}</td><td>${esc(whenText(f.outDepart, tz))}</td></tr>
          ${costs ? `<tr><th>Flight cost</th><td>${esc(money(f.cost))} + bags ${esc(money(f.bags))} = <b>${esc(money(Number(f.cost) + Number(f.bags)))}</b></td><td>${esc(payText(f.paid))}${f.ref ? ' · Receipt ' + esc(f.ref) : ''} · Booked by ${esc(booker(f))}</td></tr>` : ''}`
          : '<tr><th>Flight</th><td colspan="2" class="m">No flight entered</td></tr>'}
        ${h ? `<tr><th>Hotel</th><td>${esc(h.name || 'Hotel')}${h.conf ? ' · Confirmation ' + esc(h.conf) : ''}</td><td>${esc(dayText(h.in))} – ${esc(dayText(h.out))} · ${nights(h.in, h.out)} nights</td></tr>
          <tr><th>Airport to hotel</th><td colspan="2">${esc(transferText(h.tIn))}. ${esc(transferHelp(h.tIn, 'in'))}</td></tr>
          <tr><th>Hotel to airport</th><td colspan="2">${esc(transferText(h.tOut))}. ${esc(transferHelp(h.tOut, 'out'))}${h.tNotes ? '<br><span class="m">' + esc(h.tNotes) + '</span>' : ''}</td></tr>
          ${costs ? `<tr><th>Hotel cost</th><td>Total (folio) <b>${esc(money(h.total))}</b>${Number(h.nightly) ? ' · Nightly ' + esc(money(h.nightly)) : ''}</td><td>${esc(payText(h.paid))}${h.ref ? ' · Receipt ' + esc(h.ref) : ''} · Booked by ${esc(booker(h))}</td></tr>` : ''}`
          : '<tr><th>Hotel</th><td colspan="2" class="m">No hotel entered</td></tr>'}
      </tbody></table></section>`; }).join('');
  } else {
    const t = reportTable({ view, list, flights, hotels, tz, costs, booker });
    let last = null;
    body = `<table class="grid"><thead><tr>${t.head.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${t.rows.map(r => {
      const g = r.group && r.group !== last ? `<tr class="group"><td colspan="${t.head.length}">${esc(r.group)}</td></tr>` : ''; last = r.group || last;
      return g + `<tr>${r.cells.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`; }).join('')}</tbody></table>${t.missing && t.missing.length ? `<p class="m">No ${view === 'departures' ? 'departure' : 'arrival'} time yet: ${esc(t.missing.join(', '))}</p>` : ''}`;
  }
  const wide = view !== 'combined' && (costs || view === 'hotel');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>@page{size:letter ${wide ? 'landscape' : 'portrait'};margin:.45in}body{font:11px/1.4 system-ui,sans-serif;color:#000;margin:16px}h1{font-size:18px;margin:0 0 2px}h2{font-size:14px;margin:16px 0 4px;break-after:avoid}.m{color:#555;font-weight:400}p.m{margin:0 0 12px}table{border-collapse:collapse;width:100%}th,td{border-top:1px solid #bbb;padding:5px 6px;text-align:left;vertical-align:top;overflow-wrap:anywhere}section table th{width:120px;color:#333;font-weight:600}table.grid thead th{background:#e8eeed;border-top:0}tr.group td{background:#f3f6f5;font-weight:700;border-top:2px solid #0f766e}tr,section{break-inside:avoid}thead{display:table-header-group}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}button{font:inherit;padding:10px 16px;margin:0 0 12px;min-height:44px}@media print{body{margin:0}button{display:none}}</style></head><body><button onclick="window.print()">Print or save as PDF</button><h1>${esc(title)}</h1><p class="m">${esc([scope, list.length + (list.length === 1 ? ' person' : ' people'), 'Times are local to the event' + (tz ? ' (' + tz + ')' : ''), 'Printed ' + printed].join(' · '))}</p>${body || '<p class="m">No people match.</p>'}${autoPrint ? '<script>addEventListener("load",()=>setTimeout(()=>print(),200))</script>' : ''}</body></html>`;
}

export function openReport(opts) {
  const url = URL.createObjectURL(new Blob([reportDoc({ ...opts, autoPrint: true })], { type: 'text/html' }));
  const w = window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return w ? '' : 'Your browser blocked the report window. Allow pop-ups for this site and try again.';
}

export function downloadReportXlsx(opts, filename) {
  const t = reportTable(opts);
  const rows = [t.group ? t.head : (t.rows.some(r => r.group) ? ['Date', ...t.head] : t.head), ...t.rows.map(r => r.group ? [r.group, ...r.cells] : r.cells)];
  const data = xlsx(opts.sheet || 'Itineraries', rows, rows[0].map((_, i) => i === 0 ? 22 : 20));
  const url = URL.createObjectURL(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return '';
}
