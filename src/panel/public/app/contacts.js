// Contacts screen and a person's page (073). Module of the panel (063).
import { $, S, ago, api, ask, avatar, can, field, h, icon, menu, tryApi } from './core.js';
import { helpLink, plural } from './shared.js';
let contactsQuery = '';
const PAGE = 100; // 069: contacts load 100 at a time (Show more), the server searches all of them
const page = (offset) => api('GET', `/api/contacts?q=${encodeURIComponent(contactsQuery)}&limit=${PAGE}&offset=${offset}`);
// 057: which WhatsApp name is shown (the panel picks own > phone contact > business > profile name)
const KIND = (c) => (c.ownName ? '' : c.bookName ? 'phone contact' : c.businessName ? 'business name' : c.profileName ? 'profile name' : '');
const SRC = { own: 'Own', whatsapp: 'WhatsApp', both: 'Own + WhatsApp' };
const href = (c) => `#contacts/${encodeURIComponent(c.phone)}`;
/** Contacts (073: list → page): one row per person — avatar · name · one muted line · chevron; the rest on their page. */
export async function renderContacts() {
  const want = decodeURIComponent(location.hash.split('/')[1] || '');
  if (want) return renderPerson(want);
  const [list, sum] = await Promise.all([page(0), api('GET', '/api/contacts/summary').catch(() => null)]);
  const edit = can('admin');
  const search = h('input', { type: 'search', placeholder: 'Search name, note or number', 'aria-label': 'Search contacts', value: contactsQuery });
  let timer; search.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { contactsQuery = search.value; renderContacts().then(() => { const i = $('#main input[type=search]'); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }); }, 250); };
  // 068: adding is one button that opens the shared dialog
  const addContact = async () => {
    const F = { name: h('input', { autocomplete: 'off' }), phone: h('input', { placeholder: '+41 79 000 00 01', inputmode: 'tel', autocomplete: 'off' }), note: h('input', { placeholder: 'e.g. drives on Tuesdays', autocomplete: 'off' }), shared: h('input', { type: 'checkbox' }) };
    if (!await ask({ title: 'Add a contact', ok: 'Save contact', body: [field('Name', F.name), field('Number', F.phone), field('Note (optional)', F.note), h('label', { class: 'tick' }, F.shared, ' Shared: participants may look it up')] })) return;
    if (await tryApi(() => api('PUT', `/api/contacts/${encodeURIComponent(F.phone.value)}`, { name: F.name.value, note: F.note.value, shared: F.shared.checked }), 'Contact saved')) renderContacts();
  };
  const row = (c) => h('li', {}, h('a', { class: 'lrow', href: href(c) }, avatar(c.name, c.phone, 's'),
    h('span', { class: 'lrow-main' }, h('span', { class: 'lrow-name' }, c.name),
      h('span', { class: 'lrow-sub num' }, [`+${c.phone}`, c.shared ? 'Shared' : '', c.note || KIND(c) || SRC[c.source]].filter(Boolean).join(' · '))),
    h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')));
  const ul = h('ul', { class: 'contact-list' }, list.map(row));
  const more = h('button', { class: 'btn', type: 'button', hidden: list.length < PAGE, style: 'margin-top:10px', onclick: () => tryApi(async () => {
    const next = await page(ul.childElementCount); ul.append(...next.map(row)); more.hidden = next.length < PAGE;
  }) }, 'Show more');
  $('#main').replaceChildren(
    h('div', { class: 'card' },
      h('div', { class: 'sec-head' }, h('h2', {}, `Contacts (${(contactsQuery || !sum ? list.length : sum.total).toLocaleString()}${contactsQuery && list.length === PAGE ? '+' : ''})`), edit ? h('button', { class: 'btn small primary', type: 'button', onclick: addContact }, '+ Add') : null, helpLink('chats.md#contacts')),
      h('div', { class: 'ld-tools', style: 'margin-top:8px' }, search),
      sum ? h('p', { class: 'small muted', role: 'status' }, `${sum.book} from your phone · ${plural(sum.profile, 'profile name')}${sum.hiddenNumbers ? ` · ${sum.hiddenNumbers} hidden numbers` : ''}${sum.refreshedAt ? ` · refreshed ${ago(sum.refreshedAt)} ago` : ''}. Participants only see Shared ones.`,
        edit ? [' ', h('button', { class: 'btn small ghost', title: 'Optional: the server also does this by itself', onclick: () => tryApi(async () => { await api('POST', '/api/contacts/refresh'); setTimeout(renderContacts, 4000); }, 'Asked WhatsApp for names') }, 'Refresh')] : null) : null,
      sum ? h('label', { class: 'tick small', style: 'justify-content:flex-start' }, h('input', { type: 'checkbox', checked: sum.namesForAgents !== false, disabled: !can('owner'),
        onchange: (e) => tryApi(async () => { await api('PUT', '/api/contacts/agent-names', { enabled: e.target.checked }); }, e.target.checked ? 'Agents use your contact names' : 'Agents use profile names') }),
        ' Agents may use the names from your phone contacts') : null,
      list.length ? [ul, more]
        : h('p', { class: 'muted' }, contactsQuery ? 'No contact matches.' : 'No contacts yet. They appear once WhatsApp syncs your phone’s address book.')));
}

/** A person's page (073): name, number, where the name comes from, Shared, note, their direct chat and their groups. */
async function renderPerson(phone) {
  const back = h('a', { class: 'sub-back', href: '#contacts' }, icon('back'), 'Contacts');
  const c = can('admin') ? await api('GET', `/api/contacts/${encodeURIComponent(phone)}/person`).catch(() => null) : null;
  if (!c) {
    $('#main').replaceChildren(h('div', { class: 'card' }, back, h('h2', {}, 'Contacts'), h('p', { class: 'muted' }, can('admin') ? 'Could not open this person.' : 'Admins can open a person’s page.')));
    return;
  }
  window.scrollTo(0, 0);
  const editC = async () => {
    const name = h('input', { value: c.ownName || c.whatsappName || '', autocomplete: 'off' }); const note = h('input', { value: c.note || '', autocomplete: 'off' });
    if (!await ask({ title: `Edit ${c.name}`, ok: 'Save contact', body: [field('Name', name), field('Note (optional)', note)] })) return;
    if (await tryApi(() => api('PUT', `/api/contacts/${c.phone}`, { name: name.value, note: note.value }), 'Contact saved')) renderPerson(phone);
  };
  const remove = async () => (await ask({ title: `Remove ${c.name}?`, text: 'Removed from Duniya only; WhatsApp and your phone are not changed.', ok: 'Remove contact', danger: true }))
    && tryApi(async () => { await api('DELETE', `/api/contacts/${c.phone}`); location.hash = 'contacts'; }, 'Removed');
  const setUp = () => { S.dmPrefill = { phone: c.phone, name: c.name }; location.hash = 'chats/add'; };
  const shared = h('input', { type: 'checkbox', checked: c.shared, onchange: () => tryApi(() => api('PUT', `/api/contacts/${c.phone}`, { shared: shared.checked }), shared.checked ? 'Shared' : 'Not shared') });
  const chatRow = (x, sub) => h('li', {}, h('a', { class: 'lrow', href: `#chats/${encodeURIComponent(x.id)}` }, avatar(x.name, x.id, `s${x.enabled ? '' : ' off'}`),
    h('span', { class: 'lrow-main' }, h('span', { class: 'lrow-name' }, x.name), h('span', { class: 'lrow-sub' }, [x.enabled ? x.agentName || 'No agent' : 'Off', sub].filter(Boolean).join(' · '))),
    h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')));
  const names = [['Phone contact', c.bookName], ['Business', c.businessName], ['Profile', c.profileName]].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ');
  $('#main').replaceChildren(h('div', { class: 'card person-page' }, back,
    h('div', { class: 'ap-head' }, avatar(c.name, c.phone, 'l'),
      h('div', { class: 'ap-title' }, h('h2', { tabindex: '-1' }, c.name), h('div', { class: 'small muted num' }, [`+${c.phone}`, c.notSaved ? 'not saved as a contact' : KIND(c) || SRC[c.source]].filter(Boolean).join(' · '))),
      menu(`More for ${c.name}`, h('button', { class: 'btn small', type: 'button', onclick: editC }, c.notSaved ? 'Save as contact…' : 'Edit…'),
        c.source !== 'whatsapp' && !c.notSaved ? h('button', { class: 'btn small danger', type: 'button', onclick: remove }, 'Remove…') : null)),
    c.note ? h('p', { class: 'small', style: 'margin:10px 0 0' }, c.note) : null,
    names ? h('p', { class: 'small muted', style: 'margin:6px 0 0' }, names) : null,
    c.notSaved ? null : h('div', { class: 'sblock' }, h('label', { class: 'tick small', style: 'justify-content:flex-start' }, shared, ' Shared: participants may look this contact up')),
    h('div', { class: 'lgroup' }, h('div', { class: 'eyebrow' }, 'Direct chat'), h('ul', {},
      c.direct.length ? c.direct.map((x) => chatRow(x, ''))
        : h('li', {}, h('button', { class: 'lrow', type: 'button', onclick: setUp }, h('span', { class: 'lmark c3', 'aria-hidden': 'true' }, '+'),
          h('span', { class: 'lrow-main' }, h('span', { class: 'lrow-name' }, 'Set up a direct chat'), h('span', { class: 'lrow-sub' }, 'Give them an agent, before they write')),
          h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'))))),
    h('div', { class: 'lgroup' }, h('div', { class: 'eyebrow' }, 'Groups they wrote in'),
      c.groups.length ? h('ul', {}, c.groups.map((x) => chatRow(x, `wrote ${ago(x.lastAt)} ago`)))
        : h('p', { class: 'small muted', style: 'padding:0 10px' }, 'No stored message from them in a group that is on.'))));
  $('#main h2')?.focus({ preventScroll: true });
}
