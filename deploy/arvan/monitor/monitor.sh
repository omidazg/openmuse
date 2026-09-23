#!/bin/sh
# Uptime/alerting loop for the `monitor` compose service (curlimages/curl, busybox sh).
#
#   loop   (default) run all checks every MONITOR_INTERVAL seconds
#   once   run the checks once and print the result (no alerts)
#   test   send a test alert to every configured channel
#
# The server cannot reach its own public IP (no hairpin NAT), so HTTPS is checked
# through the compose network: curl --connect-to sends https://$DOMAIN to caddy:443,
# which still validates the real certificate. External reachability is covered by
# smoke.sh / .github/workflows/smoke.yml from outside.
#
# An alert is sent only on a state change (after MONITOR_FAIL_THRESHOLD consecutive
# failures), plus a recovery message. Channels: Telegram, Bale, generic webhook.
set -u

DOMAIN="${DOMAIN:?DOMAIN is required}"
INTERVAL="${MONITOR_INTERVAL:-60}"
THRESHOLD="${MONITOR_FAIL_THRESHOLD:-2}"
DISK_PCT="${MONITOR_DISK_ALERT_PCT:-90}"
CERT_DAYS="${MONITOR_CERT_WARN_DAYS:-2}"
BACKUP_MAX_AGE_H="${MONITOR_BACKUP_MAX_AGE_HOURS:-26}"
PROJECT="${MONITOR_COMPOSE_PROJECT:-openmuse}"
APP_URL="${MONITOR_APP_URL:-http://app:8787/api/health}"
BROWSER_URL="${MONITOR_BROWSER_URL:-http://browser-worker:8790/health}"
CADDY_ADDR="${MONITOR_CADDY_ADDR:-caddy:443}"
DOCKER_SOCK="${MONITOR_DOCKER_SOCKET:-/var/run/docker.sock}"
BACKUP_STATUS="${MONITOR_BACKUP_STATUS:-/backups/.status}"
LABEL="${ALERT_NAME:-دستیار جی‌پی‌تی}"
STATE="${MONITOR_STATE_DIR:-/tmp/monitor}"
mkdir -p "$STATE"

log() { echo "[monitor] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

fa_digits() {
  sed 's/0/۰/g;s/1/۱/g;s/2/۲/g;s/3/۳/g;s/4/۴/g;s/5/۵/g;s/6/۶/g;s/7/۷/g;s/8/۸/g;s/9/۹/g'
}

# Tehran is a fixed UTC+03:30 (no DST); a POSIX TZ string needs no tzdata.
tehran_time() { TZ='<+0330>-3:30' date +%H:%M | fa_digits; }

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g;s/"/\\"/g' | awk 'BEGIN{ORS=""} NR>1{print "\\n"} {print}'
}

send_bot() { # send_bot base_url token chat text
  curl -fsS -m 15 -o /dev/null "$1/bot$2/sendMessage" \
    --data-urlencode "chat_id=$3" --data-urlencode "text=$4"
}

# Returns 0 when at least one channel accepted the message (or none is configured);
# otherwise the state is not committed and the alert is retried on the next round.
send_alert() { # send_alert status(down|up|info) check text
  text="$3"
  configured=0
  delivered=0
  if [ -n "${ALERT_TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${ALERT_TELEGRAM_CHAT_ID:-}" ]; then
    configured=1
    if send_bot "${ALERT_TELEGRAM_API_URL:-https://api.telegram.org}" "$ALERT_TELEGRAM_BOT_TOKEN" \
      "$ALERT_TELEGRAM_CHAT_ID" "$text"; then delivered=1; else log "telegram send failed"; fi
  fi
  if [ -n "${ALERT_BALE_BOT_TOKEN:-}" ] && [ -n "${ALERT_BALE_CHAT_ID:-}" ]; then
    configured=1
    if send_bot "${ALERT_BALE_API_URL:-https://tapi.bale.ai}" "$ALERT_BALE_BOT_TOKEN" \
      "$ALERT_BALE_CHAT_ID" "$text"; then delivered=1; else log "bale send failed"; fi
  fi
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    configured=1
    body=$(printf '{"text":"%s","status":"%s","check":"%s","domain":"%s"}' \
      "$(json_escape "$text")" "$1" "$2" "$DOMAIN")
    if curl -fsS -m 15 -o /dev/null -H 'Content-Type: application/json' -d "$body" \
      "$ALERT_WEBHOOK_URL"; then delivered=1; else log "webhook send failed"; fi
  fi
  [ "$configured" = 0 ] && log "no alert channel configured: $text"
  [ "$configured" = 0 ] || [ "$delivered" = 1 ]
}

footer() { echo "$LABEL ($DOMAIN)، ساعت $(tehran_time) به وقت تهران"; }

# record <key> ok|fail "<problem sentence>" "<recovery sentence>" ["<detail>"]
record() {
  key="$1"
  prev=$(cat "$STATE/$key.alerted" 2>/dev/null || echo 0)
  if [ "$2" = ok ]; then
    echo 0 >"$STATE/$key.fails"
    if [ "$prev" = 1 ]; then
      send_alert up "$key" "برطرف شد: $4
$(footer)" && echo 0 >"$STATE/$key.alerted"
      log "RECOVERED $key"
    fi
    return 0
  fi
  detail="${5:-}"
  fails=$(($(cat "$STATE/$key.fails" 2>/dev/null || echo 0) + 1))
  echo "$fails" >"$STATE/$key.fails"
  log "FAIL $key ($fails): $detail"
  if [ "$prev" != 1 ] && [ "$fails" -ge "$THRESHOLD" ]; then
    send_alert down "$key" "هشدار: $3
$(footer)${detail:+
جزئیات: $detail}" && echo 1 >"$STATE/$key.alerted"
  fi
  return 0
}

