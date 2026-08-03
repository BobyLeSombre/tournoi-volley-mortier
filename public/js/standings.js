// Calcul des classements de poule.
// Module partagé : importé par le serveur (src/model.js) ET par le navigateur,
// pour que l'écran spectateur affiche exactement le même classement que l'API.

/**
 * Classement en deux critères seulement :
 *   1. le nombre de victoires ;
 *   2. à égalité, le total des points marqués sur l'ensemble des matchs.
 * (Puis la confrontation directe et l'ordre alphabétique, en dernier recours.)
 * Pas de barème de points par match : une victoire est une victoire.
 */
export function computeStandings(state, poolId) {
  const teams = state.teams.filter((t) => t.poolId === poolId);

  const rows = new Map(
    teams.map((t) => [
      t.id,
      {
        teamId: t.id,
        name: t.name,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        pointsFor: 0, // total des points marqués, tous matchs confondus
      },
    ])
  );

  const finished = state.matches.filter((m) => m.poolId === poolId && m.status === 'finished');

  for (const m of finished) {
    const a = rows.get(m.teamAId);
    const b = rows.get(m.teamBId);
    if (!a || !b) continue;
    a.played++;
    b.played++;
    a.pointsFor += m.scoreA;
    b.pointsFor += m.scoreB;
    if (m.scoreA > m.scoreB) {
      a.won++;
      b.lost++;
    } else if (m.scoreB > m.scoreA) {
      b.won++;
      a.lost++;
    } else {
      a.drawn++;
      b.drawn++;
    }
  }

  const list = [...rows.values()];

  const headToHead = (x, y) => {
    const m = finished.find(
      (mm) =>
        (mm.teamAId === x.teamId && mm.teamBId === y.teamId) ||
        (mm.teamAId === y.teamId && mm.teamBId === x.teamId)
    );
    if (!m) return 0;
    const xScore = m.teamAId === x.teamId ? m.scoreA : m.scoreB;
    const yScore = m.teamAId === y.teamId ? m.scoreA : m.scoreB;
    return yScore - xScore;
  };

  list.sort(
    (x, y) =>
      y.won - x.won ||
      y.pointsFor - x.pointsFor ||
      headToHead(x, y) ||
      x.name.localeCompare(y.name, 'fr')
  );
  list.forEach((r, i) => {
    r.rank = i + 1;
  });
  return list;
}

/**
 * Qualifiés pour la phase finale : les 2 premiers de chaque poule, complétés
 * par les meilleurs 3es jusqu'à une puissance de deux. Avec 6 poules de 4 :
 * 12 + 4 meilleurs troisièmes = tableau de 16 (le format de l'Euro 2016).
 * Les 3es de poules différentes se comparent comme au classement : victoires,
 * puis total de points marqués.
 */
export function qualifiedTeams(state) {
  if (!state.pools.length) return { error: 'Aucune poule.' };
  const per = state.pools.map((p) => ({ pool: p, rows: computeStandings(state, p.id) }));
  if (per.some((s) => s.rows.length < 2)) {
    return { error: 'Il faut au moins 2 équipes par poule.' };
  }

  const tag = (row, s) => ({ ...row, poolId: s.pool.id, poolName: s.pool.name });
  const byRank = (a, b) =>
    b.won - a.won || b.pointsFor - a.pointsFor || a.name.localeCompare(b.name, 'fr');

  const firsts = per.map((s) => tag(s.rows[0], s)).sort(byRank);
  const seconds = per.map((s) => tag(s.rows[1], s)).sort(byRank);
  const thirds = per.filter((s) => s.rows[2]).map((s) => tag(s.rows[2], s)).sort(byRank);

  const base = firsts.length + seconds.length;
  let size = 2;
  while (size < base) size *= 2;
  const needed = size - base;
  if (needed > thirds.length) {
    return {
      error: `Impossible de compléter un tableau de ${size} : il faudrait ${needed} troisième(s), il n'y en a que ${thirds.length}.`,
    };
  }

  const thirdsTaken = thirds.slice(0, needed);
  return {
    size,
    // Têtes de série : les 1ers d'abord (classés entre eux), puis les 2es,
    // puis les 3es repêchés.
    seeds: [...firsts, ...seconds, ...thirdsTaken],
    firsts,
    seconds,
    thirds,
    thirdsTaken,
  };
}

