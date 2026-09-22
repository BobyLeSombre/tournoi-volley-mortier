// Logo du tournoi, personnalisable depuis l'espace orga.
//
// Même principe que les photos (src/photos.js) : l'image ne transite JAMAIS par
// le WebSocket. Elle est écrite sur disque et servie comme un fichier statique ;
// seul un petit numéro de version circule en temps réel, pour que les pages
// ouvertes rechargent le logo quand il change. Sans logo perso, on retombe sur
// le logo par défaut livré dans public/logo.jpg.

import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const META = path.join(DATA_DIR, 'logo.json');
const MAX_BYTES = 1024 * 1024; // 1 Mo ; l'image est déjà réduite côté client

let meta = null; // { version, ext } quand un logo perso est défini, sinon null
let version = 0;

export function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    if (fs.existsSync(META)) {
      const parsed = JSON.parse(fs.readFileSync(META, 'utf8'));
      if (parsed && parsed.ext) {
        meta = { version: parsed.version || 1, ext: parsed.ext };
        version = meta.version;
      }
    }
  } catch (err) {
    console.error('[logo] méta illisible :', err.message);
    meta = null;
  }
  return version;
}

export function getVersion() {
  return version;
}

export function hasCustom() {
  return !!meta;
}

/** Chemin du fichier logo perso, ou null s'il faut servir le logo par défaut. */
export function filePath() {
  return meta ? path.join(DATA_DIR, `logo.${meta.ext}`) : null;
}

export function contentType() {
  return meta && meta.ext === 'png' ? 'image/png' : 'image/jpeg';
}

function persist() {
  try {
    const tmp = `${META}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(meta), 'utf8');
    fs.renameSync(tmp, META);
  } catch (err) {
    console.error('[logo] écriture méta impossible :', err.message);
  }
}

function decode(dataUrl) {
  const m = /^data:image\/(png|jpeg|jpg);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return { error: 'Format attendu : PNG ou JPEG.' };
  const ext = m[1] === 'png' ? 'png' : 'jpg';
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) return { error: 'Image vide.' };
  if (buf.length > MAX_BYTES) return { error: 'Logo trop lourd (max 1 Mo).' };
  return { ext, buf };
}

/** Remplace le logo. Retourne { ok, version } ou { error }. */
export function set(dataUrl) {
  const d = decode(dataUrl);
  if (d.error) return { error: d.error };
  // Si l'extension change, on efface l'ancien fichier pour ne pas en laisser traîner.
  if (meta && meta.ext !== d.ext) {
    try {
      fs.unlinkSync(path.join(DATA_DIR, `logo.${meta.ext}`));
    } catch {
      /* déjà absent : on ignore */
    }
  }
  try {
    fs.writeFileSync(path.join(DATA_DIR, `logo.${d.ext}`), d.buf);
  } catch (err) {
    return { error: 'Écriture impossible : ' + err.message };
  }
  version++;
  meta = { version, ext: d.ext };
  persist();
  return { ok: true, version };
}

/** Revient au logo par défaut (supprime le logo perso). */
export function clear() {
  if (meta) {
    try {
      fs.unlinkSync(path.join(DATA_DIR, `logo.${meta.ext}`));
    } catch {
      /* déjà absent : on ignore */
    }
    meta = null;
  }
  try {
    if (fs.existsSync(META)) fs.unlinkSync(META);
  } catch {
    /* on ignore */
  }
  version++; // change quand même : les pages ouvertes rechargent le logo par défaut
  return { ok: true, version };
}
