// Publie automatiquement les posts du planning sur Instagram et Facebook (API Graph de Meta).
// Lancé toutes les 15 min par GitHub Actions. Aucun module à installer (Node 20+).
//
// Variables d'environnement (secrets GitHub) :
//   META_PAGE_TOKEN   token de la Page Facebook (permanent)
//   META_PAGE_ID      id de la Page Facebook
//   META_IG_ID        id du compte Instagram professionnel
//   MEDIA_BASE_URL    adresse publique du dépôt (calculée automatiquement sur GitHub)
// Option : --test  affiche ce qui serait publié, sans rien publier.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const GRAPH = 'https://graph.facebook.com/v21.0';
const TEST = process.argv.includes('--test');
const MAX_ESSAIS = 3;
const VIDEO = /\.(mp4|mov)$/i;

const { META_PAGE_TOKEN, META_PAGE_ID, META_IG_ID } = process.env;
const MEDIA_BASE_URL = (process.env.MEDIA_BASE_URL ||
  `https://raw.githubusercontent.com/${process.env.GITHUB_REPOSITORY}/${process.env.GITHUB_REF_NAME || 'main'}/`
).replace(/\/?$/, '/');

const planning = JSON.parse(readFileSync('planning.json', 'utf8'));
const etat = existsSync('etat.json') ? JSON.parse(readFileSync('etat.json', 'utf8')) : {};

// "2026-10-08 18:00" (heure de Paris) -> Date
function heureParis(texte) {
  const [d, h = '00:00'] = texte.trim().split(/[ T]/);
  const naif = new Date(`${d}T${h}:00Z`);
  const vu = new Date(naif.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const vuUtc = new Date(naif.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(naif.getTime() - (vu - vuUtc));
}

async function graph(chemin, params = {}, methode = 'POST') {
  const corps = new URLSearchParams({ ...params, access_token: META_PAGE_TOKEN });
  const url = methode === 'GET' ? `${GRAPH}/${chemin}?${corps}` : `${GRAPH}/${chemin}`;
  const rep = await fetch(url, methode === 'GET' ? {} : { method: 'POST', body: corps });
  const json = await rep.json();
  if (json.error) throw new Error(`${json.error.message} (code ${json.error.code})`);
  return json;
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Instagram traite les médias de façon asynchrone : on attend qu'ils soient prêts.
async function attendreConteneur(id) {
  for (let i = 0; i < 60; i++) {
    const { status_code } = await graph(id, { fields: 'status_code' }, 'GET');
    if (status_code === 'FINISHED') return;
    if (status_code === 'ERROR' || status_code === 'EXPIRED') throw new Error(`Instagram a refusé le média (${status_code})`);
    await pause(5000);
  }
  throw new Error('Instagram met trop de temps à traiter le média');
}

async function publierInstagram(post, urls) {
  let conteneur;
  if (urls.length > 1) {
    const enfants = [];
    for (const url of urls) {
      const champ = VIDEO.test(url) ? { media_type: 'VIDEO', video_url: url } : { image_url: url };
      const { id } = await graph(`${META_IG_ID}/media`, { ...champ, is_carousel_item: 'true' });
      await attendreConteneur(id);
      enfants.push(id);
    }
    conteneur = await graph(`${META_IG_ID}/media`, { media_type: 'CAROUSEL', children: enfants.join(','), caption: post.legende });
  } else if (VIDEO.test(urls[0])) {
    conteneur = await graph(`${META_IG_ID}/media`, { media_type: 'REELS', video_url: urls[0], caption: post.legende, share_to_feed: 'true' });
  } else {
    conteneur = await graph(`${META_IG_ID}/media`, { image_url: urls[0], caption: post.legende });
  }
  await attendreConteneur(conteneur.id);
  const { id } = await graph(`${META_IG_ID}/media_publish`, { creation_id: conteneur.id });
  return id;
}

async function publierFacebook(post, urls) {
  if (VIDEO.test(urls[0])) {
    const { id } = await graph(`${META_PAGE_ID}/videos`, { file_url: urls[0], description: post.legende });
    return id;
  }
  if (urls.length === 1) {
    const { post_id, id } = await graph(`${META_PAGE_ID}/photos`, { url: urls[0], message: post.legende });
    return post_id || id;
  }
  // Plusieurs images : on les envoie sans les publier, puis un seul post les regroupe.
  const photos = [];
  for (const url of urls) {
    const { id } = await graph(`${META_PAGE_ID}/photos`, { url, published: 'false' });
    photos.push({ media_fbid: id });
  }
  const { id } = await graph(`${META_PAGE_ID}/feed`, { message: post.legende, attached_media: JSON.stringify(photos) });
  return id;
}

const PUBLIER = { instagram: publierInstagram, facebook: publierFacebook };

const maintenant = new Date();
let changements = 0;

for (const post of planning.posts) {
  if (heureParis(post.date) > maintenant) continue;
  if (post.legende_fichier) post.legende = readFileSync(post.legende_fichier, 'utf8').trim();
  const urls = post.medias.map((m) => MEDIA_BASE_URL + m.split('/').map(encodeURIComponent).join('/'));

  for (const reseau of post.reseaux) {
    const e = (etat[post.id] ??= {})[reseau] ??= { essais: 0 };
    if (e.publie || e.essais >= MAX_ESSAIS) continue;
    if (!PUBLIER[reseau]) { console.log(`⏭  ${post.id} : réseau « ${reseau} » pas encore pris en charge`); continue; }

    if (TEST) { console.log(`🧪 ${post.id} → ${reseau} : ${urls.join(', ')}`); changements++; continue; }
    try {
      e.id = await PUBLIER[reseau](post, urls);
      e.publie = new Date().toISOString();
      delete e.erreur;
      console.log(`✅ ${post.id} publié sur ${reseau} (${e.id})`);
    } catch (err) {
      e.essais++;
      e.erreur = err.message;
      console.log(`❌ ${post.id} sur ${reseau}, essai ${e.essais}/${MAX_ESSAIS} : ${err.message}`);
    }
    changements++;
  }
}

if (changements && !TEST) writeFileSync('etat.json', JSON.stringify(etat, null, 2) + '\n');
console.log(changements ? `${changements} action(s).` : 'Rien à publier pour le moment.');
