#!/usr/bin/env bash

# Musiki DB SSH Tunnel Helper
#
# DEPRECADO para migraciones. Usar ./scripts/db-migrate.sh, que corre allá donde
# la base es local.
#
# Este túnel viene de cuando se desarrollaba local contra la base remota. Hoy ese
# escenario casi no se da, y el túnel agrega un punto de falla difícil de leer: un
# forward de SSH acepta conexiones locales aunque el otro extremo esté caído, así
# que parece funcionar y el error aparece después, en psql, hablando de otra cosa.
#
# Sigue acá porque sirve para inspeccionar la base a mano con un cliente gráfico.
# Si lo usás y psql se desconecta apenas conecta, el contenedor cambió de IP: el
# fallback 172.18.0.2 ya no vale.
#
# Nota: la contraseña que imprime está en texto plano en este archivo y en el
# historial de git. Conviene rotarla y moverla a .env.

REMOTE_USER="zz"
REMOTE_HOST="46.225.154.68"
REMOTE_PORT="5432"
LOCAL_PORT="5433" # Using 5433 to avoid conflict with local postgres if any

FALLBACK_IP="172.18.0.2"

echo "[INFO] Resolving remote PostgreSQL container IP..."
# `ssh` devuelve la salida de docker con un \r pegado. Sin limpiarlo, la
# especificación del forward queda "5433:172.18.0.2\r:5432", que ssh rechaza con
# «Bad local forwarding specification» — y el \r además ensucia el mensaje de
# error, así que el síntoma no se parece a la causa. Los echo de abajo se veían
# bien porque el \r no molesta al imprimir.
CONTAINER_IP=$(ssh "${REMOTE_USER}@${REMOTE_HOST}" \
  "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' devmusiki-db" 2>/dev/null \
  | tr -d '[:space:]')

if ! printf '%s' "$CONTAINER_IP" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; then
  echo "[WARN] No se pudo resolver la IP del contenedor (se obtuvo: '${CONTAINER_IP}')."
  echo "[WARN] Usando ${FALLBACK_IP}."
  CONTAINER_IP="$FALLBACK_IP"
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
