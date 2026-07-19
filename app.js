/**
 * ═══════════════════════════════════════════════════════════════
 * StarBeer — Application de suivi de dégustation de bières
 * Toutes les données sont sauvegardées dans IndexedDB
 * ═══════════════════════════════════════════════════════════════
 * Architecture :
 *   - DB        : couche d'accès à IndexedDB (open, get, getAll, save, delete)
 *   - State     : état applicatif (liste beers, tri, recherche)
 *   - Renderer  : construction du DOM (cartes, modales)
 *   - Events    : gestionnaires d'événements (click, long-press, submit…)
 *   - Photos    : conversion WebP, capture caméra, galerie
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

// ─────────────────────────────────────────────────────────────
// CONSTANTES & CONFIGURATION
// ─────────────────────────────────────────────────────────────
const DB_NAME    = 'StarBeerDB';
const DB_VERSION = 1;
const STORE_NAME = 'beers';

const CONTAINERS = [
    'Bouteille en verre','Bouteille en plastique',
    'Canette','Brique carton','Fût','Verre (pression)','Growler'
];

// Durée du "long press" pour ouvrir le formulaire de modification (ms)
const LONG_PRESS_DURATION = 2500;

// ─────────────────────────────────────────────────────────────
// BASE DE DONNÉES INDEXEDDB
// ─────────────────────────────────────────────────────────────
const DB = {
    /** Ouvre (ou crée) la base IndexedDB */
    open() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);

            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, {
                        keyPath: 'id', autoIncrement: true
                    });
                    ['name','rating','type','container','createdAt']
                        .forEach(idx => store.createIndex(idx, idx, { unique: false }));
                }
            };

            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror  = (e) => {
                console.error('[DB] Erreur ouverture :', e.target.error);
                reject(e.target.error);
            };
        });
    },

    /** Récupère toutes les bières */
    async getAll() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx  = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror   = () => reject(req.error);
        });
    },

    /** Sauvegarde une bière (insert ou update) */
    async save(beer) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx    = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req   = store.put(beer); // put → insert or update
            req.onsuccess = () => resolve(req.result);
            req.onerror   = () => reject(req.error);
        });
    },

    /** Supprime une bière par id */
    async delete(id) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx  = db.transaction(STORE_NAME, 'readwrite');
            const req = tx.objectStore(STORE_NAME).delete(id);
            req.onsuccess = () => resolve();
            req.onerror   = () => reject(req.error);
        });
    }
};

// ─────────────────────────────────────────────────────────────
// ÉTAT APPLICATIF
// ─────────────────────────────────────────────────────────────
const State = {
    beers:      [],       // toutes les bières chargées depuis IndexedDB
    filtered:   [],       // bières après filtrage / recherche
    currentId:  null,     // id de la bière en cours d'édition (null = création)
    sortField:  'createdAt',
    sortDir:    'desc',   // 'asc' | 'desc'
    searchTerm: '',
    photoBlob:  null,     // blob WebP de la photo en cours dans le formulaire
};

// ─────────────────────────────────────────────────────────────
// UTILITAIRES
// ─────────────────────────────────────────────────────────────

/** Génère une chaîne HTML d'étoiles pleines + vides (max = 10 ou 5) */
function starsHtml(filled, max = 10) {
    const f = Math.round(filled);
    return Array.from({ length: max }, (_, i) =>
        i < f ? '<span class="lit">★</span>' : '<span>☆</span>'
    ).join('');
}

/** Formatte un timestamp JS en date lisible en français */
function formatDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('fr-FR', {
        day:   'numeric', month: 'short', year: 'numeric',
        hour:  '2-digit', minute:'2-digit'
    });
}

/** Affiche / masque une modale par son id */
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

/** Applique le tri sur State.beers → State.filtered */
function applyFilters() {
    let list = [...State.beers];

    // Filtre texte (recherche par nom)
    if (State.searchTerm.trim()) {
        const term = State.searchTerm.trim().toLowerCase();
        list = list.filter(b => b.name && b.name.toLowerCase().includes(term));
    }

    // Tri
    list.sort((a, b) => {
        let va = a[State.sortField] ?? '';
        let vb = b[State.sortField] ?? '';
        // Si tri par date (createdAt), comparer en tant que nombre
        if (State.sortField === 'createdAt') {
            va = a.createdAt || 0;
            vb = b.createdAt || 0;
        } else {
            va = String(va).toLowerCase();
            vb = String(vb).toLowerCase();
        }
        if (va < vb) return State.sortDir === 'asc' ? -1 :  1;
        if (va > vb) return State.sortDir === 'asc' ?  1 : -1;
        return 0;
    });

    State.filtered = list;
}

