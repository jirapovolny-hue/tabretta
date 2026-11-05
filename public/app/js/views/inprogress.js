import { h } from '../dom.js';
import { get } from '../api.js';
import { getPref } from '../prefs.js';
import { errorView, overviewToolbar, taskRow } from '../components.js';

/** Rychlý pohled: všechny úkoly ve stavu Rozdělané napříč projekty. */
export async function inProgressView(container) {
  const list = h('div');
  container.replaceChildren(
    overviewToolbar({ active: 'rozdelane', onFilter: () => load() }),
    h('section', { class: 'card stack' }, h('h2', {}, 'Rozdělané'), list),
  );

  async function load() {
    const filter = getPref('filter');
    try {
      const tasks = await get(`/tasks?status=rozdelane${filter === 'vse' ? '' : `&kind=${filter}`}`);
      list.replaceChildren(
        tasks.length
          ? h('ul', { class: 'task-list' }, tasks.map((t) => taskRow(t, { showProject: true })))
          : h('p', { class: 'empty' }, 'Nic rozdělaného.'),
      );
    } catch (err) {
      list.replaceChildren(errorView(err));
    }
  }

  await load();
}
