#!/usr/bin/env bash
# ==============================================================================
# F1 Telemetry & Dashboard — Linux/macOS Quick Setup Script
# Usage: chmod +x setup.sh && ./setup.sh
# ==============================================================================

set -e

# Change to the directory where this script is located
cd "$(dirname "$0")"

# Check if Python 3 is installed
if command -v python3 &>/dev/null; then
    exec python3 setup.py "$@"
fi

if command -v python &>/dev/null; then
    exec python setup.py "$@"
fi

# Fallback in pure Bash if Python is not installed
echo "⚠️  Python 3 non détecté — exécution en mode Bash fallback..."

ENV_FILE=".env"

if [ -f "$ENV_FILE" ]; then
    echo "⚠️  Le fichier .env existe déjà."
    read -r -p "Voulez-vous régénérer les secrets ? (o/N) : " confirm
    if [[ "$confirm" != "o" && "$confirm" != "O" && "$confirm" != "y" && "$confirm" != "Y" ]]; then
        echo "Configuration conservée."
        echo "Démarrage de la stack Docker..."
        docker compose up --build -d
        exit 0
    fi
fi

# Generate random secure passwords & tokens using openssl or /dev/urandom
if command -v openssl &>/dev/null; then
    INFLUX_PASS=$(openssl rand -base64 20 | tr -dc 'a-zA-Z0-9' | head -c 20)
    INFLUX_TOK=$(openssl rand -base64 36 | tr -dc 'a-zA-Z0-9' | head -c 36)
    FLUSH_TOK=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)
else
    INFLUX_PASS=$(head /dev/urandom | tr -dc A-Za-z0-9 | head -c 20)
    INFLUX_TOK=$(head /dev/urandom | tr -dc A-Za-z0-9 | head -c 36)
    FLUSH_TOK=$(head /dev/urandom | tr -dc A-Za-z0-9 | head -c 24)
fi

cat > "$ENV_FILE" <<EOF
# Fichier .env — F1 Telemetry Stack
# Généré automatiquement le $(date '+%Y-%m-%d %H:%M:%S')

INFLUX_USER=f1admin
INFLUX_PASSWORD=${INFLUX_PASS}
INFLUX_TOKEN=${INFLUX_TOK}

F1_AUTH_TOKEN=

PROXY_PORT=3001
NODE_ENV=production
ALLOWED_ORIGINS=http://localhost,http://127.0.0.1
FLUSH_TOKEN=${FLUSH_TOK}

API_ALLOWED_ORIGINS=http://localhost,http://127.0.0.1

HTTP_PORT=80
HTTPS_PORT=443
EOF

chmod 600 "$ENV_FILE" 2>/dev/null || true

echo "✅ Fichier .env créé avec succès !"
echo "🚀 Lancement des conteneurs Docker..."
docker compose up --build -d

echo ""
echo "🏁 F1 Telemetry est prêt sur : http://localhost"