/** Met à jour le compteur dans la barre de stats */
function updateStats() {
    const total = State.beers.length;
    const shown = State.filtered.length;
    const countEl = document.getElementById('beerCount');
    if (countEl) {
        countEl.textContent = shown === total
            ? `${total} bière${total !== 1 ? 's' : ''} goûtée${total !== 1 ? 's' : ''}`
            : `${shown}/${total} bières`;
    }
}

// ─────────────────────────────────────────────────────────────
// RENDU DES CARTES BIÈRE
// ─────────────────────────────────────────────────────────────
function renderBeerGrid() {
    const grid = document.getElementById('beerGrid');
    const empty = document.getElementById('emptyState');

    applyFilters();
    updateStats();

    // Vider la grille (garder only empty state)
    Array.from(grid.children).forEach(c => {
        if (c.id !== 'emptyState') c.remove();
    });

    if (State.filtered.length === 0) {
        empty.style.display = 'flex';
        return;
    }
    empty.style.display = 'none';

    State.filtered.forEach(beer => {
        grid.appendChild(buildBeerCard(beer));
    });
}

/** Construit le DOM d'une carte bière */
function buildBeerCard(beer) {
    const card = document.createElement('article');
    card.className = 'beer-card';
    card.dataset.id = beer.id;
    card.setAttribute('role', 'listitem');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `Bière ${beer.name}, note ${beer.rating}/10`);

    // ── Indicateur de long press (anneau SVG) ──
    const indicator = document.createElement('div');
    indicator.className = 'long-press-indicator';
    indicator.innerHTML = `
        <svg class="progress-ring-svg" viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r="46"/>
        </svg>
    `;

    // ── Photo ──
    const photoWrap = document.createElement('div');
    photoWrap.className = 'card-photo-wrap';
    if (beer.photoBlob) {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(beer.photoBlob);
        img.alt = `Photo de ${beer.name}`;
        img.loading = 'lazy';
        photoWrap.appendChild(img);
    } else {
        const ph = document.createElement('div');
        ph.className = 'card-photo-placeholder';
        ph.innerHTML = '<span aria-hidden="true">🍺</span><span>Bière</span>';
        photoWrap.appendChild(ph);
    }

    // Badge IPA
    if (beer.isIPA) {
        const badge = document.createElement('span');
        badge.className = 'ipa-badge';
        badge.textContent = 'IPA';
        photoWrap.appendChild(badge);
    }

    // ── Corps de la carte ──
    const body = document.createElement('div');
    body.className = 'card-body';

    const name = document.createElement('div');
    name.className = 'card-name';
    name.textContent = beer.name || 'Sans nom';

    const meta = document.createElement('div');
    meta.className = 'card-meta';
    if (beer.type) {
        const t = document.createElement('div');
        t.className = 'card-type';
        t.textContent = beer.type;
        meta.appendChild(t);
    }
    if (beer.container) {
        const c = document.createElement('div');
        c.className = 'card-container-badge';
        c.textContent = beer.container;
        meta.appendChild(c);
    }

    // Note en étoiles
    const rating = document.createElement('div');
    rating.className = 'card-rating';
    const numStars = Math.round((beer.rating || 0) / 2); // /10 → /5 display
    rating.innerHTML = `
        <span class="card-stars" aria-label="Note ${beer.rating}/10">${starsHtml(numStars, 5)}</span>
        <span class="card-rating-num">${beer.rating}/10</span>
    `;

    body.append(name, meta, rating);

    // Assembler
    card.append(indicator, photoWrap, body);

    // ── Interactions ──
    // Clic simple → détail
    card.addEventListener('click', () => openDetailModal(beer.id));

    // Appui long → modification (avec indicateur visuel)
    setupLongPress(card, () => openFormModal(beer.id));

    // Support clavier : Entrée → détail
    card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') openDetailModal(beer.id);
        if (e.key === 'Delete' || e.key === 'Backspace') openFormModal(beer.id);
    });

    return card;
}

