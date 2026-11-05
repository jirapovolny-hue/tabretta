// Tvorba DOM bez innerHTML: texty vždy přes textContent / textové uzly.

/**
 * h('a', { href: '#/', class: 'x', onclick: fn }, 'text', otherNode)
 * Vlastnosti: class, text, dataset, on* (posluchače), hodnoty DOM (value, checked…),
 * ostatní jako atributy. null/undefined/false se vynechá.
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value') el.value = value;
    else if (typeof value === 'boolean' && key in el) el[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of [children].flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

/** Bezpečný odkaz ven: jen http(s), nové okno bez opener/referreru. */
export function externalLink(url, text) {
  const ok = /^https?:\/\//i.test(url);
  return ok
    ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, text)
    : h('span', {}, text);
}

let toastTimer;
export function toast(message, { error = false } = {}) {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: error ? 'toast error' : 'toast', role: error ? 'alert' : 'status' }, message);
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), error ? 5000 : 2000);
}

/** Segmentový přepínač; onChange(value). */
export function segmented(options, current, onChange, label) {
  const wrap = h('div', { class: 'segmented', role: 'group', 'aria-label': label });
  for (const [value, text] of options) {
    wrap.append(
      h('button', {
        type: 'button',
        'aria-pressed': String(value === current),
        onclick: (ev) => {
          for (const b of wrap.children) b.setAttribute('aria-pressed', String(b === ev.currentTarget));
          onChange(value);
        },
      }, text),
    );
  }
  return wrap;
}
