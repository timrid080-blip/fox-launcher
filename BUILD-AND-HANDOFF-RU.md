# Fox Launcher — исходники, сборка и передача разработки

Этот архив содержит весь исходный код Fox Launcher 1.5.0. Доступ к этому чату для сборки не нужен. Не содержит node_modules, dist, паролей, токенов GitHub, service_role или данных игроков.

## Быстрая сборка на Windows

1. Установите Git (необязательно для ZIP), Node.js 24 LTS с npm и доступ к интернету. Распакуйте архив в обычную папку, например `C:\Dev\foxlauncher`.
2. Откройте PowerShell в папке, где лежит package.json.
3. Выполните:

```powershell
npm ci
npm test
npm start
```

4. Для Portable:

```powershell
npm run dist:portable
```

5. Для установщика и Portable:

```powershell
npm run dist
```

Файлы появятся в `dist`. На первом запуске сборщика скачиваются Electron и инструменты упаковки. Нужен интернет. Linux может собрать Portable; NSIS на Linux может требовать Wine для создания uninstaller — проще собирать установщик на Windows или в GitHub Actions.

## GitHub: один раз подключить

1. Создайте PUBLIC-репозиторий, например `fox-launcher`. Для проверки обновлений всем игрокам токены не нужны. Не публикуйте резервные копии Supabase и папку `%APPDATA%\.foxlauncher`.
2. Загрузите весь проект, включая скрытую папку `.github/workflows`, package-lock.json, renderer, core, assets, backend, supabase и тесты. Не загружайте node_modules/dist. Если используете GitHub Desktop: File → Add local repository (или Create repository from existing files) → Publish repository, снимите Private.
3. В `fox-services.json` укажите `github.owner` (ваш GitHub-логин), `github.repo` (точное имя репозитория), `github.branch` (`main`). Оставьте публичный URL/ключ Supabase. Этот файл безопасно включать в сборку, но только с anon/publishable ключом. НЕ service_role.
4. Если owner/repo вводятся через лаунчер: владелец Fox ID → «Админ-панель» → «Новости и подключения» → сохраните подключения, войдите в Fox ID заново и перезапустите лаунчер. Экспортируйте публичную конфигурацию друзьям рядом с EXE. Локальный services.json в папке данных имеет приоритет над встроенным, проверьте его при смене репозитория.
5. Для публикации/удаления новостей создайте fine-grained personal access token GitHub с доступом только к этому репозиторию, Repository permissions → Contents → Read and write. Введите в поле токена редактора, сохраните. Токен хранится локально через Windows safeStorage и НЕ передаётся друзьям. Не вставляйте токен в исходники.
6. GitHub Actions запускает `.github/workflows/windows.yml`. Он сам подставляет публичные owner/repo в конфигурацию и package.json перед сборкой. Actions → Build Windows → Run workflow — тестовая сборка, артефакт можно скачать из завершённого запуска.

## Выпуск следующей версии (пример 1.6.0)

1. Внесите изменения, тесты и при необходимости новую миграцию SQL. Не переиспользуйте номер уже опубликованной версии.
2. Обновите версию:

```powershell
npm version 1.6.0 --no-git-tag-version
```

В renderer/index.html обновите резервный текст appVersion; при запуске настоящий номер берётся из package.json. Прогоните `npm test` и проверьте интерфейс/игру.

3. Закоммитьте исходники и создайте тег:

```powershell
git add .
git commit -m "Release 1.6.0"
git tag v1.6.0
git push origin main
git push origin v1.6.0
```

4. Дождитесь Actions → Build Windows. Workflow создаст опубликованный GitHub Release с EXE, latest.yml, blockmap и публичной конфигурацией. Если релиз уже существует, удалите незавершённый релиз и повторите workflow после проверки; не подменяйте уже установленный пользователям номер.
5. Не удаляйте `latest.yml` и `.blockmap`: они нужны electron-updater установленной версии. Tag `v1.6.0` должен соответствовать package.json `1.6.0`. Для обычных пользователей не ставьте prerelease/draft.
6. Проверьте обновление на отдельной Windows-машине с предыдущей версией. NSIS обновляется через подтверждение установки; Portable — проверка и ручная замена EXE. SQL владелец применяет отдельно.

## Карта проекта для вас / другой нейросети

- `main.js`: Electron main, IPC allowlist, запуск/импорт/экспорт сборок, настройки. Новый IPC добавляется сюда, renderer не имеет доступа к Node.js напрямую.
- `preload.js`: ограниченный bridge window.fox.
- `renderer/app.js`, `renderer/styles.css`, `renderer/index.html`: интерфейс. Стиль Fox: тёмные панели, оранжевый акцент, версия по центру.
- `core/packs.js`: `.foxpack`, безопасная распаковка/фильтрация путей. Не ослаблять traversal/symlink-защиту.
- `core/community-news.js`: локальные новости/импорт/кэш/отметки удаления. `core/services.js`: GitHub публикация, публичная конфигурация, локально зашифрованный токен.
- `core/updater.js`: проверка GitHub на старте и по таймеру, electron-updater для NSIS, уведомление Portable.
- `core/cloud.js`: Fox ID сессия, RPC `fox_action`, адаптер оплаты; секреты сервера отсутствуют.
- `backend/migrate-1.4.sql`: проверенный переход с 1.2/1.3 к 1.4. `backend/migrate-1.5.sql`: новая миграция поверх1.4. Оба файла без звёздочек для копирования в SQL Editor. `backend/supabase.sql`: основа1.4 для новой базы, затем применить1.5.
- `fox_action`: публичная защищённая RPC; `fox_action_v140` и `fox_action_v130` закрыты для authenticated. Не выдавать им execute: это обход модерации.
- `fox_admins`: владельцы по auth UUID. `fox_roles`: staff badges/support. `fox_notifications`: только свой ящик через RPC, RLS и revoke прямого доступа.
- `supabase/functions/fox-payments`: сохранённый выключенный платёжный адаптер; продублирован в backend/functions для совместимости. Не включать приём платежей без полного отдельного аудита, правил чеков и возвратов.
- `tests/`: Node test runner, PGlite PostgreSQL, файловые security-тесты. Держать старые тесты совместимости. `tests/v150.test.cjs` и `tests/news-updater.test.cjs` проверяют новый функционал.
- `.github/workflows/windows.yml`: Windows сборка и публикация тегов. Секреты только через GitHub Secrets / Supabase Secrets при необходимости, не в EXE.

## Что важно сохранить при дальнейшей разработке

Резервная копия БД до миграций. Миграции транзакционные, по возможности повторяемые; не удалять таблицы с данными пользователей. Балансы, время и награды проверять на сервере, не доверять renderer. При копировании из чата ранее терялись звёздочки — распространять SQL обычным файлом в ZIP. Бан Fox ID не является Minecraft-античитом и не запрещает офлайн-игру; заморозка ограничивает расходы, не входящие награды. Платёжные копейки отделены от старых учётных рублей. Новая версия приложения не запускает SQL за владельца автоматически.

## Что осталось перед публичным запуском

Подключить ваш GitHub-репозиторий; тест установки/обновления NSIS на Windows; тест Portable и запуска Minecraft на Windows; проверка миграции на копии реального Supabase; при подключении платежей — отдельный аудит и тестовый провайдер. Сертификат подписи приложения пока не настроен. Не выдавайте локальные тесты за проверку реального продакшена.
