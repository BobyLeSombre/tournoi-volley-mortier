// Modèle de données + règles du tournoi.
// Le state complet tient en quelques dizaines de Ko : il est diffusé tel quel
// aux clients WebSocket à chaque changement.

// Le calcul des classements et des qualifiés vit dans public/js/ : le
// navigateur importe le même module, donc l'écran spectateur et l'API ne
// peuvent pas diverger.
import { computeStandings, qualifiedTeams } from '../public/js/standings.js';
export { computeStandings, qualifiedTeams };

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newId(prefix) {
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return `${prefix}_${s}`;
}

export function emptyState() {
  return {
    version: 1,
    config: {
      name: 'Tournoi de Volley Mortier',
      subtitle: 'Jeunesse Mortier a.s.b.l.',
      date: '',
      // Un match = `periods` périodes de `periodDurationSec`, score cumulé sur
      // l'ensemble. Changement de côté entre les deux, relancé par l'arbitre.
      periodDurationSec: 15 * 60,
      periods: 2,
      // Aller-retour : chaque paire d'une poule se rencontre deux fois, avec
      // inversion des côtés au match retour.
      allerRetour: false,
      // Pas d'horaires : les matchs sont organisés en tours. Un tour démarre
      // quand l'organisation l'annonce, et se termine quand tous ses matchs
      // sont clôturés par les arbitres.
      // Six terrains par défaut : le format habituel du tournoi (24 équipes en
      // 6 poules). Modifiable dans les réglages.
      courts: ['Terrain 1', 'Terrain 2', 'Terrain 3', 'Terrain 4', 'Terrain 5', 'Terrain 6'],
      // Pas de barème de points : le classement se fait aux victoires, puis au
      // total des points marqués (voir public/js/standings.js).
      adminPassword: 'admin',
      refereePin: '1234',
    },
    pools: [],
    teams: [],
    matches: [],
    updatedAt: Date.now(),
  };
}

/** State envoyé aux clients : sans les secrets. */
export function publicState(state) {
  const { adminPassword, refereePin, ...config } = state.config;
  return {
    version: state.version,
    config,
    pools: state.pools,
    teams: state.teams,
    matches: state.matches,
    updatedAt: state.updatedAt,
  };
}

export function findTeam(state, id) {
  return state.teams.find((t) => t.id === id) || null;
}

export function findMatch(state, id) {
  return state.matches.find((m) => m.id === id) || null;
}

// ---------------------------------------------------------------- chronomètre

/**
 * Temps restant en ms. Le serveur fait autorité : il stocke `endsAt` (timestamp
 * de fin) quand le chrono tourne, et `remainingMs` quand il est en pause.
 */
export function remainingMs(match, now = Date.now()) {
  if (match.status === 'live' && match.endsAt) return Math.max(0, match.endsAt - now);
  if (match.remainingMs != null) return Math.max(0, match.remainingMs);
  return match.durationSec * 1000;
}

export function isTimeUp(match, now = Date.now()) {
  return match.status === 'live' && remainingMs(match, now) <= 0;
}

export function startTimer(match, now = Date.now()) {
  const left = match.remainingMs != null ? match.remainingMs : match.durationSec * 1000;
  match.status = 'live';
  match.startedAt = match.startedAt || now;
  match.endsAt = now + Math.max(0, left);
  match.remainingMs = null;
}

export function pauseTimer(match, now = Date.now()) {
  match.remainingMs = remainingMs(match, now);
  match.endsAt = null;
  match.status = 'paused';
}

/** Remet à zéro le chrono de la période en cours (le score n'est pas touché). */
export function resetTimer(match) {
  match.status = match.status === 'finished' ? 'finished' : 'pending';
  match.startedAt = null;
  match.endsAt = null;
  match.remainingMs = match.durationSec * 1000;
}

export function isLastPeriod(match) {
  return (match.period || 1) >= (match.periods || 1);
}

/** Fin de période atteinte : le chrono est à zéro. */
export function isPeriodOver(match, now = Date.now()) {
  return match.status !== 'finished' && remainingMs(match, now) <= 0;
}

/**
 * Passe à la période suivante et relance le chrono. Le score est cumulé sur
 * tout le match : on ne le remet pas à zéro.
 */
export function nextPeriod(match, now = Date.now()) {
  if (isLastPeriod(match)) return false;
  match.period = (match.period || 1) + 1;
  match.remainingMs = match.durationSec * 1000;
  match.endsAt = null;
  startTimer(match, now);
  return true;
}