/**
 * Configure l'appui long (mousedown + touchstart) avec indicateur de progression.
 * Le callback est appelé après LONG_PRESS_DURATION ms.
 */
function setupLongPress(element, callback) {
    let timer       = null;
    let isLongPress = false;
    let startX = 0, startY = 0;
    let progressRaf = null;

    // Anneau de progression SVG
    const svgCircle = element.querySelector('.progress-ring-svg circle');
    const RADIUS    = 46;
    const CIRCUM    = 2 * Math.PI * RADIUS;

    function startProgress() {
        isLongPress = true;
        const indicator = element.querySelector('.long-press-indicator');
        if (indicator) indicator.classList.add('active');

        const startTime = Date.now();
        function tick() {
            if (!isLongPress) return;
            const elapsed = Date.now() - startTime;
            const pct     = Math.min(elapsed / LONG_PRESS_DURATION, 1);
            const offset  = CIRCUM * (1 - pct);
            if (svgCircle) {
                svgCircle.style.strokeDasharray  = CIRCUM;
                svgCircle.style.strokeDashoffset = offset;
            }
            if (pct < 1) {
                progressRaf = requestAnimationFrame(tick);
            } else {
                // Fin : déclencher le callback
                isLongPress = false;
                if (indicator) indicator.classList.remove('active');
                if (svgCircle) {
                    svgCircle.style.strokeDasharray  = CIRCUM;
                    svgCircle.style.strokeDashoffset = CIRCUM;
                }
                callback();
            }
        }
        progressRaf = requestAnimationFrame(tick);
    }

    function cancelProgress() {
        isLongPress = false;
        if (progressRaf) cancelAnimationFrame(progressRaf);
        const indicator = element.querySelector('.long-press-indicator');
        if (indicator) indicator.classList.remove('active');
        if (svgCircle) {
            svgCircle.style.strokeDasharray  = CIRCUM;
            svgCircle.style.strokeDashoffset = CIRCUM;
        }
    }

    element.addEventListener('mousedown', (e) => {
        startX = e.clientX; startY = e.clientY;
        timer = setTimeout(startProgress, 150); // délai initial court avant de commencer le remplissage
        // Démarrer immédiatement la progression visuelle après le délai initial
        clearTimeout(timer);
        timer = setTimeout(() => {
            startProgress();
        }, 150);
    });

    element.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        startX = touch.clientX; startY = touch.clientY;
        clearTimeout(timer);
        timer = setTimeout(startProgress, 150);
    }, { passive: true });

    const cancel = () => {
        clearTimeout(timer);
        cancelProgress();
    };

    element.addEventListener('mouseup',      cancel);
    element.addEventListener('mouseleave',   cancel);
    element.addEventListener('touchend',     cancel);
    element.addEventListener('touchcancel',  cancel);

    // Annuler si mouvement latéral important (pour ne pas interférer avec scroll)
    element.addEventListener('mousemove', (e) => {
        if (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10) cancel();
    });
    element.addEventListener('touchmove', (e) => {
        const touch = e.touches[0];
        if (Math.abs(touch.clientX - startX) > 10 || Math.abs(touch.clientY - startY) > 10) cancel();
    }, { passive: true });
}

