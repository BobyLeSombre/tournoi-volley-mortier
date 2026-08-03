// Persistance : un seul fichier JSON, écriture atomique (tmp + rename).
// Le tournoi tient largement en mémoire ; le fichier sert de filet de sécurité
// en cas de redémarrage du serveur.

import fs from 'node:fs';
import path from 'node:path';
import { emptyState } from './model.js';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'tournament.json');
const BACKUP = path.join(DATA_DIR, 'tournament.backup.json');

let writeQueued = false;
let currentState = null;

export function loadState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const file of [FILE, BACKUP]) {
    try {
      if (!fs.existsSync(file)) continue;
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && Array.isArray(parsed.matches)) {
        currentState = migrate(parsed);
        return currentState;
      }
    } catch (err) {
      console.error(`[store] lecture impossible de ${file} :`, err.message);
    }
  }
  currentState = emptyState();
  save(currentState);
  return currentState;
}

/** Complète un state chargé avec les champs ajoutés depuis sa création. */
function migrate(state) {
  const base = emptyState();
  state.config = { ...base.config, ...state.config };

  // Avant l'introduction des périodes, la durée s'appelait matchDurationSec.
  if (state.config.matchDurationSec != null && state.config.periodDurationSec == null) {
    state.config.periodDurationSec = state.config.matchDurationSec;
  }
  delete state.config.matchDurationSec;

  state.pools ||= [];
  state.teams ||= [];
  state.matches ||= [];
  // Les arbitres nommés et affectés à un terrain ont été remplacés par un
  // simple choix de terrain sur le téléphone de l'arbitre.
  delete state.referees;
  // Le barème de points par match a été abandonné : classement aux victoires,
  // puis au total des points marqués.
  delete state.config.pointsWin;
  delete state.config.pointsDraw;
  delete state.config.pointsLoss;
  // Les horaires ont été remplacés par des tours annoncés au micro.
  delete state.config.startTime;
  delete state.config.breakMin;
  for (const m of state.matches) {
    m.periods ||= state.config.periods || 1;
    m.period ||= 1;
    m.round ??= 0;
    delete m.scheduledAt; // remplacé par le numéro de tour
    if (m.remainingMs == null && m.status !== 'live') m.remainingMs = m.durationSec * 1000;
  }
  return state;
}

export function save(state) {
  currentState = state;
  state.updatedAt = Date.now();
  if (writeQueued) return;
  writeQueued = true;
  setTimeout(flush, 150); // regroupe les rafales (+1 point répété, etc.)
}

export function flush() {
  writeQueued = false;
  if (!currentState) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(FILE)) fs.copyFileSync(FILE, BACKUP);
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(currentState, null, 2), 'utf8');
    fs.renameSync(tmp, FILE);
  } catch (err) {
    console.error('[store] écriture impossible :', err.message);
  }
}

process.on('SIGINT', () => {
  flush();
  process.exit(0);
});
process.on('SIGTERM', () => {
  flush();
  process.exit(0);
});
