<div dir="rtl">

# راهنمای تغییر نام تجاری (Rebrand)

این فورک قرار است نام تازه‌ای بگیرد. برای اینکه تغییر نام «یک‌جایی» باشد، همهٔ متن‌های نمایشی نام از یک فایل خوانده می‌شوند:

**`packages/domain/src/brand.json`** ← فقط همین فایل را برای نام نمایشی ویرایش کنید.

- `packages/domain/src/brand.ts` همین JSON را با نوع `Brand` به‌صورت `BRAND` صادر می‌کند (و از `packages/domain/src/index.ts` هم در دسترس است).
- `apps/mobile/app.config.ts` (جایگزین `app.json`) همان JSON را می‌خواند؛ پس نام برنامه و عنوان وب (`<title>`) هم از همان‌جا می‌آید.

| کلید | کاربرد | مقدار فعلی |
| --- | --- | --- |
| `name` | نام لاتین (پرامپت انگلیسی عامل، نویسندهٔ PDF، نام برنامه در Expo) | `OpenMuse` |
| `nameFa` | نام در متن‌های فارسی رابط کاربری، عنوان وب، صفحهٔ کنسول مرورگر، پیام‌های خطا | `OpenMuse` |
| `tagline` | شعار فارسی (عنوان وب) | «فضایی کوچک برای همه‌چیز» |
| `taglineEn` | شعار انگلیسی | `A little room for everything` |
| `mascotName` / `mascotNameEn` | نام نماد (متن جایگزین تصویر نماد) | «کاپیبارا» / `capybara` |
| `attribution` | اعتبار مجوز MIT — **حذف نشود** | `Based on OpenMuse by CopilotKit (MIT)` |
| `technical.*` | slug، scheme، شناسهٔ بستهٔ iOS/اندروید — **هشدار پایین را بخوانید** | `openmuse` / `app.openmuse.mobile` |

> ⚠️ مقادیر `technical` (slug، URL scheme، `bundleIdentifier`، `package`) هویت برنامه در فروشگاه‌ها و نصب‌های موجود هستند. تغییرشان یعنی یک برنامهٔ جدید: نصب‌های فعلی به‌روزرسانی نمی‌گیرند و پیوندهای عمیق (`openmuse://…`) و بازگشت OAuth از کار می‌افتند.

## چک‌لیست هنگام انتخاب نام

### الف) نمایشی (امن، بدون شکستن چیزی)

- [ ] `name`، `nameFa`، `tagline`، `taglineEn` را در `packages/domain/src/brand.json` عوض کنید.
- [ ] اگر نماد عوض می‌شود: `mascotName`/`mascotNameEn` و تصویر `apps/mobile/assets/capybara.png` (و `apps/mobile/assets/README.md` دربارهٔ منشأ تصویر).
- [ ] آیکون برنامه، splash و favicon وب (فعلاً پیش‌فرض Expo؛ در `app.config.ts` فیلدهای `icon`، `splash`، `web.favicon` را اضافه کنید).
- [ ] متن‌های سخت‌کد در فایل‌هایی که هنگام این کار در دست عامل‌های دیگر بودند (جدول «باقی‌مانده‌ها» پایین) را به `BRAND` وصل کنید.
- [ ] شعارهای جانبی هم‌خانوادهٔ برند را بازبینی کنید (عمداً ثابت ماندند): «فضایی کوچک برای روزتان.» در صفحهٔ خوش‌آمد (`apps/mobile/App.tsx`) و «فضایی کوچک برای ساختن» در `apps/mobile/src/computer-workspace.tsx`.
- [ ] مستندات: `README.md`، `README.en.md`، `docs/*.md` (FA، README، COMPUTER، DEMO، EXPERIENCE، FEATURES، RICH-THREADS، VERIFICATION، OPENBOT-INTEGRATION، persian-rules)، `apps/mobile/README.md`، `apps/worker/README.md`، `deploy/arvan/README.fa.md`، `SECURITY.md`، `CONTRIBUTING.md`، `ROADMAP.md`، قالب‌های `.github/ISSUE_TEMPLATE/*`.
- [ ] نشان‌های README (نشان CI به `github.com/omidazg/openmuse`)، تصاویر و متن جایگزین دموها (`OpenMuse 🪁`)، و پیوند «با تیم CopilotKit دیدار کنید».
- [ ] پیام‌های لاگ سرور (`[OpenMuse]`، «OpenMuse … API ready»، «OpenMuse task worker running»، «OpenMuse browser worker…») — اگر داشبورد/هشداری روی این متن‌ها فیلتر می‌کند، هم‌زمان به‌روز کنید.

### ب) اعتبار مجوز (الزامی)

- [ ] در `README.md`، `README.en.md` و `LICENSE` اعتبار «بر پایهٔ OpenMuse ساختهٔ CopilotKit» و متن کامل مجوز MIT باید بماند. خط کپی‌رایت موجود (`Copyright (c) 2026 OpenMuse contributors`) را **حذف نکنید**؛ در صورت نیاز یک خط کپی‌رایت برای نام جدید **اضافه** کنید.

### ج) فنی (می‌شکند؛ فقط با برنامهٔ مهاجرت)

