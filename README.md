# 🛡️ DULMS Watcher v14.0 — Monolith

بوت مراقبة متطور لمادة **GEN 101** على منصة DULMS مع **5 طبقات كشف** و **Session Resilience** و **Alert Deduplication**.

---

## ✨ المميزات الرئيسية

| الميزة | الوصف |
|--------|-------|
| 🎯 **Early Detection** | كشف ظهور المادة (مرة واحدة) |
| 🆕 **New Group Watch** | كشف مجموعة جديدة (حتى 0/0) |
| 🎉 **Group Open Watch** | كشف فتح مجموعة (0/0 → 5/30) |
| 📈 **Seat Increase Watch** | كشف زيادة مقاعد (5/30 → 8/30) |
| 🚫 **Block Change Watch** | كشف تغير حالة الحجب |
| 🛡️ **Security Guard** | حماية المواد المسجلة |
| 🔐 **Session Resilience** | إعادة استخدام + تحقق + relogin تلقائي |
| 🚫 **Alert Deduplication** | منع تكرار التنبيهات |
| 🔕 **First-Scan Silent** | أول scan صامت — مفيش طوفان |
| 🔒 **AES-256-GCM** | تشفير state/session |
| 🔐 **Redaction** | إخفاء secrets في logs |

---

## 📊 5 طبقات كشف

| الطبقة | بتكشف إيه | الفاصل |
|--------|-----------|--------|
| 🎯 **Course Watch** | ظهور المادة | 10s |
| 👥 **Group Watch** | مجموعة جديدة | 10s |
| 💺 **Seat Watch** | فتح/زيادة مقاعد | 10s |
| 🚫 **Block Watch** | تغير حالة الحجب | 10s |
| 🛡️ **Security Guard** | سقوط المواد المسجلة | 10m |

---

## 🔔 التنبيهات

- 🎉 **GEN 101 ظهرت** (مرة واحدة)
- 🆕 **مجموعة جديدة ظهرت** (حتى لو 0/0)
- 🎉 **مجموعة فتحت** (0/0 → 5/30)
- 📈 **مقاعد زادت** في مجموعة مفتوحة
- 🚫 **حالة الحجب اتغيرت**
- 🚨 **مادة اتشالت** من موادك

**كل تنبيه بيمر على dedup — مفيش تكرار.**

---

## 🔐 الأمان

- 🔒 **AES-256-GCM** لتشفير state/session
- 🔒 **Redaction تلقائي** في logs
- 🔒 **Whitelist** على TG_CHAT_ID
- 🔒 **مفيش plaintext dumps**
- 🔒 **مفيش secrets في الريبو**

---

## 🔑 Secrets المطلوبة

| Secret | الوصف |
|--------|-------|
| `DULMS_USERNAME` | اسم المستخدم |
| `DULMS_PASSWORD` | كلمة السر |
| `TG_TOKEN` | توكن البوت |
| `TG_CHAT_ID` | chat ID |
| `STATE_ENCRYPTION_KEY` | 32-byte hex (64 chars) |

### 🔐 توليد `STATE_ENCRYPTION_KEY`

**PowerShell (Windows):**
```powershell
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
```

**Bash (Linux/Mac):**
```bash
openssl rand -hex 32
```

**Node.js:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 🚀 التشغيل

### الطريقة 1: GitHub Actions (المستحسن)

**1. Fork الريبو**

**2. أضف Secrets:**
- اذهب إلى: `Settings → Secrets and variables → Actions`
- أضف الـ 5 secrets المذكورة فوق

**3. شغّل:**
- `Actions → DULMS Watcher v14.0 Monolith → Run workflow`

**العمل التلقائي:**
- Cron كل ساعة (5 و 55 دقيقة)
- Overlap trigger بين runs
- Health Monitor كل 10 دقايق

### الطريقة 2: تشغيل محلي

```bash
# 1. Clone
git clone https://github.com/YOUR_USER/dulms-watcher.git
cd dulms-watcher

# 2. Install
npm install
npx playwright install chromium

# 3. Set env vars
export DULMS_USERNAME="your_username"
export DULMS_PASSWORD="your_password"
export TG_TOKEN="your_bot_token"
export TG_CHAT_ID="your_chat_id"
export STATE_ENCRYPTION_KEY="$(openssl rand -hex 32)"

# 4. Run
DURATION_MIN=5 node watch.js
```

