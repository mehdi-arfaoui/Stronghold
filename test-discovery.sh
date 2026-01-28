#!/bin/bash
#
# Test Discovery - Script simple pour tester la decouverte Stronghold
#
# Usage: ./test-discovery.sh
#
# Ce script fait tout automatiquement:
# 1. Verifie que Docker est en cours d'execution
# 2. Demarre les services si necessaire
# 3. Attend que le backend soit pret
# 4. Importe des donnees de test
# 5. Affiche les resultats
#

set -e

# Couleurs pour les messages
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

API_URL="http://localhost:4000"
API_KEY="dev-key"

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}   Test de Decouverte Stronghold${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Fonction pour afficher les messages
info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[ATTENTION]${NC} $1"
}

error() {
    echo -e "${RED}[ERREUR]${NC} $1"
}

# Etape 1: Verifier Docker
info "Verification de Docker..."
if ! command -v docker &> /dev/null; then
    error "Docker n'est pas installe. Installez Docker Desktop depuis https://docker.com"
    exit 1
fi

if ! docker info &> /dev/null; then
    error "Docker n'est pas en cours d'execution. Demarrez Docker Desktop."
    exit 1
fi
success "Docker est disponible"

# Etape 2: Verifier si les services sont deja demarres
info "Verification des services..."
BACKEND_RUNNING=false
if curl -s --max-time 3 "$API_URL/health/live" > /dev/null 2>&1; then
    BACKEND_RUNNING=true
    success "Backend deja en cours d'execution"
fi

# Etape 3: Demarrer les services si necessaire
if [ "$BACKEND_RUNNING" = false ]; then
    warning "Services non demarres. Demarrage en cours..."
    echo ""
    echo -e "${YELLOW}Cela peut prendre 1-2 minutes la premiere fois.${NC}"
    echo ""

    docker-compose up -d --build

    # Attendre que le backend soit pret
    info "Attente du demarrage du backend..."
    MAX_WAIT=120
    WAITED=0
    while ! curl -s --max-time 3 "$API_URL/health/live" > /dev/null 2>&1; do
        sleep 3
        WAITED=$((WAITED + 3))
        echo -ne "\r${BLUE}[INFO]${NC} Attente... ${WAITED}s / ${MAX_WAIT}s"
        if [ $WAITED -ge $MAX_WAIT ]; then
            echo ""
            error "Le backend n'a pas demarre dans les temps. Verifiez les logs: docker-compose logs backend"
            exit 1
        fi
    done
    echo ""
    success "Backend pret!"
fi

# Etape 4: Importer les donnees de test
echo ""
info "Import des donnees de test..."

# Utiliser le fichier de demo s'il existe, sinon le fichier standard
if [ -f "backend/tests/fixtures/discovery-demo.json" ]; then
    TEST_FILE="backend/tests/fixtures/discovery-demo.json"
else
    TEST_FILE="backend/tests/fixtures/discovery-import.json"
fi

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/discovery/import" \
    -H "x-api-key: $API_KEY" \
    -F "file=@$TEST_FILE")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    success "Import reussi!"
else
    error "Echec de l'import (code HTTP: $HTTP_CODE)"
    echo "$BODY"
    exit 1
fi

# Etape 5: Recuperer l'historique des decouvertes
echo ""
info "Recuperation des resultats..."
HISTORY=$(curl -s "$API_URL/discovery/history" -H "x-api-key: $API_KEY")

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   Resultats de la Decouverte${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Afficher un resume simple
if command -v jq &> /dev/null; then
    echo "$HISTORY" | jq -r '.[] | "Type: \(.jobType // "import") | Status: \(.status) | Date: \(.completedAt // .createdAt)"' 2>/dev/null | head -5
else
    echo "$HISTORY" | head -c 500
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   Test termine avec succes!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Prochaines etapes:"
echo -e "  1. Ouvrez ${BLUE}http://localhost:3000${NC} dans votre navigateur"
echo -e "  2. Allez dans la section ${BLUE}Decouverte${NC}"
echo -e "  3. Visualisez les services et dependances importes"
echo ""
echo -e "Pour arreter les services: ${YELLOW}docker-compose down${NC}"
echo ""
