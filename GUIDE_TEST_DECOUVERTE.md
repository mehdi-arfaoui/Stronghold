# Guide de Test de la Decouverte Stronghold

Ce guide vous permet de tester la fonctionnalite de decouverte d'infrastructure **sans aucune connaissance technique**.

---

## Methode 1 : Script Automatique (Le Plus Simple)

### Prerequis
- Docker Desktop installe et demarre
- Terminal ouvert dans le dossier Stronghold

### Etapes

1. **Ouvrez un terminal** (Terminal sur Mac, PowerShell ou Git Bash sur Windows)

2. **Allez dans le dossier Stronghold** :
   ```
   cd chemin/vers/Stronghold
   ```

3. **Lancez le test** :
   ```
   ./test-discovery.sh
   ```

4. **Attendez** que le script affiche "Test termine avec succes!"

5. **Ouvrez votre navigateur** a l'adresse : http://localhost:3000

6. **Naviguez vers "Decouverte"** pour voir les services importes

---

## Methode 2 : Interface Web (Visuel)

### Etapes

1. **Demarrez les services** :
   ```
   docker-compose up
   ```
   Attendez de voir "Backend ready" ou "pra_backend ... healthy"

2. **Ouvrez le navigateur** : http://localhost:3000

3. **Allez dans "Decouverte"**

4. **Cliquez sur "Importer"**

5. **Selectionnez un fichier** :
   - `backend/tests/fixtures/discovery-demo.json` (exemple complet avec 15 services)
   - `backend/tests/fixtures/discovery-import.json` (exemple simple avec 2 services)

6. **Visualisez le resultat** dans la carte des dependances

---

## Donnees de Test Disponibles

| Fichier | Contenu |
|---------|---------|
| `discovery-demo.json` | 15 services (web, API, bases de donnees, cache, etc.) avec 19 dependances |
| `discovery-import.json` | 2 services simples pour un test rapide |
| `discovery-import.csv` | Meme contenu en format CSV |

---

## Ce Que Vous Devriez Voir

Apres l'import, vous verrez :

- **Services** : Site Web, API Gateway, Service Paiement, etc.
- **Infrastructure** : PostgreSQL, Redis, Elasticsearch, etc.
- **Dependances** : Fleches montrant les connexions entre composants
- **Graphe visuel** : Carte interactive de votre infrastructure

---

## Pour Arreter

Quand vous avez termine :
```
docker-compose down
```

---

## Besoin d'Aide ?

- Verifiez que Docker Desktop est bien demarre
- Consultez `TROUBLESHOOTING.md` pour les problemes courants
- Les logs sont visibles avec : `docker-compose logs backend`
