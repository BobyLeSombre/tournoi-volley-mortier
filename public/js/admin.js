// Interface organisation : réglages, poules, équipes, génération du calendrier,
// retouches de dernière minute et sauvegarde.

import {
  connect,
  onState,
  store,
  api,
  el,
  toast,
  teamName,
  sideName,
  roundProgress,
  setTitle,
} from './common.js';
import { qualifiedTeams } from './standings.js';
import { renderTeams, teamsBusy } from './teams.js';

const PWD_KEY = 'volley.adminPwd';
const gate = document.getElementById('gate');
const app = document.getElementById('app');

let pwd = localStorage.getItem(PWD_KEY) || '';
let authed = false;
let refPin = ''; // code arbitre, renvoyé par l'API à l'admin authentifié

document.getElementById('password-submit').addEventListener('click', submitPwd);
document.getElementById('password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitPwd();
});

async function submitPwd() {
  const value = document.getElementById('password').value;
  const res = await api('/api/auth/admin', { password: value }).catch(() => ({ ok: false }));
  if (!res.ok) return toast('Mot de passe incorrect', true);
  pwd = value;
  localStorage.setItem(PWD_KEY, pwd);
  authed = true;
  refPin = res.refereePin || '';
  render(store.state);
}

async function checkStored() {
  if (!pwd) return;
  const res = await api('/api/auth/admin', { password: pwd }).catch(() => ({ ok: false }));
  authed = !!res.ok;
  refPin = res.refereePin || '';
  if (!authed) localStorage.removeItem(PWD_KEY);
}

async function post(path, body) {
  try {
    return await api(path, body, { 'x-admin-password': pwd });
  } catch (err) {
    toast(err.message, true);
    throw err;
  }
}

// -------------------------------------------------------------------- vues

function renderLinks(state) {
  const base = location.origin;
  return panel('Liens', 'Ce que tu communiques, et ce que tu gardes pour toi.', [
    el('label', { text: 'À partager' }),
    el('div', { class: 'links' }, [
      link(`${base}/`, 'Écran public — joueurs et spectateurs'),
      link(`${base}/arbitre.html`, `Arbitres — code : ${refPin || '••••'}`),
    ]),
    el('label', { style: 'margin-top:18px', text: "Réservé à l'organisation" }),
    el('div', { class: 'links' }, [
      link(
        `${base}/?tv=1`,
        'Écran géant / vidéoprojecteur',
        "Ne le diffuse pas : ce mode n'est plus proposé sur l'écran public, pour que les joueurs ne l'ouvrent pas sur leur téléphone."
      ),
    ]),
  ]);
}

const qrSrc = (url, size = 240) =>
  `/api/qr.svg?size=${size}&data=${encodeURIComponent(url)}`;

/**
 * QR codes à imprimer. Celui du haut connecte l'arbitre ; ceux du bas, posés
 * sur chaque terrain, l'emmènent en plus directement sur le bon match.
 */
function renderQr(state) {
  const lienArbitre = `${location.origin}/arbitre.html`;

  return el('div', { class: 'panel' }, [
    el('h2', { text: 'QR code arbitres' }),
    el('p', { class: 'hint' }, [
      "L'espace arbitre n'est accessible que par ce QR code : l'écran public n'y " +
        'renvoie pas. Il mène à la page de connexion — le code arbitre ne circule ' +
        "jamais dedans, tu le donnes de vive voix. Une affiche photographiée par un " +
        'joueur ne lui permet donc pas de toucher aux scores.',
    ]),

    el('div', { class: 'qr-zone' }, [
      el('div', { class: 'qr-print-head' }, [
        el('h3', { text: state.config.name }),
        el('p', { text: 'Arbitres — scannez pour accéder à la saisie des scores' }),
      ]),
      el('div', { class: 'qr-card' }, [
        el('img', {
          class: 'qr-img',
          src: qrSrc(lienArbitre, 340),
          alt: 'QR code — espace arbitre',
        }),
        el('strong', { text: 'Espace arbitre' }),
        el('span', { class: 'qr-url', text: lienArbitre }),
      ]),
      el('p', { class: 'qr-print-note' }, [
        'Le code vous sera communiqué par l’organisation.',
      ]),
    ]),

    el('p', { class: 'hint', style: 'margin:16px 0 0' }, [
      `Code arbitre actuel : `,
      el('strong', { style: 'color:var(--accent-strong)', text: refPin || '••••' }),
      ". Il se change dans les réglages ci-dessous ; le QR, lui, ne bouge pas.",
    ]),

    el('div', { class: 'row', style: 'margin-top:14px' }, [
      el('button', {
        class: 'btn primary',
        text: '🖨 Imprimer le QR code',
        onClick: () => window.print(),
      }),
      el('a', {
        class: 'btn',
        href: lienArbitre,
        target: '_blank',
        rel: 'noopener',
        text: 'Ouvrir la page arbitre',
      }),
    ]),
  ]);
}

