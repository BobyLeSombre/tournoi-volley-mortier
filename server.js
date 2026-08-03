// Serveur du tournoi : API REST pour les mutations, WebSocket pour la diffusion
// temps réel de l'état complet à tous les écrans connectés.

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode-svg';

import * as M from './src/model.js';
import { loadState, save, flush } from './src/store.js';
import * as Photos from './src/photos.js';
import { createStoreZip } from './src/zip.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5183;

let state = loadState();
Photos.load();

// Sur un hébergement public, on remplace les identifiants par défaut par ceux
// fournis en variables d'environnement. Un mot de passe déjà personnalisé
// depuis l'interface admin n'est jamais écrasé.
if (process.env.ADMIN_PASSWORD && state.config.adminPassword === 'admin') {
  state.config.adminPassword = process.env.ADMIN_PASSWORD;
}
if (process.env.REFEREE_PIN && state.config.refereePin === '1234') {
  state.config.refereePin = process.env.REFEREE_PIN;
}

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
    },
  })
);

// Les fichiers photos : immuables (leur id est unique), donc cache long. C'est
// ce qui évite de les recharger et fait que la galerie ne rame pas.
app.use(
  '/photos',
  express.static(Photos.photosDir(), { maxAge: '365d', immutable: true, fallthrough: false })
);

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// ------------------------------------------------------------- diffusion live

const timers = new Map(); // matchId -> timeout de fin de chrono

/**
 * Terrains occupés par un arbitre connecté. Empêche deux arbitres de saisir le
 * même match sans le savoir. La réservation est liée à la connexion : elle
 * disparaît quand l'arbitre change de terrain ou ferme sa page.
 */
const claims = new Map(); // terrain -> WebSocket
const releaseTimers = new Map(); // terrain -> timeout de libération différée
const GRACE_MS = 60_000; // téléphone en veille ou réseau qui saute

function occupiedCourts() {
  return [...claims.keys()];
}

function claimCourt(ws, court) {
  releaseCourt(ws, { silent: true });
  if (!court) return;
  clearTimeout(releaseTimers.get(court));
  releaseTimers.delete(court);
  claims.set(court, ws);
  ws.court = court;
  broadcast();
}

function releaseCourt(ws, { silent = false, differe = false } = {}) {
  const court = ws.court;
  if (!court) return;
  ws.court = null;
  if (claims.get(court) !== ws) return;

  const liberer = () => {
    if (claims.get(court) === ws) claims.delete(court);
    releaseTimers.delete(court);
    broadcast();
  };

  if (differe) {
    // Déconnexion subie : on garde le terrain réservé un moment, le temps que
    // l'arbitre revienne, plutôt que de le libérer pour un simple écran verrouillé.
    releaseTimers.set(court, setTimeout(liberer, GRACE_MS));
  } else {
    claims.delete(court);
    if (!silent) broadcast();
  }
}

function broadcast() {
  const payload = JSON.stringify({
    type: 'state',
    serverNow: Date.now(),
    occupiedCourts: occupiedCourts(),
    // Juste un compteur : les galeries ouvertes rechargent l'index quand il
    // change. Aucune image ne passe par le WebSocket.
    photosVersion: Photos.getVersion(),
    state: M.publicState(state),
  });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

/** Programme un réveil à la fin du chrono pour rediffuser « temps écoulé ». */
function scheduleTimerEnd(match) {
  clearTimeout(timers.get(match.id));
  timers.delete(match.id);
  if (match.status !== 'live' || !match.endsAt) return;
  const delay = match.endsAt - Date.now();
  if (delay < 0) return;
  timers.set(
    match.id,
    setTimeout(() => {
      timers.delete(match.id);
      broadcast();
    }, delay + 50)
  );
}

function commit(match) {
  if (match) scheduleTimerEnd(match);
  M.propagateBracket(state); // les vainqueurs avancent dans le tableau final
  save(state);
  broadcast();
}

wss.on('connection', (ws) => {
  ws.court = null;
  ws.send(
    JSON.stringify({
      type: 'state',
      serverNow: Date.now(),
      occupiedCourts: occupiedCourts(),
      photosVersion: Photos.getVersion(),
      state: M.publicState(state),
    })
  );

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // message illisible : on ignore
    }
    // Seule la réservation de terrain transite par le WebSocket ; toute
    // modification de score passe par l'API REST, protégée par le code arbitre.
    if (msg?.type === 'claim-court' && msg.pin === state.config.refereePin) {
      claimCourt(ws, String(msg.court || '').slice(0, 60));
    } else if (msg?.type === 'release-court') {
      releaseCourt(ws);
    }
  });

  ws.on('close', () => releaseCourt(ws, { differe: true }));
  ws.on('error', () => {});
});

