// Phase finale : tableau visuel (arbre 8es → finale) + podium à confettis.
// Utilisé par l'onglet « Phase finale » et par l'écran géant.

import { el, teamName, sideName } from './common.js';

/** Le tournoi a-t-il une phase finale générée ? */
export function hasBracket(state) {
  return state.matches.some((m) => m.stage);
}

/** 1er / 2e / 3e une fois la finale (et la petite finale) jouées. */
export function podium(state) {
  const finale = state.matches.find(
    (m) => m.stage === 'finale' && m.status === 'finished' && m.winnerId && m.winnerId !== 'draw'
  );
  if (!finale) return null;
  const champion = finale.winnerId;
  const finalist = finale.winnerId === finale.teamAId ? finale.teamBId : finale.teamAId;
  const petite = state.matches.find(
    (m) => m.stage === 'petite' && m.status === 'finished' && m.winnerId && m.winnerId !== 'draw'
  );
  return { champion, finalist, third: petite ? petite.winnerId : null };
}

// ------------------------------------------------------------------ podium

export function renderPodium(state) {
  const p = podium(state);
  if (!p) return null;

  const marche = (place, medaille, teamId, rang) =>
    el('div', { class: `podium-step ${place}` }, [
      el('div', { class: 'podium-medal', text: medaille }),
      el('div', { class: 'podium-name', text: teamId ? teamName(state, teamId) : '—' }),
      el('div', { class: 'podium-bar' }, [el('span', { text: rang })]),
    ]);

  return el('div', { class: 'podium-wrap' }, [
    el('div', { class: 'podium-title' }, [
      el('span', { class: 'podium-trophy', text: '🏆' }),
      el('strong', { text: teamName(state, p.champion) }),
      ' remporte le tournoi !',
    ]),
    el('div', { class: 'podium' }, [
      marche('second', '🥈', p.finalist, '2'),
      marche('first', '🥇', p.champion, '1'),
      marche('third', '🥉', p.third, '3'),
    ]),
  ]);
}

// ------------------------------------------------------------- arbre visuel

const STAGES = [
  ['8e', '8es de finale'],
  ['quart', 'Quarts'],
  ['demi', 'Demies'],
  ['finale', 'Finale'],
];

function bracketSlot(state, m, side) {
  const id = side === 'A' ? m.teamAId : m.teamBId;
  const finished = m.status === 'finished';
  const live = m.status === 'live' || m.status === 'paused';
  const gagnant = finished && m.winnerId === id && m.winnerId !== 'draw';
  const perdant = finished && m.winnerId && m.winnerId !== id && m.winnerId !== 'draw';

  // La finale s'affiche en sets gagnés ; les autres matchs en points.
  const score =
    m.format === 'sets'
      ? side === 'A'
        ? m.setsA
        : m.setsB
      : side === 'A'
        ? m.scoreA
        : m.scoreB;

  return el('div', { class: `bm-slot${gagnant ? ' win' : ''}${perdant ? ' lose' : ''}` }, [
    el('span', { class: 'bm-team', text: sideName(state, m, side) }),
    el('span', { class: 'bm-score', text: finished || live ? String(score) : '' }),
  ]);
}

function bracketMatch(state, m) {
  const live = m.status === 'live' || m.status === 'paused';
  const finished = m.status === 'finished';
  const champion = m.stage === 'finale' && finished && m.winnerId && m.winnerId !== 'draw';
  return el('div', { class: `bm${live ? ' live' : ''}${finished ? ' done' : ''}${champion ? ' champ' : ''}` }, [
    bracketSlot(state, m, 'A'),
    bracketSlot(state, m, 'B'),
  ]);
}

export function renderBracket(state) {
  const cols = STAGES.map(([stage, label]) => {
    const ms = state.matches
      .filter((m) => m.stage === stage)
      .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
    if (!ms.length) return null;
    return el('div', { class: 'br-col' }, [
      el('div', { class: 'br-col-head', text: label }),
      el('div', { class: 'br-col-body' }, ms.map((m) => bracketMatch(state, m))),
    ]);
  }).filter(Boolean);

  const petite = state.matches.find((m) => m.stage === 'petite');

  return el('div', {}, [
    el('div', { class: 'bracket-scroll' }, [el('div', { class: 'bracket' }, cols)]),
    petite
      ? el('div', { class: 'petite-final' }, [
          el('div', { class: 'br-col-head', text: 'Petite finale · 3e place' }),
          bracketMatch(state, petite),
        ])
      : null,
  ]);
}

/** Vue complète de l'onglet : podium (si fini) au-dessus, puis l'arbre. */
export function renderFinals(container, state) {
  container.replaceChildren(
    ...[
      el('div', { class: 'section-title' }, [
        el('h2', { text: 'Phase finale' }),
        el('span', { text: 'du tableau à élimination' }),
      ]),
      renderPodium(state),
      renderBracket(state),
    ].filter(Boolean)
  );
}

// ----------------------------------------------------------------- confettis

let confettiActif = false;

export function confettiBurst(durationMs = 5000) {
  if (confettiActif) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  confettiActif = true;

  const canvas = el('canvas', { class: 'confetti-canvas' });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const resize = () => {
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);

  const couleurs = ['#1c9409', '#ffcc33', '#ff7a1a', '#2ee66b', '#ffffff', '#147006'];
  const parts = Array.from({ length: 180 }, () => ({
    x: Math.random() * innerWidth,
    y: -20 - Math.random() * innerHeight * 0.5,
    r: 4 + Math.random() * 7,
    c: couleurs[(Math.random() * couleurs.length) | 0],
    vx: -2 + Math.random() * 4,
    vy: 2 + Math.random() * 4,
    rot: Math.random() * 6.28,
    vr: -0.2 + Math.random() * 0.4,
  }));

  const start = performance.now();
  function frame(t) {
    const e = t - start;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.05;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6);
      ctx.restore();
    }
    canvas.style.opacity = e > durationMs - 900 ? Math.max(0, (durationMs - e) / 900) : '1';
    if (e < durationMs) {
      requestAnimationFrame(frame);
    } else {
      window.removeEventListener('resize', resize);
      canvas.remove();
      confettiActif = false;
    }
  }
  requestAnimationFrame(frame);
}
