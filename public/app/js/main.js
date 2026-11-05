import { h } from './dom.js';
import { post } from './api.js';
import { errorView } from './components.js';
import { homeView } from './views/home.js';
import { inProgressView } from './views/inprogress.js';
import { archiveView } from './views/archive.js';
import { projectView } from './views/project.js';
import { taskView } from './views/task.js';

// Jednoduchý router nad #hash: #/, #/rozdelane, #/archiv, #/projekt/ID, #/ukol/ID
const ROUTES = [
  [/^#?\/?$/, homeView],
  [/^#\/rozdelane$/, inProgressView],
  [/^#\/archiv$/, archiveView],
  [/^#\/projekt\/(\d+)$/, projectView],
  [/^#\/ukol\/(\d+)$/, taskView],
];

const main = document.getElementById('view');

export function navigate(hash) {
  if (window.location.hash === hash) render();
  else window.location.hash = hash;
}

async function render() {
  const hash = window.location.hash;
  const route = ROUTES.find(([re]) => re.test(hash));
  // Každé zobrazení dostane nový kontejner; starý (pomalé načítání) se zahodí.
  const container = h('div', { class: 'stack' }, h('p', { class: 'loading' }, 'Načítám…'));
  main.className = 'app';
  main.replaceChildren(container);
  if (!route) {
    container.replaceChildren(h('p', {}, 'Stránka neexistuje. ', h('a', { href: '#/' }, 'Zpět na přehled')));
    return;
  }
  const [re, view] = route;
  const params = hash.match(re).slice(1);
  try {
    await view(container, { params, navigate, main });
  } catch (err) {
    if (err.status === 401) return;
    container.replaceChildren(errorView(err), h('p', {}, h('a', { href: '#/' }, 'Zpět na přehled')));
  }
  window.scrollTo(0, 0);
}

document.getElementById('logout').addEventListener('click', async () => {
  try {
    await post('/logout');
  } finally {
    window.location.replace('/login');
  }
});

window.addEventListener('hashchange', render);
render();