function link(href, label, note) {
  return el('div', { class: 'link-row' }, [
    el('a', { href, target: '_blank', rel: 'noopener' }, [el('b', { text: label }), href]),
    el('button', {
      class: 'btn sm ghost',
      text: 'Copier',
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(href);
          toast('Lien copié ✓');
        } catch {
          toast('Copie impossible — sélectionne le lien à la main', true);
        }
      },
    }),
    note ? el('p', { class: 'link-note', text: note }) : null,
  ]);
}

function renderConfig(state) {
  const c = state.config;
  const input = (id, label, value, attrs = {}) =>
    el('div', { class: 'field' }, [
      el('label', { text: label }),
      el('input', { id, value: value ?? '', ...attrs }),
    ]);

  const save = async () => {
    const get = (id) => document.getElementById(id).value;
    await post('/api/admin/config', {
      config: {
        name: get('cfg-name'),
        subtitle: get('cfg-subtitle'),
        date: get('cfg-date'),
        periodDurationMin: get('cfg-period-duration'),
        periods: get('cfg-periods'),
        allerRetour: get('cfg-aller-retour') === '1',
        courts: get('cfg-courts').split(',').map((s) => s.trim()).filter(Boolean),
        refereePin: get('cfg-pin') || undefined,
        adminPassword: get('cfg-admin') || undefined,
      },
    });
    if (get('cfg-admin')) {
      pwd = get('cfg-admin');
      localStorage.setItem(PWD_KEY, pwd);
      document.getElementById('cfg-admin').value = '';
    }
    document.getElementById('cfg-pin').value = '';
    await checkStored(); // récupère le code arbitre éventuellement modifié
    toast('Réglages enregistrés ✓');
    render(store.state);
  };

  return panel('Réglages du tournoi', 'Durée des matchs et terrains.', [
    el('div', { class: 'fields' }, [
      input('cfg-name', 'Nom du tournoi', c.name),
      input('cfg-subtitle', 'Sous-titre', c.subtitle),
      input('cfg-date', 'Date affichée', c.date, { placeholder: 'Samedi 12 septembre' }),
    ]),
    el('div', { class: 'fields' }, [
      input('cfg-period-duration', 'Durée d\'une période (min)', Math.round(c.periodDurationSec / 60), {
        type: 'number',
        min: '1',
      }),
      input('cfg-periods', 'Périodes par match', c.periods, { type: 'number', min: '1', max: '5' }),
    ]),
    el('p', { class: 'hint', style: 'margin:-4px 0 16px' }, [
      `Un match dure ${(c.periods * c.periodDurationSec) / 60} min de jeu ` +
        `(${c.periods} × ${c.periodDurationSec / 60} min), score cumulé sur toutes les périodes. ` +
        `Aucun horaire de coup d'envoi : les matchs sont regroupés en tours, ` +
        `que tu annonces au micro quand le tour précédent est terminé.`,
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'Terrains (séparés par des virgules)' }),
      el('input', { id: 'cfg-courts', value: c.courts.join(', ') }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'Format des poules' }),
      el('select', { id: 'cfg-aller-retour' }, [
        el('option', {
          value: '0',
          selected: c.allerRetour ? null : '',
          text: 'Aller simple — chaque équipe en affronte une autre 1 fois',
        }),
        el('option', {
          value: '1',
          selected: c.allerRetour ? '' : null,
          text: 'Aller-retour — chaque équipe en affronte une autre 2 fois',
        }),
      ]),
    ]),
    el('p', { class: 'hint', style: 'margin:0 0 16px' }, [
      'Classement : d’abord au nombre de victoires, puis à égalité au total ' +
        'des points marqués sur tous les matchs. Aucun barème à régler.',
    ]),
    el('div', { class: 'fields' }, [
      input('cfg-pin', 'Nouveau code arbitre', '', { placeholder: 'inchangé' }),
      input('cfg-admin', 'Nouveau mot de passe admin', '', {
        placeholder: 'inchangé',
        type: 'password',
      }),
    ]),
    el('button', { class: 'btn primary', text: 'Enregistrer les réglages', onClick: save }),
  ]);
}


