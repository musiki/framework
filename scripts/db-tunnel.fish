#!/usr/bin/env fish

# Musiki DB SSH Tunnel Helper — opens tunnel to Docker container then starts dev server.

set REMOTE_USER "zz"
set REMOTE_HOST "46.225.154.68"
set REMOTE_DB_HOST "172.18.0.10"
set REMOTE_PORT 5432
set LOCAL_PORT 5433
set DB_URL "postgresql://app:3bce519832b81f101ebc5bc80af7f501@localhost:$LOCAL_PORT/musiki26"

echo (set_color cyan)"[INFO] Opening SSH tunnel → $REMOTE_DB_HOST:$REMOTE_PORT via $REMOTE_HOST..."(set_color normal)

ssh -f -N -o ExitOnForwardFailure=yes \
    -L $LOCAL_PORT:$REMOTE_DB_HOST:$REMOTE_PORT \
    $REMOTE_USER@$REMOTE_HOST
or begin
    echo (set_color red)"[ERROR] SSH tunnel failed to open."(set_color normal)
    exit 1
end

set TUNNEL_PID (lsof -ti TCP:$LOCAL_PORT 2>/dev/null | head -1)
echo (set_color green)"[INFO] Tunnel open (PID $TUNNEL_PID). Starting dev server..."(set_color normal)
echo "[INFO] DATABASE_URL=$DB_URL"
echo ""

env DATABASE_URL=$DB_URL npm run dev

echo ""
echo (set_color yellow)"[INFO] Dev server exited. Closing tunnel (PID $TUNNEL_PID)..."(set_color normal)
if test -n "$TUNNEL_PID"
    kill $TUNNEL_PID 2>/dev/null
end