// ─────────────────────────────────────────────────────────────
// MODALE DE DÉTAIL
// ─────────────────────────────────────────────────────────────
function openDetailModal(id) {
    const beer = State.beers.find(b => b.id === id);
    if (!beer) return;

    const body   = document.getElementById('detailBody');
    const title  = document.getElementById('detailModalTitle');
    const editBtn = document.getElementById('detailEditBtn');

    title.textContent = beer.name || 'Détail';
    editBtn.onclick   = () => { closeModal('detailModal'); openFormModal(id); };

    // Construire le HTML du détail
    let html = '';

    // Photo
    if (beer.photoBlob) {
        html += `<img class="detail-photo" src="${URL.createObjectURL(beer.photoBlob)}" alt="Photo de ${beer.name}" loading="lazy">`;
    } else {
        html += `<div class="detail-photo-placeholder" aria-hidden="true"><span>🍺</span><span>Aucune photo</span></div>`;
    }

    // Section note principale
    const numStars10 = Math.round((beer.rating || 0));
    html += `
    <div class="detail-section">
        <h3>⚙ Note générale</h3>
        <div class="detail-row">
            <span class="detail-label">Note /10</span>
            <span class="detail-value">
                <span class="detail-stars">${starsHtml(numStars10, 10)}</span>
                &nbsp;${beer.rating}/10
            </span>
        </div>
    </div>`;

    // Composition détaillée (si au moins un champ)
    const comp = beer.composition || {};
    const hasComp = (comp.smell || comp.taste || comp.foam || comp.bitterness || comp.roundness);
    if (hasComp) {
        html += `<div class="detail-section"><h3>⚙ Composition</h3>`;
        if (comp.smell)      html += `<div class="detail-row"><span class="detail-label">Odeur /5</span><span class="detail-value"><span class="comp-stars">${starsHtml(comp.smell, 5)}</span></span></div>`;
        if (comp.taste)      html += `<div class="detail-row"><span class="detail-label">Goût /5</span><span class="detail-value"><span class="comp-stars">${starsHtml(comp.taste, 5)}</span></span></div>`;
        if (comp.foam)       html += `<div class="detail-row"><span class="detail-label">Mousse</span><span class="detail-value"><span class="foam-badge">${comp.foam}</span></span></div>`;
        if (comp.bitterness) html += `<div class="detail-row"><span class="detail-label">Amertume /5</span><span class="detail-value"><span class="comp-stars">${starsHtml(comp.bitterness, 5)}</span></span></div>`;
        if (comp.roundness)  html += `<div class="detail-row"><span class="detail-label">Rondeur /5</span><span class="detail-value"><span class="comp-stars">${starsHtml(comp.roundness, 5)}</span></span></div>`;
        html += `</div>`;
    }

    // Métadonnées
    html += `<div class="detail-section"><h3>⚙ Informations</h3>`;
    if (beer.type)      html += `<div class="detail-row"><span class="detail-label">Type</span><span class="detail-value">${beer.type}</span></div>`;
    if (beer.container) html += `<div class="detail-row"><span class="detail-label">Contenant</span><span class="detail-value">${beer.container}</span></div>`;
    if (beer.isIPA)     html += `<div class="detail-row"><span class="detail-label">IPA</span><span class="detail-value">Oui</span></div>`;
    if (beer.country)   html += `<div class="detail-row"><span class="detail-label">Pays</span><span class="detail-value">${beer.country}</span></div>`;
    if (beer.region)    html += `<div class="detail-row"><span class="detail-label">Région</span><span class="detail-value">${beer.region}</span></div>`;
    html += `<div class="detail-row"><span class="detail-label">Créée le</span><span class="detail-value">${formatDate(beer.createdAt)}</span></div>`;
    if (beer.updatedAt && beer.updatedAt !== beer.createdAt) {
        html += `<div class="detail-row"><span class="detail-label">Modifiée le</span><span class="detail-value">${formatDate(beer.updatedAt)}</span></div>`;
    }
    html += `</div>`;

    // Mémo
    if (beer.memo && beer.memo.trim()) {
        html += `
        <div class="detail-section">
            <h3>⚙ Notes</h3>
            <div class="detail-memo">${escapeHtml(beer.memo)}</div>
        </div>`;
    }

    body.innerHTML = html;
    openModal('detailModal');
}

/** Échappe les caractères HTML危险 pour éviter les injections */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '"');
}

// ─────────────────────────────────────────────────────────────
// MODALE CRÉER / MODIFIER
// ─────────────────────────────────────────────────────────────
function openFormModal(id = null) {
    State.currentId = id;
    State.photoBlob = null;

    const modal   = document.getElementById('formModal');
    const title   = document.getElementById('formModalTitle');
    const form    = document.getElementById('beerForm');
    const delBtn  = document.getElementById('deleteBtn');
    const saveBtn = document.getElementById('saveBtn');

    // Titre
    title.textContent = id ? '⚙ Modifier la bière' : '⚙ Nouvelle Bière';

    // Bouton supprimer (uniquement en mode modification)
    delBtn.style.display = id ? 'inline-flex' : 'none';

    // Réinitialiser le formulaire
    form.reset();

    // Réinitialiser les étoiles du formulaire
    resetStarButtons();

    // Cacher la photo et le bouton supprimer photo
    setPhotoPreview(null);
    document.getElementById('removePhotoBtn').style.display = 'none';

    // Si modification : charger les données existantes
    if (id) {
        const beer = State.beers.find(b => b.id === id);
        if (beer) loadBeerIntoForm(beer);
    }

    // Validation initiale
    updateSaveButtonState();

    // Scroll en haut
    modal.scrollTop = 0;

    openModal('formModal');
}

