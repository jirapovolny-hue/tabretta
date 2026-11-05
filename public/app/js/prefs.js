// Volby pamatované v prohlížeči (filtr, zobrazení hotových, Seznam/Kanban).
// localStorage může být nedostupné (soukromé okno), proto vše v try/catch.

const PREFIX = 'tabretta.';

const DEFAULTS = {
  filter: 'vse', // vse | prace | soukrome
  showDone: false,
  projectView: 'seznam', // seznam | kanban
  lastKind: 'prace',
};

const ALLOWED = {
  filter: ['vse', 'prace', 'soukrome'],
  projectView: ['seznam', 'kanban'],
  lastKind: ['prace', 'soukrome'],
};

export function getPref(key) {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return DEFAULTS[key];
    const value = JSON.parse(raw);
    if (ALLOWED[key] && !ALLOWED[key].includes(value)) return DEFAULTS[key];
    if (typeof value !== typeof DEFAULTS[key]) return DEFAULTS[key];
    return value;
  } catch {
    return DEFAULTS[key];
  }
}

export function setPref(key, value) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // nevadí, volba se jen nezapamatuje
  }
}
