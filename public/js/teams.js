// Espace de saisie des équipes.
//
// Le chemin critique, c'est coller 24 noms d'un coup puis les répartir : tout
// le reste (renommer, déplacer, supprimer) est occasionnel et passe après.

import { el, toast, teamName } from './common.js';

// État local du panneau, hors du state serveur.
const ui = {
  bulkOpen: false,
  bulkText: '',
  poolCount: null, // null = suggestion automatique
  mode: 'order',
  selected: null, // équipe en cours de déplacement (tap-to-move)
  dragging: null,
};

/** Le panneau est en cours de manipulation : ne pas le re-render sous les doigts. */
export function teamsBusy() {
  return ui.bulkOpen || !!ui.selected || !!ui.dragging;
}

// ------------------------------------------------------------------ analyse

/**
 * Extrait les noms d'un copier-coller. Une liste sur plusieurs lignes se
 * découpe par ligne ; une liste sur une seule ligne se découpe aux virgules.
 * Les puces et numérotations (« 1. », « - ») sont retirées.
 */
export function parseNames(raw) {
  const texte = String(raw || '');
  const morceaux = texte.includes('\n') ? texte.split(/\r?\n/) : texte.split(/[,;\t]/);
  return morceaux
    .map((s) => s.replace(/^\s*(?:\d+\s*[.)\]:-]|[-–—•*])\s*/, '').trim())
    .filter(Boolean);
}

/** Comparaison tolérante : casse, accents et espaces multiples ignorés. */
const cle = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export function findDuplicates(names) {
  const vus = new Map();
  const doublons = new Set();
  for (const n of names) {
    const k = cle(n);
    if (vus.has(k)) doublons.add(n);
    else vus.set(k, n);
  }
  return doublons;
}

/**
 * Découpage suggéré : des poules de 4 en priorité, puis 5, puis 3. On préfère
 * peu de grosses poules à beaucoup de petites — plus de matchs par équipe.
 */
export function suggestPools(total) {
  if (total < 2) return 1;
  for (const taille of [4, 5, 3, 6]) {
    if (total % taille === 0) return total / taille;
  }
  return Math.max(1, Math.round(total / 4));
}

/** « 6 poules de 4 » ou « 5 poules : 5, 5, 5, 5, 4 ». */
export function describeSplit(total, poolCount) {
  if (!total || !poolCount) return '';
  const base = Math.floor(total / poolCount);
  const reste = total % poolCount;
  if (!reste) return `${poolCount} poule${poolCount > 1 ? 's' : ''} de ${base}`;
  const tailles = Array.from({ length: poolCount }, (_, i) => base + (i < reste ? 1 : 0));
  return `${poolCount} poules : ${tailles.join(', ')} équipes`;
}

// -------------------------------------------------------------------- rendu

export function renderTeams(state, ctx) {
  const { post, panel } = ctx;
  const total = state.teams.length;
  const enSaisie = ui.bulkOpen || total === 0;

  return panel(
    'Équipes',
    enSaisie
      ? "Colle ta liste d'équipes — une par ligne, ou séparées par des virgules. Les numéros et tirets en début de ligne sont retirés automatiquement."
      : 'Glisse une équipe d’une poule à l’autre, clique son nom pour le corriger.',
    enSaisie ? [bulkForm(state, ctx)] : [toolbar(state, ctx), poolsGrid(state, ctx)]
  );
}

// ------------------------------------------------------------ saisie en masse