/** Charge les données d'une bière dans le formulaire */
function loadBeerIntoForm(beer) {
    document.getElementById('beerName').value     = beer.name     || '';
    document.getElementById('beerRating').value   = beer.rating   ?? '';
    document.getElementById('beerType').value     = beer.type     || '';
    document.getElementById('beerContainer').value = beer.container || '';
    document.getElementById('beerIPA').checked    = !!beer.isIPA;
    document.getElementById('beerCountry').value  = beer.country  || '';
    document.getElementById('beerRegion').value   = beer.region   || '';
    document.getElementById('beerMemo').value     = beer.memo     || '';

    // Composition
    const comp = beer.composition || {};
    setStarGroup('smellStars',      comp.smell      || 0);
    setStarGroup('tasteStars',      comp.taste      || 0);
    setStarGroup('bitternessStars', comp.bitterness || 0);
    setStarGroup('roundnessStars',  comp.roundness  || 0);
    if (comp.foam) {
        const r = document.querySelector(`input[name="foam"][value="${comp.foam}"]`);
        if (r) r.checked = true;
    }

    // Photo
    if (beer.photoBlob) {
        State.photoBlob = beer.photoBlob;
        setPhotoPreview(beer.photoBlob);
        document.getElementById('removePhotoBtn').style.display = 'inline-flex';
    }

    // Allumer les étoiles principales
    const rating = beer.rating || 0;
    const starBtns = document.querySelectorAll('#starRatingRow .star-btn');
    starBtns.forEach((btn, i) => {
        btn.classList.toggle('lit', i < rating);
    });
}

/** Réinitialise tous les groupes d'étoiles du formulaire */
function resetStarButtons() {
    document.querySelectorAll('.star-btn, .mini-star').forEach(btn => {
        btn.classList.remove('lit');
    });
    // Décocher les radios mousse
    document.querySelectorAll('input[name="foam"]').forEach(r => r.checked = false);
}

/** Active les étoiles d'un groupe jusqu'à une valeur (0–5) */
function setStarGroup(groupId, value) {
    const container = document.getElementById(groupId);
    if (!container) return;
    container.querySelectorAll('.mini-star').forEach((btn, i) => {
        btn.classList.toggle('lit', i < value);
    });
}

/** Récupère la valeur d'un groupe d'étoiles (0–5) */
function getStarGroupValue(groupId) {
    const container = document.getElementById(groupId);
    if (!container) return 0;
    return container.querySelectorAll('.mini-star.lit').length;
}

/** Met à jour la prévisualisation de la photo */
function setPhotoPreview(blobOrUrl) {
    const preview = document.getElementById('photoPreview');
    const ph      = document.getElementById('photoPlaceholder');

    if (blobOrUrl) {
        // Retire l'ancienne URL
        const old = preview.querySelector('img');
        if (old) URL.revokeObjectURL(old.src);

        const img = document.createElement('img');
        if (blobOrUrl instanceof Blob) {
            img.src = URL.createObjectURL(blobOrUrl);
        } else {
            img.src = blobOrUrl;
        }
        img.alt = 'Aperçu de la photo';
        if (ph) ph.style.display = 'none';
        preview.prepend(img);
    } else {
        const old = preview.querySelector('img');
        if (old) { URL.revokeObjectURL(old.src); old.remove(); }
        if (ph) ph.style.display = 'flex';
    }
}

// ─────────────────────────────────────────────────────────────
// GESTION DES ÉTOILES INTERACTIVES
// ─────────────────────────────────────────────────────────────

/** Active/désactive une étoile et met à jour le champ caché */
/**
 * Configure les étoiles interactives dans le formulaire.
 * Chaque groupe d'étoiles (rating /10 et composition /5) est cliquable.
 */
function setupStarRatings() {
    // Groupe note principale /10
    setupStarGroup('#starRatingRow', 'beerRating');

    // Groupes composition /5
    ['smellStars','tasteStars','bitternessStars','roundnessStars'].forEach(id => {
        setupStarGroup(`#${id}`, null, 5);
    });
}

