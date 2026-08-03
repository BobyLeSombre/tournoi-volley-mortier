// Interface arbitre : sélection du match, saisie des points, chrono, validation.
// Le serveur fait autorité : chaque action est un appel API, l'affichage suit
// l'état diffusé en WebSocket (donc deux arbitres sur le même match restent
// synchronisés).

import {
  connect,
  onState,
  store,
  api,
  claimCourt,
  el,
  toast,
  remainingMs,
  fmtClock,
  teamName,
  sideName,
  matchLabel,
  roundLabel,
  statusBadge,
  setTitle,
} from './common.js';

const PIN_KEY = 'volley.refPin';
const COURT_KEY = 'volley.refCourt';

const gate = document.getElementById('gate');
const who = document.getElementById('who');
const picker = document.getElementById('picker');
const board = document.getElementById('board');
const backLink = document.getElementById('back-list');

// Le QR code mène à la page de connexion, sans jamais transporter le code :
// une affiche photographiée par un joueur ne donne aucun accès à la saisie.
const params = new URLSearchParams(location.search);

let pin = localStorage.getItem(PIN_KEY) || '';
let authed = false;
let selectedId = params.get('match') || null;
// Terrain choisi par l'arbitre sur CE téléphone. Aucune affectation côté
// serveur : ce n'est pas forcément la même personne d'un match à l'autre.
let courtFilter = localStorage.getItem(COURT_KEY) || '';
let confirming = false;

// ------------------------------------------------------------------- accès

document.getElementById('pin-submit').addEventListener('click', submitPin);
document.getElementById('pin').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitPin();
});

async function submitPin() {
  const value = document.getElementById('pin').value.trim();
  try {
    const res = await api('/api/auth/referee', { pin: value });
    if (!res.ok) return toast('Code incorrect', true);
    pin = value;
    localStorage.setItem(PIN_KEY, pin);
    authed = true;
    if (courtFilter) claimCourt(courtFilter, pin);
    render(store.state);
  } catch (err) {
    toast(err.message, true);
  }
}

async function checkStoredPin() {
  if (!pin) return;
  try {
    const res = await api('/api/auth/referee', { pin });
    authed = !!res.ok;
    if (!authed) localStorage.removeItem(PIN_KEY);
  } catch {
    /* hors ligne : on laisse la porte fermée, le PIN sera revalidé */
  }
}

// ------------------------------------------------------------------ actions

async function send(path, body) {
  try {
    await api(path, body, { 'x-ref-pin': pin });
  } catch (err) {
    toast(err.message, true);
  }
}

const addPoint = (m, team, delta) =>
  send(`/api/ref/match/${m.id}/score`, { team, delta });
const timer = (m, action, seconds) =>
  send(`/api/ref/match/${m.id}/timer`, { action, seconds });

function selectMatch(id) {
  selectedId = id;
  confirming = false;
  const url = new URL(location.href);
  if (id) url.searchParams.set('match', id);
  else url.searchParams.delete('match');
  history.replaceState(null, '', url);
  render(store.state);
  window.scrollTo(0, 0);
}

backLink.addEventListener('click', (e) => {
  e.preventDefault();
  selectMatch(null);
});

// ------------------------------------------------------- choix du terrain

/** Match à arbitrer maintenant sur ce terrain : le 1er non terminé. */
function currentMatchOn(state, court) {
  return state.matches.find((m) => m.court === court && m.status !== 'finished') || null;
}

function chooseCourt(state, court) {
  courtFilter = court;
  localStorage.setItem(COURT_KEY, court);
  claimCourt(court, pin); // les autres arbitres verront ce terrain occupé
  const next = currentMatchOn(state, court);
  if (next) selectMatch(next.id);
  else render(state);
}

function forgetCourt() {
  courtFilter = '';
  localStorage.removeItem(COURT_KEY);
  claimCourt(null); // on rend la main : le terrain redevient disponible
  selectMatch(null);
}

/** Terrain déjà tenu par un autre arbitre connecté. */
function courtTaken(court) {
  return store.occupiedCourts.includes(court) && court !== courtFilter;
}

