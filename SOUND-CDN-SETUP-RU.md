# Fox Launcher — Cloudflare R2 + CDN для звуков

Выбранный вариант: Cloudflare R2 для хранения файлов и Cloudflare CDN для раздачи через собственный домен. GitHub остаётся для исходного кода и релизов. Звуки загружаются отдельно и могут обновляться без пересборки EXE.

## Что подготовлено в репозитории

- cloudflare/sounds-worker.js — Worker с публичным GET /manifest.json, проверкой владельца и защищённым POST /upload.
- cloudflare/wrangler.toml — конфигурация Worker и привязка R2 bucket.
- Worker принимает MP3/WAV/OGG/M4A до 15 МБ; загрузку разрешает только вошедшему пользователю, который есть в таблице public.fox_admins.
- Manifest обновляется на лету и кэшируется максимум на 15 секунд. После подключения клиент может опрашивать его раз в 30 секунд.

## Настройка Cloudflare

1. Создай аккаунт на https://dash.cloudflare.com/.
2. Открой Storage & databases → R2 и создай bucket fox-launcher-sounds.
3. Подключи к bucket Custom Domain — поддомен твоего домена. Для кэширования нужен Custom Domain; r2.dev оставь для тестов.
4. Установи Wrangler и выполни из папки cloudflare: npx wrangler deploy.
5. В настройках Worker задай переменные SUPABASE_URL, SUPABASE_ANON_KEY и SOUND_CDN_BASE_URL (HTTPS Custom Domain, ведущий на корень bucket).
6. Добавь секрет SUPABASE_SERVICE_ROLE_KEY через Cloudflare Dashboard или npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY. Не добавляй его в Git, конфиг лаунчера или EXE.
7. Проверь, что на домене Worker открываются /health и /manifest.json.

## Проверка после настройки

- GET https://<worker-domain>/health должен вернуть JSON с ok=true.
- GET https://<worker-domain>/manifest.json должен вернуть список звуков.
- POST https://<worker-domain>/upload требует Authorization: Bearer <Supabase access token> и multipart-поле file.
- Для upload проверь, что вошедший пользователь присутствует в public.fox_admins.

## Важные границы

Worker и bucket — подготовленный backend, но они не будут доступны до создания ресурсов в твоём Cloudflare аккаунте и установки секретов. В текущем PR ещё нужно подключить адрес Worker в лаунчере: UI загрузки и клиентское обновление звуков должны использовать именно развернутый адрес. Не указывай выдуманный домен и не обещай, что CDN уже работает, пока эти шаги не сделаны.