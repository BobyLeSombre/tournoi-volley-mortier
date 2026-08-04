// Écran spectateur : matchs en direct, calendrier, classements.

import {
  connect,
  onState,
  store,
  el,
  remainingMs,
  fmtClock,
  clockClass,
  teamName,
  sideName,
  matchLabel,
  roundLabel,
  currentRound,
  roundProgress,
  statusBadge,
  periodBadge,
  isInterval,
  setTitle,
  startClockLoop,
} from './common.js';
import { computeStandings, teamProfile } from './standings.js';
import { showGallery, syncGallery } from './gallery.js';
import { hasBracket, podium, renderFinals, renderPodium, confettiBurst } from './finals.js';

const views = {
  direct: document.getElementById('view-direct'),
  calendrier: document.getElementById('view-calendrier'),
  classements: document.getElementById('view-classements'),
  finale: document.getElementById('view-finale'),
  equipe: document.getElementById('view-equipe'),
  photos: document.getElementById('view-photos'),
};
let currentView = 'direct';

// Lien direct vers un onglet (ex. « Ouvrir l'écran public » de la démo vers la
// phase finale). Honoré une fois que l'onglet visé est disponible.
let wantedTab = new URLSearchParams(location.search).get('tab');

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    currentView = tab.dataset.view;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    for (const [name, node] of Object.entries(views)) node.hidden = name !== currentView;
    // La galerie n'est montée que lorsqu'on ouvre son onglet.
    if (currentView === 'photos') showGallery(views.photos);
    if (currentView === 'finale' && store.state) renderFinals(views.finale, store.state);
  });
});

// Équipe consultée dans l'onglet « Mon équipe ». Mémorisée : un joueur retrouve
// la sienne sans la rechercher à chaque fois.
let watchedTeam = localStorage.getItem('volley.myTeam') || null;
let teamQuery = '';

// Mode écran géant : réservé à l'organisation, on n'y entre que par le lien
// `?tv=1` fourni dans l'espace Orga — aucun bouton sur l'écran public.
function setTv(on) {
  document.body.classList.toggle('tv', on);
  const url = new URL(location.href);
  if (on) url.searchParams.set('tv', '1');
  else url.searchParams.delete('tv');
  history.replaceState(null, '', url);
}

document.getElementById('tv-exit').addEventListener('click', () => setTv(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('tv')) setTv(false);
});

if (new URLSearchParams(location.search).get('tv') === '1') setTv(true);

// -------------------------------------------------------------- carte match

function matchCard(state, m, { big = false } = {}) {
  const left = remainingMs(m);
  const finished = m.status === 'finished';
  const aWins = finished && m.winnerId === m.teamAId;
  const bWins = finished && m.winnerId === m.teamBId;

  const head = el('div', { class: 'match-head' }, [
    el('span', { class: 'court', text: m.court }),
    el('span', { class: 'spacer' }),
    el('span', { text: matchLabel(state, m) }),
    periodBadge(m),
    statusBadge(m),
  ]);

  const body = el('div', { class: 'match-body' }, [
    el('div', { class: 'side a' }, [
      el('div', {
        class: `team-name${finished && bWins ? ' loser' : ''}`,
        text: sideName(state, m, 'A'),
      }),
    ]),
    el('div', { class: 'scores' }, [
      el('span', { class: `score${aWins ? ' win' : ''}`, text: String(m.scoreA) }),
      el('span', { class: 'sep', text: '–' }),
      el('span', { class: `score${bWins ? ' win' : ''}`, text: String(m.scoreB) }),
    ]),
    el('div', { class: 'side b' }, [
      el('div', {
        class: `team-name${finished && aWins ? ' loser' : ''}`,
        text: sideName(state, m, 'B'),
      }),
    ]),
  ]);

  let footText;
  if (finished) {
    footText =
      m.winnerId === 'draw'
        ? 'Match nul'
        : `Victoire ${teamName(state, m.winnerId)}`;
  } else if (isInterval(m)) {
    footText = `Fin de la période ${m.period} — changement de côté`;
  } else if (m.status === 'live' && left <= 0) {
    footText = 'Temps écoulé — dernière action';
  } else if (m.status === 'pending') {
    footText = `${roundLabel(m)} — au lancement de l'organisation`;
  } else {
    footText = m.status === 'paused' ? 'Chrono en pause' : 'Temps restant';
  }

  const foot = el('div', { class: 'match-foot' }, [
    finished ? null : el('span', { class: clockClass(left, m.status), text: fmtClock(left) }),
    el('span', { text: footText }),
  ]);

  return el('article', { class: `card match-card${m.status === 'live' ? ' is-live' : ''}` }, [
    head,
    body,
    foot,
  ]);
}