/** Écran d'accueil : une tuile par terrain, avec le match du moment. */
function renderCourts(state) {
  const tiles = state.config.courts.map((court) => {
    const m = currentMatchOn(state, court);
    const live = m && (m.status === 'live' || m.status === 'paused');
    const pris = courtTaken(court);

    return el(
      'button',
      {
        class: `court-tile${live ? ' is-live' : ''}${pris ? ' is-taken' : ''}`,
        disabled: pris,
        title: pris ? 'Un arbitre est déjà en place sur ce terrain' : null,
        onClick: pris ? null : () => chooseCourt(state, court),
      },
      [
        el('span', { class: 'court-tile-name', text: court }),
        m
          ? el('span', { class: 'court-tile-match' }, [
              `${sideName(state, m, 'A')} vs ${sideName(state, m, 'B')}`,
              el('em', { text: `${roundLabel(m)} · ${matchLabel(state, m)}` }),
            ])
          : el('span', { class: 'court-tile-match' }, [
              el('em', { text: 'plus aucun match' }),
            ]),
        pris
          ? el('span', { class: 'court-tile-lock', text: '🔒 Arbitre en place' })
          : live
            ? el('span', { class: 'court-tile-score', text: `${m.scoreA} – ${m.scoreB}` })
            : m
              ? statusBadge(m)
              : null,
      ]
    );
  });

  const libres = state.config.courts.filter((c) => !courtTaken(c)).length;

  who.replaceChildren(
    el('div', { class: 'page-head', style: 'padding:22px 0 16px' }, [
      el('h1', { text: 'Quel terrain ?' }),
      el('p', {
        text: libres
          ? "Prends le terrain que l'organisation t'a indiqué. Ceux qui ont déjà un arbitre sont verrouillés."
          : "Tous les terrains ont déjà un arbitre — rapproche-toi de l'organisation.",
      }),
    ]),
    el('div', { class: 'court-grid' }, tiles)
  );
}

/** Bandeau rappelant le terrain en cours, avec le moyen d'en changer. */
function courtBar() {
  if (!courtFilter) return null;
  return el('div', { class: 'me-bar' }, [
    el('strong', { text: courtFilter }),
    el('button', { text: 'changer de terrain', onClick: forgetCourt }),
  ]);
}

// ------------------------------------------------------- liste des matchs

function renderPicker(state) {
  const matches = state.matches.filter((m) => !courtFilter || m.court === courtFilter);
  const groups = [
    ['En cours', matches.filter((m) => m.status === 'live' || m.status === 'paused')],
    ['À venir', matches.filter((m) => m.status === 'pending')],
    ['Terminés', matches.filter((m) => m.status === 'finished').reverse()],
  ];

  const out = [
    el('div', { class: 'page-head', style: 'padding:22px 0 14px' }, [
      el('h1', { text: courtFilter || 'Choisis ton match' }),
      el('p', { text: 'Touche le match que tu arbitres.' }),
      courtBar(),
    ]),
  ];

  let any = false;
  for (const [title, list] of groups) {
    if (!list.length) continue;
    any = true;
    out.push(
      el('div', { class: 'section-title' }, [
        el('h2', { text: title }),
        el('span', { text: `${list.length}` }),
      ])
    );
    out.push(
      el(
        'div',
        { class: 'card' },
        list.map((m) =>
          el('button', { class: 'picker-item', onClick: () => selectMatch(m.id) }, [
            el('span', { class: 'time', text: roundLabel(m) }),
            el('span', { class: 'names' }, [
              `${sideName(state, m, 'A')} vs ${sideName(state, m, 'B')}`,
              el('em', { text: `${m.court} · ${matchLabel(state, m)}` }),
            ]),
            m.status === 'finished'
              ? el('span', { class: 'final-score', text: `${m.scoreA}–${m.scoreB}` })
              : statusBadge(m),
          ])
        )
      )
    );
  }

  if (!any) {
    out.push(el('div', { class: 'empty' }, ["Aucun match sur ce terrain pour l'instant."]));
  }

  picker.replaceChildren(...out);
}

// -------------------------------------------------------- tableau de marque

