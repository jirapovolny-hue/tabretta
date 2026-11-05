import { h, segmented, toast } from '../dom.js';
import { del, get, patch, post } from '../api.js';
import { getPref, setPref } from '../prefs.js';
import { KINDS, STATUSES, dueBadge, kindBadge, waitingBadges } from '../labels.js';
import { errorView, quickAddInput, taskRow } from '../components.js';

// Přetahování jen u myši; na dotyku se stav mění nabídkou na kartě
// (HTML5 drag and drop na dotykových zařízeních nefunguje spolehlivě).
const canDrag = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

export async function projectView(container, { params, navigate, main }) {
  const projectId = Number(params[0]);
  let project = await get(`/projects/${projectId}`);
  let mode = getPref('projectView');

  const head = h('div', { class: 'page-head' });
  const body = h('div', { class: 'stack' });
  const doneToggle = h(
    'label',
    { class: 'toggle' },
    h('input', {
      type: 'checkbox',
      checked: getPref('showDone'),
      onchange: (e) => {
        setPref('showDone', e.target.checked);
        load();
      },
    }),
    'Zobrazit hotové',
  );

  const toolbar = h(
    'div',
    { class: 'toolbar' },
    segmented([['seznam', 'Seznam'], ['kanban', 'Kanban']], mode, (value) => {
      mode = value;
      setPref('projectView', value);
      load();
    }, 'Zobrazení'),
    doneToggle,
  );

  const addTask = quickAddInput({
    placeholder: 'Nový úkol…',
    label: 'Nový úkol',
    onSubmit: async (title) => {
      await post(`/projects/${projectId}/tasks`, { title });
      await load();
    },
  });

  container.replaceChildren(
    h('a', { class: 'back', href: project.archived ? '#/archiv' : '#/' }, project.archived ? '← Archiv' : '← Přehled'),
    head,
    toolbar,
    h('section', { class: 'card', 'aria-label': 'Nový úkol' }, addTask),
    body,
  );
  renderHead();
  await load();

  function renderHead() {
    head.replaceChildren(
      h(
        'div',
        { class: 'row' },
        h('h2', { class: 'grow' }, project.name),
        kindBadge(project.kind),
        project.archived ? h('span', { class: 'badge' }, 'Archivováno') : null,
      ),
      project.description ? h('p', { class: 'description' }, project.description) : null,
      h(
        'div',
        { class: 'row' },
        h('button', { type: 'button', class: 'btn btn-small', onclick: () => head.replaceChildren(editForm()) }, 'Upravit projekt'),
        h('button', { type: 'button', class: 'btn btn-small btn-danger', onclick: deleteProject }, 'Smazat projekt'),
      ),
    );
  }

  function editForm() {
    const name = h('input', { type: 'text', value: project.name, required: true, maxlength: 200 });
    const kind = h('select', {}, KINDS.map(([v, t]) => h('option', { value: v, selected: v === project.kind }, t)));
    const description = h('textarea', { value: project.description, maxlength: 20000 });
    const archived = h('input', { type: 'checkbox', checked: project.archived });
    return h(
      'form',
      {
        class: 'card stack',
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            project = await patch(`/projects/${projectId}`, {
              name: name.value,
              kind: kind.value,
              description: description.value,
              archived: archived.checked,
            });
            toast('Projekt uložen.');
            renderHead();
          } catch (err) {
            toast(err.message, { error: true });
          }
        },
      },
      h('label', { class: 'field' }, h('span', {}, 'Název'), name),
      h('label', { class: 'field' }, h('span', {}, 'Druh'), kind),
      h('label', { class: 'field' }, h('span', {}, 'Popis'), description),
      h('label', { class: 'toggle' }, archived, 'Archivovat (skrýt z přehledu)'),
      h(
        'div',
        { class: 'row' },
        h('button', { type: 'submit', class: 'btn btn-primary' }, 'Uložit'),
        h('button', { type: 'button', class: 'btn', onclick: renderHead }, 'Zrušit'),
      ),
    );
  }

  async function deleteProject() {
    const ok = window.confirm(`Opravdu smazat projekt „${project.name}“ včetně všech jeho úkolů, odkazů, nákupních seznamů a příloh? Tuto akci nelze vrátit.`);
    if (!ok) return;
    try {
      await del(`/projects/${projectId}`);
      toast('Projekt smazán.');
      navigate('#/');
    } catch (err) {
      toast(err.message, { error: true });
    }
  }

  async function load() {
    const kanban = mode === 'kanban';
    main.classList.toggle('wide', kanban);
    doneToggle.hidden = kanban; // kanban má sloupec Hotovo vždy
    const includeDone = kanban || getPref('showDone');
    try {
      const tasks = await get(`/tasks?project_id=${projectId}${includeDone ? '&include_done=1' : ''}`);
      body.replaceChildren(kanban ? kanbanBoard(tasks) : listView(tasks));
    } catch (err) {
      body.replaceChildren(errorView(err));
    }
  }

  function listView(tasks) {
    return h(
      'section',
      { class: 'card' },
      tasks.length
        ? h('ul', { class: 'task-list' }, tasks.map((t) => taskRow(t)))
        : h('p', { class: 'empty' }, 'Žádné úkoly k zobrazení.'),
    );
  }

  function kanbanBoard(tasks) {
    const drag = canDrag();
    const columns = new Map();
    const board = h('div', { class: 'kanban' });

    for (const [status, label] of STATUSES) {
      const list = h('div', { class: 'stack' });
      const count = h('span', { class: 'badge' });
      const col = h('section', { class: 'kanban-col', 'aria-label': label, dataset: { status } }, h('h3', {}, label, count), list);
      columns.set(status, { col, list, count });
      if (drag) {
        col.addEventListener('dragover', (e) => {
          e.preventDefault();
          col.classList.add('drop-target');
        });
        col.addEventListener('dragleave', (e) => {
          if (!col.contains(e.relatedTarget)) col.classList.remove('drop-target');
        });
        col.addEventListener('drop', (e) => {
          e.preventDefault();
          col.classList.remove('drop-target');
          const id = Number(e.dataTransfer.getData('text/plain'));
          const card = board.querySelector(`[data-task-id="${id}"]`);
          if (card && card.dataset.status !== status) changeStatus(card, status);
        });
      }
      board.append(col);
    }

    const updateCounts = () => {
      for (const { list, count } of columns.values()) count.textContent = String(list.children.length);
    };

    async function changeStatus(card, status) {
      const previous = card.dataset.status;
      moveCard(card, status);
      try {
        await patch(`/tasks/${card.dataset.taskId}`, { status });
      } catch (err) {
        moveCard(card, previous);
        toast(err.message, { error: true });
      }
    }

    function moveCard(card, status) {
      card.dataset.status = status;
      card.querySelector('select').value = status;
      columns.get(status).list.append(card);
      updateCounts();
    }

    for (const t of tasks) {
      const select = h(
        'select',
        { 'aria-label': `Stav úkolu ${t.title}`, onchange: (e) => changeStatus(card, e.target.value) },
        STATUSES.map(([v, label]) => h('option', { value: v, selected: v === t.status }, label)),
      );
      const card = h(
        'article',
        { class: 'kanban-card', draggable: drag ? 'true' : null, dataset: { taskId: String(t.id), status: t.status } },
        h('a', { href: `#/ukol/${t.id}` }, t.title),
        h('div', { class: 'row' }, dueBadge(t.due_date, t.status), waitingBadges(t.waiting_on)),
        select,
      );
      if (drag) {
        card.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', String(t.id));
          e.dataTransfer.effectAllowed = 'move';
          card.classList.add('dragging');
        });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
      }
      (columns.get(t.status) ?? columns.get('k_udelani')).list.append(card);
    }
    updateCounts();
    return board;
  }
}