// Ping périodique : garde la connexion ouverte derrière les proxies (Render…)
setInterval(() => {
  for (const client of wss.clients) {
    if (client.readyState === 1) client.ping();
  }
}, 25000);

// ------------------------------------------------------------------- helpers

function fail(res, code, message) {
  res.status(code).json({ error: message });
  return null;
}

function requireAdmin(req, res) {
  const pwd = req.get('x-admin-password') || req.body?.adminPassword;
  if (pwd !== state.config.adminPassword) return fail(res, 401, 'Mot de passe admin incorrect');
  return true;
}

function requireRef(req, res) {
  const pin = req.get('x-ref-pin') || req.body?.pin;
  if (pin !== state.config.refereePin && pin !== state.config.adminPassword) {
    return fail(res, 401, 'Code arbitre incorrect');
  }
  return true;
}

function getMatch(req, res) {
  const match = M.findMatch(state, req.params.id);
  if (!match) return fail(res, 404, 'Match introuvable');
  return match;
}

// ---------------------------------------------------------------- API commune

app.get('/api/state', (req, res) => {
  res.json({ serverNow: Date.now(), state: M.publicState(state) });
});

/**
 * QR code d'une adresse, en SVG. Public : il ne fait qu'encoder ce qu'on lui
 * passe, il ne divulgue rien de lui-même. Sert à afficher et imprimer les QR
 * de l'espace Organisation via une simple balise <img>.
 */
app.get('/api/qr.svg', (req, res) => {
  const data = String(req.query.data || '').slice(0, 1000);
  if (!data) return res.status(400).send('data manquant');
  const size = Math.max(80, Math.min(1200, Number(req.query.size) || 260));
  try {
    const svg = new QRCode({
      content: data,
      padding: 1,
      width: size,
      height: size,
      color: '#101511',
      background: '#ffffff',
      ecl: 'M', // tolère un QR imprimé un peu abîmé ou photographié de travers
      join: true,
      container: 'svg-viewbox',
    }).svg();
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
  } catch (err) {
    res.status(500).send('QR impossible : ' + err.message);
  }
});

// ------------------------------------------------------------------ photos

app.get('/api/photos', (req, res) => {
  res.json(Photos.listPhotos());
});

// Sauvegarde : toutes les photos dans un ZIP. Réservé à l'organisation.
app.get('/api/photos/export', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const files = Photos.exportBuffers();
  if (!files.length) return fail(res, 400, 'Aucune photo à sauvegarder');
  const zip = createStoreZip(files);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="photos-tournoi-volley-mortier.zip"');
  res.send(zip);
});

app.post('/api/photos', (req, res) => {
  const { full, thumb } = req.body || {};
  const r = Photos.add({ full, thumb });
  if (r.error) return fail(res, 400, r.error);
  broadcast(); // bump du photosVersion → les galeries se rafraîchissent
  res.json({ ok: true, id: r.id });
});

app.delete('/api/photos/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const r = Photos.remove(req.params.id);
  if (r.error) return fail(res, 404, r.error);
  broadcast();
  res.json({ ok: true });
});

app.get('/api/round', (req, res) => {
  res.json(M.roundProgress(state) || { round: null, termine: true });
});

app.get('/api/standings', (req, res) => {
  res.json(
    state.pools.map((p) => ({
      poolId: p.id,
      name: p.name,
      rows: M.computeStandings(state, p.id),
    }))
  );
});

app.post('/api/auth/referee', (req, res) => {
  const pin = req.body?.pin;
  const ok = pin === state.config.refereePin || pin === state.config.adminPassword;
  res.json({ ok });
});

app.post('/api/auth/admin', (req, res) => {
  const ok = req.body?.password === state.config.adminPassword;
  // Le code arbitre n'est jamais diffusé dans le state public : l'organisateur
  // le récupère ici pour pouvoir le communiquer aux arbitres.
  res.json(ok ? { ok, refereePin: state.config.refereePin } : { ok });
});

// --------------------------------------------------------------- API arbitre

app.post('/api/ref/match/:id/score', (req, res) => {
  if (!requireRef(req, res)) return;
  const match = getMatch(req, res);
  if (!match) return;
  if (match.status === 'finished') return fail(res, 409, 'Match déjà terminé');

  const { team, delta, value } = req.body || {};
  if (team !== 'A' && team !== 'B') return fail(res, 400, 'Équipe invalide');
  const key = team === 'A' ? 'scoreA' : 'scoreB';
  const next = value != null ? Number(value) : match[key] + Number(delta || 0);
  match[key] = Math.max(0, Math.min(999, Math.round(next) || 0));

  // Premier point marqué : on lance le chrono automatiquement.
  if (match.status === 'pending' && delta > 0) M.startTimer(match);

  commit(match);
  res.json({ ok: true, match });
});