function renderBoard(state, m) {
  const left = remainingMs(m);
  const timeUp = m.status === 'live' && left <= 0;
  const finished = m.status === 'finished';
  const running = m.status === 'live';

  const context = el('div', { class: 'match-context' }, [
    el('span', { class: 'badge', text: m.court }),
    el('span', { class: 'who', text: matchLabel(state, m) }),
    el('span', { class: 'badge', text: roundLabel(m) }),
    statusBadge(m),
  ]);

  // Match de tableau dont les qualifiés ne sont pas encore connus : rien à
  // arbitrer pour l'instant.
  if (!m.teamAId || !m.teamBId) {
    board.replaceChildren(
      context,
      el('div', { class: 'empty' }, [
        `${sideName(state, m, 'A')} contre ${sideName(state, m, 'B')} — en attente des résultats précédents.`,
      ])
    );
    return;
  }

  const side = (team) => {
    const name = teamName(state, team === 'A' ? m.teamAId : m.teamBId);
    const score = team === 'A' ? m.scoreA : m.scoreB;
    return el('div', { class: 'team-panel' }, [
      el('div', { class: 'label', text: name }),
      el('button', {
        class: 'plus',
        text: String(score),
        disabled: finished,
        onClick: () => {
          if (navigator.vibrate) navigator.vibrate(12);
          addPoint(m, team, 1);
        },
      }),
      // Sur un match validé, la correction passe par « Corriger le résultat ».
      finished
        ? null
        : el('button', {
            class: 'minus',
            text: '− retirer 1 point',
            onClick: () => addPoint(m, team, -1),
          }),
    ]);
  };

  // Fin d'une période intermédiaire : l'action principale devient « période
  // suivante », pour ne pas qu'un arbitre clôture le match à la mi-temps.
  const interval = timeUp && !isLastPeriod(m) && !finished;

  const timerBox = el('div', { class: `timer-box${interval ? ' interval' : ''}` }, [
    el('div', { class: 'period-pill', text: periodLabel(m) }),
    el('div', { id: 'big-clock', class: clockClassFor(m), text: fmtClock(left) }),
    el('div', { id: 'board-state', class: 'state', text: stateTextFor(m) }),
    finished
      ? null
      : el('div', { class: 'timer-actions' }, [
          interval
            ? el('button', {
                class: 'btn xl primary wide',
                text: `▶ Démarrer la période ${m.period + 1}`,
                onClick: () => timer(m, 'next-period'),
              })
            : running
              ? el('button', { class: 'btn xl', text: '⏸ Pause', onClick: () => timer(m, 'pause') })
              : el('button', {
                  class: 'btn xl go',
                  text: m.status === 'pending' ? '▶ Démarrer' : '▶ Reprendre',
                  onClick: () => timer(m, 'start'),
                }),
          el('button', { class: 'btn xl', text: '+1 min', onClick: () => timer(m, 'add', 60) }),
          el('button', {
            class: 'btn xl ghost wide',
            text: '↺ Remettre à zéro',
            onClick: () => {
              if (confirm(`Remettre le chrono de la période ${m.period} à zéro ?`)) {
                timer(m, 'reset');
              }
            },
          }),
          // Filet de sécurité si l'arbitre a lancé la période suivante trop tôt.
          (m.period || 1) > 1 && !finished
            ? el('button', {
                class: 'btn xl ghost wide',
                text: `↩ Revenir à la période ${m.period - 1}`,
                onClick: () => {
                  if (confirm(`Revenir à la période ${m.period - 1} ?`)) {
                    timer(m, 'previous-period');
                  }
                },
              })
            : null,
        ]),
  ]);

  const out = [
    context,
    timerBox,
    el('div', { class: 'scoreboard' }, [side('A'), side('B')]),
    finished
      ? null
      : el('div', { class: 'tap-hint', text: 'Touche le score pour ajouter un point' }),
  ];

  if (finished) {
    const winner =
      m.winnerId === 'draw' ? 'Match nul' : `Vainqueur : ${teamName(state, m.winnerId)}`;
    out.push(
      el('div', { class: 'confirm-box' }, [
        el('p', { class: 'win', text: winner }),
        el('div', { class: 'row', style: 'justify-content:center' }, [
          nextMatchButton(state, m),
          el('button', {
            class: 'btn',
            text: 'Corriger le résultat',
            onClick: () => send(`/api/ref/match/${m.id}/reopen`, {}),
          }),
          // L'arbitre suivant n'est pas forcément le même : il peut rendre
          // la main ou passer sur un autre terrain d'un geste.
          el('button', { class: 'btn ghost', text: 'Changer de terrain', onClick: forgetCourt }),
        ]),
      ])
    );
  } else if (confirming) {
    const winner =
      m.scoreA > m.scoreB
        ? teamName(state, m.teamAId)
        : m.scoreB > m.scoreA
          ? teamName(state, m.teamBId)
          : null;
    out.push(
      el('div', { class: 'confirm-box' }, [
        el('p', {}, [
          `Valider le score final ${m.scoreA} – ${m.scoreB} ? `,
          el('span', {
            class: 'win',
            text: winner ? `${winner} l'emporte.` : 'Match nul.',
          }),
          isLastPeriod(m)
            ? null
            : el('span', {
                style: 'display:block;margin-top:8px;font-weight:650;color:var(--warn)',
                text: `Attention : la période ${m.period} sur ${m.periods} est en cours.`,
              }),
        ]),
        el('div', { class: 'row', style: 'justify-content:center' }, [
          el('button', {
            class: 'btn primary',
            text: 'Oui, terminer le match',
            onClick: async () => {
              confirming = false;
              await send(`/api/ref/match/${m.id}/finish`, {});
              toast('Résultat enregistré ✓');
            },
          }),
          el('button', {
            class: 'btn ghost',
            text: 'Annuler',
            onClick: () => {
              confirming = false;
              render(store.state);
            },
          }),
        ]),
      ])
    );
  } else {
    // Avant la dernière période, terminer le match reste possible (forfait,
    // abandon) mais ne doit pas être le bouton le plus tentant.
    const last = isLastPeriod(m);
    out.push(
      el('div', { class: 'finish-row' }, [
        el('button', {
          class: last ? 'btn primary xl' : 'btn xl ghost',
          text: last ? '✓ Terminer le match' : 'Terminer le match maintenant',
          onClick: () => {
            // Un match à élimination ne peut pas finir sur une égalité.
            if (m.stage && m.scoreA === m.scoreB) {
              return toast('Égalité — point en or : le prochain point décide', true);
            }
            confirming = true;
            render(store.state);
          },
        }),
      ])
    );
  }

  board.replaceChildren(...out.filter(Boolean));
}