---

## 🤖 أوامر Telegram

### الأوامر الأساسية

| الأمر | الوصف |
|-------|-------|
| `/start` | لوحة التحكم |
| `/status` | تقرير شامل |
| `/groups` | كل المجموعات |
| `/open` | المجموعات المفتوحة |
| `/targets` | المواد المستهدفة |
| `/baseline` | المواد المسجلة |

### أوامر التحكم

| الأمر | الوصف |
|-------|-------|
| `/pause` | إيقاف مؤقت |
| `/resume` | استئناف |
| `/reset` | إعادة تعيين |
| `/audit` | آخر 10 أحداث |

### أوامر متقدمة

| الأمر | الوصف |
|-------|-------|
| `/find <code>` | البحث عن مادة |
| `/diag` | تشخيص كل المواد |
| `/target <code>` | إضافة مادة جديدة |
| `/watch <group>` | مراقبة مجموعة محددة |
| `/info` | معلومات التسجيل |
| `/help` | كل الأوامر |

---

## 📁 هيكل المشروع

```
dulms-watcher/
├── watch.js                              # الكود الأساسي (~2400 سطر)
├── package.json
├── .gitignore
├── README.md
│
├── .github/
│   └── workflows/
│       ├── watcher.yml                   # Workflow الرئيسي
│       └── health-check.yml              # Health Monitor
│
└── scripts/
    └── migrate-state.js                  # v11/v12/v13 → v14
```

---

## 🔄 Migration من نسخة أقدم

```bash
# عمل backup ثم تشغيل
STATE_ENCRYPTION_KEY=<your-key> node scripts/migrate-state.js

# الملف الأصلي محفوظ في:
# .dulms-state.json.v-old.bak
```

---

## ⚙️ الإعدادات (USER_CONFIG في watch.js)

### تعديل المواد المستهدفة

```js
targets: [
  { code: 'GEN 101', label: 'English 2' },
  { code: 'MEC 151', label: 'Mechanics' },  // ضيف اللي عايز
],
```

### تعديل الفواصل

```js
timing: {
  fastIntervalMs: 10 * 1000,    // 10s — فحص المجموعات
  slowIntervalMs: 30 * 1000,    // 30s — فحص هادئ
  // ...
},
```

### تعديل منع التكرار

```js
dedup: {
  courseAppeared: 60 * 60 * 1000,  // ساعة
  newGroup:       10 * 60 * 1000,  // 10 دقايق
  // ...
},
```

---

## 🩺 Health & Monitoring

### في Telegram:

- **`/status`** → نظرة شاملة
- **`/audit`** → آخر 10 أحداث
- **`/groups`** → كل المجموعات

### في GitHub Actions:

- **Actions tab** → runs history
- **Health Monitor** → كل 10 دقايق
- **Artifacts** → state files (مشفرة)

---

## ⚠️ ملاحظات مهمة

1. **الـ session بتعيش ~7 دقايق** على DULMS — الـ relogin تلقائي
2. **الفجوات بين runs** ~30-90 ثانية (GitHub Actions limit)
3. **الريبو Public** → Actions unlimited
4. **الـ secrets آمنة** — مش بتظهر في logs
5. **State files مشفرة** — آمنة حتى لو حد نزّلها

---

## 🐛 Troubleshooting

### البوت مش بيرد
- افتح `Actions → DULMS Watcher` وشوف آخر run
- تأكد إن الـ Secrets موجودة

### تنبيهات مكررة
- الـ dedup بيشتغل تلقائي
- لو حصلت مشكلة → `/reset`

### Session بيموت بسرعة
- طبيعي — البوت بيعمل relogin تلقائي
- لو زاد عن 10/ساعة → قوللي

### Memory عالية
- البوت بيراقب نفسه
- لو وصل 900MB → rebuild تلقائي

---

## 📊 معايير الأداء

| المقياس | الهدف |
|---------|-------|
| Memory | < 500 MB |
| Login time | < 10s |
| Relogin time | < 10s |
| Alert latency | < 15s |
| Uptime | > 85% (GitHub Actions) |

---

## 📝 License

MIT

---

## 🙏 Credits

- **Playwright** — Browser automation
- **Telegram Bot API** — Notifications
- **GitHub Actions** — Free CI/CD