app.post('/api/ref/match/:id/timer', (req, res) => {
  if (!requireRef(req, res)) return;
  const match = getMatch(req, res);
  if (!match) return;
  const { action, seconds } = req.body || {};

  if (action === 'start') M.startTimer(match);
  else if (action === 'pause') M.pauseTimer(match);
  else if (action === 'reset') M.resetTimer(match);
  else if (action === 'add') M.addTime(match, Number(seconds) || 60);
  else if (action === 'next-period') {
    if (!M.nextPeriod(match)) return fail(res, 409, 'Dernière période déjà en cours');
  } else if (action === 'previous-period') {
    if (!M.previousPeriod(match)) return fail(res, 409, 'Déjà à la première période');
  } else return fail(res, 400, 'Action inconnue');

  commit(match);
  res.json({ ok: true, match });
});

app.post('/api/ref/match/:id/finish', (req, res) => {
  if (!requireRef(req, res)) return;
  const match = getMatch(req, res);
  if (!match) return;
  // Pas de match nul en phase finale : point en or jusqu'à ce qu'on marque.
  if (match.stage && match.scoreA === match.scoreB) {
    return fail(res, 409, 'Égalité — en phase finale, point en or : le prochain point décide');
  }
  M.finishMatch(state, match);
  commit(match);
  res.json({ ok: true, match });
});

app.post('/api/ref/match/:id/reopen', (req, res) => {
  if (!requireRef(req, res)) return;
  const match = getMatch(req, res);
  if (!match) return;
  // Rouvrir un match du tableau alors que le suivant a commencé fausserait tout.
  const dependent = state.matches.find(
    (x) => x.srcA?.matchId === match.id || x.srcB?.matchId === match.id
  );
  if (dependent && (dependent.status !== 'pending' || dependent.scoreA || dependent.scoreB)) {
    return fail(res, 409, 'Impossible : le match suivant du tableau a déjà commencé');
  }
  M.reopenMatch(match);
  commit(match);
  res.json({ ok: true, match });
});

// ----------------------------------------------------------------- API admin

app.post('/api/admin/config', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const c = req.body?.config || {};
  const cfg = state.config;

  if (typeof c.name === 'string') cfg.name = c.name.slice(0, 120);
  if (typeof c.subtitle === 'string') cfg.subtitle = c.subtitle.slice(0, 160);
  if (typeof c.date === 'string') cfg.date = c.date.slice(0, 40);
  if (c.periodDurationMin != null) {
    cfg.periodDurationSec = Math.max(60, Math.round(Number(c.periodDurationMin) * 60));
  }
  if (c.periods != null) {
    cfg.periods = Math.max(1, Math.min(5, Math.round(Number(c.periods)) || 1));
  }
  if (c.allerRetour !== undefined) cfg.allerRetour = !!c.allerRetour;
  if (Array.isArray(c.courts)) {
    cfg.courts = c.courts.map((x) => String(x).trim()).filter(Boolean).slice(0, 40);
    if (!cfg.courts.length) cfg.courts = ['Terrain 1'];
  }
  if (c.refereePin) cfg.refereePin = String(c.refereePin).slice(0, 40);
  if (c.adminPassword) cfg.adminPassword = String(c.adminPassword).slice(0, 60);

  commit();
  res.json({ ok: true });
});

app.post('/api/admin/pools', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { action, id, name, count } = req.body || {};

  if (action === 'add') {
    state.pools.push({ id: M.newId('p'), name: name || `Poule ${state.pools.length + 1}` });
  } else if (action === 'addMany') {
    const n = Math.max(1, Math.min(12, Number(count) || 1));
    for (let i = 0; i < n; i++) {
      const letter = String.fromCharCode(65 + state.pools.length);
      state.pools.push({ id: M.newId('p'), name: `Poule ${letter}` });
    }
  } else if (action === 'rename') {
    const pool = state.pools.find((p) => p.id === id);
    if (!pool) return fail(res, 404, 'Poule introuvable');
    pool.name = name || pool.name;
  } else if (action === 'delete') {
    state.pools = state.pools.filter((p) => p.id !== id);
    state.teams = state.teams.filter((t) => t.poolId !== id);
    state.matches = state.matches.filter((m) => m.poolId !== id);
  } else {
    return fail(res, 400, 'Action inconnue');
  }

  commit();
  res.json({ ok: true });
});