// ------------------------------------------------------------------- vues

/**
 * Bannière du tour en cours. C'est le repère de la journée : tant qu'il reste
 * un match à clôturer, le tour suivant n'est pas annoncé.
 */
function roundBanner(state) {
  if (!state.matches.length) return null;
  const p = roundProgress(state);

  if (!p) {
    const finale = state.matches.find(
      (m) => m.stage === 'finale' && m.status === 'finished' && m.winnerId && m.winnerId !== 'draw'
    );
    return el('div', { class: 'round-banner done' }, [
      el('strong', {
        text: finale
          ? `🏆 ${teamName(state, finale.winnerId)} remporte le tournoi !`
          : 'Tous les matchs sont terminés',
      }),
      finale ? null : el('span', { text: 'Rendez-vous au classement final.' }),
    ]);
  }

  // Le tour bascule dès que son dernier match est clôturé : l'état « à
  // annoncer » est donc un tour dont aucun match n'a encore démarré.
  const aAnnoncer = p.finished === 0 && p.live === 0;

  return el('div', { class: `round-banner${aAnnoncer ? ' ready' : ''}` }, [
    el('strong', { text: `Tour ${p.round + 1}` }),
    el('span', {
      text: aAnnoncer
        ? `${p.total} matchs à lancer — en attente de l'annonce de l'organisation.`
        : `${p.finished}/${p.total} matchs terminés · ${p.live} en cours · ${p.pending} pas encore lancés`,
    }),
    aAnnoncer
      ? null
      : el('span', { class: 'round-bar' }, [
          el('i', { style: `width:${Math.round((p.finished / p.total) * 100)}%` }),
        ]),
  ]);
}

function renderDirect(state) {
  const live = state.matches.filter((m) => m.status === 'live' || m.status === 'paused');
  const next = state.matches.filter((m) => m.status === 'pending').slice(0, 6);
  const done = state.matches.filter((m) => m.status === 'finished').slice(-6).reverse();

  // Tournoi terminé avec un champion : le podium prend la tête de l'écran
  // (visible aussi sur l'écran géant). Sinon, la bannière du tour en cours.
  const out = [];
  const pod = renderPodium(state);
  if (pod) out.push(pod);
  else {
    const banner = roundBanner(state);
    if (banner) out.push(banner);
  }

  if (live.length) {
    out.push(sectionTitle('Matchs en cours', `${live.length} terrain${live.length > 1 ? 's' : ''}`));
    // En mode écran géant on fixe le nombre de colonnes, plafonné par la largeur
    // réelle : une carte sous ~470 px casse les noms d'équipe en morceaux.
    const wanted = live.length <= 3 ? live.length : live.length === 4 ? 2 : 3;
    const cols = Math.max(1, Math.min(wanted, Math.floor(window.innerWidth / 470)));
    out.push(
      el(
        'div',
        { class: 'grid live', style: `--tv-cols:${cols}` },
        live.map((m) => matchCard(state, m))
      )
    );
  } else {
    out.push(
      el('div', { class: 'empty' }, [
        state.matches.length
          ? 'Aucun match en cours pour le moment.'
          : "Le calendrier n'a pas encore été publié.",
      ])
    );
  }

  if (next.length) {
    out.push(sectionTitle('Prochains matchs', 'à suivre', true));
    out.push(el('div', { class: 'card tv-hide' }, next.map((m) => upcomingRow(state, m))));
  }

  if (done.length) {
    out.push(sectionTitle('Derniers résultats', 'terminés', true));
    out.push(el('div', { class: 'card tv-hide' }, done.map((m) => upcomingRow(state, m))));
  }

  views.direct.replaceChildren(...out);
}

/**
 * Ligne de match unifiée, pensée mobile : les équipes en avant (elles peuvent
 * s'étaler sur plusieurs lignes), une sous-ligne de contexte compacte, et un
 * seul statut à droite. Fini les colonnes qui se chevauchent sur un téléphone.
 */
function matchLine(state, m, subText, statusEl) {
  return el('div', { class: 'match-line' }, [
    el('div', { class: 'ml-main' }, [
      el('div', { class: 'ml-teams' }, [
        el('span', { text: sideName(state, m, 'A') }),
        el('span', { class: 'ml-vs', text: 'vs' }),
        el('span', { text: sideName(state, m, 'B') }),
      ]),
      el('div', { class: 'ml-sub', text: subText }),
    ]),
    statusEl,
  ]);
}

function scoreOrBadge(m) {
  if (m.status === 'finished') {
    return el('span', { class: 'ml-score', text: `${m.scoreA} – ${m.scoreB}` });
  }
  return statusBadge(m);
}