function bulkForm(state, ctx) {
  const { post } = ctx;
  const dejaLa = state.teams.length;

  const apercu = el('div', { class: 'bulk-preview' });
  const textarea = el('textarea', {
    class: 'bulk-input',
    rows: 12,
    spellcheck: 'false',
    placeholder:
      'Les Smasheurs\nVolley Vibes\nSet Point\nBlock Party\n…\n\n(ou : Les Smasheurs, Volley Vibes, Set Point)',
  });
  textarea.value = ui.bulkText;

  const champPoules = el('input', {
    type: 'number',
    min: '1',
    max: '24',
    class: 'bulk-pools',
  });
  const selectMode = el('select', { class: 'bulk-mode' }, [
    el('option', { value: 'order', text: 'Dans l’ordre de la liste' }),
    el('option', { value: 'random', text: 'Tirage au sort' }),
    el('option', { value: 'snake', text: 'Serpentin (liste classée par niveau)' }),
  ]);
  selectMode.value = ui.mode;

  const bouton = el('button', { class: 'btn primary bulk-submit' });

  /** Recalcule l'aperçu à chaque frappe, sans re-render du panneau. */
  function rafraichir() {
    const noms = parseNames(textarea.value);
    const doublons = findDuplicates(noms);
    ui.bulkText = textarea.value;

    if (ui.poolCount == null) champPoules.value = suggestPools(noms.length);
    const nbPoules = Math.max(1, Number(champPoules.value) || 1);

    const trop = nbPoules > noms.length;
    bouton.disabled = !noms.length || trop;
    bouton.textContent = noms.length
      ? `Créer ${noms.length} équipe${noms.length > 1 ? 's' : ''} et ${nbPoules} poule${nbPoules > 1 ? 's' : ''}`
      : 'Créer les équipes';

    apercu.replaceChildren(
      el('div', { class: 'bulk-stats' }, [
        el('strong', { text: `${noms.length}` }),
        ` équipe${noms.length > 1 ? 's' : ''} détectée${noms.length > 1 ? 's' : ''}`,
        doublons.size
          ? el('span', { class: 'bulk-warn', text: ` · ${doublons.size} doublon(s)` })
          : null,
        noms.length && !trop
          ? el('span', { class: 'bulk-split', text: ` · ${describeSplit(noms.length, nbPoules)}` })
          : null,
        trop ? el('span', { class: 'bulk-warn', text: ' · plus de poules que d’équipes' }) : null,
      ]),
      el(
        'div',
        { class: 'bulk-chips' },
        noms.slice(0, 60).map((n) =>
          el('span', {
            class: `mini-chip${doublons.has(n) ? ' dup' : ''}`,
            title: doublons.has(n) ? 'Ce nom apparaît plusieurs fois' : null,
            text: n,
          })
        )
      ),
      doublons.size
        ? el('button', {
            class: 'btn sm ghost',
            text: 'Retirer les doublons',
            onClick: () => {
              const vus = new Set();
              textarea.value = parseNames(textarea.value)
                .filter((n) => {
                  const k = cle(n);
                  if (vus.has(k)) return false;
                  vus.add(k);
                  return true;
                })
                .join('\n');
              rafraichir();
            },
          })
        : null
    );
  }

  textarea.addEventListener('input', rafraichir);
  champPoules.addEventListener('input', () => {
    ui.poolCount = Number(champPoules.value) || null;
    rafraichir();
  });
  selectMode.addEventListener('change', () => {
    ui.mode = selectMode.value;
  });

  bouton.addEventListener('click', async () => {
    const noms = parseNames(textarea.value);
    const nbPoules = Math.max(1, Number(champPoules.value) || 1);
    if (dejaLa && !confirm(`Remplacer les ${dejaLa} équipes existantes par cette liste ?`)) return;

    const r = await post('/api/admin/teams-bulk', {
      names: noms,
      poolCount: nbPoules,
      mode: selectMode.value,
      replace: true,
    });
    ui.bulkOpen = false;
    ui.bulkText = '';
    ui.poolCount = null;
    toast(
      `${r.teams} équipes réparties en ${r.pools} poules ✓` +
        (r.matchesRemoved ? ` — calendrier à régénérer` : '')
    );
  });

  setTimeout(rafraichir, 0);

  return el('div', {}, [
    textarea,
    el('div', { class: 'bulk-row' }, [
      el('label', { class: 'bulk-label', text: 'Nombre de poules' }),
      champPoules,
      el('label', { class: 'bulk-label', text: 'Répartition' }),
      selectMode,
    ]),
    apercu,
    el('div', { class: 'row', style: 'margin-top:14px' }, [
      bouton,
      dejaLa
        ? el('button', {
            class: 'btn ghost',
            text: 'Annuler',
            onClick: () => {
              ui.bulkOpen = false;
              ui.bulkText = '';
              ctx.rerender();
            },
          })
        : null,
    ]),
  ]);
}

// ------------------------------------------------------------ édition visuelle

function toolbar(state, ctx) {
  const { post } = ctx;
  const total = state.teams.length;
  const sansPoule = state.teams.filter((t) => !t.poolId).length;

  return el('div', { class: 'teams-toolbar' }, [
    el('span', { class: 'teams-count' }, [
      el('strong', { text: String(total) }),
      ` équipes · ${state.pools.length} poules`,
      sansPoule ? el('span', { class: 'bulk-warn', text: ` · ${sansPoule} sans poule` }) : null,
    ]),
    el('span', { style: 'margin-left:auto' }),
    el('button', {
      class: 'btn sm',
      text: '＋ Coller une liste',
      onClick: () => {
        ui.bulkOpen = true;
        ctx.rerender();
      },
    }),
    el('button', {
      class: 'btn sm',
      text: '🎲 Retirer au sort',
      title: 'Refaire la répartition des équipes existantes',
      onClick: async () => {
        if (!confirm('Retirer au sort la répartition des équipes dans les poules ?')) return;
        const r = await post('/api/admin/distribute', {
          poolCount: state.pools.length,
          mode: 'random',
        });
        toast(`Nouveau tirage effectué ✓${r.matchesRemoved ? ' — calendrier à régénérer' : ''}`);
      },
    }),
  ]);
}