/** Retour à la période précédente, en cas de fausse manœuvre de l'arbitre. */
export function previousPeriod(match) {
  if ((match.period || 1) <= 1) return false;
  match.period -= 1;
  match.remainingMs = 0; // on le repose en fin de période, prêt à être prolongé
  match.endsAt = null;
  match.status = 'paused';
  return true;
}

export function addTime(match, seconds, now = Date.now()) {
  if (match.status === 'live' && match.endsAt) {
    match.endsAt = Math.max(now, match.endsAt + seconds * 1000);
  } else {
    match.remainingMs = Math.max(0, remainingMs(match, now) + seconds * 1000);
  }
}

// --------------------------------------------------------------------- tours

/** Tour suivant le dernier programmé — pour un match ajouté à la main. */
export function nextFreeRound(state) {
  if (!state.matches.length) return 0;
  return Math.max(...state.matches.map((m) => m.round ?? 0)) + 1;
}

/**
 * Le tour en cours : le premier dont tous les matchs ne sont pas clôturés.
 * C'est lui que l'organisation annonce au micro, et il se termine quand le
 * dernier arbitre a validé son résultat.
 */
export function currentRound(state) {
  const rounds = [...new Set(state.matches.map((m) => m.round ?? 0))].sort((a, b) => a - b);
  for (const r of rounds) {
    const list = state.matches.filter((m) => (m.round ?? 0) === r);
    if (list.some((m) => m.status !== 'finished')) return r;
  }
  return null; // tournoi terminé
}

/**
 * Match d'un tour PLUS LOIN que le tour en cours : à verrouiller tant que le
 * tour précédent n'est pas terminé sur tous les terrains.
 */
export function isFutureRound(state, match) {
  const cur = currentRound(state);
  return cur != null && (match.round ?? 0) > cur;
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

// ------------------------------------------------------------------- matchs

export function createMatch(state, data) {
  const durationSec = data.durationSec || state.config.periodDurationSec;
  const periods = data.periods || state.config.periods || 1;
  return {
    id: newId('m'),
    periods,
    period: 1, // période en cours (1..periods)
    poolId: data.poolId || null,
    label: data.label || null, // pour les matchs hors poule (demi-finale…)
    teamAId: data.teamAId,
    teamBId: data.teamBId,
    court: data.court || state.config.courts[0] || 'Terrain 1',
    durationSec, // durée d'UNE période
    round: data.round ?? nextFreeRound(state), // tour (0-indexé), pas d'horaire
    order: data.order ?? state.matches.length,
    status: 'pending',
    scoreA: 0,
    scoreB: 0,
    startedAt: null,
    endsAt: null,
    remainingMs: durationSec * 1000,
    finishedAt: null,
    winnerId: null, // id d'équipe, ou 'draw'
  };
}

export function finishMatch(state, match, now = Date.now()) {
  if (match.status === 'live') pauseTimer(match, now);
  match.status = 'finished';
  match.finishedAt = now;
  match.winnerId =
    match.scoreA > match.scoreB
      ? match.teamAId
      : match.scoreB > match.scoreA
        ? match.teamBId
        : 'draw';
}

export function reopenMatch(match) {
  match.status = 'paused';
  match.finishedAt = null;
  match.winnerId = null;
  match.period = match.periods || 1; // on rouvre sur la dernière période
}

// ---------------------------------------------------------------- calendrier

/**
 * Aller-retour : on rejoue tous les tours en inversant les côtés, de sorte que
 * chaque paire se rencontre deux fois. Les tours retour sont placés APRÈS tous
 * les tours aller, pour que les équipes s'affrontent à nouveau le plus tard
 * possible.
 */
function withReturnLegs(rounds) {
  return [...rounds, ...rounds.map((pairs) => pairs.map(([a, b]) => [b, a]))];
}

/** Méthode du cercle : rounds où chaque équipe joue au plus une fois. */
function roundRobin(teamIds) {
  const t = [...teamIds];
  if (t.length < 2) return [];
  if (t.length % 2 === 1) t.push(null); // équipe exempte
  const n = t.length;
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = t[i];
      const b = t[n - 1 - i];
      if (a && b) pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    t.splice(1, 0, t.pop()); // rotation en gardant t[0] fixe
  }
  return rounds;
}

/**
 * Génère tous les matchs de poules, puis les répartit en tours :
 * un tour = autant de matchs que de terrains, sans qu'une équipe joue deux
 * fois dans le même tour. Aucun horaire : c'est l'organisation qui lance
 * chaque tour au micro.
 */
