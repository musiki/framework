#!/usr/bin/env fish

# Musiki DB SSH Tunnel Helper (Fish version)
# Use this script to connect your local environment to the remote PostgreSQL database.

set REMOTE_USER "zz"
set REMOTE_HOST "46.225.154.68"
set REMOTE_PORT 5432
set LOCAL_PORT 5433

echo (set_color cyan)"[INFO] Opening SSH tunnel for PostgreSQL..."(set_color normal)
echo "[INFO] Remote: $REMOTE_HOST:$REMOTE_PORT"
echo "[INFO] Local:  localhost:$LOCAL_PORT"
echo "[INFO] Connection string for .env:"
echo "       DATABASE_URL=postgresql://app:3bce519832b81f101ebc5bc80af7f501@localhost:$LOCAL_PORT/musiki26"
echo ""
echo (set_color yellow)"[INFO] Press Ctrl+C to close the tunnel."(set_color normal)

ssh -L $LOCAL_PORT:localhost:$REMOTE_PORT $REMOTE_USER@$REMOTE_HOST -N