function upcomingRow(state, m) {
  const sub = `${roundLabel(m)} · ${m.court} · ${matchLabel(state, m)}`;
  return matchLine(state, m, sub, scoreOrBadge(m));
}

function renderCalendrier(state) {
  if (!state.matches.length) {
    views.calendrier.replaceChildren(el('div', { class: 'empty' }, ['Aucun match programmé.']));
    return;
  }

  // Regroupement par tour : l'ordre des matchs, sans aucun horaire.
  const tours = new Map();
  for (const m of state.matches) {
    const key = m.round ?? 0;
    if (!tours.has(key)) tours.set(key, []);
    tours.get(key).push(m);
  }

  const encours = currentRound(state);
  const out = [sectionTitle('Ordre des matchs', `${state.matches.length} matchs`)];
  for (const [round, list] of [...tours].sort((a, b) => a[0] - b[0])) {
    const restants = list.filter((m) => m.status !== 'finished').length;
    const note =
      round === encours
        ? `en cours — ${list.length - restants}/${list.length} terminés`
        : restants === 0
          ? 'terminé'
          : 'à venir';
    out.push(
      el('div', { class: 'pool-block' }, [
        el('h3', {}, [`Tour ${round + 1}`, el('span', { class: 'round-note', text: note })]),
        el('div', { class: 'card' }, list.map((m) => calendarRow(state, m))),
      ])
    );
  }
  views.calendrier.replaceChildren(...out);
}

function calendarRow(state, m) {
  const left = remainingMs(m);
  let statusEl;
  if (m.status === 'live' || m.status === 'paused') {
    statusEl = el('span', { class: `${clockClass(left, m.status)} ml-clock`, text: fmtClock(left) });
  } else {
    statusEl = scoreOrBadge(m);
  }
  const sub = `${m.court} · ${matchLabel(state, m)}`;
  return matchLine(state, m, sub, statusEl);
}

function renderClassements(state) {
  if (!state.pools.length) {
    views.classements.replaceChildren(el('div', { class: 'empty' }, ['Aucune poule créée.']));
    return;
  }

  const out = [sectionTitle('Classements des poules', 'mis à jour en direct')];
  for (const pool of state.pools) {
    const rows = computeStandings(state, pool.id);
    if (!rows.length) continue;

    const table = el('table', {}, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { class: 'left', text: 'Équipe' }),
          el('th', { title: 'Matchs joués', text: 'J' }),
          el('th', { title: 'Victoires — 1er critère du classement', text: 'V' }),
          el('th', { title: 'Nuls', text: 'N' }),
          el('th', { title: 'Défaites', text: 'D' }),
          el('th', { title: 'Total des points marqués — départage les égalités', text: 'Points' }),
        ]),
      ]),
      el(
        'tbody',
        {},
        rows.map((r) =>
          el('tr', { class: r.rank <= 2 ? 'qualified' : '' }, [
            el('td', { class: 'left' }, [
              el('span', { class: 'team' }, [
                el('span', { class: 'rank', text: String(r.rank) }),
                r.name,
              ]),
            ]),
            el('td', { text: String(r.played) }),
            el('td', { class: 'pts', text: String(r.won) }),
            el('td', { text: String(r.drawn) }),
            el('td', { text: String(r.lost) }),
            el('td', { class: 'total', text: String(r.pointsFor) }),
          ])
        )
      ),
    ]);

    out.push(
      el('div', { class: 'pool-block' }, [
        el('h3', { text: pool.name }),
        el('div', { class: 'table-wrap' }, [table]),
      ])
    );
  }
  views.classements.replaceChildren(...out);
}

function sectionTitle(title, note, hideOnTv = false) {
  return el('div', { class: `section-title${hideOnTv ? ' tv-hide' : ''}` }, [
    el('h2', { text: title }),
    note ? el('span', { text: note }) : null,
  ]);
}

// ----------------------------------------------------------- « Mon équipe »

