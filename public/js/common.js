// Utilitaires partagés : connexion temps réel, horloge synchronisée, helpers DOM.

export const store = {
  state: null,
  offset: 0, // serverNow - Date.now() : corrige l'horloge du téléphone
  occupiedCourts: [], // terrains déjà pris par un arbitre connecté
  photosVersion: 0, // change quand une photo est ajoutée / retirée
};

const listeners = new Set();
let ws = null;
let retry = 0;
let claim = null; // { court, pin } — rejoué à chaque reconnexion

export function onState(fn) {
  listeners.add(fn);
  if (store.state) fn(store.state);
  return () => listeners.delete(fn);
}

function applyMessage(msg) {
  if (msg.type !== 'state') return;
  store.offset = msg.serverNow - Date.now();
  store.state = msg.state;
  store.occupiedCourts = msg.occupiedCourts || [];
  if (msg.photosVersion != null) store.photosVersion = msg.photosVersion;
  for (const fn of listeners) fn(store.state);
}

/**
 * Réserve un terrain pour cette page : les autres arbitres le verront occupé.
 * La réservation est rejouée après une reconnexion.
 */
export function claimCourt(court, pin) {
  claim = court ? { court, pin } : null;
  if (ws?.readyState === 1) {
    ws.send(JSON.stringify(court ? { type: 'claim-court', court, pin } : { type: 'release-court' }));
  }
}

export function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.addEventListener('open', () => {
    retry = 0;
    setConn('ok', 'en direct');
    if (claim) ws.send(JSON.stringify({ type: 'claim-court', ...claim }));
  });
  ws.addEventListener('message', (e) => {
    try {
      applyMessage(JSON.parse(e.data));
    } catch {
      /* message illisible : on ignore */
    }
  });
  ws.addEventListener('close', () => {
    setConn('ko', 'reconnexion…');
    retry++;
    setTimeout(connect, Math.min(8000, 500 * 2 ** Math.min(retry, 4)));
  });
  ws.addEventListener('error', () => ws.close());
}

function setConn(cls, text) {
  const el = document.querySelector('.conn');
  if (!el) return;
  el.className = `conn ${cls}`;
  el.querySelector('span').textContent = text;
}

/** Heure serveur estimée côté client. */
export function now() {
  return Date.now() + store.offset;
}

export function remainingMs(match, t = now()) {
  if (match.status === 'live' && match.endsAt) return Math.max(0, match.endsAt - t);
  if (match.remainingMs != null) return Math.max(0, match.remainingMs);
  return match.durationSec * 1000;
}

export function fmtClock(ms) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function clockClass(ms, status) {
  if (status === 'live' && ms <= 0) return 'clock over';
  if (status === 'live' && ms <= 60000) return 'clock urgent';
  return 'clock';
}

// ------------------------------------------------------------------ requêtes

export async function api(url, body, headers = {}, method = 'POST') {
  const opts = {
    method,
    headers: { ...headers },
  };
  // Un DELETE n'a pas de corps ; les autres envoient du JSON.
  if (method !== 'DELETE') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body || {});
  }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

// ---------------------------------------------------------------- helpers UI

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null && v !== false) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c) node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