/** Où en est chaque terrain — la vue dont on a besoin en marchant dans la salle. */
function renderCourtsPanel(state) {
  const p = roundProgress(state);

  // Ce qui bloque l'annonce du tour suivant : les terrains du tour en cours
  // qui n'ont pas encore rendu leur résultat.
  const bloquants = [];
  const rows = state.config.courts.map((court) => {
    const list = state.matches.filter((m) => m.court === court);
    const encours = list.find((m) => m.status === 'live' || m.status === 'paused');
    const suivant = list.find((m) => m.status === 'pending');
    const joues = list.filter((m) => m.status === 'finished').length;
    const m = encours || suivant;

    const duTour = p && m && (m.round ?? 0) === p.round;
    if (duTour) bloquants.push(court);

    return el('div', { class: `court-row${duTour ? ' actif' : ''}` }, [
      el('span', { class: 'court-name', text: court }),
      el('span', { class: 'court-state' }, [
        m ? `${sideName(state, m, 'A')} vs ${sideName(state, m, 'B')}` : 'terrain libéré',
        el('em', { text: m ? `Tour ${(m.round ?? 0) + 1} · ${joues}/${list.length} joués` : `${joues}/${list.length} joués` }),
      ]),
      encours
        ? el('span', { class: 'badge ok', text: `${encours.scoreA} – ${encours.scoreB}` })
        : suivant
          ? el('span', { class: 'badge', text: 'à lancer' })
          : el('span', { class: 'badge ok', text: 'terminé' }),
    ]);
  });

  let annonce;
  if (!p) {
    annonce = el('p', { class: 'hint', style: 'margin:14px 0 0;color:var(--accent-strong)' }, [
      'Tous les matchs sont terminés.',
    ]);
  } else if (p.finished === 0 && p.live === 0) {
    // Le tour précédent vient d'être clôturé : c'est le moment de l'annonce.
    annonce = el('p', { class: 'hint', style: 'margin:14px 0 0;color:var(--accent-strong)' }, [
      `Tour ${p.round + 1} prêt — annonce ses ${p.total} matchs au micro. ` +
        `Le tour précédent est entièrement clôturé.`,
    ]);
  } else {
    annonce = el('p', { class: 'hint', style: 'margin:14px 0 0' }, [
      `Tour ${p.round + 1} : ${p.finished}/${p.total} matchs clôturés. ` +
        `En attente de ${bloquants.join(', ') || '—'}.`,
    ]);
  }

  return panel(
    'Suivi des terrains',
    "Les arbitres choisissent eux-mêmes leur terrain sur la page arbitre, avec le code. Ce tableau te dit quand tous les matchs du tour sont clôturés, donc quand annoncer le tour suivant.",
    [el('div', { class: 'court-list' }, rows), annonce]
  );
}

function renderSchedule(state) {
  const generate = async () => {
    const played = state.matches.some((m) => m.status !== 'pending');
    if (played && !confirm('Des matchs ont déjà commencé. Régénérer le calendrier ? Les résultats terminés seront conservés.')) {
      return;
    }
    const res = await post('/api/admin/schedule', { keepFinished: played });
    toast(`${res.created} matchs générés ✓`);
  };

  const rows = state.matches.map((m) => matchRow(state, m));

  return panel(
    'Calendrier',
    'Génère automatiquement tous les matchs de poule (championnat aller simple), répartis sur les terrains sans qu\'une équipe joue deux fois en même temps.',
    [
      el('div', { class: 'row', style: 'margin-bottom:16px' }, [
        el('button', { class: 'btn primary', text: '⚡ Générer le calendrier des poules', onClick: generate }),
        el('button', {
          class: 'btn ghost',
          text: 'Tout effacer',
          onClick: () => {
            if (confirm('Supprimer tous les matchs ?')) post('/api/admin/matches', { action: 'deleteAll' });
          },
        }),
      ]),
      rows.length
        ? el('div', { class: 'card' }, rows)
        : el('div', { class: 'empty' }, ['Aucun match. Crée tes poules puis génère le calendrier.']),
      addMatchForm(state),
    ]
  );
}