export function generateSchedule(state, { poolIds = null, keepFinished = false } = {}) {
  const targetPools = state.pools.filter((p) => !poolIds || poolIds.includes(p.id));
  const targetIds = new Set(targetPools.map((p) => p.id));

  const kept = state.matches.filter((m) => {
    // Un tableau final repose sur le classement des poules : régénérer les
    // poules l'invalide, on le supprime (les matchs manuels hors poule restent).
    if (m.stage) return false;
    if (m.poolId == null) return true; // matchs hors poule saisis à la main
    if (!targetIds.has(m.poolId)) return true;
    return keepFinished && m.status === 'finished';
  });

  // Affrontements déjà disputés. On compte les occurrences plutôt que de les
  // marquer : en aller-retour une même paire doit légitimement figurer deux
  // fois, et n'avoir joué que l'aller ne doit pas supprimer le retour.
  const pairKey = (a, b) => [a, b].sort().join('|');
  const dejaJoue = new Map();
  for (const m of kept) {
    if (m.poolId == null || !targetIds.has(m.poolId)) continue;
    const k = pairKey(m.teamAId, m.teamBId);
    dejaJoue.set(k, (dejaJoue.get(k) || 0) + 1);
  }

  // File d'attente : tous les affrontements, triés par numéro de tour puis par poule.
  const queue = [];
  for (const pool of targetPools) {
    const teamIds = state.teams.filter((t) => t.poolId === pool.id).map((t) => t.id);
    let rounds = roundRobin(teamIds);
    if (state.config.allerRetour) rounds = withReturnLegs(rounds);
    rounds.forEach((pairs, roundIdx) => {
      for (const [a, b] of pairs) {
        const k = pairKey(a, b);
        const reste = dejaJoue.get(k) || 0;
        if (reste > 0) {
          dejaJoue.set(k, reste - 1); // cette rencontre est déjà au calendrier
          continue;
        }
        queue.push({ poolId: pool.id, a, b, round: roundIdx });
      }
    });
  }
  queue.sort((x, y) => x.round - y.round);

  const courts = state.config.courts.length ? state.config.courts : ['Terrain 1'];
  const slots = [];
  const pending = [...queue];
  while (pending.length) {
    const used = new Set();
    const slot = [];
    for (let i = 0; i < pending.length && slot.length < courts.length; ) {
      const m = pending[i];
      if (used.has(m.a) || used.has(m.b)) {
        i++;
        continue;
      }
      used.add(m.a);
      used.add(m.b);
      slot.push(m);
      pending.splice(i, 1);
    }
    slots.push(slot);
  }

  // En cours de tournoi, la reprise s'ajoute après le dernier tour conservé.
  const premierTour = keepFinished && kept.length ? nextFreeRound({ matches: kept }) : 0;

  const generated = [];
  slots.forEach((slot, slotIdx) => {
    slot.forEach((m, courtIdx) => {
      const round = premierTour + slotIdx;
      generated.push(
        createMatch(state, {
          poolId: m.poolId,
          teamAId: m.a,
          teamBId: m.b,
          court: courts[courtIdx],
          round,
          order: round * 100 + courtIdx,
        })
      );
    });
  });

  state.matches = [...kept, ...generated];
  resequence(state);
  return generated.length;
}

/** Renumérote `order` d'après le tour puis le terrain. */
export function resequence(state) {
  const courts = state.config.courts;
  state.matches.sort((a, b) => {
    const ra = a.round ?? 0;
    const rb = b.round ?? 0;
    if (ra !== rb) return ra - rb;
    return courts.indexOf(a.court) - courts.indexOf(b.court);
  });
  state.matches.forEach((m, i) => {
    m.order = i;
  });
}

// -------------------------------------------------------------- phase finale

export const STAGE_LABELS = {
  '8e': '8e de finale',
  quart: 'Quart de finale',
  demi: 'Demi-finale',
  finale: 'Finale',
  petite: 'Petite finale',
};

const STAGES_BY_SIZE = {
  16: ['8e', 'quart', 'demi', 'finale'],
  8: ['quart', 'demi', 'finale'],
  4: ['demi', 'finale'],
  2: ['finale'],
};

/**
 * Ordre de placement standard des têtes de série dans un tableau à n places :
 * le 1er ne peut croiser le 2e qu'en finale, etc.
 */
