// Contacts screen. Module of the panel (063).
// ---------- contacts (#11) ----------
import { renderChats } from './chats.js';
import { $, S, ago, api, can, h, tryApi } from './core.js';
let contactsQuery = '';
export async function renderContacts() {
  const [list, sum] = await Promise.all([api('GET', `/api/contacts?q=${encodeURIComponent(contactsQuery)}`), api('GET', '/api/contacts/summary').catch(() => null)]);
  const edit = can('admin');
  // 057: which WhatsApp name is shown (the panel picks own > phone contact > business > profile name)
  const KIND = (c) => (c.ownName ? '' : c.bookName ? 'phone contact' : c.businessName ? 'business name' : c.profileName ? 'profile name' : '');
  const SRC = { own: 'Own', whatsapp: 'WhatsApp', both: 'Own + WhatsApp' };
  const search = h('input', { type: 'search', placeholder: 'Search name, note or number', value: contactsQuery, style: 'max-width:320px' });
  let timer; search.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { contactsQuery = search.value; renderContacts().then(() => { const i = $('#main input[type=search]'); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }); }, 250); };
  const F = { name: h('input', { placeholder: 'Name' }), phone: h('input', { placeholder: '+41 79 000 00 01', inputmode: 'tel' }), note: h('input', { placeholder: 'Note (optional), e.g. “drives on Tuesdays”' }), shared: h('input', { type: 'checkbox' }) };
  const add = edit ? h('form', { class: 'card', onsubmit: async (e) => { e.preventDefault(); if (await tryApi(() => api('PUT', `/api/contacts/${encodeURIComponent(F.phone.value)}`, { name: F.name.value, note: F.note.value, shared: F.shared.checked }), 'Contact saved')) renderContacts(); } },
    h('h2', {}, 'Add a contact'),
    h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px' }, F.name, F.phone, F.note),
    h('div', { class: 'row spread', style: 'margin-top:8px' }, h('label', { class: 'inline' }, F.shared, 'Shared — participants may look it up'), h('button', { class: 'btn primary' }, 'Save'))) : null;
  const row = (c) => {
    const shared = h('input', { type: 'checkbox', checked: c.shared, disabled: !edit, 'aria-label': `Share ${c.name}`, onchange: () => tryApi(() => api('PUT', `/api/contacts/${c.phone}`, { shared: shared.checked }), shared.checked ? 'Shared' : 'Not shared') });
    const editBtn = h('button', { class: 'btn small', onclick: async () => {
      const name = prompt('Name', c.ownName || c.whatsappName); if (name === null) return;
      const note = prompt('Note (optional)', c.note || ''); if (note === null) return;
      if (await tryApi(() => api('PUT', `/api/contacts/${c.phone}`, { name, note }), 'Contact saved')) renderContacts();
    } }, 'Edit');
    return h('tr', {},
      h('td', { 'data-label': '' }, h('strong', {}, c.name), KIND(c) ? h('span', { class: 'small muted' }, ` · ${KIND(c)}`) : null, c.note ? h('div', { class: 'small muted' }, c.note) : null),
      h('td', { 'data-label': 'Number', class: 'num' }, `+${c.phone}`),
      h('td', { 'data-label': 'Source' }, h('span', { class: 'pill' }, SRC[c.source]), c.whatsappName && c.ownName && c.whatsappName !== c.ownName ? h('div', { class: 'small muted' }, `WhatsApp: ${c.whatsappName}`) : null),
      h('td', { 'data-label': 'Shared' }, h('label', { class: 'tick' }, shared)),
      h('td', { 'data-label': '' }, edit ? h('div', { class: 'row nowrap', style: 'gap:6px' }, editBtn,
        h('button', { class: 'btn small', title: 'Choose an agent for this person before they write', onclick: () => { S.dmPrefill = { phone: c.phone, name: c.name }; if (location.hash === '#chats') renderChats(); else location.hash = '#chats'; } }, 'Set up chat'),
        c.source !== 'whatsapp' ? h('button', { class: 'btn small mut', onclick: () => confirm(`Remove ${c.name}?`) && tryApi(async () => { await api('DELETE', `/api/contacts/${c.phone}`); renderContacts(); }, 'Removed') }, 'Remove') : null) : null));
  };
  $('#main').replaceChildren(
    h('div', { class: 'card' },
      h('div', { class: 'row spread' }, h('h2', {}, `Contacts (${list.length})`), search),
      h('p', { class: 'small muted' }, 'Names from your linked WhatsApp phone appear here automatically, plus the people you add. Agents can look up numbers: organizers see everyone, participants only contacts marked Shared. Nothing is shared until you tick it.'),
      sum ? h('p', { class: 'small muted', role: 'status' }, `Names refresh from your phone by themselves (after it connects and once a day)${sum.refreshedAt ? `, last ${ago(sum.refreshedAt)} ago` : ''}: ${sum.book} phone contact${sum.book === 1 ? '' : 's'}, ${sum.profile} profile name${sum.profile === 1 ? '' : 's'}${sum.hiddenNumbers ? `, ${sum.hiddenNumbers} waiting for WhatsApp to share their number` : ''}.`,
        edit ? [' ', h('button', { class: 'btn small mut', title: 'Optional: the server also does this by itself', onclick: () => tryApi(async () => { await api('POST', '/api/contacts/refresh'); setTimeout(renderContacts, 4000); }, 'Asked WhatsApp for names') }, 'Refresh now')] : null) : null,
      sum ? h('label', { class: 'tick small' }, h('input', { type: 'checkbox', checked: sum.namesForAgents !== false, disabled: !can('owner'),
        onchange: (e) => tryApi(async () => { await api('PUT', '/api/contacts/agent-names', { enabled: e.target.checked }); }, e.target.checked ? 'Agents use your contact names' : 'Agents use profile names') }),
        ' Agents may use the names from your phone contacts (profile names are often incomplete). Turn off to keep your contact names to yourself.') : null,
      list.length ? h('table', { class: 'stack' }, h('thead', {}, h('tr', {}, ['Name', 'Number', 'Source', 'Shared', ''].map((x) => h('th', {}, x)))), h('tbody', {}, list.map(row)))
        : h('p', { class: 'muted' }, contactsQuery ? 'No contact matches.' : 'No contacts yet. They appear once WhatsApp syncs your phone’s address book, or add one below.')),
    add);
}