function matchRow(state, m) {
  return el('div', { class: 'match-row' }, [
    // Le numéro de tour remplace l'horaire : il fixe l'ordre, pas l'heure.
    el('input', {
      type: 'number',
      min: '1',
      value: (m.round ?? 0) + 1,
      title: 'Tour',
      onChange: (e) =>
        post('/api/admin/matches', {
          action: 'update',
          id: m.id,
          data: { round: Math.max(0, (Number(e.target.value) || 1) - 1) },
        }),
    }),
    el('span', { class: 'pair' }, [
      `${sideName(state, m, 'A')} vs ${sideName(state, m, 'B')}`,
      el('em', {
        style: 'display:block;font-style:normal;font-size:.74rem;color:var(--dim);margin-top:2px',
        text: m.label || state.pools.find((p) => p.id === m.poolId)?.name || 'Hors poule',
      }),
    ]),
    el(
      'select',
      {
        onChange: (e) =>
          post('/api/admin/matches', { action: 'update', id: m.id, data: { court: e.target.value } }),
      },
      state.config.courts.map((c) =>
        el('option', { value: c, selected: c === m.court ? '' : null, text: c })
      )
    ),
    el('span', {
      class: `badge${m.status === 'live' ? ' live' : m.status === 'finished' ? ' finished' : ''}`,
      text:
        m.status === 'finished'
          ? `${m.scoreA}–${m.scoreB}`
          : m.status === 'live'
            ? 'en cours'
            : m.status === 'paused'
              ? 'pause'
              : 'à venir',
    }),
    el('button', {
      class: 'btn sm danger',
      text: '×',
      onClick: () => {
        if (confirm('Supprimer ce match ?')) post('/api/admin/matches', { action: 'delete', id: m.id });
      },
    }),
  ]);
}

function addMatchForm(state) {
  const teamOptions = () => [
    el('option', { value: '', text: '— équipe —' }),
    ...state.teams.map((t) => el('option', { value: t.id, text: t.name })),
  ];

  return el('div', { style: 'margin-top:18px;padding-top:18px;border-top:1px solid var(--line-soft)' }, [
    el('label', { text: 'Ajouter un match hors poule (demi-finale, finale, match de classement…)' }),
    el('div', { class: 'row' }, [
      el('select', { id: 'nm-a', style: 'flex:1;min-width:130px' }, teamOptions()),
      el('select', { id: 'nm-b', style: 'flex:1;min-width:130px' }, teamOptions()),
      el('input', { id: 'nm-label', placeholder: 'Finale', style: 'flex:1;min-width:110px' }),
      el('input', {
        id: 'nm-round',
        type: 'number',
        min: '1',
        placeholder: 'Tour',
        title: 'Tour (vide = à la suite)',
        style: 'width:90px',
      }),
      el(
        'select',
        { id: 'nm-court', style: 'width:130px' },
        state.config.courts.map((c) => el('option', { value: c, text: c }))
      ),
      el('button', {
        class: 'btn',
        text: 'Ajouter',
        onClick: async () => {
          const v = (id) => document.getElementById(id).value;
          await post('/api/admin/matches', {
            action: 'add',
            data: {
              teamAId: v('nm-a'),
              teamBId: v('nm-b'),
              label: v('nm-label') || 'Phase finale',
              round: v('nm-round') ? Math.max(0, Number(v('nm-round')) - 1) : undefined,
              court: v('nm-court'),
            },
          });
          toast('Match ajouté ✓');
        },
      }),
    ]),
  ]);
}

/**
 * Phase finale : aperçu des qualifiés en direct, génération du tableau,
 * suivi de son avancement. Format « Euro » : 2 premiers par poule + les
 * meilleurs 3es pour compléter à 16.
 */
