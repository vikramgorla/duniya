// Contacts screen. Module of the panel (063).
// ---------- contacts (#11) ----------
import { $, S, ago, api, ask, avatar, can, field, h, menu, tryApi } from './core.js';
import { helpLink } from './shared.js';
let contactsQuery = '';
const PAGE = 100; // 069: contacts load 100 at a time (Show more), the server searches all of them
const page = (offset) => api('GET', `/api/contacts?q=${encodeURIComponent(contactsQuery)}&limit=${PAGE}&offset=${offset}`);
export async function renderContacts() {
  const [list, sum] = await Promise.all([page(0), api('GET', '/api/contacts/summary').catch(() => null)]);
  const edit = can('admin');
  // 057: which WhatsApp name is shown (the panel picks own > phone contact > business > profile name)
  const KIND = (c) => (c.ownName ? '' : c.bookName ? 'phone contact' : c.businessName ? 'business name' : c.profileName ? 'profile name' : '');
  const SRC = { own: 'Own', whatsapp: 'WhatsApp', both: 'Own + WhatsApp' };
  const search = h('input', { type: 'search', placeholder: 'Search name, note or number', 'aria-label': 'Search contacts', value: contactsQuery });
  let timer; search.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { contactsQuery = search.value; renderContacts().then(() => { const i = $('#main input[type=search]'); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }); }, 250); };
  // 068: adding is one button that opens the shared dialog
  const addContact = async () => {
    const F = { name: h('input', { autocomplete: 'off' }), phone: h('input', { placeholder: '+41 79 000 00 01', inputmode: 'tel', autocomplete: 'off' }), note: h('input', { placeholder: 'e.g. drives on Tuesdays', autocomplete: 'off' }), shared: h('input', { type: 'checkbox' }) };
    if (!await ask({ title: 'Add a contact', ok: 'Save contact', body: [field('Name', F.name), field('Number', F.phone), field('Note (optional)', F.note), h('label', { class: 'tick' }, F.shared, ' Shared: participants may look it up')] })) return;
    if (await tryApi(() => api('PUT', `/api/contacts/${encodeURIComponent(F.phone.value)}`, { name: F.name.value, note: F.note.value, shared: F.shared.checked }), 'Contact saved')) renderContacts();
  };
  // 068: one row per contact: avatar · name · one muted line · Shared · ⋯ (Edit, Set up chat, Remove)
  const row = (c) => {
    const shared = h('input', { type: 'checkbox', checked: c.shared, disabled: !edit, 'aria-label': `Share ${c.name}`, onchange: () => tryApi(() => api('PUT', `/api/contacts/${c.phone}`, { shared: shared.checked }), shared.checked ? 'Shared' : 'Not shared') });
    const editC = async () => {
      const name = h('input', { value: c.ownName || c.whatsappName || '', autocomplete: 'off' }); const note = h('input', { value: c.note || '', autocomplete: 'off' });
      if (!await ask({ title: `Edit ${c.name}`, ok: 'Save contact', body: [field('Name', name), field('Note (optional)', note)] })) return;
      if (await tryApi(() => api('PUT', `/api/contacts/${c.phone}`, { name: name.value, note: note.value }), 'Contact saved')) renderContacts();
    };
    const line = [`+${c.phone}`, KIND(c) || SRC[c.source], c.whatsappName && c.ownName && c.whatsappName !== c.ownName ? `WhatsApp: ${c.whatsappName}` : '', c.note].filter(Boolean).join(' · ');
    return h('li', {}, avatar(c.name, c.phone, 's'), h('span', { class: 'lrow-main' }, h('span', { class: 'lrow-name' }, c.name), h('span', { class: 'lrow-sub num' }, line)),
      h('label', { class: 'tick small' }, shared, ' Shared'),
      edit ? menu(`Actions for ${c.name}`, h('button', { class: 'btn small', type: 'button', onclick: editC }, 'Edit'),
        h('button', { class: 'btn small', type: 'button', onclick: () => { S.dmPrefill = { phone: c.phone, name: c.name }; location.hash = 'chats/add'; } }, 'Set up chat'),
        c.source !== 'whatsapp' ? h('button', { class: 'btn small danger', type: 'button', onclick: async () => (await ask({ title: `Remove ${c.name}?`, text: 'Removed from Duniya only; WhatsApp and your phone are not changed.', ok: 'Remove contact', danger: true })) && tryApi(async () => { await api('DELETE', `/api/contacts/${c.phone}`); renderContacts(); }, 'Removed') }, 'Remove') : null) : null);
  };
  const ul = h('ul', { class: 'contact-list' }, list.map(row));
  const more = h('button', { class: 'btn', type: 'button', hidden: list.length < PAGE, style: 'margin-top:10px', onclick: () => tryApi(async () => {
    const next = await page(ul.childElementCount); ul.append(...next.map(row)); more.hidden = next.length < PAGE;
  }) }, 'Show more');
  $('#main').replaceChildren(
    h('div', { class: 'card' },
      h('div', { class: 'sec-head' }, h('h2', {}, `Contacts (${(contactsQuery || !sum ? list.length : sum.total).toLocaleString()}${contactsQuery && list.length === PAGE ? '+' : ''})`), edit ? h('button', { class: 'btn small primary', type: 'button', onclick: addContact }, '+ Add') : null, helpLink('agents.md#contacts')),
      h('div', { class: 'ld-tools', style: 'margin-top:8px' }, search),
      sum ? h('p', { class: 'small muted', role: 'status' }, `${sum.book} from your phone · ${sum.profile} profile name${sum.profile === 1 ? '' : 's'}${sum.hiddenNumbers ? ` · ${sum.hiddenNumbers} hidden numbers` : ''}${sum.refreshedAt ? ` · refreshed ${ago(sum.refreshedAt)} ago` : ''}. Participants only see Shared ones.`,
        edit ? [' ', h('button', { class: 'btn small ghost', title: 'Optional: the server also does this by itself', onclick: () => tryApi(async () => { await api('POST', '/api/contacts/refresh'); setTimeout(renderContacts, 4000); }, 'Asked WhatsApp for names') }, 'Refresh')] : null) : null,
      sum ? h('label', { class: 'tick small', style: 'justify-content:flex-start' }, h('input', { type: 'checkbox', checked: sum.namesForAgents !== false, disabled: !can('owner'),
        onchange: (e) => tryApi(async () => { await api('PUT', '/api/contacts/agent-names', { enabled: e.target.checked }); }, e.target.checked ? 'Agents use your contact names' : 'Agents use profile names') }),
        ' Agents may use the names from your phone contacts') : null,
      list.length ? [ul, more]
        : h('p', { class: 'muted' }, contactsQuery ? 'No contact matches.' : 'No contacts yet. They appear once WhatsApp syncs your phone’s address book.')));
}
