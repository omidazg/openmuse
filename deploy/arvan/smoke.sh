#!/usr/bin/env bash
# Post-deploy smoke test, run from OUTSIDE the server (the server cannot reach its own
# public IP). Exits non-zero on the first failed group of checks.
#
#   ./deploy/arvan/smoke.sh https://37.32.27.135
#   SMOKE_ACCESS_KEY=... ./deploy/arvan/smoke.sh https://dastyar-gpt.ir
#
# Env:
#   SMOKE_URL         base URL (instead of the first argument)
#   SMOKE_ACCESS_KEY  optional access key: log in, GET /api/workspace, GET /api/copilotkit/info
#   SMOKE_RETRIES     retries for the first health check (default 1; deploy.sh uses 6)
#   SMOKE_INSECURE    1 = skip TLS verification (never in production checks)
# Checks: TLS certificate, /api/health JSON (ok, live, agent + browser configured), web
# <title> containing «دستیار», HSTS header, 401 without a session and with a wrong key.
set -uo pipefail

URL="${1:-${SMOKE_URL:-}}"
[ -n "$URL" ] || { echo "usage: $0 https://<domain>   (or SMOKE_URL=...)" >&2; exit 2; }
URL="${URL%/}"
RETRIES="${SMOKE_RETRIES:-1}"
CURL=(curl -sS -m 20)
[ "${SMOKE_INSECURE:-0}" = 1 ] && CURL+=(-k)
failures=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass() { echo "PASS  $1"; }
fail() { # fail "english" "persian"
  echo "FAIL  $1" >&2
  echo "      خطا: $2" >&2
  failures=$((failures + 1))
}

echo "Smoke test: $URL"

# 1. TLS + health (retried: right after a deploy the app or certificate may still be starting)
health=""
for ((i = 1; i <= RETRIES; i++)); do
  if health=$("${CURL[@]}" -v -f "$URL/api/health" 2>"$TMP/tls.log"); then break; fi
  health=""
  [ "$i" -lt "$RETRIES" ] && { echo "      waiting for the server ($i/$RETRIES)…"; sleep 10; }
done
if [ -z "$health" ]; then
  fail "cannot reach $URL/api/health over valid HTTPS: $(grep -m1 'curl:' "$TMP/tls.log")" \
    "نشانی $URL/api/health با HTTPS معتبر در دسترس نیست. گواهی، Caddy و کانتینر app را بررسی کنید."
  echo "FAILED ($failures) / ناموفق" >&2
  exit 1
fi
expire=$(grep -i -m1 'expire date:' "$TMP/tls.log" | sed 's/.*expire date: *//')
pass "TLS certificate valid${expire:+ (expires $expire)}"

for field in '"ok":true' '"mode":"live"' '"agentConfigured":true' '"browserConfigured":true'; do
  if [[ "$health" == *"$field"* ]]; then
    pass "health $field"
  else
    fail "health JSON lacks $field: $health" "پاسخ سلامت سرور $field را ندارد. متغیرهای .env را بررسی کنید."
  fi
done

# 2. Web bundle
index=$("${CURL[@]}" -f "$URL/" 2>&1) || index=""
title=$(printf '%s' "$index" | grep -o '<title>[^<]*</title>' | head -1)
if [[ "$title" == *"دستیار"* ]]; then
  pass "web index $title"
else
  fail "web index has no <title> containing «دستیار» (got: ${title:-none})" \
    "صفحهٔ وب عنوان «دستیار» را ندارد؛ باندل وب ساخته نشده یا نسخهٔ قدیمی است."
fi

headers=$("${CURL[@]}" -D - -o /dev/null "$URL/api/health" 2>/dev/null | tr -d '\r')
if grep -qi '^strict-transport-security:' <<<"$headers"; then
  pass "HSTS header"
else
  fail "Strict-Transport-Security header missing" "سرآیند HSTS ارسال نمی‌شود؛ Caddyfile را بررسی کنید."
fi

# 3. Auth
code() { "${CURL[@]}" -o "$TMP/body" -w '%{http_code}' "$@" 2>/dev/null; }

c=$(code "$URL/api/workspace")
if [ "$c" = 401 ]; then pass "GET /api/workspace without session -> 401"; else
  fail "GET /api/workspace without session returned $c (want 401)" "فضای کاری بدون ورود در دسترس است (کد $c)."
fi

c=$(printf '{"accessKey":"smoke-wrong-key-%s"}' "$RANDOM" |
  code -X POST -H 'Content-Type: application/json' --data-binary @- "$URL/api/session")
if [ "$c" = 401 ]; then pass "login with a wrong key -> 401"; else
  fail "login with a wrong key returned $c (want 401)" "ورود با کلید نادرست رد نشد (کد $c)."
fi

if [ -n "${SMOKE_ACCESS_KEY:-}" ]; then
  key=${SMOKE_ACCESS_KEY//\\/\\\\}
  key=${key//\"/\\\"}
  # Key and token go through stdin/config, never the process list.
  c=$(printf '{"accessKey":"%s"}' "$key" |
    code -X POST -H 'Content-Type: application/json' --data-binary @- "$URL/api/session")
  token=$(sed -n 's/.*"token":"\([^"]*\)".*/\1/p' "$TMP/body")
  if [ "$c" = 200 ] && [ -n "$token" ]; then
    pass "login with SMOKE_ACCESS_KEY -> 200"
    auth() { printf 'header = "Authorization: Bearer %s"\n' "$token" | code -K - "$@"; }
    c=$(auth "$URL/api/workspace")
    if [ "$c" = 200 ]; then pass "GET /api/workspace -> 200"; else
      fail "GET /api/workspace returned $c" "بارگذاری فضای کاری ناموفق بود (کد $c). گزارش app را بررسی کنید."
    fi
    c=$(auth "$URL/api/copilotkit/info")
    if [ "$c" = 200 ] && grep -q '"agents"' "$TMP/body"; then
      pass "GET /api/copilotkit/info -> 200 with agents"
    else
      fail "GET /api/copilotkit/info returned $c: $(head -c 200 "$TMP/body")" \
        "سرویس گفت‌وگو (CopilotKit) پاسخ نداد (کد $c). مدل و کلید API را بررسی کنید."
    fi
  else
    fail "login with SMOKE_ACCESS_KEY returned $c" "ورود با SMOKE_ACCESS_KEY ناموفق بود (کد $c)."
  fi
else
  echo "SKIP  authenticated checks (set SMOKE_ACCESS_KEY) / بررسی‌های پس از ورود انجام نشد"
fi

if [ "$failures" -gt 0 ]; then
  echo "FAILED: $failures check(s) / ناموفق: $failures بررسی" >&2
  exit 1
fi
echo "OK: all checks passed / همهٔ بررسی‌ها موفق بود"
