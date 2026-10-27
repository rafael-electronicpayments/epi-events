// People types. 'contractor' is shown as "Event Staff" (the stored value is unchanged). Everyone but Staff and
// Admin sees only what they are assigned to; only Staff and Admin can be team leads.
export const PERSON_TYPES = [['staff', 'Staff', 'Staff'], ['contractor', 'Event Staff', 'Event Staff'], ['speaker', 'Speaker', 'Speakers'], ['panelist', 'Panelist', 'Panelists'], ['admin', 'Admin', 'Admins']];
export const typeLabel = v => (PERSON_TYPES.find(t => t[0] === v) || [, 'Staff'])[1];
// Spreadsheet values: "Event Staff", "Contractor", "Speaker", "Panelist", "Staff", "Admin" (any case, plurals ok).
export function typeFromText(raw) {
  const k = String(raw || '').toLowerCase().replace(/[^a-z]/g, '').replace(/s$/, '');
  return { admin: 'admin', administrator: 'admin', staff: 'staff', employee: 'staff', contractor: 'contractor', eventstaff: 'contractor', eventstaf: 'contractor',
    speaker: 'speaker', presenter: 'speaker', panelist: 'panelist', panellist: 'panelist' }[k] || null;
}
