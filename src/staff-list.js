// Printable staff list for an event: name, phone, and email only.
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function staffListDoc({ eventName, dates, scope, people, autoPrint = false }) {
  const list = [...people].sort((a, b) => a.name.localeCompare(b.name));
  const title = (eventName ? eventName + ': ' : '') + 'staff list';
  const rows = list.map(p => `<tr><td>${esc(p.name)}</td><td class="ph">${esc(p.phone)}</td><td>${esc(p.email)}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>@page{size:letter portrait;margin:.5in}body{font:12px/1.4 system-ui,sans-serif;color:#000;margin:16px;max-width:8in}h1{font-size:18px;margin:0 0 2px}.m{color:#555;margin:0 0 14px}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border-top:1px solid #bbb;padding:6px 6px;text-align:left;vertical-align:top;overflow-wrap:anywhere}thead th{background:#e8eeed;border-top:0}th:nth-child(1){width:36%}th:nth-child(2){width:22%}.ph{white-space:nowrap}tr{break-inside:avoid}thead{display:table-header-group}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}button{font:inherit;padding:10px 16px;margin:0 0 12px;min-height:44px}@media print{body{margin:0}button{display:none}}</style></head><body><button onclick="window.print()">Print or save as PDF</button><h1>${esc(title)}</h1><p class="m">${esc([dates, scope, list.length + (list.length === 1 ? ' person' : ' people'), 'Printed ' + new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })].filter(Boolean).join(' · '))}</p>${list.length ? `<table><thead><tr><th>Name</th><th>Phone</th><th>Email</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="m">No people match.</p>'}${autoPrint ? '<script>addEventListener("load",()=>setTimeout(()=>print(),200))</script>' : ''}</body></html>`;
}

// Opens the list in a new tab (during the click, so pop-up blockers allow it). Returns an error message or ''.
export function openStaffList(opts) {
  const url = URL.createObjectURL(new Blob([staffListDoc({ ...opts, autoPrint: true })], { type: 'text/html' }));
  const w = window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return w ? '' : 'Your browser blocked the PDF window. Allow pop-ups for this site and try again.';
}
