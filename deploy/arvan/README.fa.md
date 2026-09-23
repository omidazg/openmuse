# راه‌اندازی OpenMuse روی ابرآروان

این راهنما OpenMuse را روی **یک سرور ابری ابرآروان (ECC)** با Docker Compose اجرا می‌کند:

| سرویس | نقش |
| --- | --- |
| `app` | سرور API (Hono) + نسخهٔ وب اپ (خروجی Expo) از همان دامنه |
| `worker` | اجراکنندهٔ کارهای پس‌زمینه (`worker-entry.js`) |
| `browser-worker` | مرورگر Playwright ایزوله (همان سخت‌سازی `infra/compose.yaml`) |
| `postgres` | پایگاه داده (PostgreSQL 17) |
| `caddy` | HTTPS خودکار (Let's Encrypt) برای `DOMAIN` |

فایل‌ها: `Dockerfile` (ریشهٔ مخزن)، `deploy/arvan/compose.yaml`، `Caddyfile`، `env.example`،
`cloud-init.yaml`، `create-server.sh`، `deploy.sh`.

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
مقادیر را در `deploy/arvan/.env` بگذارید و `DOMAIN`، `CPK_INTELLIGENCE_API_KEY`، `MODEL` و کلید
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
| `CPK_INTELLIGENCE_API_KEY` | ✔ | CopilotKit Intelligence |
| `MODEL` + `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` | ✔ | مدل عامل؛ مثل `openai/<model-id>` |
| `OPENAI_BASE_URL` | – | درگاه سازگار با OpenAI |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | – | اتصال Google؛ Redirect URI: `https://DOMAIN/api/google/callback` |
| `REGISTRY_MIRROR` / `NPM_REGISTRY` | – | آینه‌ها برای سرورهای ایران |

## ۵. DNS و CDN ابرآروان

1. در پنل ابرآروان ← CDN ← «افزودن دامنه»، دامنه را اضافه کنید و NSهای دامنه را به NSهای
   ابرآروان تغییر دهید.
2. یک رکورد `A` برای `DOMAIN` به IP سرور بسازید.
3. **در نخستین راه‌اندازی، پروکسی (ابر نارنجی) را خاموش بگذارید** تا Caddy بتواند گواهی
   Let's Encrypt را با چالش HTTP بگیرد.
4. در صورت تمایل به فعال‌کردن CDN: در تنظیمات HTTPS ابرآروان حالت اتصال به مبدأ را روی
   **HTTPS** بگذارید، کش را برای مسیر `/api/*` غیرفعال کنید (API خودش `Cache-Control: no-store`
   می‌فرستد) و مطمئن شوید پاسخ‌های استریم (SSE مسیر `/api/copilotkit`) بافر نمی‌شوند. اگر
   چت قطع‌و‌وصل شد، پروکسی را خاموش کنید.

## ۶. ساخت سرور

### روش الف: پنل
پنل ← سرور ابری ← ایجاد سرور: منطقه `eu-west1-a`، Ubuntu 24.04، اندازهٔ `g1-4-2-0`، کلید SSH
خودتان، و محتوای `deploy/arvan/cloud-init.yaml` را در «اسکریپت اولیه» (User data) بچسبانید.

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

cloud-init این کارها را انجام می‌دهد: نصب Docker و Compose از مخزن Ubuntu، فعال‌کردن ufw
(فقط پورت‌های ۲۲، ۸۰ و ۴۴۳)، کلون شاخهٔ `fa-arvan` از `https://github.com/omidazg/openmuse`
در `/opt/openmuse`. تا `.env` بارگذاری نشود، کانتینری اجرا نمی‌شود.
پیشرفت: `ssh ubuntu@IP sudo tail -f /var/log/cloud-init-output.log`

> گروه امنیتی پیش‌فرض ابرآروان همهٔ پورت‌های TCP را باز می‌گذارد؛ ufw روی خود سرور آن را
> محدود می‌کند. در صورت امکان یک گروه امنیتی با فقط ۲۲/۸۰/۴۴۳ بسازید و `SECURITY_GROUP` را
> تنظیم کنید.

## ۷. استقرار (Deploy)

```bash
SERVER=ubuntu@<IP> ./deploy/arvan/deploy.sh
# با کلید مشخص:
SERVER=ubuntu@<IP> SSH_KEY=~/.ssh/arvan ./deploy/arvan/deploy.sh
```
اسکریپت idempotent است: مخزن را کلون/به‌روز می‌کند (`git merge --ff-only`)، `.env` محلی را با
مجوز 600 بارگذاری می‌کند و `docker compose up -d --build` را اجرا می‌کند.

بررسی:
```bash
curl -fsS https://<DOMAIN>/api/health
ssh ubuntu@<IP> 'cd /opt/openmuse/deploy/arvan && sudo docker compose ps && sudo docker compose logs --tail=50 app'
```

## ۸. به‌روزرسانی

تغییرات را به شاخهٔ `fa-arvan` در fork بفرستید و دوباره اجرا کنید:
```bash
SERVER=ubuntu@<IP> ./deploy/arvan/deploy.sh
```
توجه: آدرس API داخل باندل وب هنگام build ثابت می‌شود؛ اگر `DOMAIN` عوض شد، حتماً دوباره
build کنید (deploy.sh این کار را انجام می‌دهد).

## ۹. پشتیبان‌گیری

داده‌ها در volumeهای Docker هستند: `openmuse_pgdata` (پایگاه داده)، `openmuse_app-data`
(PDFها و کلید امضای نشست)، `openmuse_browser-profiles`، `openmuse_caddy-data` (گواهی‌ها).

```bash
# روی سرور
cd /opt/openmuse/deploy/arvan
sudo docker compose exec -T postgres pg_dump -U openmuse -Fc openmuse > ~/openmuse-$(date +%F).dump
sudo docker run --rm -v openmuse_app-data:/data:ro -v ~/:/backup \
  docker.arvancloud.ir/library/alpine tar czf /backup/app-data-$(date +%F).tgz -C /data .
# بازگردانی پایگاه داده
sudo docker compose exec -T postgres pg_restore -U openmuse -d openmuse --clean < ~/openmuse-YYYY-MM-DD.dump
```
فایل‌های پشتیبان را خارج از سرور نگه دارید (مثلاً فضای ذخیره‌سازی ابری ابرآروان). اسنپ‌شات
دوره‌ای سرور از پنل هم گزینهٔ سادهٔ دیگری است. `.env` را هم جداگانه و امن نگه دارید؛ بدون
`TOKEN_ENCRYPTION_KEY` توکن‌های Google قابل رمزگشایی نیستند.

## ۱۰. نکات

- حالت `sample` فقط روی loopback کار می‌کند و برای استقرار عمومی مناسب نیست؛ این Compose
  همیشه `WORKSPACE_MODE=live` است.
- «کامپیوتر لینوکسی» (`COMPUTER_ENABLED`) خاموش است، چون به Docker socket میزبان نیاز دارد.
- برای ساخت محلی ایمیج:
  ```bash
  docker build -t openmuse --build-arg EXPO_PUBLIC_API_URL=https://<DOMAIN> \
    --build-arg REGISTRY_MIRROR=docker.arvancloud.ir/ .
  ```
