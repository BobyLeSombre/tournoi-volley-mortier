# 🏐 Tournoi de Volley Mortier — suivi en direct

Application autonome pour faire vivre le tournoi de volley de la Jeunesse
Mortier a.s.b.l. : les arbitres saisissent les points depuis leur téléphone,
tout le monde suit les scores, les chronos et les classements en temps réel.

Identité : vert `#1C9409` sur blanc, logo de la Jeunesse Mortier
(`public/logo.jpg`, réutilisé comme favicon).

Trois interfaces, une seule application :

| Page | Adresse | Pour qui |
|---|---|---|
| Écran public | `/` | Joueurs et spectateurs |
| Écran géant | `/?tv=1` | Vidéoprojecteur — **lien réservé à l'organisation** |
| Arbitrage | `/arbitre.html` | Arbitres (protégé par un code) |
| Organisation | `/admin.html` | Toi (protégé par un mot de passe) |

**L'écran public ne mène nulle part ailleurs** : ni vers l'arbitrage, ni vers
l'administration, ni vers l'écran géant. Aucun lien dans son en-tête. Les
joueurs y trouvent quatre onglets : **En direct**, **Calendrier**,
**Classements** et **Mon équipe**.

Dans **Mon équipe**, un joueur cherche son équipe et voit sa fiche : sa place en
poule, son nombre de victoires et de points, son rang au classement général des
24 équipes, et surtout **son statut de qualification à l'instant T** — vert
« Qualifié·e » (provisoire pendant les poules, définitif dès la phase finale) ou
orange « À la lutte ». La fiche liste aussi ses matchs (résultats passés et
prochains) et l'équipe choisie est mémorisée sur le téléphone.

Dans **Photos**, tout le monde partage ses photos du tournoi. Un gros bouton
**+ Ajouter ma photo** ouvre directement l'appareil photo sur mobile ; la photo
est publiée dans une galerie commune, qu'un clic agrandit en plein écran.
L'organisation peut retirer une photo depuis l'onglet « En direct » de l'admin.

Les photos sont pensées pour **ne pas ralentir le site** : chaque image est
réduite dans le téléphone avant l'envoi (≈ 1400 px pour l'affichage, une
vignette de ~15 Ko pour la galerie), stockée en fichier sur le serveur et servie
avec un cache long. Surtout, **aucune image ne transite par le temps réel** : le
WebSocket ne porte qu'un numéro de version (quelques octets), et les galeries
ouvertes ne rechargent l'index que lorsqu'il change. Un score qui bouge ne
déclenche aucun appel photo.

- Les **arbitres** entrent en scannant un QR code (voir plus bas).
- L'**écran géant** s'ouvre depuis l'espace Organisation, section « Réservé à
  l'organisation ». On en sort avec **Échap** ou le bouton discret en bas à
  droite.

**Identifiants par défaut : mot de passe admin `admin`, code arbitre `1234`.**
À changer dans l'onglet Organisation avant le jour J.

---

## Lancer en local

```bash
npm install
```

```bash
npm start
```

Puis ouvre <http://localhost:5183>.

Les données sont enregistrées dans `data/tournament.json` (plus une copie de
sauvegarde). Le serveur peut redémarrer en plein tournoi sans rien perdre.

## Mettre en ligne (gratuit)

Pour que les spectateurs y accèdent en 4G depuis n'importe où :

1. Pousse le dossier sur un dépôt GitHub.
2. Sur [render.com](https://render.com) : **New → Blueprint**, choisis le dépôt.
   Le fichier `render.yaml` fait le reste.
3. Renseigne les variables `ADMIN_PASSWORD` et `REFEREE_PIN`.
4. Récupère l'URL publique (`https://volley-tournoi.onrender.com`) et diffuse-la.

Railway, Fly.io ou n'importe quel hébergeur Node fonctionnent aussi : la seule
commande nécessaire est `npm start`, et le port est lu dans `PORT`.

> ⚠️ Sur les offres gratuites, le disque est effacé à chaque redéploiement, et
> l'instance s'endort après ~15 min d'inactivité (le premier chargement prend
> alors 30 s). Exporte ton tournoi depuis l'admin avant la compétition, et
> ouvre une page 10 minutes avant le début pour réveiller le serveur.

## Déroulé type

**Avant le tournoi** — onglet Organisation :