let toastTimer;
export function toast(message, isError = false) {
  let node = document.querySelector('.toast');
  if (!node) {
    node = el('div', { class: 'toast' });
    document.body.append(node);
  }
  node.textContent = message;
  node.className = `toast show${isError ? ' err' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.className = 'toast';
  }, 2600);
}

export function teamName(state, id) {
  if (!id) return '—';
  return state.teams.find((t) => t.id === id)?.name || 'Équipe supprimée';
}

const STAGE_SHORT = { '8e': '8e', quart: 'quart', demi: 'demi', finale: 'finale', petite: 'petite finale' };

/**
 * Nom d'un côté du match. Pour un match de tableau dont l'équipe n'est pas
 * encore connue, affiche d'où elle viendra : « Vainqueur 8e 3 », « Perdant
 * demi 1 »…
 */
export function sideName(state, m, side) {
  const id = side === 'A' ? m.teamAId : m.teamBId;
  if (id) return teamName(state, id);
  const src = side === 'A' ? m.srcA : m.srcB;
  if (src) {
    const from = state.matches.find((x) => x.id === src.matchId);
    if (from) {
      const what = STAGE_SHORT[from.stage] || 'match';
      const num = from.stage === 'finale' ? '' : ` ${(from.slot ?? 0) + 1}`;
      return `${src.take === 'loser' ? 'Perdant' : 'Vainqueur'} ${what}${num}`;
    }
  }
  return '—';
}

export function poolName(state, id) {
  if (!id) return null;
  return state.pools.find((p) => p.id === id)?.name || null;
}

export function matchLabel(state, m) {
  return m.label || poolName(state, m.poolId) || 'Match';
}

/** Les tours remplacent les horaires : « Tour 1 », « Tour 2 »… */
export function roundLabel(m) {
  return `Tour ${(m.round ?? 0) + 1}`;
}

/** Tour en cours : le premier dont tous les matchs ne sont pas clôturés. */
export function currentRound(state) {
  const rounds = [...new Set(state.matches.map((m) => m.round ?? 0))].sort((a, b) => a - b);
  for (const r of rounds) {
    if (state.matches.some((m) => (m.round ?? 0) === r && m.status !== 'finished')) return r;
  }
  return null;
}

/** Avancement du tour en cours, pour savoir quand annoncer le suivant. */
export function roundProgress(state) {
  const round = currentRound(state);
  if (round == null) return null;
  const list = state.matches.filter((m) => (m.round ?? 0) === round);
  return {
    round,
    total: list.length,
    finished: list.filter((m) => m.status === 'finished').length,
    live: list.filter((m) => m.status === 'live' || m.status === 'paused').length,
    pending: list.filter((m) => m.status === 'pending').length,
  };
}

export const isLastPeriod = (m) => (m.period || 1) >= (m.periods || 1);

/** Fin d'une période intermédiaire : changement de côté en cours. */
export const isInterval = (m) =>
  m.status !== 'finished' && m.status !== 'pending' && remainingMs(m) <= 0 && !isLastPeriod(m);

export function statusBadge(m) {
  if (isInterval(m)) {
    // Libellé court : le pied de carte détaille déjà « changement de côté ».
    const text = (m.periods || 1) === 2 ? 'Mi-temps' : `Fin P${m.period}`;
    return el('span', { class: 'badge paused', text });
  }
  if (m.status === 'live') {
    return remainingMs(m) <= 0
      ? el('span', { class: 'badge paused', text: 'Temps écoulé' })
      : el('span', { class: 'badge live', text: 'En direct' });
  }
  if (m.status === 'paused') return el('span', { class: 'badge paused', text: 'Pause' });
  if (m.status === 'finished') return el('span', { class: 'badge finished', text: 'Terminé' });
  return el('span', { class: 'badge', text: 'À venir' });
}

/** « P1 » / « P2 » — n'a de sens que si le match compte plusieurs périodes. */
export function periodBadge(m) {
  if (m.format === 'sets') return null; // la finale n'a pas de périodes
  if ((m.periods || 1) < 2 || m.status === 'finished') return null;
  return el('span', { class: 'badge', text: `P${m.period || 1}/${m.periods}` });
}

/** Rafraîchit tous les chronos affichés, sans re-render complet. */
export function startClockLoop(render) {
  setInterval(() => {
    if (store.state) render(store.state);
  }, 1000);
}

export function setTitle(state) {
  if (!state?.config) return;
  const sub = [state.config.subtitle, state.config.date].filter(Boolean).join(' · ');
  // querySelectorAll : le nom apparaît à plusieurs endroits (en-tête + mode écran géant).
  for (const n of document.querySelectorAll('[data-tournament-name]')) {
    n.textContent = state.config.name;
  }
  for (const n of document.querySelectorAll('[data-tournament-sub]')) {
    n.textContent = sub;
  }
}
