// Stockage des photos, volontairement séparé de l'état du tournoi.
//
// Les images ne transitent JAMAIS par le WebSocket (qui rediffuse tout l'état à
// chaque point marqué) : elles sont écrites sur disque et servies comme des
// fichiers statiques. Seul un petit numéro de version circule en temps réel,
// pour que les galeries ouvertes sachent qu'il y a du nouveau.

import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');
const INDEX = path.join(PHOTOS_DIR, 'index.json');

// Réduites côté client, mais on borne quand même pour ne rien laisser passer.
const MAX_FULL = 900 * 1024;
const MAX_THUMB = 200 * 1024;
const MAX_PHOTOS = 1000;

let list = []; // { id, at } — du plus ancien au plus récent
let version = 0;

export function photosDir() {
  return PHOTOS_DIR;
}

export function load() {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
  try {
    if (fs.existsSync(INDEX)) {
      const parsed = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
      if (Array.isArray(parsed.photos)) {
        list = parsed.photos;
        version = parsed.version || list.length;
      }
    }
  } catch (err) {
    console.error('[photos] index illisible :', err.message);
    list = [];
  }
  return version;
}

function persist() {
  try {
    const tmp = `${INDEX}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version, photos: list }), 'utf8');
    fs.renameSync(tmp, INDEX);
  } catch (err) {
    console.error('[photos] écriture index impossible :', err.message);
  }
}

export function getVersion() {
  return version;
}

/** Liste pour la galerie : la plus récente d'abord, sans les données binaires. */
export function listPhotos() {
  return { version, photos: [...list].reverse() };
}

function randomId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Décode une dataURL JPEG en buffer, en refusant tout ce qui dépasse. */
function decode(dataUrl, maxBytes) {
  const m = /^data:image\/(jpeg|jpg);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return { error: 'Format attendu : JPEG.' };
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) return { error: 'Image vide.' };
  if (buf.length > maxBytes) return { error: 'Image trop lourde.' };
  return { buf };
}

/** Enregistre une photo (full + vignette). Retourne { id } ou { error }. */
export function add({ full, thumb }) {
  if (list.length >= MAX_PHOTOS) return { error: 'Galerie pleine.' };
  const f = decode(full, MAX_FULL);
  if (f.error) return { error: f.error };
  const t = decode(thumb, MAX_THUMB);
  if (t.error) return { error: t.error };

  const id = randomId();
  try {
    fs.writeFileSync(path.join(PHOTOS_DIR, `${id}.jpg`), f.buf);
    fs.writeFileSync(path.join(PHOTOS_DIR, `${id}_t.jpg`), t.buf);
  } catch (err) {
    return { error: 'Écriture impossible : ' + err.message };
  }
  list.push({ id, at: Date.now() });
  version++;
  persist();
  return { id };
}

export function count() {
  return list.length;
}

/**
 * Prépare les photos pour un ZIP de sauvegarde : uniquement les vraies photos
 * (pas les vignettes), en ordre chronologique, renommées lisiblement avec la
 * date de prise de vue.
 */
export function exportBuffers() {
  return list
    .map((p, i) => {
      const file = path.join(PHOTOS_DIR, `${p.id}.jpg`);
      if (!fs.existsSync(file)) return null;
      const d = new Date(p.at);
      const pad = (n) => String(n).padStart(2, '0');
      const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}h${pad(d.getMinutes())}`;
      return {
        name: `photo-${String(i + 1).padStart(3, '0')}_${stamp}.jpg`,
        buf: fs.readFileSync(file),
      };
    })
    .filter(Boolean);
}

export function remove(id) {
  const before = list.length;
  list = list.filter((p) => p.id !== id);
  if (list.length === before) return { error: 'Photo introuvable.' };
  for (const suffix of ['.jpg', '_t.jpg']) {
    try {
      fs.unlinkSync(path.join(PHOTOS_DIR, `${id}${suffix}`));
    } catch {
      /* déjà absent : on ignore */
    }
  }
  version++;
  persist();
  return { ok: true };
}
