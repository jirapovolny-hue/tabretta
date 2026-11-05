import { externalLink, h, toast } from '../dom.js';
import { api, del, get, patch, post } from '../api.js';
import {
  STATUSES,
  STATUS_LABEL,
  formatNumberInput,
  formatPrice,
  formatSize,
  statusBadge,
  waitingBadges,
} from '../labels.js';

const MAX_UPLOAD = 25 * 1024 * 1024;

/** Detail úkolu. Změny polí se ukládají hned (po opuštění pole / změně volby). */
export async function taskView(container, { params, navigate }) {
  const taskId = Number(params[0]);
  let task = await get(`/tasks/${taskId}`);

  const waiting = h('div', { class: 'row' });
  const sections = h('div', { class: 'stack' });

  async function save(fields) {
    try {
      task = await patch(`/tasks/${taskId}`, fields);
      renderWaiting();
      toast('Uloženo.');
    } catch (err) {
      toast(err.message, { error: true });
      // vrátit pole na poslední uložený stav
      title.value = task.title;
      status.value = task.status;
      due.value = task.due_date ?? '';
      description.value = task.description;
    }
  }

  const title = h('input', {
    type: 'text',
    value: task.title,
    maxlength: 500,
    'aria-label': 'Název úkolu',
    class: 'title-input',
    onchange: (e) => {
      if (!e.target.value.trim()) {
        e.target.value = task.title;
        toast('Název nesmí být prázdný.', { error: true });
        return;
      }
      save({ title: e.target.value });
    },
  });
  const status = h(
    'select',
    { onchange: (e) => save({ status: e.target.value }) },
    STATUSES.map(([v, label]) => h('option', { value: v, selected: v === task.status }, label)),
  );
  const due = h('input', {
    type: 'date',
    value: task.due_date ?? '',
    onchange: (e) => save({ due_date: e.target.value || null }),
  });
  const description = h('textarea', {
    value: task.description,
    maxlength: 50000,
    placeholder: 'Popis (prostý text)',
    'aria-label': 'Popis',
    onchange: (e) => save({ description: e.target.value }),
  });

  container.replaceChildren(
    h('a', { class: 'back', href: `#/projekt/${task.project_id}` }, `← ${task.project_name}`),
    h(
      'section',
      { class: 'card stack' },
      h('label', { class: 'field' }, h('span', {}, 'Název'), title),
      waiting,
      h(
        'div',
        { class: 'grid-2' },
        h('label', { class: 'field' }, h('span', {}, 'Stav'), status),
        h('label', { class: 'field' }, h('span', {}, 'Termín'), due),
      ),
      h('label', { class: 'field' }, h('span', {}, 'Popis'), description),
    ),
    sections,
    h(
      'div',
      { class: 'danger-zone' },
      h('button', { type: 'button', class: 'btn btn-danger', onclick: deleteTask }, 'Smazat úkol'),
    ),
  );

  renderWaiting();
  await renderSections();

  function renderWaiting() {
    waiting.replaceChildren(...waitingBadges(task.waiting_on));
    waiting.hidden = !task.waiting_on?.length;
  }

  async function reload() {
    task = await get(`/tasks/${taskId}`);
    renderWaiting();
    await renderSections();
  }

  async function run(action) {
    try {
      await action();
      await reload();
    } catch (err) {
      toast(err.message, { error: true });
    }
  }

  async function deleteTask() {
    if (!window.confirm(`Opravdu smazat úkol „${task.title}“ včetně odkazů, nákupního seznamu a příloh? Tuto akci nelze vrátit.`)) return;
    try {
      await del(`/tasks/${taskId}`);
      toast('Úkol smazán.');
      navigate(`#/projekt/${task.project_id}`);
    } catch (err) {
      toast(err.message, { error: true });
    }
  }

  async function renderSections() {
    const candidates = await get('/tasks?include_done=1').catch(() => []);
    sections.replaceChildren(linksSection(), attachmentsSection(), shoppingSection(), dependenciesSection(candidates));
  }

  // --- Odkazy ---

  function linksSection() {
    const url = h('input', { type: 'url', placeholder: 'https://…', 'aria-label': 'Adresa odkazu', required: true, inputmode: 'url' });
    const label = h('input', { type: 'text', placeholder: 'Popisek (nepovinný)', 'aria-label': 'Popisek odkazu', maxlength: 200 });
    return h(
      'section',
      { class: 'card section' },
      h('h3', {}, 'Odkazy'),
      task.links.length
        ? h(
            'ul',
            { class: 'item-list' },
            task.links.map((l) =>
              h(
                'li',
                {},
                h('span', { class: 'grow' }, externalLink(l.url, l.label || l.url)),
                removeButton(`Smazat odkaz ${l.label || l.url}`, () => run(() => del(`/links/${l.id}`))),
              ),
            ),
          )
        : h('p', { class: 'empty' }, 'Žádné odkazy.'),
      h(
        'form',
        {
          class: 'form-inline',
          onsubmit: (e) => {
            e.preventDefault();
            const value = url.value.trim();
            if (!/^https?:\/\//i.test(value)) {
              toast('Adresa musí začínat http:// nebo https://', { error: true });
              return;
            }
            run(() => post(`/tasks/${taskId}/links`, { url: value, label: label.value }));
          },
        },
        url,
        label,
        h('button', { type: 'submit', class: 'btn' }, 'Přidat odkaz'),
      ),
    );
  }

  // --- Přílohy ---

  function attachmentsSection() {
    const progress = h('span', { class: 'muted small', hidden: true }, 'Nahrávám…');
    const input = h('input', {
      type: 'file',
      multiple: true,
      'aria-label': 'Vybrat soubory',
      onchange: async (e) => {
        const files = [...e.target.files];
        e.target.value = '';
        const tooBig = files.filter((f) => f.size > MAX_UPLOAD);
        if (tooBig.length) toast(`Příliš velké (max. 25 MB): ${tooBig.map((f) => f.name).join(', ')}`, { error: true });
        const ok = files.filter((f) => f.size <= MAX_UPLOAD);
        if (!ok.length) return;
        progress.hidden = false;
        await run(async () => {
          for (const file of ok) {
            const form = new FormData();
            form.append('file', file, file.name);
            await api('POST', `/tasks/${taskId}/attachments`, form);
          }
        });
        progress.hidden = true;
      },
    });
    return h(
      'section',
      { class: 'card section' },
      h('h3', {}, 'Přílohy'),
      task.attachments.length
        ? h(
            'ul',
            { class: 'item-list' },
            task.attachments.map((a) =>
              h(
                'li',
                {},
                h(
                  'span',
                  { class: 'grow' },
                  h('a', { href: `/api/attachments/${a.id}`, download: a.original_name }, a.original_name),
                  ' ',
                  h('span', { class: 'muted small' }, formatSize(a.size_bytes)),
                ),
                removeButton(`Smazat přílohu ${a.original_name}`, () => {
                  if (window.confirm(`Smazat přílohu „${a.original_name}“?`)) run(() => del(`/attachments/${a.id}`));
                }),
              ),
            ),
          )
        : h('p', { class: 'empty' }, 'Žádné přílohy.'),
      h('div', { class: 'row' }, input, progress),
      h('p', { class: 'muted small' }, 'Fotky, PDF, dokumenty. Max. 25 MB na soubor.'),
    );
  }

  // --- Nákupní seznam ---

  function shoppingSection() {
    const items = task.shopping_items;
    const totals = task.shopping_totals;
    const name = h('input', { type: 'text', placeholder: 'Položka', 'aria-label': 'Název položky', required: true, maxlength: 200 });
    const qty = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'Množství', 'aria-label': 'Množství', value: '1' });
    const price = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'Cena/ks', 'aria-label': 'Cena za kus' });

    const itemRow = (it) => {
      const rowEl = h(
        'li',
        { class: it.bought ? 'shop-item bought' : 'shop-item' },
        h('input', {
          type: 'checkbox',
          checked: it.bought,
          'aria-label': `Koupeno: ${it.name}`,
          onchange: (e) => run(() => patch(`/shopping-items/${it.id}`, { bought: e.target.checked })),
        }),
        h('input', {
          type: 'text',
          class: 'name',
          value: it.name,
          'aria-label': 'Název položky',
          maxlength: 200,
          onchange: (e) => run(() => patch(`/shopping-items/${it.id}`, { name: e.target.value })),
        }),
        h('input', {
          type: 'text',
          inputmode: 'decimal',
          value: formatNumberInput(it.quantity),
          'aria-label': 'Množství',
          onchange: (e) => run(() => patch(`/shopping-items/${it.id}`, { quantity: e.target.value })),
        }),
        h('input', {
          type: 'text',
          inputmode: 'decimal',
          value: formatNumberInput(it.unit_price),
          placeholder: 'cena/ks',
          'aria-label': 'Cena za kus',
          onchange: (e) => run(() => patch(`/shopping-items/${it.id}`, { unit_price: e.target.value.trim() || null })),
        }),
        removeButton(`Smazat položku ${it.name}`, () => run(() => del(`/shopping-items/${it.id}`))),
      );
      return rowEl;
    };

    return h(
      'section',
      { class: 'card section' },
      h('h3', {}, 'Nákupní seznam'),
      items.length
        ? [
            h(
              'div',
              { class: 'shop-item shop-head', 'aria-hidden': 'true' },
              h('span', {}, '✓'),
              h('span', {}, 'Položka'),
              h('span', {}, 'Množství'),
              h('span', {}, 'Cena/ks'),
              h('span'),
            ),
            h('ul', { class: 'item-list' }, items.map(itemRow)),
            h(
              'div',
              { class: 'shop-totals' },
              h('span', {}, `Celkem: ${formatPrice(totals.total)}`),
              h('span', {}, `Zbývá koupit: ${formatPrice(totals.remaining)}`),
            ),
            totals.unpriced_count
              ? h('p', { class: 'muted small' }, `Bez ceny (nezapočteno): ${totals.unpriced_count}`)
              : null,
          ]
        : h('p', { class: 'empty' }, 'Seznam je prázdný.'),
      h(
        'form',
        {
          class: 'form-inline',
          onsubmit: (e) => {
            e.preventDefault();
            if (!name.value.trim()) return;
            const body = { name: name.value, quantity: qty.value.trim() || '1' };
            if (price.value.trim()) body.unit_price = price.value.trim();
            run(() => post(`/tasks/${taskId}/shopping-items`, body));
          },
        },
        name,
        qty,
        price,
        h('button', { type: 'submit', class: 'btn' }, 'Přidat položku'),
      ),
    );
  }

  // --- Navazuje na ---

  function dependenciesSection(candidates) {
    const existing = new Set(task.depends_on.map((d) => d.id));
    const byProject = new Map();
    for (const c of candidates) {
      if (c.id === taskId || existing.has(c.id)) continue;
      if (!byProject.has(c.project_id)) byProject.set(c.project_id, { name: c.project_name, tasks: [] });
      byProject.get(c.project_id).tasks.push(c);
    }
    const select = h(
      'select',
      { 'aria-label': 'Úkol, na který tento navazuje' },
      h('option', { value: '' }, '— vyberte úkol —'),
      [...byProject.values()].map((g) =>
        h('optgroup', { label: g.name }, g.tasks.map((t) => h('option', { value: String(t.id) }, `${t.title} (${STATUS_LABEL[t.status]})`))),
      ),
    );

    return h(
      'section',
      { class: 'card section' },
      h('h3', {}, 'Navazuje na', h('span', { class: 'muted small' }, 'jen upozornění, nic neblokuje')),
      task.depends_on.length
        ? h(
            'ul',
            { class: 'item-list' },
            task.depends_on.map((d) =>
              h(
                'li',
                {},
                statusBadge(d.status),
                h(
                  'span',
                  { class: 'grow' },
                  h('a', { href: `#/ukol/${d.id}` }, d.title),
                  d.project_id !== task.project_id ? h('span', { class: 'muted small' }, ` · ${d.project_name}`) : null,
                ),
                removeButton(`Odebrat návaznost na ${d.title}`, () => run(() => del(`/tasks/${taskId}/dependencies/${d.id}`))),
              ),
            ),
          )
        : h('p', { class: 'empty' }, 'Nenavazuje na žádný úkol.'),
      h(
        'form',
        {
          class: 'form-inline',
          onsubmit: (e) => {
            e.preventDefault();
            if (!select.value) return;
            run(() => post(`/tasks/${taskId}/dependencies`, { depends_on_task_id: Number(select.value) }));
          },
        },
        select,
        h('button', { type: 'submit', class: 'btn' }, 'Přidat'),
      ),
      task.dependents.length
        ? h(
            'div',
            { class: 'small' },
            h('span', { class: 'muted' }, 'Na tento úkol navazuje: '),
            task.dependents.flatMap((d, i) => [i ? ', ' : '', h('a', { href: `#/ukol/${d.id}` }, d.title)]),
          )
        : null,
    );
  }
}

function removeButton(label, onClick) {
  return h('button', { type: 'button', class: 'btn-icon', 'aria-label': label, title: label, onclick: onClick }, '×');
}