1. Règle le nom, la durée d'une période, le nombre de périodes et la liste des
   terrains. Il n'y a **aucun horaire à saisir**.
2. Dans le panneau **Équipes**, colle ta liste (une par ligne, ou séparées par
   des virgules — les numéros et tirets sont retirés tout seuls). Un aperçu
   compte les équipes, signale les doublons et propose un nombre de poules ;
   un clic crée tout et répartit. Ensuite tu peux glisser une équipe d'une
   poule à l'autre, la renommer d'un clic, ou refaire un tirage au sort.
3. Rien à préparer pour les arbitres : ils se servent eux-mêmes le jour J. Il
   te suffit de leur communiquer l'adresse et le code arbitre.
4. Clique sur **Générer le calendrier** : tous les matchs de poule sont créés en
   championnat aller simple et répartis en **tours**, de façon qu'aucune équipe
   ne joue deux fois dans le même tour.
5. Ajuste à la main si besoin (numéro de tour, terrain, suppression d'un match).
6. Exporte une sauvegarde JSON.

**Pendant** — chaque arbitre **scanne le QR code**, saisit le code que tu lui as
donné de vive voix, puis **touche le terrain que tu lui as indiqué**. Le
téléphone retient les deux, donc c'est à faire une seule fois :

- Le chrono démarre au premier point marqué (ou avec le bouton **Démarrer**).
- On touche le score pour ajouter un point, « retirer 1 point » pour corriger.
- À la fin, **Terminer le match** demande une confirmation puis enregistre le
  vainqueur ; les classements se recalculent instantanément.
- Un bouton **Match suivant** enchaîne sur le match d'après du même terrain.

Ce n'est pas forcément la même personne d'un match à l'autre : le terrain choisi
est mémorisé sur le téléphone mais **Changer de terrain** est accessible partout,
y compris juste après avoir validé un résultat.

## Le QR code arbitres

L'espace Organisation contient un panneau **QR code arbitres** : un seul code,
qui pointe vers `/arbitre.html`, c'est-à-dire **la page de connexion**.

Le code arbitre n'est **jamais** dans le QR. Une affiche photographiée par un
joueur ne lui donne donc rien : il tombe sur un écran qui réclame un code qu'il
n'a pas. Tu communiques ce code de vive voix aux arbitres.

Le bouton **Imprimer le QR code** sort une feuille propre (une feuille de style
d'impression masque tout le reste de l'admin). Le QR est généré côté serveur en
SVG par `GET /api/qr.svg?data=…&size=…`, donc net à n'importe quelle taille.

## Phase finale

Un bouton **Générer le tableau final** dans l'espace Organisation construit
toute la phase à élimination directe à partir des classements :

- **2 premiers de chaque poule + les meilleurs troisièmes** pour compléter à la
  puissance de deux supérieure. Avec 6 poules de 4 : 12 + 4 repêchés = tableau
  de 16, donc de vrais 8es de finale (le format de l'Euro 2016).
- Les 3es de poules différentes se comparent avec les mêmes critères que le
  classement : victoires, puis total de points marqués.
- **Têtes de série** : les 1ers ne peuvent se croiser que tard, et deux équipes
  d'une même poule ne se rencontrent jamais au premier tour.
- **Les vainqueurs avancent tout seuls.** Tant qu'un match n'est pas joué, le
  suivant affiche « Vainqueur 8e 3 » ; dès la validation du résultat, l'équipe
  apparaît partout en direct.
- Une **petite finale** oppose les perdants des demies, sur un autre terrain en
  même temps que la finale.

Deux protections propres à l'élimination directe :

- **Pas de match nul** : si le temps est écoulé à égalité, l'arbitre voit
  « Égalité — point en or : le prochain point décide » et le bouton *Terminer*
  est refusé tant que personne n'a marqué.
- **Pas de réouverture en cascade** : rouvrir un match dont le suivant a déjà
  commencé est bloqué, sinon tout le tableau en aval deviendrait faux.

Le premier tour compte 8 matchs. Avec 6 terrains il se joue en 2 tours ; en
repassant à 8 terrains dans les réglages, il tient en un seul — l'admin le
signale.

## Un arbitre par terrain

Quand un arbitre choisit un terrain, celui-ci devient **verrouillé pour les
autres** : sa tuile passe en grisé barré « 🔒 Arbitre en place » et n'est plus
cliquable. Deux personnes ne peuvent pas saisir le même match sans le savoir.

La réservation est liée à la connexion temps réel, pas à un compte :

- « Changer de terrain » libère immédiatement le terrain ;
- une déconnexion subie (écran verrouillé, réseau qui saute) le garde réservé
  **60 secondes**, le temps que l'arbitre revienne — sa page se reconnecte et
  reprend automatiquement sa réservation ;
- passé ce délai le terrain se libère seul, pour qu'un téléphone à plat ne
  bloque jamais un terrain durablement.

## Des tours, pas des horaires

Il n'y a aucune heure de coup d'envoi. Les matchs sont regroupés en **tours** :
un tour contient autant de matchs que de terrains, et une équipe n'y joue jamais
deux fois. Le déroulé est le suivant :

1. L'organisation annonce les matchs du tour au micro.
2. Chaque arbitre lance son match quand ses joueurs sont en place — les terrains
   sont totalement indépendants, personne n'attend personne.
3. Quand le dernier arbitre du tour a validé son résultat, le tour bascule tout
   seul et l'écran affiche en vert **« Tour N — X matchs à lancer, en attente de
   l'annonce de l'organisation »**. C'est le signal pour reprendre le micro.

Le panneau **Suivi des terrains** dit à tout moment ce qui bloque : « Tour 3 :
4/6 matchs clôturés. En attente de Terrain 2, Terrain 5. »

**Format retenu** : 24 équipes en 6 poules de 4 sur **6 terrains** → 36 matchs
en 6 tours de 6 (3 matchs par équipe). Les 6 terrains sont pleins du début à la
fin, 6 arbitres suffisent, et aucune équipe n'enchaîne deux matchs de suite.

Le menu **Format des poules** permet de passer en aller-retour (chaque paire se
rencontre deux fois) si tu veux plus de matchs par équipe.

**Phases finales** — en bas de l'onglet Calendrier, ajoute un match hors poule
entre deux équipes avec un libellé (« Demi-finale », « Finale »…). Ces matchs
n'entrent pas dans le classement des poules.

## Règles appliquées

- **Un match = 2 périodes de 15 min, score cumulé** sur l'ensemble (comme deux
  mi-temps). L'équipe qui mène à la fin de la 2ᵉ période l'emporte ; l'égalité
  donne un match nul. Nombre de périodes et durée réglables dans l'admin.
- Entre les deux périodes, l'écran passe en « changement de côté » et attend que
  l'arbitre appuie sur **Démarrer la période 2** — pas de décompte imposé, un
  terrain en retard ne bloque personne.
- Chaque terrain a son chrono indépendant : lancer, mettre en pause ou prolonger
  un match n'a aucun effet sur les autres.
- Le chrono ne s'arrête pas tout seul à zéro : il affiche « temps écoulé » et
  l'arbitre valide après la dernière action.
- **Classement en deux critères** : d'abord le **nombre de victoires**, puis à
  égalité le **total des points marqués** sur l'ensemble des matchs. Il n'y a
  pas de barème de points par match à régler — une victoire est une victoire.
  En cas d'égalité parfaite, la confrontation directe puis l'ordre alphabétique
  tranchent silencieusement.

## Fonctionnement technique

- **Node + Express** pour l'API, **WebSocket** pour la diffusion temps réel.
  Chaque changement envoie l'état complet du tournoi (quelques dizaines de Ko)
  à tous les écrans connectés — pas de rafraîchissement manuel.
- **Le serveur fait autorité sur le chrono** : il stocke un timestamp de fin, et
  chaque client corrige le décalage de sa propre horloge. Deux téléphones
  affichent donc exactement la même seconde.
- **Persistance fichier** (`data/tournament.json`), écriture atomique et
  regroupée. Aucune base de données à installer.
- Le calcul des classements (`public/js/standings.js`) est partagé entre le
  serveur et le navigateur : l'affichage ne peut pas diverger de l'API.

```
server.js              API REST + WebSocket
src/model.js           règles du tournoi, chrono, génération du calendrier
src/store.js           persistance JSON
public/index.html      écran public (direct / calendrier / classements)
public/arbitre.html    interface arbitre
public/admin.html      interface organisation
public/js/standings.js classements — partagé serveur + client
```