check_app() {
  body=$(curl -fsS -m 10 "$APP_URL" 2>&1)
  if echo "$body" | grep -q '"ok":true'; then r=ok; else r=fail; fi
  record app "$r" "سرور API پاسخ نمی‌دهد." "سرور API دوباره پاسخ می‌دهد." \
    "$(echo "$body" | head -c 200)"
}

check_https() {
  out=$(curl -sS -v -m 15 -o /dev/null -w '%{http_code}' --connect-to "::$CADDY_ADDR" \
    "https://$DOMAIN/api/health" 2>"$STATE/https.err")
  if [ "$out" = 200 ]; then r=ok; else r=fail; fi
  record https "$r" "نشانی HTTPS در دسترس نیست یا گواهی آن نامعتبر است." \
    "نشانی HTTPS دوباره در دسترس است." \
    "HTTP $out $(grep -iE 'curl:|error' "$STATE/https.err" | tail -1 | head -c 200)"
  expire=$(grep -i 'expire date:' "$STATE/https.err" | head -1 | sed 's/.*expire date: *//;s/ GMT//')
  [ -n "$expire" ] || return 0
  exp_s=$(date -u -D '%b %d %H:%M:%S %Y' -d "$expire" +%s 2>/dev/null) || return 0
  left=$(((exp_s - $(date -u +%s)) / 86400))
  if [ "$left" -lt "$CERT_DAYS" ]; then r=fail; else r=ok; fi
  record cert "$r" "گواهی HTTPS به‌زودی منقضی می‌شود و تمدید نشده است." \
    "گواهی HTTPS تمدید شد." "$(echo "$left" | fa_digits) روز تا انقضا مانده است"
}

check_browser() {
  if curl -fsS -m 10 -o /dev/null "$BROWSER_URL" 2>/dev/null; then r=ok; else r=fail; fi
  record browser "$r" "مرورگر ایزوله (browser-worker) پاسخ نمی‌دهد." \
    "مرورگر ایزوله دوباره پاسخ می‌دهد."
}

check_disk() {
  pct=$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')
  avail=$(df -Pm / | awk 'NR==2 {print $4}')
  if [ "${pct:-0}" -ge "$DISK_PCT" ]; then r=fail; else r=ok; fi
  record disk "$r" "فضای دیسک سرور رو به پایان است." "فضای دیسک سرور به حد عادی برگشت." \
    "$(echo "$pct" | fa_digits)٪ پر، $(echo "$avail" | fa_digits) مگابایت آزاد"
}

docker_names() { # docker_names '<extra filter json>'
  curl -fsS -m 10 --unix-socket "$DOCKER_SOCK" -G "http://docker/containers/json" \
    --data-urlencode "filters={\"label\":[\"com.docker.compose.project=$PROJECT\",\"com.docker.compose.oneoff=False\"],$1}" |
    grep -o '"Names":\["/[^"]*' | sed 's/.*"\///' | tr '\n' ' '
}

check_containers() {
  [ -S "$DOCKER_SOCK" ] || return 0
  bad="$(docker_names '"health":["unhealthy"]')$(docker_names '"status":["restarting","dead"]')"
  if [ -n "$(echo "$bad" | tr -d ' ')" ]; then r=fail; else r=ok; fi
  record containers "$r" "کانتینرهایی ناسالم هستند یا مدام راه‌اندازی مجدد می‌شوند." \
    "همهٔ کانتینرها دوباره سالم هستند." "$bad"
}

check_backup() {
  [ -f "$BACKUP_STATUS" ] || return 0
  read -r st at detail <"$BACKUP_STATUS" || return 0
  age_h=$((($(date -u +%s) - ${at:-0}) / 3600))
  r=ok
  if [ "$st" != ok ]; then
    r=fail
  elif [ "$age_h" -ge "$BACKUP_MAX_AGE_H" ]; then
    r=fail
    detail="آخرین پشتیبان موفق $(echo "$age_h" | fa_digits) ساعت پیش گرفته شده است"
  fi
  record backup "$r" "پشتیبان‌گیری روزانه ناموفق بود." "پشتیبان‌گیری روزانه دوباره موفق بود." \
    "$detail"
}

run_checks() {
  check_app
  check_https
  check_browser
  check_disk
  check_containers
  check_backup
}

case "${1:-loop}" in
  loop)
    log "monitoring $DOMAIN every ${INTERVAL}s (threshold $THRESHOLD)"
    if [ "${MONITOR_STARTUP_MESSAGE:-1}" = 1 ]; then
      send_alert info startup "پایش $LABEL ($DOMAIN) آغاز شد." || true
    fi
    while :; do
      run_checks
      sleep "$INTERVAL"
    done
    ;;
  once)
    THRESHOLD=1000000
    STATE="$STATE-once"
    rm -rf "$STATE" && mkdir -p "$STATE"
    run_checks
    log "checks finished (see FAIL lines above; no alert is sent in this mode)"
    ;;
  test)
    send_alert info test "پیام آزمایشی پایش $LABEL ($DOMAIN). اگر این پیام را می‌بینید، هشدارها کار می‌کنند." &&
      log "test alert sent"
    ;;
  *)
    echo "unknown command: $1" >&2
    exit 2
    ;;
esac
