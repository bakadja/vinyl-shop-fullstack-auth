# Protection contre les abus d’authentification

La protection de POST /api/auth/login et POST /api/auth/register utilise PostgreSQL 17 et le pool existant (cinq connexions par processus). Elle précède la lecture/création de session et toute opération bcrypt, tout en restant après le contrôle HTTPS existant. GET et les autres routes gardent leur comportement. Les variantes de casse et la barre finale acceptées par Express sont aussi limitées. Les JSON invalides et les corps dépassant la limite Express sont rejetés par le parseur avant authentification.

## Analyse et choix

Avant cette modification, chaque requête pouvait exécuter bcrypt au coût 10 et une inscription pouvait créer un compte/session sans budget. Les sessions sûres ne limitaient ni brute force, ni credential stuffing, ni création automatisée. Le lookup d’un utilisateur absent évitait bcrypt. Les noms d’utilisateur restent sensibles à la casse et sont uniquement trimés, comme le contrôleur existant ; aucune conversion en minuscules, modification Unicode ou règle de connexion par email n’est introduite.

Trois approches ont été étudiées : les compteurs mémoire ne survivent pas aux processus ; un budget global par compte permet à un attaquant de verrouiller ce compte pour tous ses utilisateurs ; des budgets PostgreSQL cumulés par endpoint, pair et couple pair–identifiant bornent les coûts sans verrou global de compte. La troisième approche est retenue. Une attaque distribuée sur un compte reste soumise au budget global, mais peut répartir ses essais entre pairs. Il n’y a ni CAPTCHA, ni MFA, ni détection de mots de passe compromis ; cette protection réduit le débit sans prouver l’absence de credential stuffing.

## Budgets initiaux

| Dimension par endpoint | Connexion | Inscription |
| --- | --- | --- |
| Rafale globale | 20 / 10 secondes | 5 / minute |
| Volume global | 120 / minute | 30 / heure |
| Pair réseau | 60 / 15 minutes | 10 / heure |
| Couple pair et username trimé | 10 / 15 minutes | 3 / heure |

Ces valeurs sont des limites initiales conservatrices pour la petite application de démonstration sur B1, pas des seuils validés par une mesure Azure. Elles plafonnent les admissions bcrypt globales à deux par seconde en moyenne pour la connexion et trente créations par heure. Les fenêtres commencent à la première tentative et sont fixes : aucune expiration n’est prolongée par les refus. Une frontière de fenêtre peut permettre deux budgets rapprochés, plafonnés par le budget de rafale. Les tentatives valides, invalides et réussies consomment le budget ; une réussite ne le réinitialise pas. Les changements aléatoires d’identifiant ne contournent ni le budget pair, ni les budgets globaux. Les refus d’un budget antérieur ne créent pas de nouvelles lignes pour les dimensions suivantes.

Un client légitime derrière un NAT/proxy partage le budget pair. Un utilisateur qui dépasse dix connexions en quinze minutes attend l’expiration ; il peut se connecter ensuite. Un attaquant partageant son pair peut perturber son accès. Une attaque distribuée peut aussi épuiser les budgets globaux et provoquer un déni d’accès temporaire. Ce compromis protège les ressources limitées ; aucun rate limiter ne garantit la disponibilité face à une saturation réseau/PostgreSQL. Réviser les valeurs dans une PR avec mesures et tests, sans override de désactivation.

## Comptage, stockage et nettoyage

`db/abuse.sql` crée exclusivement `auth_abuse_counters(key text PRIMARY KEY, attempts integer, expires_at timestamptz)` avec contraintes de forme/plage et index btree d’expiration. Les clés sont des HMAC-SHA256 avec domaines séparés pour version, endpoint et dimension. Aucun username ou IP en clair n’est stocké. Le nom d’utilisateur absent, non textuel ou démesuré utilise un marqueur commun ; les budgets pair/globaux s’appliquent quand même. Les pseudonymes restent des données à protéger : ne pas leur accorder un accès public.

