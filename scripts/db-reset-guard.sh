#!/bin/bash
#
# db-reset-guard.sh
# Protege contra reset accidental de la base de datos.
# Requiere ALLOW_DB_RESET="true" para permitir la operacion.
#

set -e

if [ "$ALLOW_DB_RESET" != "true" ]; then
    echo "=============================================="
    echo "  BLOQUEO: reset de base de datos prohibido"
    echo "=============================================="
    echo ""
    echo "Para resetear la base de datos necesitas:"
    echo ""
    echo "  export ALLOW_DB_RESET=true"
    echo "  npm run db:reset"
    echo ""
    echo "ADVERTENCIA: Esto eliminara TODOS los datos."
    echo "Solo usar en desarrollo local o con backup."
    exit 1
fi

echo "[DB-RESET-GUARD] Permiso concedido. Ejecutando migrate reset..."
exit 0