/**
 * Configure un groupe d'étoiles cliquables.
 * @param {string} selector  - selecteur CSS du conteneur
 * @param {string|null} inputId - id du champ input à synchroniser (null = juste visuel)
 * @param {number} max       - nombre max d'étoiles (5 ou 10)
 */
function setupStarGroup(selector, inputId, max = 10) {
    const container = document.querySelector(selector);
    if (!container) return;

    container.querySelectorAll('.star-btn, .mini-star').forEach(btn => {
        btn.addEventListener('click', () => {
            const val = parseInt(btn.dataset.val, 10);
            // Toggle : si déjà allumée, éteindre (sauf pour rating principal)
            const currentLit = container.querySelectorAll('.lit').length;
            let newVal = val;

            // Comportement toggle pour les mini-étoiles (composition)
            if (inputId === null && currentLit === val) {
                newVal = val - 1;
            }

            // Allumer les étoiles jusqu'à newVal
            container.querySelectorAll('.star-btn, .mini-star').forEach((b, i) => {
                b.classList.toggle('lit', i < newVal);
            });

            // Synchroniser l'input rating principal
            if (inputId) {
                const input = document.getElementById(inputId);
                if (input) {
                    input.value = newVal;
                    updateSaveButtonState();
                }
            }
        });
    });
}

// ─────────────────────────────────────────────────────────────
// PHOTO : CONVERSION WebP + ACCEPTATION MULTIFORMAT
// ─────────────────────────────────────────────────────────────

/**
 * Convertit une image en WebP (max 800px de largeur, qualité 0.85).
 * Gère la conversion préalable des formats HEIC/HEIF.
 * @param {File|Blob} file - fichier image source
 * @returns {Promise<Blob>} blob WebP
 */
async function convertToWebP(file) {
    let sourceBlob = file;

    // 1. Vérifier si c'est du HEIC/HEIF
    const isHeic = file.type === 'image/heic' || 
                   file.type === 'image/heif' || 
                   (file.name && file.name.toLowerCase().match(/\.(heic|heif)$/));

    if (isHeic) {
        try {
            console.log("Format HEIC détecté, conversion en JPEG...");
            const convertedBlob = await heic2any({
                blob: file,
                toType: 'image/jpeg',
                quality: 0.9
            });
            // heic2any peut retourner un tableau de blobs si l'image contient plusieurs frames
            sourceBlob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
        } catch (err) {
            console.error('[Photo] Erreur conversion HEIC :', err);
            throw new Error('Échec de la conversion HEIC');
        }
    }

    // 2. Redimensionner et convertir en WebP via Canvas
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const MAX_W = 800;
            let w = img.naturalWidth;
            let h = img.naturalHeight;
            
            // Redimensionnement proportionnel
            if (w > MAX_W) {
                h = Math.round(h * MAX_W / w);
                w = MAX_W;
            }
            
            const canvas = document.createElement('canvas');
            canvas.width  = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            
            // Fond blanc pour préserver la transparence (PNG) lors de la conversion WebP
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, w, h);
            
            ctx.drawImage(img, 0, 0, w, h);
            
            canvas.toBlob(
                (blob) => {
                    URL.revokeObjectURL(img.src); // Libérer la mémoire
                    if (blob) resolve(blob);
                    else    reject(new Error('Échec de la conversion WebP'));
                },
                'image/webp',
                0.85
            );
        };
        
        img.onerror = () => {
            URL.revokeObjectURL(img.src);
            reject(new Error('Erreur chargement image (format non supporté)'));
        };
        
        // createObjectURL est bien plus performant que readAsDataURL pour les grosses images
        img.src = URL.createObjectURL(sourceBlob);
    });
}