Chaque admission utilise une transaction et un verrou consultatif propre à la base et au schéma, commun à tous les workers. Après acquisition, l’horloge PostgreSQL définit la fenêtre. Les UPSERT et les compteurs saturants sont atomiques ; un résultat 429 est commité pour conserver les budgets précédents consommés. Le verrou est libéré avant bcrypt et ne verrouille pas les tables applicatives. Il n’y a pas de connexion supplémentaire ni de Map de secours. Les processus restent limités par les mêmes lignes après redémarrage.

Chaque transaction supprime au plus 500 lignes expirées via l’index ; les nouvelles admissions sont plafonnées strictement à 10 000 lignes, y compris après changement de clé. Le volume nominal est de quelques milliers de lignes sous les budgets globaux. Ce plafond borne les lignes vivantes, pas la taille physique exacte du fichier : les mises à jour génèrent du WAL et des tuples morts, que l’autovacuum PostgreSQL doit recycler. Surveiller taille physique, autovacuum, WAL et latence. Aucun coût Azure supplémentaire n’est créé par ce code. Le stockage a un coût sur le serveur PostgreSQL existant, sans service Redis.

Le nettoyage est opportuniste : sans trafic, les dernières lignes expirées restent présentes. Une opération privée de maintenance approuvée peut exécuter `DELETE FROM auth_abuse_counters WHERE expires_at <= clock_timestamp()` avec les droits runtime. Aucun ordonnanceur ou service payant n’est provisionné. Ne jamais tronquer la table pour débloquer un utilisateur en production sans décision opérateur : cela réinitialiserait aussi les protections des attaquants.

Les attentes de verrou sont bornées à deux secondes ; chaque instruction SQL à trois secondes, avec le délai d’acquisition de connexion existant de cinq secondes. Sous contention, le système peut répondre 503. Il ne promet pas un délai HTTP maximal de trois secondes pour toute la transaction. Le verrou global est un compromis volontaire pour l’échelle B1 ; mesurer avant tout changement de nombre de workers. Le pool de cinq connexions est par processus, pas pour tout le déploiement.

## Contrat HTTP et erreurs

Une admission refusée renvoie 429, JSON `{error: "Too many authentication attempts. Please try again later."}`, Cache-Control:no-store et Retry-After en secondes entières positives. Une erreur du stockage renvoie 503 avec JSON générique, no-store et Retry-After:5. Aucune authentification/session de secours n’a lieu. Les refus précèdent la lecture des sessions, même avec un ancien cookie. Aucun message SQL, secret, mot de passe, cookie, SID, nom d’utilisateur ou adresse complète n’est journalisé par le limiteur.

Les réponses métier existantes sont conservées, notamment 401 identique pour compte absent/mauvais mot de passe et 400 pour inscription en doublon. Les connexions inconnues exécutent maintenant une comparaison bcrypt contre un hash factice aléatoire calculé une fois au démarrage au coût 10. Cela retire le raccourci évident sans garantir un temps constant de l’ensemble HTTP/SQL. L’inscription permet encore l’énumération via son contrat de doublon ; une réponse d’inscription indifférenciée nécessiterait une modification plus profonde de l’API/UX et n’est pas prétendue ici.

Les inscriptions refusent désormais les mots de passe dépassant 72 octets UTF-8 pour éviter la troncature bcrypt, ainsi que les noms dépassant 1024 octets et emails dépassant 254 octets. La règle existante du username ASCII de 1 à 20 caractères est conservée. La connexion accepte toujours les anciens mots de passe au-delà de 72 octets, jusqu’à la nouvelle borne de 8192 octets ; username est borné à 1024 octets avant bcrypt. Ces changements sont explicites : un ancien mot de passe démesuré au-delà de cette borne nécessite une récupération de compte, dont le flux n’existe pas dans cette démonstration. Aucun mot de passe existant n’est modifié ou rehashé silencieusement.

## Adresse réseau et Azure : NO-GO

Seul `req.socket.remoteAddress` est utilisé. Les en-têtes X-Forwarded-For, Forwarded et X-Real-IP ne sont jamais consultés, y compris lorsque le proxy est approuvé pour HTTPS. La confiance dans un protocole HTTPS ne prouve pas la fiabilité d’un en-tête IP. Les adresses IPv4 mappées en IPv6 sont ramenées à la même clé IPv4 ; IPv6 est agrégé par /64 pour réduire le contournement par rotation de suffixe. Cette agrégation peut regrouper plusieurs clients légitimes.