function renderBracket(state) {
  const bracket = state.matches.filter((m) => m.stage);
  const poolMatches = state.matches.filter((m) => m.poolId);
  const poolDone = poolMatches.filter((m) => m.status === 'finished').length;
  const q = qualifiedTeams(state);
  const courts = state.config.courts.length;

  const chip = (r, opts = {}) =>
    el('span', { class: 'chip', style: opts.out ? 'opacity:.45' : '' }, [
      r.name,
      el('span', {
        style: 'font-size:.7rem;font-weight:700;color:var(--dim)',
        text: r.poolName,
      }),
    ]);

  const qualifBlock = q.error
    ? el('p', { class: 'hint', style: 'color:var(--warn)', text: q.error })
    : el('div', {}, [
        el('label', { text: `Premiers de poule (${q.firsts.length})` }),
        el('div', { style: 'margin-bottom:10px' }, q.firsts.map((r) => chip(r))),
        el('label', { text: `Deuxièmes de poule (${q.seconds.length})` }),
        el('div', { style: 'margin-bottom:10px' }, q.seconds.map((r) => chip(r))),
        el('label', {
          text: `Meilleurs troisièmes — ${q.thirdsTaken.length} repêchés sur ${q.thirds.length}`,
        }),
        el('div', {}, q.thirds.map((r) => chip(r, { out: !q.thirdsTaken.includes(r) }))),
      ]);

  const generate = async () => {
    const notes = [];
    const restants = poolMatches.length - poolDone;
    if (restants) {
      notes.push(`${restants} match(s) de poule ne sont pas terminés : le tableau se basera sur le classement ACTUEL.`);
    }
    if (bracket.length) notes.push('Le tableau existant sera remplacé.');
    if (notes.length && !confirm(notes.join('\n'))) return;
    const r = await post('/api/admin/bracket', { action: 'generate', force: true });
    toast(`Tableau de ${r.size} généré : ${r.created} matchs ✓`);
  };

  const stageNames = { '8e': '8es', quart: 'Quarts', demi: 'Demies', petite: 'Petite finale', finale: 'Finale' };
  const resume = ['8e', 'quart', 'demi', 'petite', 'finale']
    .filter((s) => bracket.some((m) => m.stage === s))
    .map((s) => {
      const list = bracket.filter((m) => m.stage === s);
      const done = list.filter((m) => m.status === 'finished').length;
      return `${stageNames[s]} ${done}/${list.length}`;
    })
    .join(' · ');

  const finale = bracket.find((m) => m.stage === 'finale' && m.status === 'finished');
  const champion =
    finale && finale.winnerId && finale.winnerId !== 'draw'
      ? teamName(state, finale.winnerId)
      : null;

  return panel(
    'Phase finale',
    "2 qualifiés par poule + les meilleurs troisièmes pour compléter le tableau. Les vainqueurs avancent tout seuls de match en match ; en cas d'égalité au temps, point en or.",
    [
      qualifBlock,
      el('div', { class: 'row', style: 'margin-top:16px' }, [
        el('button', {
          class: 'btn primary',
          text: bracket.length ? '⚡ Régénérer le tableau' : '⚡ Générer le tableau final',
          disabled: !!q.error,
          onClick: generate,
        }),
        bracket.length
          ? el('button', {
              class: 'btn danger',
              text: 'Supprimer le tableau',
              onClick: async () => {
                if (!confirm('Supprimer tous les matchs de la phase finale ?')) return;
                await post('/api/admin/bracket', { action: 'delete', force: true });
                toast('Tableau supprimé');
              },
            })
          : null,
      ]),
      bracket.length
        ? el('p', { class: 'hint', style: 'margin:14px 0 0' }, [`Avancement : ${resume}.`])
        : null,
      champion
        ? el('p', { class: 'hint', style: 'margin:8px 0 0;color:var(--accent-strong);font-weight:750' }, [
            `🏆 Champion : ${champion}`,
          ])
        : null,
      !q.error && q.size / 2 > courts
        ? el('p', { class: 'hint', style: 'margin:14px 0 0;color:var(--warn)' }, [
            `Le premier tour compte ${q.size / 2} matchs pour ${courts} terrains : il se jouera en ${Math.ceil(q.size / 2 / courts)} tours. Repasse à ${q.size / 2} terrains dans les réglages pour tout jouer d'un coup.`,
          ])
        : null,
    ]
  );
}

