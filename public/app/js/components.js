import { h, segmented, toast } from './dom.js';
import { getPref, setPref } from './prefs.js';
import { dueBadge, statusBadge, waitingBadges } from './labels.js';

export const FILTERS = [
  ['vse', 'Vše'],
  ['prace', 'Práce'],
  ['soukrome', 'Soukromé'],
];

/** Řádek úkolu v seznamu: název, stav, termín, „čeká na“, případně projekt. */
export function taskRow(task, { showProject = false } = {}) {
  return h(
    'li',
    { class: task.status === 'hotovo' ? 'task-row done' : 'task-row' },
    h('a', { class: 'title', href: `#/ukol/${task.id}` }, task.title),
    h(
      'span',
      { class: 'meta' },
      showProject ? h('a', { class: 'project-name', href: `#/projekt/${task.project_id}` }, task.project_name) : null,
      statusBadge(task.status),
      dueBadge(task.due_date, task.status),
      waitingBadges(task.waiting_on),
    ),
  );
}

/**
 * Horní panel přehledu: filtr Vše/Práce/Soukromé, přepínač Projekty/Rozdělané,
 * volitelně „Zobrazit hotové“ a odkaz na archiv.
 */
export function overviewToolbar({ active, onFilter, onShowDone }) {
  const filter = getPref('filter');
  return h(
    'div',
    { class: 'toolbar' },
    segmented(FILTERS, filter, (value) => {
      setPref('filter', value);
      onFilter(value);
    }, 'Filtr projektů'),
    h(
      'div',
      { class: 'segmented', role: 'group', 'aria-label': 'Pohled' },
      h('a', { class: 'btn', href: '#/', 'aria-current': active === 'home' ? 'page' : null }, 'Projekty'),
      h('a', { class: 'btn', href: '#/rozdelane', 'aria-current': active === 'rozdelane' ? 'page' : null }, 'Rozdělané'),
    ),
    onShowDone
      ? h(
          'label',
          { class: 'toggle' },
          h('input', {
            type: 'checkbox',
            checked: getPref('showDone'),
            onchange: (e) => {
              setPref('showDone', e.target.checked);
              onShowDone(e.target.checked);
            },
          }),
          'Zobrazit hotové',
        )
      : null,
    h('a', { class: 'btn btn-small', href: '#/archiv' }, 'Archiv'),
  );
}

/**
 * Jedno textové pole: Enter vytvoří záznam. onSubmit(text) vrací Promise;
 * pole se po úspěchu vyprázdní a zůstane v něm kurzor (rychlé zadávání).
 */
export function quickAddInput({ placeholder, label, onSubmit, extra = null }) {
  const input = h('input', { type: 'text', placeholder, 'aria-label': label, enterkeyhint: 'done', maxlength: 500 });
  const form = h(
    'form',
    {
      class: 'quick-add',
      onsubmit: async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.disabled = true;
        try {
          await onSubmit(text);
          input.value = '';
        } catch (err) {
          toast(err.message, { error: true });
        } finally {
          input.disabled = false;
          input.focus();
        }
      },
    },
    input,
    extra,
    h('button', { type: 'submit', class: 'btn' }, 'Přidat'),
  );
  return form;
}

export function errorView(err) {
  return h('p', { class: 'error', role: 'alert' }, err.message || 'Něco se pokazilo.');
}