- [ ] **شناسه‌های برنامه** (`technical` در `brand.json`): slug `openmuse`، scheme `openmuse`، `app.openmuse.mobile` برای iOS/اندروید. تغییر = برنامهٔ جدید در App Store/Play، از دست رفتن پیوندهای عمیق و نیاز به ثبت دوبارهٔ Redirect URIهای OAuth.
- [ ] **نام بسته‌ها**: `openmuse` (ریشه، و `--filter openmuse` در `Dockerfile`)، `@openmuse/mobile`، `@openmuse/browser-worker`، مسیر `@openmuse/domain` در `apps/mobile/tsconfig.json`.
- [ ] **متغیرهای محیطی**: `OPENMUSE_ACCESS_KEY` (در `apps/server/src/config.ts`، `.env.example`، `deploy/arvan/env.example`، `deploy/arvan/compose.yaml`، READMEها)، `OPENMUSE_TEST_SECRET` (آزمون‌ها). برای تغییر، مدتی هر دو نام را بپذیرید.
- [ ] **پایگاه داده و دادهٔ روی دیسک**: کاربر/پایگاه Postgres `openmuse` در `deploy/arvan/compose.yaml`؛ پوشهٔ داده `.openmuse/` (`DATA_DIR`، `WORKER_DATA_DIR`، `.gitignore`، `.dockerignore`، `biome.json`). تغییر بدون مهاجرت = از دست رفتن داده.
- [ ] **رمزنگاری**: AAD ثابت `openmuse:credential:v1` در `packages/integrations/src/vault.ts` — تغییرش اعتبارنامه‌های رمزشدهٔ موجود را غیرقابل‌رمزگشایی می‌کند. **دست نزنید** مگر با رمزگذاری دوباره.
- [ ] **Docker**: ایمیج‌های `openmuse-app:latest`، `openmuse-computer:local` (`COMPUTER_IMAGE`، CI، `docs/COMPUTER.md`)، `openmuse-browser-worker:test`؛ نام پروژهٔ compose `openmuse` (`infra/compose.yaml`، `deploy/arvan/compose.yaml`)؛ برچسب‌های کانتینر `dev.openmuse.*` و نام کانتینر `openmuse-<deployment>-<owner>` در `apps/server/src/computer.ts` (تغییرشان کانتینرهای موجود را یتیم می‌کند)؛ مسیر `/opt/openmuse/files.py` در `apps/computer/Dockerfile` و `apps/server/src/computer.ts`؛ پیشوند فایل موقت `.openmuse-` در `apps/computer/files.py`.
- [ ] **استقرار آروان**: مسیر `/opt/openmuse`، اسکریپت `/usr/local/bin/openmuse-up`، `SERVER_NAME` پیش‌فرض `openmuse`، فایل موقت `/tmp/openmuse.env`، شاخهٔ `fa-arvan` (`deploy/arvan/*.sh`، `cloud-init.yaml`).
- [ ] **دامنه‌ها**: `muse.example.ir` در `deploy/arvan/env.example` و `Dockerfile`؛ `EXPO_PUBLIC_API_URL`؛ رکوردهای DNS و گواهی TLS؛ Redirect URIهای Google OAuth در Google Cloud Console؛ دامنهٔ Message-ID نامه‌ها `@openmuse.invalid` و مرز MIME `openmuse_` در `packages/integrations/src/google.ts`.
- [ ] **مخزن GitHub**: نام مخزن `omidazg/openmuse` (پیوندهای clone در READMEها، `deploy/arvan/deploy.sh` و `cloud-init.yaml`، نشان CI). GitHub مسیر قدیم را هدایت می‌کند، اما اسکریپت‌ها را به‌روز کنید.
- [ ] **شناسه‌های داخلی دیگر**: `agentId` = `openmuse-${threadId}` در `apps/mobile/src/chat.tsx` (به رشته‌های گفت‌وگوی ذخیره‌شده گره خورده است — تغییرش تاریخچهٔ گفت‌وگو را جدا می‌کند)؛ شناسهٔ استایل `openmuse-fa` در `apps/mobile/src/locale.ts`؛ مدل و شناسه‌های دمو `openmuse-browser-demo`، `call_openmuse_demo_*` و توکن‌های دمو در `apps/server/src/demo/*` و `tests/demo-model.test.ts`؛ پیشوندهای پوشهٔ موقت `openmuse-*` در آزمون‌ها.
- [ ] **فروشگاه‌ها**: نام نمایشی App Store Connect / Google Play، شناسهٔ برنامه (همان `technical`)، اسکرین‌شات‌ها و آیکون.

## باقی‌مانده‌ها: متن‌های نمایشی سخت‌کد در فایل‌هایی که هم‌زمان در دست کار دیگری بودند

این‌ها هنوز `"OpenMuse"` را مستقیم دارند و باید به `BRAND` وصل شوند (`import { BRAND } from "../../../packages/domain/src/brand.ts"`):

| فایل | متن |
| --- | --- |
| `apps/server/src/app.ts` | صفحهٔ بازگشت گوگل: «می‌توانید به OpenMuse برگردید.» و «به OpenMuse برگردید و فضای کاری خود را تازه کنید»؛ پاسخ JSON ریشه `{ name: "OpenMuse" }`؛ پیشوند لاگ `[OpenMuse]` |
| `apps/server/src/agent.ts` | نام کاربر پیش‌فرض «کاربر OpenMuse» |
| `apps/server/src/engine/model.ts` | پرامپت: `You are ${identity?.name ?? "OpenMuse"}` ← `BRAND.nameFa` |
| `apps/server/src/config.ts` | پیام خطای `OPENMUSE_ACCESS_KEY` (نام متغیر فنی است) و پیش‌فرض‌های `.openmuse` / `openmuse-computer:local` (فنی) |
| `deploy/arvan/*` | توضیحات و پیام `final_message` در `cloud-init.yaml` (به‌علاوهٔ موارد فنی بالا) |

</div>
