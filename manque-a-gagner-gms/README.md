# Gondole : le manque à gagner en GMS, chiffré

Gondole est une application SaaS destinée aux industriels qui vendent en grande et moyenne surface
(GMS). Elle calcule le **manque à gagner** de leurs références sur quatre leviers :

| Levier | Question à laquelle l’application répond |
|---|---|
| **Ruptures** | Combien de ventes perdons-nous quand la référence manque en rayon ? |
| **Opérations** | Combien de volume promo perdons-nous à cause des magasins qui n’implantent pas l’opération et des ruptures pendant l’opération ? |
| **Nouveaux produits** | Combien rapporterait le référencement d’une innovation dans les magasins qui ne l’ont pas encore, et combien coûte un retard d’implantation ? |
| **Facings** | Combien gagnerait-on en élargissant le linéaire d’une référence, et le rayon actuel tient-il entre deux réassorts ? |

Chaque calcul est disponible en **vue industriel** (CA net, marge brute) et en **vue enseigne**
(CA magasin TTC, marge enseigne), pour préparer les rendez-vous avec les acheteurs.
La page **Argumentaire enseigne** produit une synthèse prête à présenter, à copier dans un e-mail
ou à imprimer en PDF.

> « Gondole » est un nom de travail : il apparaît dans `public/index.html`, `public/js/app.js`,
> `public/js/pages/auth.js` et dans le logo (`public/favicon.svg`, `public/js/ui/icons.js`).

## Démarrer

Il faut **Node.js 22.13 ou plus récent** (aucune dépendance à installer, aucune compilation).

```bash
cd manque-a-gagner-gms
npm start            # http://localhost:3000
npm test             # tests : formules, import CSV, API, sécurité
```

Au premier lancement, créez l’espace de votre entreprise, puis cliquez sur
**Charger les données de démonstration** pour voir un exemple complet (une biscuiterie fictive).
Le bouton **Essayer la démonstration** de l’écran de connexion ouvre aussi la démo sans compte.

**Démo sans serveur.** Le dossier `public/` fonctionne seul sur n’importe quel hébergement
statique (Netlify, GitHub Pages…) : l’application détecte l’absence d’API et passe en mode
démonstration, les données restant dans le navigateur du visiteur. Pratique pour montrer
l’outil à un prospect.

## Méthode de calcul

Notations : **ROT** = rotation, en UVC par magasin et par semaine ; **PVC** = prix de vente
consommateur ; **prix net** = prix « trois fois net » facturé à l’enseigne.
Toutes les hypothèses par défaut se modifient dans **Hypothèses** ; elles s’appliquent à toutes
les lignes qui n’ont pas leur propre valeur.

### Économie d’une UVC

- PVC HT = PVC TTC / (1 + TVA)
- Marge industriel = prix net − coût de revient (si le coût manque : prix net × taux de marge par défaut, 35 %)
- Marge enseigne = PVC HT − prix net

### Ruptures

Deux façons de saisir une rupture :

- **Jours × magasins** (relevé terrain) : ventes manquées = ROT × jours / 7 × magasins.
  Sans date de fin, la rupture est « en cours » et compte jusqu’à aujourd’hui.
- **Taux de rupture** (portails enseignes, panels) : ventes manquées = ventes réalisées × taux / (1 − taux),
  car les ventes observées n’ont eu lieu que pendant la disponibilité.

Toutes les ventes manquées ne sont pas perdues. Par défaut (moyennes mondiales de l’étude
Gruen, Corsten et Bharadwaj, 2002), face à une rupture le client :

| Réaction | Part | Perdu pour l’industriel | Perdu pour l’enseigne |
|---|---|---|---|
| achète la même référence dans un autre magasin | 31 % | non | oui |
| reporte son achat | 15 % | non | non |
| prend une autre référence de la même marque | 19 % | non | non |
| prend une marque concurrente | 26 % | oui | non |
| renonce | 9 % | oui | oui |

Soit **35 % de perte nette pour l’industriel** et **40 % pour l’enseigne**. Ce report peut être
désactivé (100 % perdu).

### Opérations promotionnelles

Une ligne = un produit dans une opération (les lignes de même nom sont regroupées).

- ROT promo = ROT hors promo × coefficient promo ; durée en semaines = jours / 7.
- Financement par UVC = PVC HT × remise × part financée par l’industriel ;
  prix net promo = prix net − financement.
- **Non-implantation** : les magasins prévus qui n’ont pas implanté ont tout de même vendu au rythme
  normal. Le manque à gagner est la différence entre le scénario promo et ce qu’ils ont vendu :
  magasins manquants × semaines × (ROT promo × prix net promo − ROT × prix net).
- **Ruptures pendant l’opération** : magasins implantés × ROT promo × jours de rupture / 7,
  avec le même report client que ci-dessus.
- Alertes : remise au-dessus du seuil (34 % par défaut, plafond des promotions en valeur fixé par
  l’encadrement EGalim : vérifiez la réglementation applicable à vos catégories) et opération qui
  fait baisser la marge de l’industriel malgré le volume additionnel.

### Nouveaux produits

- Semaines effectives sur l’horizon H avec une montée en charge linéaire de R semaines :
  H − R/2 (ou H² / 2R si H < R).
- **DN manquante** : ROT cible × semaines effectives × (magasins cibles − magasins référencés).
- **Retard d’implantation** de D semaines : les magasins référencés ne vendent que sur H − D semaines.
- Le total est réduit de la **cannibalisation** de votre propre gamme (20 % par défaut).
- Retour sur le coût de référencement = (marge nette à 100 % de DN − coût) / coût.

### Facings

