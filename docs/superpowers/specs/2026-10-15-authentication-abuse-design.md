# Conception PR #13

Objectif autorisé : protéger login/register sans modifier la frontière Azure ni les contrats de session, avec persistance et comptage PostgreSQL partagé, migration explicite, tests isolés et Draft PR sans déploiement.

Choix : budgets fixes cumulés (rafale globale, volume global, pair, pair–identifiant), HMAC avec clé indépendante stable, verrou transactionnel de schéma et UPSERT, nettoyage borné et plafond strict, avant sessions/bcrypt. Pas de verrou global par compte afin de limiter les possibilités de verrouillage ciblé. Une Map ou une dépendance Redis ne satisfait pas les contraintes. L’adresse retenue est exclusivement le pair socket ; l’ingress Azure demeure un blocage documenté.

Plan exécuté : vérifier main et CI de fusion ; isoler la branche ; analyser contrôleurs/session/transport/SQL ; ajouter un test concurrent montrant l’absence de limite ; ajouter migration, validation, admission, normalisation et réponses ; borner les entrées bcrypt et supprimer le raccourci des comptes inconnus ; tester limites, reprise et workers ; documenter bootstrap/clé/grants ; vérifier suite, couverture, Bicep, workflows et guards ; soumettre une Draft PR à CI/Sonar et revue indépendante. Ne pas modifier readiness.json ni les règles/statuts Sonar.

Les seuils, compromis de disponibilité, limites d’énumération, conséquences utilisateurs et procédures sont détaillés dans docs/authentication-abuse.md. Les valeurs sont initiales et nécessitent mesures Azure avant ouverture publique. La mission autorise explicitement de continuer après une courte analyse sans nouvelle approbation, sauf redéfinition de frontière ou modification profonde de l’authentification ; aucune de ces deux exceptions n’est mise en œuvre.