app.post('/api/admin/teams', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { action, id, name, names, poolId } = req.body || {};

  if (action === 'add') {
    if (!name?.trim()) return fail(res, 400, "Nom d'équipe vide");
    state.teams.push({ id: M.newId('t'), name: name.trim(), poolId: poolId || null });
  } else if (action === 'addMany') {
    const list = String(names || '')
      .split(/[\n,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const n of list) state.teams.push({ id: M.newId('t'), name: n, poolId: poolId || null });
  } else if (action === 'update') {
    const team = M.findTeam(state, id);
    if (!team) return fail(res, 404, 'Équipe introuvable');
    if (name != null) team.name = String(name).trim() || team.name;
    if (poolId !== undefined) team.poolId = poolId || null;
  } else if (action === 'delete') {
    state.teams = state.teams.filter((t) => t.id !== id);
    state.matches = state.matches.filter((m) => m.teamAId !== id && m.teamBId !== id);
  } else {
    return fail(res, 400, 'Action inconnue');
  }

  commit();
  res.json({ ok: true });
});

/** Répartit une liste d'équipes dans N poules. */
function distribute(teams, poolCount, mode) {
  const list = [...teams];
  if (mode === 'random') {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
  }

  const buckets = Array.from({ length: poolCount }, () => []);
  if (mode === 'snake') {
    // Serpentin : pour une liste classée par niveau, équilibre les poules.
    list.forEach((t, i) => {
      const tour = Math.floor(i / poolCount);
      const pos = i % poolCount;
      buckets[tour % 2 === 0 ? pos : poolCount - 1 - pos].push(t);
    });
  } else if (mode === 'random') {
    list.forEach((t, i) => buckets[i % poolCount].push(t));
  } else {
    // Dans l'ordre : blocs consécutifs, en répartissant le reste au plus juste.
    const base = Math.floor(list.length / poolCount);
    const reste = list.length % poolCount;
    let k = 0;
    for (let p = 0; p < poolCount; p++) {
      const n = base + (p < reste ? 1 : 0);
      buckets[p] = list.slice(k, k + n);
      k += n;
    }
  }
  return buckets;
}

/** Toute refonte des équipes invalide le calendrier et le tableau final. */
function dropAllMatches(state) {
  const had = state.matches.length;
  state.matches = [];
  return had;
}

app.post('/api/admin/teams-bulk', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { names, poolCount, mode = 'order', replace = true } = req.body || {};

  const list = (Array.isArray(names) ? names : [])
    .map((n) => String(n).trim().slice(0, 60))
    .filter(Boolean);
  if (!list.length) return fail(res, 400, 'Aucun nom fourni');
  if (list.length > 200) return fail(res, 400, 'Trop d’équipes (200 maximum)');

  const n = Math.max(1, Math.min(24, Math.round(Number(poolCount)) || 1));
  if (n > list.length) return fail(res, 400, "Plus de poules que d'équipes");

  const removed = dropAllMatches(state);
  if (replace) {
    state.pools = [];
    state.teams = [];
  }

  const nouvelles = list.map((name) => ({ id: M.newId('t'), name, poolId: null }));
  state.teams.push(...nouvelles);

  // On repart de zéro sur les poules : c'est une (re)distribution complète.
  state.pools = Array.from({ length: n }, (_, i) => ({
    id: M.newId('p'),
    name: `Poule ${String.fromCharCode(65 + i)}`,
  }));
  distribute(state.teams, n, mode).forEach((bucket, i) => {
    for (const t of bucket) t.poolId = state.pools[i].id;
  });

  commit();
  res.json({ ok: true, teams: state.teams.length, pools: n, matchesRemoved: removed });
});

app.post('/api/admin/distribute', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { poolCount, mode = 'order' } = req.body || {};
  if (!state.teams.length) return fail(res, 400, 'Aucune équipe à répartir');

  const n = Math.max(1, Math.min(24, Math.round(Number(poolCount)) || state.pools.length || 1));
  if (n > state.teams.length) return fail(res, 400, "Plus de poules que d'équipes");

  const removed = dropAllMatches(state);
  const anciens = state.pools.map((p) => p.name);
  state.pools = Array.from({ length: n }, (_, i) => ({
    id: M.newId('p'),
    name: anciens[i] || `Poule ${String.fromCharCode(65 + i)}`,
  }));
  distribute(state.teams, n, mode).forEach((bucket, i) => {
    for (const t of bucket) t.poolId = state.pools[i].id;
  });

  commit();
  res.json({ ok: true, pools: n, matchesRemoved: removed });
});