function clockClassFor(m) {
  const left = remainingMs(m);
  if (m.status === 'live' && left <= 0) return 'big-clock over';
  if (m.status === 'live' && left <= 60000) return 'big-clock urgent';
  return 'big-clock';
}

const isLastPeriod = (m) => (m.period || 1) >= (m.periods || 1);
const periodLabel = (m) => `Période ${m.period || 1} / ${m.periods || 1}`;

function stateTextFor(m) {
  const left = remainingMs(m);
  if (m.status === 'finished') return 'Match terminé';
  if (left <= 0 && m.status !== 'pending') {
    if (isLastPeriod(m) && m.stage && m.scoreA === m.scoreB) {
      return 'Égalité — point en or : le prochain point décide';
    }
    return isLastPeriod(m)
      ? 'Temps écoulé — termine le point en cours'
      : `Fin de la période ${m.period} — changement de côté`;
  }
  if (m.status === 'live') return `${periodLabel(m)} · chrono en marche`;
  if (m.status === 'paused') return `${periodLabel(m)} · chrono en pause`;
  return `${periodLabel(m)} · pas encore commencée`;
}

/**
 * Tick d'affichage : ne touche QUE le chrono, jamais les boutons.
 * Un re-render complet chaque seconde pourrait avaler l'appui de l'arbitre
 * au moment précis où il marque un point.
 */
function tickClock() {
  const state = store.state;
  if (!state || !selectedId) return;
  const m = state.matches.find((x) => x.id === selectedId);
  if (!m) return;
  const clock = document.getElementById('big-clock');
  const label = document.getElementById('board-state');
  if (!clock) return;
  clock.textContent = fmtClock(remainingMs(m));
  clock.className = clockClassFor(m);
  if (label) label.textContent = stateTextFor(m);
}

function nextMatchButton(state, current) {
  const next = state.matches.find(
    (m) => m.court === current.court && m.status === 'pending' && m.order > current.order
  );
  if (!next) return null;
  return el('button', {
    class: 'btn primary',
    text: 'Match suivant →',
    onClick: () => selectMatch(next.id),
  });
}

// ------------------------------------------------------------------- rendu

function render(state) {
  if (!state) return;
  setTitle(state);

  const match = selectedId ? state.matches.find((m) => m.id === selectedId) : null;
  if (selectedId && !match) selectedId = null; // match supprimé par l'admin

  // Le terrain mémorisé a pu être renommé ou supprimé par l'organisation.
  if (courtFilter && !state.config.courts.includes(courtFilter)) courtFilter = '';

  // Tant qu'aucun terrain n'est choisi, on affiche la grille des terrains.
  const needsCourt = authed && !courtFilter && !match;

  gate.hidden = authed;
  who.hidden = !needsCourt;
  picker.hidden = !authed || needsCourt || !!match;
  board.hidden = !authed || !match;
  backLink.hidden = !authed || !match;

  if (!authed) return;
  if (match) renderBoard(state, match);
  else if (needsCourt) renderCourts(state);
  else renderPicker(state);
}

onState(render);
setInterval(tickClock, 500);

await checkStoredPin();
// Rechargement de page : on reprend la réservation du terrain en cours.
if (authed && courtFilter) claimCourt(courtFilter, pin);
render(store.state);
connect();