function bracketSeedOrder(n) {
  let arr = [1];
  while (arr.length < n) {
    const m = arr.length * 2;
    const next = [];
    for (const s of arr) next.push(s, m + 1 - s);
    arr = next;
  }
  return arr;
}

/**
 * Génère toute la phase finale à partir des classements : premier tour avec
 * les qualifiés, puis les tours suivants reliés par `srcA`/`srcB` — les
 * vainqueurs y avancent automatiquement (`propagateBracket`). Une petite
 * finale oppose les perdants des demies.
 */
export function generateBracket(state) {
  const q = qualifiedTeams(state);
  if (q.error) return q;

  state.matches = state.matches.filter((m) => !m.stage); // remplace l'existant
  const courts = state.config.courts.length ? state.config.courts : ['Terrain 1'];

  // Paires du premier tour, par têtes de série.
  const order = bracketSeedOrder(q.size);
  const pairs = [];
  for (let i = 0; i < order.length; i += 2) {
    pairs.push([q.seeds[order[i] - 1], q.seeds[order[i + 1] - 1]]);
  }

  // Anti-revanche : deux équipes de la même poule ne se recroisent pas au
  // premier tour. On échange les « bas de paire » (léger accroc au seeding,
  // assumé pour un tournoi amateur).
  for (let i = 0; i < pairs.length; i++) {
    for (let j = 0; j < pairs.length && pairs[i][0].poolId === pairs[i][1].poolId; j++) {
      if (i === j) continue;
      const [aj, bj] = pairs[j];
      if (bj.poolId !== pairs[i][0].poolId && aj.poolId !== pairs[i][1].poolId) {
        [pairs[i][1], pairs[j][1]] = [pairs[j][1], pairs[i][1]];
      }
    }
  }

  const stages = STAGES_BY_SIZE[q.size];
  let round = nextFreeRound(state);
  let prev = null;
  const created = [];

  for (const stage of stages) {
    const count = prev ? prev.length / 2 : pairs.length;
    const list = [];
    for (let slot = 0; slot < count; slot++) {
      const m = createMatch(state, {
        label: STAGE_LABELS[stage] + (count > 1 ? ` ${slot + 1}` : ''),
        teamAId: prev ? null : pairs[slot][0].teamId,
        teamBId: prev ? null : pairs[slot][1].teamId,
        court: courts[slot % courts.length],
        round: round + Math.floor(slot / courts.length),
        order: 0,
      });
      m.stage = stage;
      m.slot = slot;
      if (prev) {
        m.srcA = { matchId: prev[2 * slot].id, take: 'winner' };
        m.srcB = { matchId: prev[2 * slot + 1].id, take: 'winner' };
      }
      state.matches.push(m);
      list.push(m);
      created.push(m);
    }
    round += Math.ceil(count / courts.length);

    // La petite finale se joue en même temps que la finale, sur un autre terrain.
    if (stage === 'finale' && prev && prev.length === 2) {
      const pf = createMatch(state, {
        label: STAGE_LABELS.petite,
        teamAId: null,
        teamBId: null,
        court: courts[1 % courts.length],
        round: round - 1,
        order: 0,
      });
      pf.stage = 'petite';
      pf.slot = 0;
      pf.srcA = { matchId: prev[0].id, take: 'loser' };
      pf.srcB = { matchId: prev[1].id, take: 'loser' };
      state.matches.push(pf);
      created.push(pf);
    }
    prev = list;
  }

  propagateBracket(state);
  resequence(state);
  return { created: created.length, size: q.size };
}

/**
 * Remplit les équipes des matchs du tableau à partir des résultats précédents.
 * Ne touche jamais un match déjà entamé ; si un match source est rouvert, la
 * place redevient « en attente ».
 */
export function propagateBracket(state) {
  for (const m of state.matches) {
    if (!m.srcA && !m.srcB) continue;
    if (m.status !== 'pending' || m.scoreA || m.scoreB) continue;
    for (const side of ['A', 'B']) {
      const src = side === 'A' ? m.srcA : m.srcB;
      if (!src) continue;
      const from = findMatch(state, src.matchId);
      let team = null;
      if (from && from.status === 'finished' && from.winnerId && from.winnerId !== 'draw') {
        team =
          src.take === 'loser'
            ? from.winnerId === from.teamAId
              ? from.teamBId
              : from.teamAId
            : from.winnerId;
      }
      m[side === 'A' ? 'teamAId' : 'teamBId'] = team;
    }
  }
}
