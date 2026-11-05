import { h, segmented } from '../dom.js';
import { get, post } from '../api.js';
import { getPref, setPref } from '../prefs.js';
import { KINDS, kindBadge } from '../labels.js';
import { errorView, overviewToolbar, quickAddInput, taskRow } from '../components.js';

/** Hlavní obrazovka: projekty pod sebou, v každém jeho úkoly. */
export async function homeView(container) {
  const list = h('div', { class: 'stack' });

  // Rychlé přidání projektu: druh se předvyplní podle filtru, při „Vše“ poslední použitý.
  let newKind = defaultKind();
  const kindHolder = h('span');
  const renderKindSwitch = () => {
    kindHolder.replaceChildren(
      segmented(KINDS, newKind, (value) => {
        newKind = value;
        setPref('lastKind', value);
      }, 'Druh nového projektu'),
    );
  };
  renderKindSwitch();

  const addProject = quickAddInput({
    placeholder: 'Nový projekt…',
    label: 'Název nového projektu',
    extra: kindHolder,
    onSubmit: async (name) => {
      await post('/projects', { name, kind: newKind });
      setPref('lastKind', newKind);
      await load();
    },
  });

  container.replaceChildren(
    overviewToolbar({
      active: 'home',
      onFilter: () => {
        newKind = defaultKind();
        renderKindSwitch();
        load();
      },
      onShowDone: () => load(),
    }),
    h('section', { class: 'card', 'aria-label': 'Nový projekt' }, addProject),
    list,
  );

  async function load() {
    const filter = getPref('filter');
    const kindQuery = filter === 'vse' ? '' : `kind=${filter}`;
    const doneQuery = getPref('showDone') ? 'include_done=1' : '';
    try {
      const [projects, tasks] = await Promise.all([
        get(`/projects?${kindQuery}`),
        get(`/tasks?${[kindQuery, doneQuery].filter(Boolean).join('&')}`),
      ]);
      const byProject = new Map(projects.map((p) => [p.id, []]));
      for (const t of tasks) byProject.get(t.project_id)?.push(t);
      list.replaceChildren(
        ...(projects.length
          ? projects.map((p) => projectCard(p, byProject.get(p.id), filter === 'vse'))
          : [h('p', { class: 'empty' }, 'Zatím tu nejsou žádné projekty. Založte první výše.')]),
      );
    } catch (err) {
      list.replaceChildren(errorView(err));
    }
  }

  await load();
}

function defaultKind() {
  const filter = getPref('filter');
  return filter === 'vse' ? getPref('lastKind') : filter;
}

function projectCard(project, tasks, showKind) {
  const ul = h('ul', { class: 'task-list' }, tasks.map((t) => taskRow(t)));
  const empty = h('p', { class: 'empty', hidden: tasks.length > 0 }, 'Žádné úkoly k zobrazení.');
  return h(
    'section',
    { class: 'card' },
    h(
      'div',
      { class: 'project-head' },
      h('h2', {}, h('a', { href: `#/projekt/${project.id}` }, project.name)),
      showKind ? kindBadge(project.kind) : null,
    ),
    ul,
    empty,
    quickAddInput({
      placeholder: 'Nový úkol…',
      label: `Nový úkol v projektu ${project.name}`,
      onSubmit: async (title) => {
        const task = await post(`/projects/${project.id}/tasks`, { title });
        ul.append(taskRow({ ...task, waiting_on: [] }));
        empty.hidden = true;
      },
    }),
  );
}
