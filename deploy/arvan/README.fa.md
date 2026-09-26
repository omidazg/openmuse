# راه‌اندازی دستیار جی‌پی‌تی روی ابرآروان

این راهنما دستیار جی‌پی‌تی را روی **یک سرور ابری ابرآروان (ECC)** با Docker Compose اجرا می‌کند:

| سرویس | نقش |
| --- | --- |
| `app` | سرور API (Hono) + نسخهٔ وب اپ (خروجی Expo) از همان دامنه |
| `worker` | اجراکنندهٔ کارهای پس‌زمینه (`worker-entry.js`) |
| `browser-worker` | مرورگر Playwright ایزوله (همان سخت‌سازی `infra/compose.yaml`) |
| `postgres` | پایگاه داده (PostgreSQL 17) |
| `caddy` | HTTPS خودکار (Let's Encrypt) برای `DOMAIN` |
| `backup` | پشتیبان روزانهٔ Postgres و داده‌های اپ، با بارگذاری اختیاری در فضای ابری ابرآروان |
| `monitor` | پایش هر دقیقه و هشدار فارسی در تلگرام، بله یا وب‌هوک |

استقرار فعلی با همین راهنما روی سرور تهران (بامداد) در `https://37.32.27.135` اجرا می‌شود
(گواهی Let's Encrypt برای خودِ IP، `ACME_PROFILE=shortlived`). دامنه‌های DNS عمومی مثل
sslip.io و nip.io در ایران فیلتر DNS می‌شوند؛ پس از ثبت دامنهٔ `.ir` بخش ۱۴ را ببینید.

فایل‌ها: `Dockerfile` (ریشهٔ مخزن)، `deploy/arvan/compose.yaml`، `Caddyfile`، `env.example`،
`bootstrap.sh`، `cloud-init.yaml` (فقط مرجع)، `create-server.sh`، `deploy.sh`، `smoke.sh`،
`restore.sh`، `set-domain.sh`، `backup/` (ایمیج و اسکریپت پشتیبان)، `monitor/monitor.sh`،
`host/install-maintenance.sh` (زمان‌بند پاک‌سازی هفتگی Docker). برای سرور دوم و دسترس‌پذیری
بالا: [`docs/SCALING.fa.md`](../../docs/SCALING.fa.md).

> چرا سرور ابری و نه «ابر کانتینر» (PaaS)؟ ابر کانتینر فقط در دیتاسنترهای ایران است، دسترسی به
> Docker socket / تنظیمات امنیتی مرورگر (`cap_drop`, `shm_size`) محدود است و کلید API فعلی به
> APIهای آن دسترسی قابل‌کشفی نداد. یک VM با Compose ساده‌تر، ارزان‌تر و قابل‌جابجاست.

---

## ۱. پیش‌نیازها

- حساب ابرآروان با اعتبار کیف پول و یک **کلید API** (پنل ← پروفایل ← کلیدهای API).
- یک دامنه (مثلاً `muse.example.ir`).
- روی سیستم خودتان: `ssh`، `curl`، `jq`، `openssl`، `git`.
- کلید CopilotKit Intelligence (در حالت live الزامی است):
  ```bash
  npx copilotkit@latest login
  npx copilotkit@latest project select
  ```
- کلید یک ارائه‌دهندهٔ مدل (OpenAI / Anthropic / Google) یا یک درگاه سازگار با OpenAI.

## ۲. انتخاب منطقه (مهم: دسترسی به سرویس‌های هوش مصنوعی)

OpenAI، Anthropic و Google درخواست‌های IPهای ایران را مسدود می‌کنند.

| منطقه | کد | توضیح |
| --- | --- | --- |
| آلمان (کارلسروهه) | `eu-west1-a` | **پیشنهادی.** دسترسی مستقیم به APIهای مدل، GitHub، Docker Hub و Google OAuth |
| تهران (بامداد، فروغ، سیمین) | `ir-thr-ba1`، `ir-thr-fr1`، `ir-thr-si1` | نیاز به درگاه/پراکسی مدل (`OPENAI_BASE_URL`) و آینه‌ها |
| تبریز / اهواز | `ir-tbz-sh1`، `ir-southwest1-a` | مانند تهران |

> پیش از نهایی‌کردن، روی سرور آلمان بررسی کنید که IP واقعاً پذیرفته می‌شود (رنج‌های ابرآروان در
> برخی پایگاه‌های GeoIP ممکن است ایران ثبت شده باشند):
> ```bash
> curl -s https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY" | head
> curl -s https://ipinfo.io/country
> ```
> اگر خطای `unsupported_country` گرفتید، یک درگاه سازگار با OpenAI خارج از ایران بسازید و
> `OPENAI_BASE_URL` را تنظیم کنید.

اگر سرور در ایران است، در `.env` این‌ها را هم بگذارید:
```bash
REGISTRY_MIRROR=docker.arvancloud.ir/     # آینهٔ Docker Hub ابرآروان (اسلش پایانی لازم است)
NPM_REGISTRY=https://<آینهٔ-npm-قابل‌دسترس>/
OPENAI_BASE_URL=https://<درگاه-شما>/v1
```
توجه: ایمیج `mcr.microsoft.com/playwright` (برای `browser-worker`) از Docker Hub نیست و آینهٔ
ابرآروان آن را پوشش نمی‌دهد؛ در ایران ممکن است لازم باشد آن را جداگانه منتقل کنید
(`docker save` / `docker load`).

### درگاه متیس (Metis AI) برای سرورهای ایران

[متیس](https://docs.metisai.ir/) درگاهی ایرانی است که مدل‌های OpenAI، Anthropic و Gemini را از
IP ایران در دسترس می‌گذارد. کافی است در `deploy/arvan/.env` کلید متیس را بگذارید:

```bash
METIS_API_KEY=<کلید متیس از پنل metisai.ir>
MODEL=openai/gpt-4.1          # پیش‌فرض اگر MODEL خالی باشد
# METIS_BASE_URL=https://api.metisai.ir   # فقط اگر نشانی دیگری لازم است
```

با وجود `METIS_API_KEY`، سرور خودش کلید و نشانی هر سه ارائه‌دهنده را روی متیس تنظیم می‌کند
(`OPENAI_API_KEY`/`OPENAI_BASE_URL` و مانند آن‌ها لازم نیست و در صورت وجود نادیده گرفته می‌شوند):

| پیشوند `MODEL` | نشانی متیس | نمونهٔ آزموده‌شده (پخش زنده + فراخوانی ابزار) |
| --- | --- | --- |
| `openai/` | `https://api.metisai.ir/openai/v1` | `openai/gpt-4.1`، `openai/gpt-5.4` |
| `anthropic/` | `https://api.metisai.ir/anthropic/v1` | `anthropic/claude-sonnet-5` |
| `google/` | `https://api.metisai.ir/v1beta` | `google/gemini-2.5-flash` |

گفتگو، اجرای کارهای پس‌زمینه و ابزارهای رایانه همگی از همین تنظیم استفاده می‌کنند. بررسی سریع روی سرور:

```bash
curl -s https://api.metisai.ir/openai/v1/models -H "Authorization: Bearer $METIS_API_KEY" | head -c 300
```

## ۳. اندازهٔ سرور و هزینه (قیمت‌های API، ریال)

| منطقه | Flavor | مشخصات | ماهانه (ریال) | ≈ تومان |
| --- | --- | --- | --- | --- |
| آلمان | `g1-4-2-0` (c1-medium1) | ۲ vCPU، ۴ GB، ۲۵ GB | 19,728,000 | ۱٬۹۷۲٬۸۰۰ |
| آلمان | `g4-8-2-0` (m4-small1) | ۲ vCPU، ۸ GB، ۵۰ GB | 38,296,800 | ۳٬۸۲۹٬۶۸۰ |
| آلمان | `g1-8-4-0` (c1-medium2) | ۴ vCPU، ۸ GB، ۷۵ GB | 41,616,000 | ۴٬۱۶۱٬۶۰۰ |
| تهران بامداد | `g4-4-2-0` (c4-medium1) | ۲ vCPU، ۴ GB، ۲۵ GB | 19,662,000 | ۱٬۹۶۶٬۲۰۰ |

- ۴ GB برای شروع کافی است (Postgres + دو فرایند Node + یک Chromium). برای استفادهٔ سنگین از
  مرورگر، ۸ GB بگیرید.
- ترافیک، IP اضافه، اسنپ‌شات و بکاپ جداگانه محاسبه می‌شوند. صورت‌حساب ساعتی است.

شناسهٔ ایمیج Ubuntu 24.04: آلمان `9642130c-85b3-4370-8e12-91c7ea125b0a`، تهران بامداد
`bffe688a-190b-41de-b038-dd9fe4f3270c` (اسکریپت آن را خودکار پیدا می‌کند).

## ۴. ساخت رازها (secrets)

```bash
cp deploy/arvan/env.example deploy/arvan/.env
chmod 600 deploy/arvan/.env
echo "OPENMUSE_ACCESS_KEY=$(openssl rand -hex 24)"
echo "TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32)"
echo "WORKER_TOKEN=$(openssl rand -hex 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"   # فقط hex؛ داخل URL قرار می‌گیرد
```
مقادیر را در `deploy/arvan/.env` بگذارید و `DOMAIN`، `MODEL` و کلید
مدل را پر کنید. `OPENMUSE_ACCESS_KEY` همان رمزی است که هنگام ورود در اپ وارد می‌کنید.
فایل `.env` در git نادیده گرفته می‌شود؛ هرگز آن را commit نکنید.

متغیرهای اصلی:

| متغیر | الزامی | توضیح |
| --- | --- | --- |
| `DOMAIN` | ✔ | دامنهٔ عمومی؛ `PUBLIC_API_URL`، `ALLOWED_ORIGINS` و آدرس API وب از آن ساخته می‌شوند |
| `OPENMUSE_ACCESS_KEY` | ✔ | حداقل ۲۴ کاراکتر |
| `TOKEN_ENCRYPTION_KEY` | ✔ | ۳۲ بایت تصادفی base64 |
| `WORKER_TOKEN` | ✔ | مشترک بین API و browser-worker، حداقل ۳۲ کاراکتر |
| `POSTGRES_PASSWORD` | ✔ | رمز پایگاه داده |
| `THREADS_BACKEND` | – | `local` (پیش‌فرض بدون کلید CPK): گفت‌وگوها در Postgres همین سرور؛ `intelligence`: CopilotKit Cloud |
| `CPK_INTELLIGENCE_API_KEY` | – | فقط برای `THREADS_BACKEND=intelligence` |
| `MODEL` + `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` | ✔ | مدل عامل؛ مثل `openai/<model-id>` |
| `OPENAI_BASE_URL` | – | درگاه سازگار با OpenAI |
| `METIS_API_KEY` / `METIS_BASE_URL` | – | درگاه متیس برای سرورهای ایران؛ جایگزین کلیدهای بالا (بخش ۲) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | – | اتصال Google؛ Redirect URI: `https://DOMAIN/api/google/callback` |
| `REGISTRY_MIRROR` / `NPM_REGISTRY` | – | آینه‌ها برای سرورهای ایران |
| `ACME_PROFILE` | – | `classic` برای دامنه (پیش‌فرض)؛ `shortlived` وقتی `DOMAIN` خودِ IP است |
| `BACKUP_S3_ENDPOINT` / `BACKUP_S3_BUCKET` / `BACKUP_S3_ACCESS_KEY` / `BACKUP_S3_SECRET_KEY` | – | بارگذاری پشتیبان‌ها در فضای ابری ابرآروان (بخش ۹) |
| `BACKUP_*` دیگر | – | زمان، تعداد نسخه‌ها و ماندگاری پشتیبان (در `env.example`) |
| `ALERT_BALE_BOT_TOKEN` / `ALERT_BALE_CHAT_ID` | – | هشدار در بله (بخش ۱۰) |
| `ALERT_TELEGRAM_BOT_TOKEN` / `ALERT_TELEGRAM_CHAT_ID` / `ALERT_TELEGRAM_API_URL` | – | هشدار در تلگرام؛ در صورت مسدودبودن، نشانی پراکسی Bot API |
| `ALERT_WEBHOOK_URL` / `ALERT_NAME` / `MONITOR_*` | – | وب‌هوک عمومی، نام نمایشی و آستانه‌های پایش |
| `SENTRY_DSN` / `SENTRY_ENVIRONMENT` / `SENTRY_RELEASE` | – | ثبت خطا در Sentry یا GlitchTip (بخش ۱۱) |

> **حالت خودمیزبان (بدون CopilotKit Cloud و Google):** با `THREADS_BACKEND=local` گفت‌وگوی اصلی،
> گفت‌وگوهای جانبی، تغییر نام، بایگانی و بازگردانی در همان پایگاه‌دادهٔ Postgres ذخیره می‌شوند و
> سرور به `copilotkit.ai` نیازی ندارد. `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` هم اختیاری‌اند؛
> اگر خالی باشند Gmail و تقویم در اپ «پیکربندی نشده» نمایش داده می‌شوند. تله‌متری CopilotKit با
> `COPILOTKIT_TELEMETRY_DISABLED=true` و `DO_NOT_TRACK=1` (در Dockerfile و خود سرور) خاموش است.

## ۵. DNS و CDN ابرآروان

1. در پنل ابرآروان ← CDN ← «افزودن دامنه»، دامنه را اضافه کنید و NSهای دامنه را به NSهای
   ابرآروان تغییر دهید.
2. رکوردهای `A` (IPv4) و `AAAA` (IPv6) را برای `@` و `www` به IP سرور بسازید و پروکسی (ابر)
   را روشن کنید. لبهٔ CDN ابرآروان به بازدیدکننده فقط IPv4 می‌دهد؛ رکورد `AAAA` نشانی مبدأ
   برای اتصال لبه به سرور است. شبکهٔ `frontend` در compose دوپشته است و UFW باید پورت‌های
   ۸۰ و ۴۴۳ را روی IPv6 هم باز کند.
3. **اتصال به مبدأ:** رکوردهای دامنهٔ اصلی روی `auto` (همان پروتکل بازدیدکننده) تا چالش
   HTTP-01 از لبه روی پورت ۸۰ به Caddy برسد و Caddy گواهی خودش را بگیرد و تمدید کند.
   «انتقال به HTTPS» ابرآروان را خاموش بگذارید؛ Caddy همین کار را با HSTS انجام می‌دهد.
   رکوردهای `www` و دامنه‌های دیگر روی `http`: Caddy آن‌ها را با حفظ مسیر به
   `https://DOMAIN` می‌فرستد و نشانی IP سرور (`SERVER_IP`) هم به دامنه منتقل می‌شود.
4. **SSL لبه:** گواهی مدیریت‌شدهٔ ابرآروان (EC)، حداقل TLS 1.2 و QUIC (HTTP/3) روشن. برای
   دامنهٔ اصلی «انتقال www به دامنهٔ اصلی» (`root`) را روشن کنید.
5. **کش:** کش پیش‌فرض دامنه خاموش؛ قانون صفحه برای `/api/*` بدون کش، و برای `/_expo/*` و
   `/assets/*` (فایل‌های هش‌دار) کش ۳۰ روزه بدون Query string. HTML و `sw.js` همیشه از مبدأ
   می‌آیند تا نسخهٔ تازه بلافاصله دیده شود.
6. Caddy نشانی واقعی کاربر را از `X-Forwarded-For` لبه‌های ابرآروان
   (`https://www.arvancloud.ir/fa/ips.txt`) می‌خواند؛ اگر ابرآروان بازهٔ تازه‌ای اضافه کرد،
   فهرست `trusted_proxies` در `Caddyfile` را به‌روز کنید. WAF و حفاظت DDoS ابرآروان را
   بدون آزمایش روشن نکنید؛ ممکن است پیام‌های حاوی کد را مسدود کنند. سقف زمان انتظار لبه در
   طرح پایه ۱۰۰ ثانیه است.

## ۶. ساخت سرور

### روش الف: پنل
پنل ← سرور ابری ← ایجاد سرور: منطقه `eu-west1-a`، Ubuntu 24.04، اندازهٔ `g1-4-2-0`، کلید SSH
خودتان، و محتوای `deploy/arvan/bootstrap.sh` را در «اسکریپت اولیه» (User data) بچسبانید. ابرآروان فرمت cloud-config را اجرا نمی‌کند و این فیلد را اسکریپت شل در نظر می‌گیرد.

### روش ب: API (اسکریپت)
ابتدا کلید SSH خود را در همان منطقه در پنل ثبت کنید، سپس:
```bash
export ARVAN_API_KEY=...            # بدون پیشوند "apikey "
export SSH_KEY_NAME=my-laptop
export REGION=eu-west1-a FLAVOR_ID=g1-4-2-0
./deploy/arvan/create-server.sh               # فقط پیش‌نمایش درخواست (dry run)
CONFIRM=yes ./deploy/arvan/create-server.sh   # ساخت واقعی سرور — هزینه دارد
```
وضعیت و IP:
```bash
curl -s -H "Authorization: apikey $ARVAN_API_KEY" \
  https://napi.arvancloud.ir/ecc/v1/regions/$REGION/servers | jq '.data[] | {name,status,addresses}'
```

bootstrap.sh این کارها را انجام می‌دهد: نصب Docker و Compose از مخزن Ubuntu، فعال‌کردن ufw
(فقط پورت‌های ۲۲، ۸۰ و ۴۴۳)، کلون شاخهٔ `fa-arvan` از `https://github.com/omidazg/openmuse`
در `/opt/openmuse`. تا `.env` بارگذاری نشود، کانتینری اجرا نمی‌شود.
اگر User data اجرا نشد، همان اسکریپت را دستی اجرا کنید: `ssh root@IP "bash -s" < deploy/arvan/bootstrap.sh`

> گروه امنیتی پیش‌فرض ابرآروان همهٔ پورت‌های TCP را باز می‌گذارد؛ ufw روی خود سرور آن را
> محدود می‌کند. در صورت امکان یک گروه امنیتی با فقط ۲۲/۸۰/۴۴۳ بسازید و `SECURITY_GROUP` را
> تنظیم کنید.

## ۷. استقرار (Deploy)

```bash
SERVER=root@<IP> ./deploy/arvan/deploy.sh
# با کلید مشخص:
SERVER=root@<IP> SSH_KEY=~/.ssh/arvan ./deploy/arvan/deploy.sh
```
اسکریپت idempotent است: مخزن را کلون/به‌روز می‌کند (`git merge --ff-only`)، `.env` محلی را با
مجوز 600 بارگذاری می‌کند (فقط اگر سرور هنوز `.env` ندارد، یا با `FORCE_ENV=1`) و
`docker compose up -d --build` را اجرا می‌کند. پس از آن ایمیج‌های بی‌استفاده و کش build قدیمی‌تر
از یک هفته را پاک می‌کند، زمان‌بند پاک‌سازی هفتگی را نصب می‌کند (بخش ۱۳)، مصرف دیسک را نشان
می‌دهد و اگر دیسک بیش از ۸۵٪ پر باشد (`DISK_WARN_PCT`) هشدار می‌دهد.

بررسی (آزمون دود از سیستم خودتان؛ خود سرور به IP عمومی‌اش دسترسی ندارد):
```bash
SERVER=root@<IP> SMOKE=1 SMOKE_ACCESS_KEY=<کلید> ./deploy/arvan/deploy.sh   # استقرار + آزمون
./deploy/arvan/smoke.sh https://<DOMAIN>                                      # فقط آزمون
ssh root@<IP> 'cd /opt/openmuse/deploy/arvan && sudo docker compose ps && sudo docker compose logs --tail=50 app'
```

## ۸. به‌روزرسانی

تغییرات را به شاخهٔ `fa-arvan` در fork بفرستید و دوباره اجرا کنید:
```bash
SERVER=root@<IP> ./deploy/arvan/deploy.sh
```
توجه: آدرس API داخل باندل وب هنگام build ثابت می‌شود؛ اگر `DOMAIN` عوض شد، حتماً دوباره
build کنید (deploy.sh این کار را انجام می‌دهد).

## ۹. پشتیبان‌گیری و بازگردانی

داده‌ها در volumeهای Docker هستند: `openmuse_pgdata` (پایگاه داده)، `openmuse_app-data`
(PDFها و کلید امضای نشست `session-signing-key`)، `openmuse_browser-profiles`،
`openmuse_caddy-data` (گواهی‌ها) و `openmuse_backups` (نسخه‌های پشتیبان).

سرویس `backup` هر روز ساعت **۰۳:۳۰ به وقت تهران** (۰۰:۰۰ UTC) این کارها را انجام می‌دهد:

- `pg_dump -Fc` از پایگاه داده و یک بایگانی `tar.gz` از `app-data` (کلید امضای نشست و PDFها)؛
- نگه‌داشتن **۷ نسخهٔ روزانه** و **۴ نسخهٔ هفتگی** (جمعه‌ها) در volume `backups`. نسخه‌های
  هفتگی hard link هستند و فضای اضافه نمی‌گیرند؛ پیش از شروع، اگر کمتر از ۵۰۰ مگابایت فضای
  آزاد باشد، پشتیبان‌گیری انجام نمی‌شود و `monitor` هشدار می‌دهد؛
- اگر متغیرهای S3 پر باشند، بارگذاری هر نسخه در فضای ذخیره‌سازی ابری ابرآروان با rclone و حذف
  نسخه‌های قدیمی‌تر از ۳۰ روز (`BACKUP_S3_RETENTION_DAYS`) از باکت.

آن‌چه عمداً پشتیبان‌گیری **نمی‌شود**: `.env` (رازها؛ آن را جداگانه در یک مدیر رمز نگه دارید؛ بدون
`TOKEN_ENCRYPTION_KEY` توکن‌های Google رمزگشایی نمی‌شوند)، `caddy-data` (گواهی دوباره خودکار
گرفته می‌شود) و `browser-profiles`.

### فعال‌کردن نسخهٔ خارج از سرور (فضای ابری ابرآروان)

1. پنل ابرآروان ← فضای ذخیره‌سازی ابری ← ساخت باکت (مثلاً `dastyar-backups`) با دسترسی
   **خصوصی**. بهتر است منطقهٔ باکت با منطقهٔ سرور فرق داشته باشد.
2. از بخش «کلیدهای دسترسی» یک Access Key و Secret Key بسازید.
3. در `.env` سرور:
   ```bash
   BACKUP_S3_ENDPOINT=https://s3.ir-thr-at1.arvanstorage.ir   # نشانی منطقهٔ باکت از پنل
   BACKUP_S3_BUCKET=dastyar-backups
   BACKUP_S3_ACCESS_KEY=...
   BACKUP_S3_SECRET_KEY=...
   ```
4. اعمال و بررسی:
   ```bash
   cd /opt/openmuse/deploy/arvan
   sudo docker compose up -d backup
   sudo docker compose exec backup /bin/sh /opt/backup/backup.sh s3-check
   sudo ./restore.sh backup-now      # یک پشتیبان فوری و بارگذاری آن
   ```

نسخه‌ها رمزنگاری نمی‌شوند؛ باکت را خصوصی نگه دارید و کلید دسترسی آن را فقط برای همین باکت
بسازید.

### بازگردانی (`restore.sh`، روی سرور)

```bash
cd /opt/openmuse/deploy/arvan
sudo ./restore.sh list                         # نسخه‌های محلی و نسخه‌های باکت
sudo ./restore.sh db latest                    # آخرین نسخهٔ محلی پایگاه داده
sudo ./restore.sh appdata latest               # کلید امضای نشست و PDFها
# از باکت: ابتدا دانلود، سپس بازگردانی همان فایل
sudo ./restore.sh fetch daily/openmuse-20260923T000000Z.dump
sudo ./restore.sh db /backups/restore/openmuse-20260923T000000Z.dump
```

`db` و `appdata` پیش از هر کار تأیید می‌خواهند (یا `CONFIRM=yes`)، یک نسخهٔ ایمنی از وضعیت فعلی
در `/backups/restore/` می‌سازند، `app` و `worker` را متوقف می‌کنند، بازگردانی را انجام می‌دهند و
دوباره آن‌ها را اجرا می‌کنند. پس از اطمینان از نتیجه، فایل‌های اضافه را پاک کنید تا دیسک پر نشود:
`sudo docker compose exec backup sh -c 'rm -f /backups/restore/*'`.

### بازسازی کامل روی سرور تازه

1. سرور را بسازید و `bootstrap.sh` را اجرا کنید (بخش ۶).
2. همان `.env` قبلی را بارگذاری و مستقر کنید: `SERVER=root@<IP> ./deploy/arvan/deploy.sh`.
3. `sudo ./restore.sh fetch daily/<آخرین dump>` و `sudo ./restore.sh db /backups/restore/<همان فایل>`،
   سپس همین کار برای `app-data-*.tar.gz` با `appdata`.
4. رکورد DNS را به IP تازه تغییر دهید (بخش ۱۴).

## ۱۰. پایش و هشدار

سرویس `monitor` (ایمیج سبک `curlimages/curl`) هر دقیقه این موارد را بررسی می‌کند و فقط هنگام
**تغییر وضعیت** (پس از ۲ شکست پیاپی) پیام فارسی می‌فرستد، و پس از رفع مشکل پیام «برطرف شد»:

| بررسی | روش |
| --- | --- |
| سرور API | `http://app:8787/api/health` از شبکهٔ داخلی |
| HTTPS و گواهی | `https://DOMAIN/api/health` از مسیر داخلی Caddy با اعتبارسنجی واقعی گواهی؛ هشدار اگر کمتر از ۲ روز تا انقضا مانده باشد |
| مرورگر ایزوله | `http://browser-worker:8790/health` |
| دیسک | بیش از ۹۰٪ پر (`MONITOR_DISK_ALERT_PCT`) |
| کانتینرها | کانتینرهای ناسالم یا در حال راه‌اندازی مجدد، از Docker socket (فقط‌خواندنی) |
| پشتیبان | شکست آخرین پشتیبان یا گذشتن بیش از ۲۶ ساعت از آخرین پشتیبان موفق |

این سرور به IP عمومی خودش دسترسی ندارد (hairpin NAT)، پس دسترس‌پذیری از بیرون را آزمون دود
(بخش ۱۲) و در صورت امکان یک سرویس پایش بیرونی بررسی می‌کند.

کانال‌ها (هر تعداد را می‌توانید با هم فعال کنید):

- **بله** (از داخل ایران در دسترس): در بله با `@BotFather` یک بات بسازید و توکن را در
  `ALERT_BALE_BOT_TOKEN` بگذارید. بات را به گروه مدیران اضافه کنید یا به آن پیام بدهید، سپس
  شناسهٔ گفت‌وگو را از خروجی این دستور بردارید و در `ALERT_BALE_CHAT_ID` بگذارید:
  `curl -s https://tapi.bale.ai/bot<TOKEN>/getUpdates`
- **تلگرام**: `ALERT_TELEGRAM_BOT_TOKEN` و `ALERT_TELEGRAM_CHAT_ID`. نشانی `api.telegram.org` از
  سرورهای ایران معمولاً مسدود است؛ در این صورت `ALERT_TELEGRAM_API_URL` را روی یک رلهٔ Bot API
  خارج از ایران بگذارید یا از بله استفاده کنید.
- **وب‌هوک**: `ALERT_WEBHOOK_URL` بدنهٔ JSON با فیلدهای `text`، `status` (`down`/`up`/`info`)،
  `check` و `domain` دریافت می‌کند.

اعمال و آزمایش:
```bash
sudo docker compose up -d monitor
sudo docker compose exec monitor sh /opt/monitor/monitor.sh test   # پیام آزمایشی
sudo docker compose exec monitor sh /opt/monitor/monitor.sh once   # اجرای یک‌بارهٔ بررسی‌ها
sudo docker compose logs --tail=50 monitor
```

> Docker socket فقط‌خواندنی به `monitor` داده می‌شود تا وضعیت سلامت کانتینرها را بخواند. این
> کانتینر پورتی باز نمی‌کند و فقط به کانال‌های هشدار وصل می‌شود. اگر نمی‌خواهید این دسترسی را
> بدهید، `MONITOR_DOCKER_SOCKET_HOST=/dev/null` بگذارید تا این بررسی کنار گذاشته شود.

## ۱۱. ثبت خطا (Sentry / GlitchTip)

با تنظیم `SENTRY_DSN`، خطاهای پیش‌بینی‌نشدهٔ API (پاسخ‌های ۵۰۲) و خطاهای مهلک فرایندهای `app`
و `worker` به یک سرویس سازگار با Sentry ارسال می‌شوند. پیاده‌سازی بدون وابستگی است
(`apps/server/src/errors-report.ts`) و بدون DSN هیچ کاری نمی‌کند.

- فقط نوع خطا، پیام پاک‌سازی‌شده (توکن‌ها، کلیدها و رمزها حذف می‌شوند)، stack، روش HTTP و
  الگوی مسیر (مثل `/api/files/:id`) ارسال می‌شود؛ بدنهٔ درخواست، سرآیندها، query و کوکی هرگز.
- `SENTRY_RELEASE` خودکار شناسهٔ commit مستقرشده است و `SENTRY_ENVIRONMENT` پیش‌فرض `production`.
- sentry.io برای کاربران ایران در دسترس نیست؛ [GlitchTip](https://glitchtip.com) خودمیزبان با همین
  DSN کار می‌کند. آن را روی سرور جداگانه نصب کنید، نه روی همین سرور ۴ گیگابایتی.

## ۱۲. آزمون دود (Smoke test)

`smoke.sh` از بیرون سرور این موارد را بررسی می‌کند و در صورت شکست با کد غیرصفر خارج می‌شود:
اعتبار گواهی TLS، پاسخ `/api/health` (`ok`، حالت `live`، `agentConfigured` و `browserConfigured`)،
وجود «دستیار» در `<title>` صفحهٔ وب، سرآیند HSTS، پاسخ ۴۰۱ بدون نشست و با کلید نادرست. با
`SMOKE_ACCESS_KEY` وارد هم می‌شود و `GET /api/workspace` و `GET /api/copilotkit/info` را بررسی می‌کند.

```bash
./deploy/arvan/smoke.sh https://37.32.27.135
SMOKE_ACCESS_KEY=<کلید> ./deploy/arvan/smoke.sh https://dastyar-gpt.ir
```

برای آزمون خودکار، یک کلید جدا بسازید (`OPENMUSE_USER_KEYS=...,smoke:<openssl rand -hex 24>`) تا
فضای کاری کاربران واقعی درگیر نشود. گردش‌کار `.github/workflows/smoke.yml` با اجرای دستی و پس از
هر push به `fa-arvan` اجرا می‌شود؛ در مخزن GitHub ← Settings ← Secrets این دو را بسازید:
`SMOKE_URL` (مثلاً `https://37.32.27.135`) و `SMOKE_ACCESS_KEY`.

### ارزیابی کیفیت فارسی (`pnpm eval`)

`tests/evals/persian.json` حدود ۳۰ پرسش فارسی دارد (نام دستیار، تقویم شمسی، حساب با رقم فارسی، نامهٔ
رسمی، نیم‌فاصله و املا، رد درخواست‌های ناامن) و برای هر پاسخ چند بررسی ساده انجام می‌شود. این ارزیابی با
مدل واقعی کار می‌کند، پس جزو `pnpm test` نیست و فقط دستی اجرا می‌شود:

```bash
EVAL_BASE_URL=https://37.32.27.135 EVAL_ACCESS_KEY=<کلید> pnpm eval
# فقط چند مورد:
EVAL_ONLY=name-1,math-multiply EVAL_BASE_URL=... EVAL_ACCESS_KEY=... pnpm eval
```

برای گواهی خودامضا `NODE_TLS_REJECT_UNAUTHORIZED=0` را هم بگذارید. هر پرسش در گفت‌وگوی تازه فرستاده
می‌شود و هزینهٔ مدل دارد؛ بهتر است همان کلید آزمون دود را به کار ببرید.

## ۱۳. نگهداری دیسک

دیسک سرور فعلی ۲۳ گیگابایت است و بیشترِ آن را ایمیج‌ها و کش build مصرف می‌کنند.

- گزارش‌های Docker چرخشی هستند (`bootstrap.sh`: حداکثر ۵ فایل ۲۰ مگابایتی برای هر کانتینر).
- `deploy.sh` پس از هر استقرار ایمیج‌های بی‌استفاده و کش build قدیمی‌تر از یک هفته را پاک می‌کند.
- زمان‌بند `openmuse-prune.timer` (نصب با `deploy.sh` یا `bootstrap.sh`) هر جمعه ساعت ۰۴:۳۰ به
  وقت تهران `docker system prune -f` و پاک‌سازی کش build بی‌استفادهٔ قدیمی‌تر از ۷ روز را اجرا
  می‌کند. volumeها (پایگاه داده و پشتیبان‌ها) هرگز پاک نمی‌شوند.

```bash
sudo docker system df                              # سهم ایمیج‌ها، کش build و volumeها
sudo systemctl list-timers openmuse-prune.timer    # زمان اجرای بعدی
sudo /usr/local/sbin/openmuse-prune                # اجرای فوری
sudo journalctl -u openmuse-prune --since -7d      # گزارش اجراها
```

اگر دیسک باز هم بیش از ۸۵٪ پر ماند، اندازهٔ دیسک سرور را از پنل ابرآروان افزایش دهید.

## ۱۴. تغییر دامنه (مثلاً dastyar-gpt.ir)

### ثبت دامنه در ایرنیک

1. در [nic.ir](https://www.nic.ir) (ایرنیک) حساب «شناسهٔ کاربری» بسازید (با کد ملی یا شناسهٔ ملی
   شرکت) یا از یک نمایندهٔ ثبت دامنه استفاده کنید.
2. دامنهٔ `dastyar-gpt.ir` را جست‌وجو و ثبت کنید و هزینه را بپردازید.
3. در پنل ابرآروان ← CDN ← «افزودن دامنه»، دامنه را اضافه کنید. ابرآروان دو نشانی NS می‌دهد؛
   آن‌ها را در پنل ایرنیک به‌عنوان سرورهای نام دامنه ثبت کنید. فعال‌شدن ممکن است چند ساعت طول
   بکشد.
4. در DNS ابرآروان یک رکورد `A` برای `@` با مقدار `37.32.27.135` بسازید و **پروکسی (ابر
   نارنجی) را خاموش** بگذارید تا Caddy گواهی را با چالش HTTP بگیرد. (Caddy فقط `DOMAIN` را
   سرو می‌کند؛ برای `www` باید Caddyfile را هم تغییر دهید.)
5. بررسی از سیستم خودتان: `dig +short dastyar-gpt.ir` باید `37.32.27.135` را نشان دهد.

### تغییر دامنهٔ سرور

```bash
SERVER=root@37.32.27.135 SMOKE=1 ./deploy/arvan/set-domain.sh dastyar-gpt.ir
```

اسکریپت ابتدا بررسی می‌کند که رکورد A به IP سرور اشاره کند (`SKIP_DNS_CHECK=1` برای ردکردن)،
سپس روی سرور از `.env` نسخهٔ `.env.bak-*` می‌سازد، `DOMAIN=dastyar-gpt.ir` و
`ACME_PROFILE=classic` را می‌نویسد و همه‌چیز را دوباره build می‌کند (نشانی API هنگام build در
باندل وب ثابت می‌شود). پس از آن:

- اگر اتصال Google فعال است، Redirect URI را به `https://dastyar-gpt.ir/api/google/callback` تغییر دهید.
- secret `SMOKE_URL` را در GitHub به‌روز کنید.
- نشانی قدیمی (`https://37.32.27.135`) دیگر سرو نمی‌شود و کاربران باید در نشانی تازه دوباره وارد شوند.
- پس از گرفتن گواهی، در صورت تمایل CDN را طبق بخش ۵ روشن کنید.
- بازگشت: همان اسکریپت را با مقدار قبلی (`37.32.27.135`) اجرا کنید.

## ۱۵. نکات

- حالت `sample` فقط روی loopback کار می‌کند و برای استقرار عمومی مناسب نیست؛ این Compose
  همیشه `WORKSPACE_MODE=live` است.
- «کامپیوتر لینوکسی» (`COMPUTER_ENABLED`) خاموش است، چون به Docker socket میزبان نیاز دارد.
- برای ساخت محلی ایمیج:
  ```bash
  docker build -t openmuse --build-arg EXPO_PUBLIC_API_URL=https://<DOMAIN> \
    --build-arg REGISTRY_MIRROR=docker.arvancloud.ir/ .
  ```