/** Configure les boutons Galerie et Appareil photo */
function setupPhotoInputs() {
    const galleryBtn = document.getElementById('galleryBtn');
    const cameraBtn  = document.getElementById('cameraBtn');
    const galleryIn = document.getElementById('photoInputGallery');
    const cameraIn  = document.getElementById('photoInputCamera');
    const removeBtn = document.getElementById('removePhotoBtn');

    galleryBtn.addEventListener('click', () => galleryIn.click());
    cameraBtn.addEventListener('click',  () => cameraIn.click());

    const handleFile = async (file) => {
        // On accepte le fichier même si le type MIME est absent (fréquent avec HEIC sur Android)
        if (!file) return;
        
        try {
            const blob = await convertToWebP(file);
            State.photoBlob = blob;
            setPhotoPreview(blob);
            document.getElementById('removePhotoBtn').style.display = 'inline-flex';
        } catch (err) {
            console.error('[Photo] Erreur conversion :', err);
            alert('Impossible de traiter cette image. Format non supporté ou corrompu.');
        }
    };

    galleryIn.addEventListener('change', (e) => {
        if (e.target.files[0]) handleFile(e.target.files[0]);
        e.target.value = ''; // permettre de re-sélectionner la même image
    });
    cameraIn.addEventListener('change', (e) => {
        if (e.target.files[0]) handleFile(e.target.files[0]);
        e.target.value = '';
    });

    removeBtn.addEventListener('click', () => {
        State.photoBlob = null;
        setPhotoPreview(null);
        removeBtn.style.display = 'none';
        galleryIn.value = '';
        cameraIn.value  = '';
    });
}

// ─────────────────────────────────────────────────────────────
// VALIDATION & SAUVEGARDE DU FORMULAIRE
// ─────────────────────────────────────────────────────────────

/** Active ou désactive le bouton Enregistrer selon les champs obligatoires */
function updateSaveButtonState() {
    const name   = document.getElementById('beerName').value.trim();
    const rating = document.getElementById('beerRating').value;
    const saveBtn = document.getElementById('saveBtn');
    const valid   = name.length > 0 && rating !== '' && !isNaN(parseFloat(rating));
    saveBtn.disabled = !valid;
}

/** Collecte toutes les données du formulaire et retourne un objet bière */
function collectFormData() {
    const name   = document.getElementById('beerName').value.trim();
    const rating = parseFloat(document.getElementById('beerRating').value) || 0;

    return {
        name,
        rating: Math.min(10, Math.max(0, rating)),
        composition: {
            smell:      getStarGroupValue('smellStars'),
            taste:      getStarGroupValue('tasteStars'),
            foam:       document.querySelector('input[name="foam"]:checked')?.value || '',
            bitterness: getStarGroupValue('bitternessStars'),
            roundness:  getStarGroupValue('roundnessStars'),
        },
        container: document.getElementById('beerContainer').value || '',
        type:      document.getElementById('beerType').value      || '',
        isIPA:     document.getElementById('beerIPA').checked,
        country:   document.getElementById('beerCountry').value.trim(),
        region:    document.getElementById('beerRegion').value.trim(),
        memo:      document.getElementById('beerMemo').value.trim(),
        photoBlob: State.photoBlob,
        updatedAt: Date.now(),
    };
}

/** Enregistre la bière (création ou mise à jour) */
async function saveBeer() {
    const data = collectFormData();

    // Validation obligatoire
    if (!data.name) {
        document.getElementById('beerName').focus();
        return;
    }
    if (isNaN(data.rating)) {
        document.getElementById('beerRating').focus();
        return;
    }

    try {
        if (State.currentId) {
            // Mise à jour : preserve createdAt
            const existing = State.beers.find(b => b.id === State.currentId);
            if (existing) data.createdAt = existing.createdAt;
            data.id = State.currentId;
        } else {
            data.createdAt = Date.now();
        }

        const savedId = await DB.save(data);

        // Recharger la liste
        State.beers = await DB.getAll();
        renderBeerGrid();
        closeModal('formModal');

    } catch (err) {
        console.error('[Save] Erreur :', err);
        alert('Erreur lors de la sauvegarde. Veuillez réessayer.');
    }
}

/** Supprime la bière courante après confirmation */
async function deleteBeer() {
    if (!State.currentId) return;
    if (!confirm('⚙ Supprimer cette bière ? Cette action est irréversible.')) return;

    try {
        await DB.delete(State.currentId);
        State.beers = await DB.getAll();
        renderBeerGrid();
        closeModal('formModal');
    } catch (err) {
        console.error('[Delete] Erreur :', err);
        alert('Erreur lors de la suppression.');
    }
}

// ─────────────────────────────────────────────────────────────
// RECHERCHE ET TRI
// ─────────────────────────────────────────────────────────────

