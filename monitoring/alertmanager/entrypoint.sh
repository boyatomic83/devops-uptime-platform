#!/bin/sh
# Substitute the shared webhook token into the Alertmanager config, then start it.
set -eu
: "${ALERTMANAGER_WEBHOOK_TOKEN:?ALERTMANAGER_WEBHOOK_TOKEN must be set}"
sed "s|__ALERTMANAGER_WEBHOOK_TOKEN__|${ALERTMANAGER_WEBHOOK_TOKEN}|g" \
  /etc/alertmanager/alertmanager.yml > /alertmanager/alertmanager.yml
exec /bin/alertmanager --config.file=/alertmanager/alertmanager.yml --storage.path=/alertmanager "$@"
