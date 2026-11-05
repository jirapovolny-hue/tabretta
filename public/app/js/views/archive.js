import { h, toast } from '../dom.js';
import { get, patch } from '../api.js';
import { kindBadge } from '../labels.js';

/** Archivované projekty s možností obnovení. */
export async function archiveView(container) {
  const projects = await get('/projects?archived=1');
  const ul = h('ul', { class: 'item-list' });
  const empty = h('p', { class: 'empty', hidden: projects.length > 0 }, 'Archiv je prázdný.');

  for (const p of projects) {
    const li = h(
      'li',
      {},
      h('span', { class: 'grow' }, h('a', { href: `#/projekt/${p.id}` }, p.name), ' ', kindBadge(p.kind)),
      h('button', {
        type: 'button',
        class: 'btn btn-small',
        onclick: async () => {
          try {
            await patch(`/projects/${p.id}`, { archived: false });
            li.remove();
            empty.hidden = ul.children.length > 0;
            toast(`Projekt „${p.name}“ je zpět v přehledu.`);
          } catch (err) {
            toast(err.message, { error: true });
          }
        },
      }, 'Obnovit'),
    );
    ul.append(li);
  }

  container.replaceChildren(
    h('a', { class: 'back', href: '#/' }, '← Přehled'),
    h('section', { class: 'card stack' }, h('h2', {}, 'Archiv projektů'), ul, empty),
  );
}
