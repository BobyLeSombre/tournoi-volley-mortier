// Onglet « Photos » : galerie partagée + prise de photo.
//
// Contraintes de perf tenues ici :
//  - l'image est réduite DANS le téléphone avant l'envoi (pas de photo brute) ;
//  - la galerie affiche des vignettes en `loading="lazy"` ;
//  - la grille se met à jour de façon incrémentale (on n'ajoute que les
//    nouvelles tuiles), donc pas de rechargement complet à chaque photo ni à
//    chaque point marqué ailleurs dans le tournoi.

import { store, api, el, toast } from './common.js';

let shell = null; // construit une seule fois
let known = new Set(); // ids déjà affichés, pour l'ajout incrémental
let lastVersion = -1;
let loading = false;

/**
 * Réduit un fichier image en dataURL JPEG, côté navigateur. `maxDim` borne le
 * plus grand côté ; on garde les proportions.
 */
function downscale(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image illisible'));
    };
    img.src = url;
  });
}

async function publier(file, addBtn) {
  if (!file || !file.type.startsWith('image/')) return;
  addBtn.classList.add('busy');
  addBtn.disabled = true;
  try {
    // Deux tailles : une pour l'affichage, une vignette légère pour la grille.
    const full = await downscale(file, 1400, 0.82);
    const thumb = await downscale(file, 480, 0.7);
    await api('/api/photos', { full, thumb });
    toast('Photo publiée ✓');
    await refresh(true);
  } catch (err) {
    toast(err.message || 'Publication impossible', true);
  } finally {
    addBtn.classList.remove('busy');
    addBtn.disabled = false;
  }
}

function buildShell(container) {
  const input = el('input', {
    type: 'file',
    accept: 'image/*',
    capture: 'environment', // ouvre l'appareil photo sur mobile
    style: 'display:none',
  });

  const addBtn = el('button', {
    class: 'photo-add',
    onClick: () => input.click(),
    html: '<span class="photo-add-plus">+</span><span class="photo-add-label">Ajouter ma photo</span>',
  });
  input.addEventListener('change', () => {
    const file = input.files[0];
    input.value = ''; // permet de reprendre deux fois la même photo
    publier(file, addBtn);
  });

  const grid = el('div', { class: 'photo-grid' }, [addBtn, input]);
  const empty = el('p', { class: 'photo-empty', text: 'Sois le premier à publier une photo du tournoi !' });

  shell = { grid, addBtn, empty };
  container.replaceChildren(
    el('div', { class: 'section-title' }, [
      el('h2', { text: 'Photos du tournoi' }),
      el('span', { text: 'partagées par tout le monde' }),
    ]),
    grid,
    empty
  );
}

function tile(p) {
  const img = el('img', {
    class: 'photo-thumb',
    src: `/photos/${p.id}_t.jpg`,
    loading: 'lazy',
    decoding: 'async',
    alt: 'Photo du tournoi',
  });
  return el('button', { class: 'photo-cell', 'data-pid': p.id, onClick: () => openLightbox(p.id) }, [img]);
}

/** Recharge l'index (léger) et met à jour la grille sans tout reconstruire. */
async function refresh(force = false) {
  if (loading) return;
  if (!force && store.photosVersion === lastVersion) return;
  loading = true;
  try {
    const { version, photos } = await fetchIndex();
    lastVersion = version;
    if (!shell) return;

    const ids = new Set(photos.map((p) => p.id));

    // Nouvelles photos : insérées juste après le bouton +, en tête de galerie.
    for (const p of photos) {
      if (known.has(p.id)) continue;
      known.add(p.id);
      shell.addBtn.after(tile(p));
    }
    // Photos retirées par la modération.
    for (const cell of [...shell.grid.querySelectorAll('.photo-cell')]) {
      if (!ids.has(cell.dataset.pid)) {
        known.delete(cell.dataset.pid);
        cell.remove();
      }
    }
    shell.empty.style.display = photos.length ? 'none' : '';
  } catch {
    /* réseau : on réessaiera au prochain changement de version */
  } finally {
    loading = false;
  }
}

async function fetchIndex() {
  const res = await fetch('/api/photos');
  if (!res.ok) throw new Error('index');
  return res.json();
}

// ------------------------------------------------------------------ lightbox

function openLightbox(id) {
  const overlay = el('div', { class: 'photo-lightbox', onClick: () => overlay.remove() }, [
    el('img', { src: `/photos/${id}.jpg`, alt: 'Photo du tournoi' }),
    el('button', { class: 'photo-close', text: '✕', title: 'Fermer' }),
  ]);
  document.body.append(overlay);
  const close = () => overlay.remove();
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', esc);
    }
  });
}

// -------------------------------------------------------------------- public

/** Appelée quand l'onglet Photos devient visible. */
export function showGallery(container) {
  if (!shell || !container.contains(shell.grid)) {
    known = new Set();
    buildShell(container);
  }
  refresh(true);
}

/** Appelée à chaque état WS : recharge seulement si la version a changé. */
export function syncGallery() {
  if (shell && store.photosVersion !== lastVersion) refresh();
}