app.post('/api/admin/bracket', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { action, force } = req.body || {};

  if (action === 'generate') {
    const poolPending = state.matches.filter(
      (m) => m.poolId && m.status !== 'finished'
    ).length;
    if (poolPending && !force) {
      return fail(res, 409, `${poolPending} match(s) de poule pas encore terminés`);
    }
    if (state.matches.some((m) => m.stage && m.status !== 'pending') && !force) {
      return fail(res, 409, 'La phase finale a déjà commencé');
    }
    const result = M.generateBracket(state);
    if (result.error) return fail(res, 400, result.error);
    commit();
    return res.json({ ok: true, ...result });
  }

  if (action === 'delete') {
    if (state.matches.some((m) => m.stage && m.status !== 'pending') && !force) {
      return fail(res, 409, 'La phase finale a déjà commencé');
    }
    state.matches = state.matches.filter((m) => !m.stage);
    commit();
    return res.json({ ok: true });
  }

  return fail(res, 400, 'Action inconnue');
});

app.post('/api/admin/schedule', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const created = M.generateSchedule(state, {
    poolIds: req.body?.poolIds || null,
    keepFinished: !!req.body?.keepFinished,
  });
  commit();
  res.json({ ok: true, created });
});

app.post('/api/admin/matches', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { action, id, data } = req.body || {};

  if (action === 'add') {
    if (!data?.teamAId || !data?.teamBId || data.teamAId === data.teamBId) {
      return fail(res, 400, 'Choisis deux équipes différentes');
    }
    state.matches.push(M.createMatch(state, data));
    M.resequence(state);
  } else if (action === 'update') {
    const match = M.findMatch(state, id);
    if (!match) return fail(res, 404, 'Match introuvable');
    for (const k of ['court', 'label', 'teamAId', 'teamBId']) {
      if (data?.[k] !== undefined) match[k] = data[k];
    }
    if (data?.round != null) {
      match.round = Math.max(0, Math.round(Number(data.round)) || 0);
    }
    if (data?.periodDurationMin != null) {
      match.durationSec = Math.max(60, Math.round(Number(data.periodDurationMin) * 60));
      if (match.status === 'pending') match.remainingMs = match.durationSec * 1000;
    }
    if (data?.periods != null) {
      match.periods = Math.max(1, Math.min(5, Math.round(Number(data.periods)) || 1));
    }
    M.resequence(state);
  } else if (action === 'delete') {
    state.matches = state.matches.filter((m) => m.id !== id);
  } else if (action === 'deleteAll') {
    state.matches = [];
  } else {
    return fail(res, 400, 'Action inconnue');
  }

  commit();
  res.json({ ok: true });
});

app.get('/api/admin/export', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.setHeader('Content-Disposition', 'attachment; filename="tournoi.json"');
  res.json(state);
});

app.post('/api/admin/import', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const incoming = req.body?.data;
  if (!incoming || !Array.isArray(incoming.matches)) return fail(res, 400, 'Fichier invalide');
  incoming.config = { ...state.config, ...incoming.config };
  state = incoming;
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  for (const m of state.matches) scheduleTimerEnd(m);
  commit();
  res.json({ ok: true });
});

app.post('/api/admin/reset', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const scope = req.body?.scope;
  if (scope === 'scores') {
    for (const m of state.matches) {
      m.scoreA = 0;
      m.scoreB = 0;
      m.status = 'pending';
      m.period = 1;
      m.startedAt = null;
      m.endsAt = null;
      m.remainingMs = m.durationSec * 1000;
      m.finishedAt = null;
      m.winnerId = null;
    }
  } else if (scope === 'all') {
    const keep = { adminPassword: state.config.adminPassword, refereePin: state.config.refereePin };
    state = M.emptyState();
    Object.assign(state.config, keep);
  } else {
    return fail(res, 400, 'Portée inconnue');
  }
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  commit();
  res.json({ ok: true });
});

// Toute autre route → page spectateur (liens directs partagés par SMS…)
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Route inconnue' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

for (const m of state.matches) scheduleTimerEnd(m);

server.listen(PORT, () => {
  console.log(`\n  🏐 Tournoi de Volley Mortier`);
  console.log(`  Spectateurs : http://localhost:${PORT}/`);
  console.log(`  Arbitres    : http://localhost:${PORT}/arbitre.html`);
  console.log(`  Admin       : http://localhost:${PORT}/admin.html\n`);
});

process.on('exit', flush);