En connexion directe, le pair est le client réseau ; sur Azure, ce pair peut être un proxy partagé. Il n’est pas présenté comme l’IP du visiteur. Aucun CIDR inventé, aucun trust proxy=true et aucun changement des fichiers sessions/config.js ou sessions/transport.js. Les six gates restent bloquées et deploymentEnabled reste false. La topologie, le filtrage/écrasement des en-têtes, l’exclusivité de l’ingress et les conséquences d’un pair partagé restent à démontrer sur Azure. Toute nouvelle résolution de client exige un accord de conception séparé.

## Migration et clé

Avant de lancer la nouvelle version, exécuter explicitement `npm run db:init:abuse` dans le bootstrap privé approuvé, puis appliquer les grants runtime. La migration est additive, transactionnelle et idempotente ; elle ne touche ni db/init.sql, ni utilisateurs, ni paniers, ni catalogue, ni sessions. Le démarrage vérifie colonnes, PK, index d’expiration et les quatre droits SELECT/INSERT/UPDATE/DELETE, puis échoue avant l’écoute si la table est incompatible ou inaccessible. Il ne crée rien automatiquement. Le workflow Azure ne migre rien.

AUTH_ABUSE_HMAC_KEY est obligatoire, distinct de la clé des sessions, identique pour tous les workers et stable après redémarrage. Générer 32 octets avec un CSPRNG et les enregistrer comme 64 caractères hexadécimaux minuscules via le gestionnaire de secrets ; ne pas afficher/copier leur valeur dans les logs ou l’historique. En Azure, la référence Key Vault pointe vers auth-abuse-hmac-key. Il n’y a pas de valeur de repli. Une référence Key Vault non résolue fait échouer la configuration.

Une rotation de cette clé change tous les pseudonymes et réinitialise les budgets : elle ne doit pas accompagner chaque release. Suspendre/drainer les admissions, effectuer une rotation coordonnée de tous les workers et vérifier leur convergence sans exposer les valeurs ; conserver le blocage si des workers utilisent des clés différentes. Les clés de session peuvent tourner indépendamment sans réinitialiser les compteurs. Une rotation après compromission est une décision opérateur ; les vieux pseudonymes seront purgés à expiration par le nettoyage borné.

## Vérification

`test/auth-abuse.test.js` vérifie les limites sur de vraies transactions PostgreSQL 17 : concurrence, expiration accélérée explicitement dans le schéma jetable, reprise, redémarrage/multiworkers, données pseudonymisées, falsification des en-têtes, saturation et plafond, panne de table et connexion indisponible, migration/privilèges et rôle runtime non propriétaire. Les fixtures créent uniquement des données fictives dans des schémas à identité vérifiée d’un nouveau cluster jetable. Elles n’utilisent jamais les données applicatives. Les tests existants continuent de contrôler HTTPS, cookies, sessions et panier. Les tests locaux ne prouvent pas le fonctionnement de l’ingress Azure.

## Preuves locales du 15 octobre 2026

Base : origin/main 6f4b5a1431ba514d1fd3dbb938f8f84261ae8673, fusion PR #12 ; workflows post-fusion API tests et Azure readiness validation réussis sur ce SHA. Branche isolée feat/authentication-abuse-protection.

Node.js 24.21.0 et PostgreSQL 17 jetable : installation fraîche npm ci --ignore-scripts, suite complète avec couverture **175/175**, zéro échec/skip. Couverture native locale : abuse.js et abuse-schema.js à 100 % des lignes ; branches respectivement 97,92 % et 100 %. Audit complet et production : zéro vulnérabilité. Bicep build/lint, validation ARM/workflow, actionlint et tests des guards de déploiement passent. Le refus de check-readiness reste attendu. Revue indépendante locale sans finding actionnable confirmé ; aucun test Azure réel. Les résultats distants CI/Sonar sont rapportés sur la Draft PR et doivent correspondre à son SHA courant ; ils ne sont pas déduits de ces résultats locaux.
