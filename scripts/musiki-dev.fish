#!/usr/bin/env fish

# Musiki All-in-One Dev Script
# Starts the SSH tunnel to PostgreSQL and launches the dev server.

set LOCAL_PORT 5433
set REMOTE_USER "zz"
set REMOTE_HOST "46.225.154.68"

# SSH Tunnel command with robust keep-alive and backgrounding
# -o ServerAliveInterval=10: Send a keep-alive packet every 10 seconds
# -o ServerAliveCountMax=3: Drop connection after 3 missed keep-alives
# -o ExitOnForwardFailure=yes: Fail if port is already taken
set TUNNEL_CMD "ssh -L $LOCAL_PORT:localhost:5432 -o ServerAliveInterval=10 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes $REMOTE_USER@$REMOTE_HOST -f -N"

# 1. Cleanup existing stale tunnels
if nc -z localhost $LOCAL_PORT 2>/dev/null
    echo (set_color yellow)"[INFO] Port $LOCAL_PORT is busy. Cleaning up existing tunnel..."(set_color normal)
    pkill -f "ssh -L $LOCAL_PORT"
    # Wait for the port to actually release
    while nc -z localhost $LOCAL_PORT 2>/dev/null
        echo "[DEBUG] Waiting for port to release..."
        sleep 0.5
    end
end

# 2. Resolve remote IP
echo (set_color cyan)"[INFO] Resolving remote PostgreSQL container IP..."(set_color normal)
set CONTAINER_IP (ssh $REMOTE_USER@$REMOTE_HOST "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' devmusiki-db" 2>/dev/null)
if test -z "$CONTAINER_IP"
    echo (set_color yellow)"[WARN] Could not resolve container IP, falling back to 172.18.0.2"(set_color normal)
    set CONTAINER_IP "172.18.0.2"
end
echo "[INFO] Using container IP: $CONTAINER_IP"

# 3. Open new tunnel
set TUNNEL_CMD "ssh -L $LOCAL_PORT:$CONTAINER_IP:5432 -o ServerAliveInterval=10 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes $REMOTE_USER@$REMOTE_HOST -f -N"
echo (set_color cyan)"[INFO] Opening SSH tunnel in background..."(set_color normal)
eval $TUNNEL_CMD

if test $status -ne 0
    echo (set_color red)"[ERROR] Failed to open SSH tunnel."(set_color normal)
    exit 1
end

# 3. Wait for tunnel to be READY
echo "[INFO] Verifying tunnel connectivity..."
set -l attempts 0
while not nc -z localhost $LOCAL_PORT 2>/dev/null
    set attempts (math $attempts + 1)
    if test $attempts -gt 20
        echo (set_color red)"[ERROR] Tunnel timed out."(set_color normal)
        exit 1
    end
    sleep 0.5
end
echo (set_color green)"[OK] Tunnel active."(set_color normal)

# 4. Run the dev server
echo (set_color green)"[INFO] Launching Musiki Framework (npm run dev)..."(set_color normal)
npm run dev

# 5. Cleanup on exit (when user stops npm run dev)
echo (set_color yellow)"[INFO] Shutting down SSH tunnel..."(set_color normal)
pkill -f "ssh -L $LOCAL_PORT"