const cleNom = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function renderEquipe(state) {
  if (!state.teams.length) {
    views.equipe.replaceChildren(el('div', { class: 'empty' }, ['Aucune équipe pour le moment.']));
    return;
  }

  const out = [];

  // Barre de recherche. On garde le focus et la valeur entre deux rendus.
  const input = el('input', {
    class: 'team-search',
    type: 'search',
    placeholder: 'Cherche ton équipe…',
    value: teamQuery,
  });
  input.addEventListener('input', () => {
    teamQuery = input.value;
    renderResultats();
  });

  const resultats = el('div', { class: 'team-results' });
  const fiche = el('div', { class: 'team-card-wrap' });

  function renderResultats() {
    const q = cleNom(teamQuery);
    const liste = q
      ? state.teams.filter((t) => cleNom(t.name).includes(q))
      : watchedTeam
        ? []
        : state.teams;

    // replaceChildren transforme un null en texte « null » : on filtre avant.
    resultats.replaceChildren(
      ...[
        ...liste.slice(0, 30).map((t) =>
          el('button', {
            class: `team-result${t.id === watchedTeam ? ' current' : ''}`,
            text: t.name,
            onClick: () => {
              watchedTeam = t.id;
              localStorage.setItem('volley.myTeam', t.id);
              teamQuery = '';
              input.value = '';
              renderResultats();
              renderFiche();
            },
          })
        ),
        q && !liste.length
          ? el('div', { class: 'team-noresult', text: 'Aucune équipe à ce nom.' })
          : null,
      ].filter(Boolean)
    );
  }

  function renderFiche() {
    const p = watchedTeam ? teamProfile(state, watchedTeam) : null;
    if (!p) {
      fiche.replaceChildren();
      return;
    }
    fiche.replaceChildren(teamCard(state, p));
  }

  out.push(
    el('div', { class: 'team-search-box' }, [
      input,
      watchedTeam
        ? el('button', {
            class: 'btn sm ghost',
            text: 'Changer d’équipe',
            onClick: () => {
              watchedTeam = null;
              localStorage.removeItem('volley.myTeam');
              teamQuery = '';
              input.value = '';
              renderResultats();
              renderFiche();
            },
          })
        : null,
    ]),
    resultats,
    fiche
  );

  views.equipe.replaceChildren(...out.filter(Boolean));
  renderResultats();
  renderFiche();
}

function teamCard(state, p) {
  const { team, pool, poolRow, overall, totalTeams, qualif, bracket } = p;

  // En-tête : nom + poule.
  const head = el('div', { class: 'tc-head' }, [
    el('div', {}, [
      el('h2', { class: 'tc-name', text: team.name }),
      pool ? el('div', { class: 'tc-pool', text: pool.name }) : null,
    ]),
    statutBadge(p),
  ]);

  // Tuiles de stats.
  const rangGeneral = overall ? `${overall.overallRank}` : '—';
  const tiles = el('div', { class: 'tc-tiles' }, [
    tile(poolRow ? String(poolRow.rank) : '—', `place en ${pool ? pool.name : 'poule'}`),
    tile(poolRow ? String(poolRow.won) : '0', 'victoires'),
    tile(poolRow ? String(poolRow.pointsFor) : '0', 'points marqués'),
    tile(rangGeneral, `sur ${totalTeams} au général`, overall ? `${overall.pointsFor} pts` : ''),
  ]);

  // Bandeau de qualification / parcours.
  const banners = [];
  if (bracket) {
    banners.push(
      el('div', { class: `tc-banner ${bracket.done ? 'done' : 'in'}`, text: bracket.label })
    );
  } else if (qualif) {
    banners.push(
      el('div', { class: `tc-banner ${qualif.in ? 'in' : 'out'}` }, [
        el('strong', { text: qualif.in ? '✓ Qualifié·e' : 'Pas encore qualifié·e' }),
        el('span', { text: ` — ${qualif.label}${qualif.provisional ? ' (provisoire)' : ''}` }),
      ])
    );
  }

  // Ses matchs.
  const sesMatchs = el('div', { class: 'tc-matches' }, p.matches.map((m) => teamMatchRow(state, m, team.id)));

  return el('article', { class: 'card team-card' }, [
    head,
    ...banners,
    tiles,
    poolRow ? poolMiniTable(state, p) : null,
    p.matches.length ? el('div', { class: 'tc-section-title', text: 'Ses matchs' }) : null,
    p.matches.length ? sesMatchs : null,
  ]);
}

function statutBadge(p) {
  if (p.bracket) {
    return el('span', {
      class: `badge ${p.bracket.done ? 'finished' : 'live'}`,
      text: p.bracket.done ? 'Terminé' : 'En course',
    });
  }
  if (p.qualif) {
    return el('span', {
      class: `badge ${p.qualif.in ? 'live' : 'paused'}`,
      text: p.qualif.in ? 'Qualifié·e' : 'À la lutte',
    });
  }
  return null;
}

function tile(value, label, sub) {
  return el('div', { class: 'tc-tile' }, [
    el('b', { text: value }),
    el('span', { text: label }),
    sub ? el('em', { text: sub }) : null,
  ]);
}