function setupSearchAndSort() {
    // Bouton loupe → déploie la barre de recherche
    document.getElementById('searchBtn').addEventListener('click', () => {
        const bar = document.getElementById('searchBar');
        const isOpen = bar.style.display !== 'none';
        bar.style.display = isOpen ? 'none' : 'flex';
        if (!isOpen) {
            document.getElementById('searchInput').focus();
        }
    });

    // Fermer la recherche
    document.getElementById('searchCloseBtn').addEventListener('click', () => {
        closeSearch();
    });

    // Champ de recherche avec debounce
    const searchInput = document.getElementById('searchInput');
    let debounceTimer;
    searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            State.searchTerm = searchInput.value;
            renderBeerGrid();
            updateSearchBadge();
        }, 250);
    });

    // Bouton effacer recherche
    document.getElementById('clearSearchBtn').addEventListener('click', closeSearch);

    // Tri : champ
    document.getElementById('sortField').addEventListener('change', (e) => {
        State.sortField = e.target.value;
        renderBeerGrid();
    });

    // Tri : direction
    document.getElementById('sortDirBtn').addEventListener('click', () => {
        State.sortDir = State.sortDir === 'asc' ? 'desc' : 'asc';
        document.getElementById('sortDirIcon').textContent = State.sortDir === 'asc' ? '⬆' : '⬇';
        renderBeerGrid();
    });
}

function closeSearch() {
    State.searchTerm = '';
    document.getElementById('searchInput').value = '';
    document.getElementById('searchBar').style.display = 'none';
    renderBeerGrid();
    updateSearchBadge();
}

function updateSearchBadge() {
    const info  = document.getElementById('activeSearchInfo');
    const badge = document.getElementById('searchBadge');
    const term  = document.getElementById('searchTermDisplay');
    if (State.searchTerm.trim()) {
        info.style.display = 'flex';
        term.textContent = State.searchTerm.trim();
    } else {
        info.style.display = 'none';
    }
}

// ─────────────────────────────────────────────────────────────
// ÉVÉNEMENTS GLOBAUX
// ─────────────────────────────────────────────────────────────

function setupGlobalEvents() {
    // Bouton + (ajouter)
    document.getElementById('addBtn').addEventListener('click', () => openFormModal(null));

    // Fermer modales avec bouton ✕
    document.getElementById('detailCloseBtn').addEventListener('click',    () => closeModal('detailModal'));
    document.getElementById('detailDismissBtn').addEventListener('click', () => closeModal('detailModal'));
    document.getElementById('formCloseBtn').addEventListener('click',      () => closeModal('formModal'));
    document.getElementById('cancelBtn').addEventListener('click',       () => closeModal('formModal'));

    // Soumission du formulaire
    document.getElementById('beerForm').addEventListener('submit', (e) => {
        e.preventDefault();
        saveBeer();
    });

    // Supprimer depuis le formulaire
    document.getElementById('deleteBtn').addEventListener('click', deleteBeer);

    // Validation en temps réel
    document.getElementById('beerName').addEventListener('input',   updateSaveButtonState);
    document.getElementById('beerRating').addEventListener('input', updateSaveButtonState);
    document.getElementById('beerRating').addEventListener('change', updateSaveButtonState);

    // Fermer modale en cliquant à l'extérieur (backdrop)
    ['detailModal','formModal'].forEach(id => {
        document.getElementById(id).addEventListener('click', (e) => {
            if (e.target.id === id) closeModal(id);
        });
    });

    // Fermer modale avec Échap
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal('detailModal');
            closeModal('formModal');
        }
    });
}

// ─────────────────────────────────────────────────────────────
// INITIALISATION
// ─────────────────────────────────────────────────────────────

async function init() {
    try {
        // Charger toutes les bières depuis IndexedDB
        State.beers = await DB.getAll();
        renderBeerGrid();

        // Configurer les interactions
        setupStarRatings();
        setupPhotoInputs();
        setupSearchAndSort();
        setupGlobalEvents();

    } catch (err) {
        console.error('[Init] Erreur fatale :', err);
        document.getElementById('beerGrid').innerHTML = `
            <div class="empty-state">
                <h2>Erreur de chargement</h2>
                <p>Impossible d'accéder à IndexedDB. Veuillez autoriser le stockage local.</p>
            </div>`;
    }
}

// Lancer dès que le DOM est prêt
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
