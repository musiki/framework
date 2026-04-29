#!/usr/bin/env bash

# Musiki DB SSH Tunnel Helper
# Use this script to connect your local environment to the remote PostgreSQL database on the Hetzner VPS.

REMOTE_USER="zz"
REMOTE_HOST="46.225.154.68"
REMOTE_PORT="5432"
LOCAL_PORT="5433" # Using 5433 to avoid conflict with local postgres if any

echo "[INFO] Resolving remote PostgreSQL container IP..."
CONTAINER_IP=$(ssh ${REMOTE_USER}@${REMOTE_HOST} "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' devmusiki-db" 2>/dev/null || echo "172.18.0.2")

if [ -z "$CONTAINER_IP" ]; then
  echo "[WARN] Could not resolve container IP, falling back to 172.18.0.2"
  CONTAINER_IP="172.18.0.2"
fi

echo "[INFO] Opening SSH tunnel for PostgreSQL..."
echo "[INFO] Remote: ${REMOTE_HOST} -> ${CONTAINER_IP}:${REMOTE_PORT}"
echo "[INFO] Local:  localhost:${LOCAL_PORT}"
echo "[INFO] Connection string for .env:"
echo "       DATABASE_URL=postgresql://app:3bce519832b81f101ebc5bc80af7f501@localhost:${LOCAL_PORT}/musiki26"
echo ""
echo "[INFO] Press Ctrl+C to close the tunnel."

# -o ServerAliveInterval=10: Send a keep-alive packet every 10 seconds
# -o ServerAliveCountMax=3: Drop connection after 3 missed keep-alives
# -o ExitOnForwardFailure=yes: Fail if port is already taken
ssh -L ${LOCAL_PORT}:${CONTAINER_IP}:${REMOTE_PORT} -o ServerAliveInterval=10 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes ${REMOTE_USER}@${REMOTE_HOST} -N