function poolsGrid(state, ctx) {
  const colonnes = state.pools.map((pool) => poolColumn(state, ctx, pool));
  const orphelines = state.teams.filter((t) => !t.poolId);
  if (orphelines.length) colonnes.push(poolColumn(state, ctx, null, orphelines));

  const grille = el('div', { class: 'pools-grid' }, colonnes);
  if (!ui.selected) return grille;

  // Barre flottante quand une équipe est « prise » : rappelle quoi faire et
  // permet d'annuler, utile au doigt où l'équipe déplacée peut sortir de l'écran.
  const equipe = state.teams.find((t) => t.id === ui.selected);
  const barre = el('div', { class: 'move-bar' }, [
    el('span', {}, [el('strong', { text: equipe?.name || '' }), ' — touche la poule d’arrivée']),
    el('button', {
      class: 'btn sm ghost',
      text: 'Annuler',
      onClick: () => {
        ui.selected = null;
        ctx.rerender();
      },
    }),
  ]);
  return el('div', {}, [barre, grille]);
}

function poolColumn(state, ctx, pool, forced) {
  const { post } = ctx;
  const teams = forced || state.teams.filter((t) => t.poolId === pool.id);
  const cible = pool ? pool.id : null;

  const deposer = async () => {
    const id = ui.dragging || ui.selected;
    if (!id) return;
    ui.dragging = null;
    ui.selected = null;
    const equipe = state.teams.find((t) => t.id === id);
    if (equipe && equipe.poolId === cible) return ctx.rerender();
    await post('/api/admin/teams', { action: 'update', id, poolId: cible });
  };

  const col = el(
    'div',
    {
      class: `pool-col${ui.selected || ui.dragging ? ' droppable' : ''}`,
      onDragover: (e) => {
        e.preventDefault();
        col.classList.add('over');
      },
      onDragleave: () => col.classList.remove('over'),
      onDrop: (e) => {
        e.preventDefault();
        col.classList.remove('over');
        deposer();
      },
      onClick: (e) => {
        // Tap-to-move : on a choisi une équipe, on touche la poule d'arrivée.
        if (ui.selected && !e.target.closest('.team-chip')) deposer();
      },
    },
    [
      el('div', { class: 'pool-col-head' }, [
        pool
          ? el('input', {
              class: 'pool-name',
              value: pool.name,
              onChange: (e) =>
                post('/api/admin/pools', {
                  action: 'rename',
                  id: pool.id,
                  name: e.target.value,
                }),
            })
          : el('span', { class: 'pool-name orphan', text: 'Sans poule' }),
        el('span', { class: 'pool-size', text: String(teams.length) }),
      ]),
      el('div', { class: 'pool-col-body' }, teams.map((t) => teamChip(state, ctx, t))),
      pool
        ? el('input', {
            class: 'pool-add',
            placeholder: '+ ajouter',
            onKeydown: (e) => {
              if (e.key !== 'Enter' || !e.target.value.trim()) return;
              post('/api/admin/teams', {
                action: 'addMany',
                names: e.target.value,
                poolId: pool.id,
              });
              e.target.value = '';
            },
          })
        : null,
    ]
  );
  return col;
}

function teamChip(state, ctx, team) {
  const { post } = ctx;
  const choisie = ui.selected === team.id;

  const nom = el('span', {
    class: 'team-chip-name',
    text: team.name,
    title: 'Cliquer pour renommer',
    onClick: (e) => {
      e.stopPropagation();
      renommer(team, nom, post);
    },
  });

  return el(
    'div',
    {
      class: `team-chip${choisie ? ' picked' : ''}`,
      draggable: 'true',
      onDragstart: (e) => {
        ui.dragging = team.id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', team.id);
      },
      onDragend: () => {
        ui.dragging = null;
      },
    },
    [
      el('span', {
        class: 'team-chip-grip',
        title: 'Déplacer vers une autre poule',
        text: '⠿',
        onClick: (e) => {
          e.stopPropagation();
          ui.selected = choisie ? null : team.id;
          ctx.rerender();
        },
        // Tactile : la poignée déclenche aussi la sélection au toucher, pour
        // que « choisir puis toucher la poule » marche au doigt sans drag natif.
        onPointerdown: (e) => {
          if (e.pointerType !== 'touch') return;
          e.stopPropagation();
          ui.selected = team.id;
          ctx.rerender();
        },
      }),
      nom,
      el('button', {
        class: 'team-chip-del',
        title: 'Supprimer',
        text: '×',
        onClick: async (e) => {
          e.stopPropagation();
          if (!confirm(`Supprimer ${team.name} ?`)) return;
          await post('/api/admin/teams', { action: 'delete', id: team.id });
        },
      }),
    ]
  );
}

/** Renommage sur place : Entrée valide, Échap annule. */
function renommer(team, noeud, post) {
  const input = el('input', { class: 'team-chip-edit', value: team.name });
  noeud.replaceWith(input);
  input.focus();
  input.select();

  let fini = false;
  const terminer = async (valider) => {
    if (fini) return;
    fini = true;
    const valeur = input.value.trim();
    input.replaceWith(noeud);
    if (valider && valeur && valeur !== team.name) {
      await post('/api/admin/teams', { action: 'update', id: team.id, name: valeur });
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') terminer(true);
    if (e.key === 'Escape') terminer(false);
  });
  input.addEventListener('blur', () => terminer(true));
}