/** Téléchargement de toutes les photos en un ZIP, pour les garder à coup sûr. */
async function downloadPhotosZip(btn) {
  btn.disabled = true;
  const libelle = btn.textContent;
  btn.textContent = 'Préparation du ZIP…';
  try {
    const res = await fetch('/api/photos/export', { headers: { 'x-admin-password': pwd } });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || 'Téléchargement impossible');
    }
    const blob = await res.blob();
    const a = el('a', {
      href: URL.createObjectURL(blob),
      download: `photos-tournoi-${new Date().toISOString().slice(0, 10)}.zip`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Photos téléchargées ✓');
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = libelle;
  }
}

/** Modération de la galerie + sauvegarde de toutes les photos. */
function renderPhotos(state) {
  const wrap = el('div', { class: 'panel' }, [
    el('h2', { text: 'Photos' }),
    el('p', { class: 'hint' }, [
      'Les joueurs publient leurs photos depuis l’onglet Photos de l’écran public. ' +
        'Tu peux en retirer une ici, et surtout les sauvegarder toutes en un fichier.',
    ]),
    el('div', { class: 'row', style: 'margin-bottom:14px' }, [
      el('button', {
        class: 'btn primary',
        text: '⬇ Télécharger toutes les photos (ZIP)',
        onClick: (e) => downloadPhotosZip(e.currentTarget),
      }),
    ]),
    el('p', { class: 'hint', style: 'margin:-6px 0 14px;color:var(--warn)' }, [
      'Important : sur l’hébergement gratuit, les photos sont perdues si le site ' +
        'est remis en ligne. Télécharge-les régulièrement, et à la fin du tournoi.',
    ]),
    el('div', { class: 'mod-grid', text: 'Chargement…' }),
  ]);

  // Chargé à part : les images ne sont pas dans l'état du tournoi.
  fetch('/api/photos')
    .then((r) => r.json())
    .then(({ photos }) => {
      const grid = wrap.querySelector('.mod-grid');
      if (!photos.length) {
        grid.replaceChildren(el('p', { class: 'hint', text: 'Aucune photo pour l’instant.' }));
        return;
      }
      grid.replaceChildren(
        ...photos.map((p) =>
          el('div', { class: 'mod-cell' }, [
            el('img', { src: `/photos/${p.id}_t.jpg`, loading: 'lazy', alt: '' }),
            el('button', {
              class: 'mod-del',
              text: '× retirer',
              onClick: async () => {
                if (!confirm('Retirer cette photo ?')) return;
                try {
                  await api(`/api/photos/${p.id}`, undefined, { 'x-admin-password': pwd }, 'DELETE');
                  toast('Photo retirée');
                  render(store.state, true);
                } catch (err) {
                  toast(err.message, true);
                }
              },
            }),
          ])
        )
      );
    })
    .catch(() => {
      wrap.querySelector('.mod-grid').replaceChildren(
        el('p', { class: 'hint', text: 'Chargement impossible.' })
      );
    });

  return wrap;
}

function renderDanger(state) {
  return el('div', { class: 'panel danger-zone' }, [
    el('h2', { text: 'Sauvegarde et remise à zéro' }),
    el('p', { class: 'hint' }, [
      'Exporte le tournoi avant de commencer : en cas de pépin tu réimportes le fichier et tout revient.',
    ]),
    el('div', { class: 'row' }, [
      el('button', {
        class: 'btn',
        text: '⬇ Exporter (JSON)',
        onClick: async () => {
          const res = await fetch('/api/admin/export', { headers: { 'x-admin-password': pwd } });
          if (!res.ok) return toast('Export impossible', true);
          const blob = await res.blob();
          const a = el('a', {
            href: URL.createObjectURL(blob),
            download: `tournoi-${new Date().toISOString().slice(0, 10)}.json`,
          });
          a.click();
          URL.revokeObjectURL(a.href);
        },
      }),
      el('label', { class: 'btn', style: 'margin:0;text-transform:none;letter-spacing:0' }, [
        '⬆ Importer',
        el('input', {
          type: 'file',
          accept: '.json',
          style: 'display:none',
          onChange: async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
              const data = JSON.parse(await file.text());
              await post('/api/admin/import', { data });
              toast('Tournoi restauré ✓');
            } catch {
              toast('Fichier illisible', true);
            }
          },
        }),
      ]),
      el('button', {
        class: 'btn danger',
        text: 'Remettre tous les scores à zéro',
        onClick: () => {
          if (confirm('Remettre tous les scores et chronos à zéro ? Les équipes et le calendrier sont conservés.')) {
            post('/api/admin/reset', { scope: 'scores' }).then(() => toast('Scores réinitialisés'));
          }
        },
      }),
      el('button', {
        class: 'btn danger',
        text: 'Effacer tout le tournoi',
        onClick: () => {
          if (confirm('Tout effacer (poules, équipes, matchs) ? Action irréversible.')) {
            post('/api/admin/reset', { scope: 'all' }).then(() => toast('Tournoi réinitialisé'));
          }
        },
      }),
    ]),
  ]);
}

