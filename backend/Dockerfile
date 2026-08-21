FROM python:3.12-slim

WORKDIR /app

# Dépendances système minimales
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copie et installation des dépendances Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copie du code source
COPY . .

# Utilisateur non-root (uid 1000 défini dans docker-compose)
RUN groupadd -g 1000 appuser && useradd -u 1000 -g appuser appuser
RUN chown -R appuser:appuser /app
USER appuser

EXPOSE 8000