function poolMiniTable(state, p) {
  return el('div', { class: 'tc-section' }, [
    el('div', { class: 'tc-section-title', text: `Classement ${p.pool.name}` }),
    el('div', { class: 'table-wrap' }, [
      el('table', {}, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { class: 'left', text: 'Équipe' }),
            el('th', { text: 'J' }),
            el('th', { text: 'V' }),
            el('th', { text: 'Points' }),
          ]),
        ]),
        el(
          'tbody',
          {},
          p.poolStanding.map((r) =>
            el('tr', { class: r.teamId === p.team.id ? 'me' : r.rank <= 2 ? 'qualified' : '' }, [
              el('td', { class: 'left' }, [
                el('span', { class: 'team' }, [
                  el('span', { class: 'rank', text: String(r.rank) }),
                  r.name,
                ]),
              ]),
              el('td', { text: String(r.played) }),
              el('td', { class: 'pts', text: String(r.won) }),
              el('td', { class: 'total', text: String(r.pointsFor) }),
            ])
          )
        ),
      ]),
    ]),
  ]);
}

function teamMatchRow(state, m, teamId) {
  const finished = m.status === 'finished';
  const monScore = m.teamAId === teamId ? m.scoreA : m.scoreB;
  const advScore = m.teamAId === teamId ? m.scoreB : m.scoreA;
  const advId = m.teamAId === teamId ? m.teamBId : m.teamAId;
  const advName = advId ? teamName(state, advId) : sideName(state, m, m.teamAId === teamId ? 'B' : 'A');

  const gagne = finished && m.winnerId === teamId;
  const perdu = finished && m.winnerId && m.winnerId !== teamId && m.winnerId !== 'draw';

  return el('div', { class: 'tc-match' }, [
    el('span', { class: 'tc-match-label', text: matchLabel(state, m) }),
    el('span', { class: 'tc-match-adv', text: `vs ${advName}` }),
    finished
      ? el('span', {
          class: `tc-match-score ${gagne ? 'win' : perdu ? 'loss' : ''}`,
          text: `${monScore} – ${advScore}`,
        })
      : el('span', { class: 'tc-match-todo', text: roundLabel(m) }),
  ]);
}

function renderStats(state) {
  const live = state.matches.filter((m) => m.status === 'live').length;
  const done = state.matches.filter((m) => m.status === 'finished').length;
  document.getElementById('hero-stats').replaceChildren(
    stat(live, 'match(s) en cours'),
    stat(`${done}/${state.matches.length}`, 'matchs joués'),
    stat(state.teams.length, 'équipes'),
    stat(state.pools.length, 'poules')
  );
}

function stat(value, label) {
  return el('div', {}, [el('b', { text: String(value) }), ` ${label}`]);
}

// Le sacre : on déclenche les confettis une seule fois, quand la finale se
// termine — quel que soit l'onglet ouvert.
let sacreCelebre = false;
function celebrerSiChampion(state) {
  const champion = !!podium(state);
  if (champion && !sacreCelebre) {
    sacreCelebre = true;
    confettiBurst();
  }
  if (!champion) sacreCelebre = false; // reset si l'admin rouvre la finale
}

function renderAll(state) {
  setTitle(state);
  document.title = `${state.config.name} — en direct`;

  // L'onglet « Phase finale » n'apparaît qu'une fois le tableau généré.
  const finaleTab = document.querySelector('.tab[data-view="finale"]');
  if (finaleTab) finaleTab.hidden = !hasBracket(state);
  if (currentView === 'finale' && !hasBracket(state)) selectTab('direct');

  // Ouverture directe sur un onglet demandé (?tab=), dès qu'il est visible.
  if (wantedTab) {
    const target = document.querySelector(`.tab[data-view="${wantedTab}"]`);
    if (target && !target.hidden) {
      wantedTab = null;
      target.click();
    }
  }

  celebrerSiChampion(state);

  renderStats(state);
  renderDirect(state);
  renderCalendrier(state);
  renderClassements(state);
  if (hasBracket(state) && !views.finale.hidden) renderFinals(views.finale, state);
  // La galerie se recharge seule si de nouvelles photos sont arrivées (juste
  // un compteur comparé ; aucune image ne transite par le WebSocket).
  syncGallery();
  // Ne pas re-render la fiche pendant qu'un joueur tape sa recherche.
  if (document.activeElement?.classList?.contains('team-search')) return;
  renderEquipe(state);
}

/** Bascule programmatique d'onglet (même effet qu'un clic). */
function selectTab(view) {
  const tab = document.querySelector(`.tab[data-view="${view}"]`);
  if (tab) tab.click();
}

onState(renderAll);
startClockLoop(renderAll);
connect();