function panel(title, hint, children) {
  return el('div', { class: 'panel' }, [
    el('h2', { text: title }),
    hint ? el('p', { class: 'hint', text: hint }) : null,
    ...children.filter(Boolean),
  ]);
}

// ------------------------------------------------------------------- rendu

/** Ne pas re-render pendant une saisie : ça écraserait ce que l'admin tape. */
function isTyping() {
  const a = document.activeElement;
  return a && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA');
}

// La page est découpée en 4 onglets qui suivent le déroulé réel : on prépare,
// on partage à l'installation, on suit en direct, on sauvegarde en secours.
const TAB_KEY = 'volley.adminTab';
const TABS = [
  {
    id: 'prep',
    label: 'Préparation',
    hint: 'À remplir une fois, avant le tournoi.',
    panels: (state) => [
      renderConfig(state),
      renderTeams(state, { post, panel, rerender: () => render(store.state, true) }),
      renderSchedule(state),
    ],
  },
  {
    id: 'share',
    label: 'À partager',
    hint: 'Les liens et le QR code à diffuser le jour J.',
    panels: (state) => [renderLinks(state), renderQr(state)],
  },
  {
    id: 'live',
    label: 'En direct',
    hint: 'Pendant la journée : où en sont les terrains, la phase finale.',
    panels: (state) => [renderCourtsPanel(state), renderBracket(state), renderPhotos(state)],
  },
  {
    id: 'backup',
    label: 'Sauvegarde',
    hint: 'Exporter, réimporter, tout remettre à zéro.',
    panels: (state) => [renderDanger(state)],
  },
];
let activeTab = localStorage.getItem(TAB_KEY) || 'prep';

/** Petit fil conducteur : la prochaine action logique dans la préparation. */
function nextStepBadge(state) {
  if (activeTab !== 'prep') return null;
  let msg = null;
  if (!state.teams.length) msg = 'Commence ici : colle ta liste d’équipes.';
  else if (!state.matches.some((m) => m.poolId)) msg = 'Équipes prêtes — génère maintenant le calendrier.';
  else return null;
  return el('div', { class: 'next-step', text: `→ ${msg}` });
}

function tabBar(state) {
  const attention = {
    // Une pastille rouge attire l'œil sur ce qui reste à faire.
    prep: !state.matches.some((m) => m.poolId),
  };
  return el(
    'div',
    { class: 'admin-tabs' },
    TABS.map((t) =>
      el('button', {
        class: `admin-tab${t.id === activeTab ? ' active' : ''}`,
        onClick: () => {
          activeTab = t.id;
          localStorage.setItem(TAB_KEY, t.id);
          render(store.state, true);
          app.scrollIntoView({ block: 'start', behavior: 'smooth' });
        },
        html: `${t.label}${attention[t.id] ? '<i class="tab-dot"></i>' : ''}`,
      })
    )
  );
}

function render(state, forcer = false) {
  if (!state) return;
  setTitle(state);
  gate.hidden = authed;
  app.hidden = !authed;
  if (!authed) return;
  // Une mise à jour temps réel ne doit pas effacer une saisie en cours ni
  // interrompre un glisser-déposer d'équipe.
  if (!forcer && (isTyping() || teamsBusy())) return;

  const tab = TABS.find((t) => t.id === activeTab) || TABS[0];

  // replaceChildren transforme un null en texte « null » : on filtre avant.
  app.replaceChildren(
    ...[
      el('div', { class: 'page-head' }, [
        el('h1', { text: 'Organisation' }),
        el('p', { text: tab.hint }),
      ]),
      tabBar(state),
      nextStepBadge(state),
      ...tab.panels(state),
    ].filter(Boolean)
  );
}

onState(render);
await checkStored();
render(store.state);
connect();