- Ventes × (facings proposés / facings actuels)^élasticité. L’élasticité par défaut, 0,17, est la
  moyenne de la méta-analyse d’Eisend (2014) : doubler les facings augmente les ventes d’environ 12,5 %.
- Si les taux de rupture avant / après sont renseignés : gain supplémentaire
  = ventes × facteur × ((1 − taux après) / (1 − taux avant) − 1).
- **Capacité du rayon** : couverture en jours = facings × capacité par facing / (ROT / 7).
  En dessous de l’intervalle de réassort, la rupture est probable ; en dessous de cet intervalle
  × 1,5, la couverture est juste. L’outil indique le nombre minimum de facings.
- **Part de linéaire** : comparée à la part de marché du segment, avec le nombre de facings à parité.

### Périodes et totaux

Les filtres de période s’appliquent aux ruptures (au prorata des jours) et aux opérations ;
les périodes glissantes incluent les opérations à venir. Nouveaux produits et facings sont des
potentiels chiffrés sur l’horizon des hypothèses (52 semaines par défaut). Le tableau de bord
additionne les quatre leviers : c’est le manque à gagner identifié, à lire avec ces conventions.

## Importer vos données

**Import CSV** accepte les exports Excel français (séparateur `;`, nombres `1 234,56`, dates
`JJ/MM/AAAA`, encodage UTF-8 ou Windows-1252) et le copier-coller de cellules depuis Excel.
Les en-têtes sont reconnus avec ou sans accents et sous plusieurs noms usuels (`Gencod`, `PVC TTC`,
`Prix net`, `ROT`…). Ordre conseillé :

1. **Produits** (mis à jour par EAN, ou par libellé à défaut) ;
2. **Enseignes** (mises à jour par nom) ;
3. **Ruptures, opérations, nouveaux produits, facings** : chaque ligne retrouve son produit par EAN
   ou libellé, et son enseigne par nom (les enseignes inconnues peuvent être créées automatiquement).

Les lignes en erreur sont listées avec leur numéro et ne sont pas importées. Chaque page propose
un **modèle CSV** et un **export** (avec les colonnes calculées), relisible par l’import.

## Comptes, rôles et sécurité

- Chaque entreprise a son **espace isolé** ; toutes les requêtes sont filtrées par entreprise
  (tests d’isolation inclus).
- Rôles : **Administrateur** (hypothèses, équipe, export, suppression de l’espace),
  **Éditeur** (saisie et import), **Lecteur** (consultation).
- L’administrateur invite un collaborateur ; un mot de passe temporaire s’affiche une seule fois
  et doit être changé à la première connexion.
- Mots de passe hachés avec scrypt, sessions en cookie `HttpOnly` / `SameSite=Lax` dont seule
  l’empreinte est stockée, limitation des tentatives de connexion, en-têtes de sécurité (CSP
  stricte, pas d’iframe), contrôle d’origine sur les écritures, protection contre l’injection de
  formules dans les exports CSV.
- RGPD : export complet des données de l’espace (JSON) et suppression définitive de l’espace
  depuis **Compte et données**. Aucune ressource externe n’est chargée (police auto-hébergée).

## Déploiement

L’application est un seul processus Node.js qui sert l’interface et l’API, avec une base SQLite
(module `node:sqlite` intégré à Node).

```bash
docker build -t gondole .
docker run -d -p 3000:3000 -v gondole-data:/data --name gondole gondole
```

Hébergez-la sur un serveur avec Docker (par exemple un VPS chez un hébergeur français pour
garder les données en France) ou sur toute plateforme qui accepte une image Docker avec un
**volume persistant** monté sur `/data`. Placez un proxy HTTPS devant (Caddy, Nginx…) et
définissez `TRUST_PROXY=true`.

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT` / `HOST` | Adresse d’écoute | `3000` / `0.0.0.0` |
| `DATA_DIR` | Dossier de la base `gondole.db` | `./data` (`/data` dans Docker) |
| `ALLOW_SIGNUP` | `false` pour fermer les inscriptions publiques | `true` |
| `TRUST_PROXY` | `true` derrière un proxy HTTPS (IP client, cookies `Secure`) | `false` |
| `COOKIE_SECURE` | `auto`, `true` ou `false` | `auto` |
| `SESSION_DAYS` | Durée des sessions | `30` |
| `LOG_REQUESTS` | `false` pour couper le journal des requêtes | `true` |

**Sauvegardes** : copiez régulièrement le dossier de données (base en mode WAL : copiez
`gondole.db` avec ses fichiers `-wal` et `-shm`, ou utilisez `sqlite3 gondole.db ".backup sauvegarde.db"`).

## Organisation du code

```
public/                    interface web (modules ES, sans compilation)
  js/core/                 logique partagée navigateur + serveur
    calc.js                moteur de calcul des quatre leviers
    schema.js              modèle de données et validation
    settings.js            hypothèses par défaut
    io.js, csv.js, parse.js  import / export CSV au format français
    demo-data.js           jeu de démonstration fictif
  js/pages/                une page par écran
  js/ui/                   composants, graphiques SVG, formulaires
  js/store/                stockage : API (mode SaaS) ou navigateur (mode démo)
server/                    serveur HTTP, authentification, base SQLite
test/                      tests (node --test)
```

## Pistes pour la suite

- Connecteurs vers les portails de données des enseignes et les panels, pour alimenter les
  ruptures et rotations automatiquement.
- Envoi des invitations par e-mail, authentification unique (SSO) pour les grands comptes.
- Abonnement et facturation (Stripe), quotas par offre.
- PostgreSQL pour les gros volumes ou l’hébergement multi-instances.
- Historique des modifications et commentaires partagés par ligne.