/**
 * Fiche complète d'une équipe pour l'écran public : sa place en poule, son
 * rang général aux points, son statut de qualification (provisoire pendant les
 * poules, définitif dès la phase finale) et son parcours.
 */
export function teamProfile(state, teamId) {
  const team = state.teams.find((t) => t.id === teamId);
  if (!team) return null;

  const pool = state.pools.find((p) => p.id === team.poolId) || null;
  const poolStanding = pool ? computeStandings(state, pool.id) : [];
  const poolRow = poolStanding.find((r) => r.teamId === teamId) || null;

  // Classement général : toutes les équipes triées comme en poule (victoires
  // puis points marqués), pour situer l'équipe dans l'ensemble du tournoi.
  const allRows = state.pools.flatMap((p) => computeStandings(state, p.id));
  allRows.sort(
    (a, b) => b.won - a.won || b.pointsFor - a.pointsFor || a.name.localeCompare(b.name, 'fr')
  );
  allRows.forEach((r, i) => {
    r.overallRank = i + 1;
  });
  const overall = allRows.find((r) => r.teamId === teamId) || null;

  const matches = state.matches
    .filter((m) => m.teamAId === teamId || m.teamBId === teamId)
    .sort((a, b) => (a.round ?? 0) - (b.round ?? 0));

  const hasBracket = state.matches.some((m) => m.stage);
  let qualif = null; // { in: bool, provisional: bool, label }
  let bracket = null; // parcours en phase finale

  // Libellés des tours du tableau. Dupliqués depuis model.js (STAGE_LABELS) :
  // standings.js est importé PAR model.js, on ne peut donc pas l'importer ici.
  const stageLabel = {
    '8e': '8e de finale',
    quart: 'Quart de finale',
    demi: 'Demi-finale',
    finale: 'Finale',
    petite: 'Petite finale',
  };

  if (hasBracket) {
    // Qualification tranchée : l'équipe est dans le tableau ou non.
    const myBracket = matches.filter((m) => m.stage && m.stage !== 'petite');
    const inBracket = state.matches.some(
      (m) => m.stage && (m.teamAId === teamId || m.teamBId === teamId)
    );
    qualif = inBracket
      ? { in: true, provisional: false, label: 'Qualifié·e pour la phase finale' }
      : { in: false, provisional: false, label: 'Non qualifié·e pour la phase finale' };

    // Où en est l'équipe dans le tableau.
    const lost = myBracket.find(
      (m) => m.status === 'finished' && m.winnerId && m.winnerId !== teamId
    );
    const finale = matches.find((m) => m.stage === 'finale' && m.status === 'finished');
    if (finale && finale.winnerId === teamId) {
      bracket = { done: true, label: '🏆 Championne du tournoi' };
    } else if (lost) {
      bracket = { done: true, label: `Éliminé·e en ${stageLabel[lost.stage].toLowerCase()}` };
    } else if (inBracket) {
      const prochain = matches.find(
        (m) => m.stage && m.stage !== 'petite' && m.status !== 'finished'
      );
      bracket = {
        done: false,
        label: prochain ? `En course — ${stageLabel[prochain.stage].toLowerCase()}` : 'En course',
      };
    }
  } else {
    // Qualification provisoire, d'après le classement à l'instant T.
    const q = qualifiedTeams(state);
    if (!q.error && poolRow) {
      const dansListe = (list) => list.some((r) => r.teamId === teamId);
      if (dansListe(q.firsts)) qualif = { in: true, provisional: true, label: `1er de ${pool.name}` };
      else if (dansListe(q.seconds)) qualif = { in: true, provisional: true, label: `2e de ${pool.name}` };
      else if (dansListe(q.thirdsTaken))
        qualif = { in: true, provisional: true, label: 'repêché·e (meilleur 3e)' };
      else if (dansListe(q.thirds))
        qualif = { in: false, provisional: true, label: `3e de ${pool.name} — hors repêchage` };
      else qualif = { in: false, provisional: true, label: `${poolRow.rank}e de ${pool.name}` };
    }
  }

  return {
    team,
    pool,
    poolStanding,
    poolRow,
    overall,
    totalTeams: allRows.length,
    matches,
    hasBracket,
    qualif,
    bracket,
    poolFinished: pool
      ? state.matches.filter((m) => m.poolId === pool.id).every((m) => m.status === 'finished') &&
        state.matches.some((m) => m.poolId === pool.id)
      : false,
  };
}
