# Отличия Astronaut Lampa от upstream

Документ описывает обязательный функциональный контракт ветки `custom/main`. Он нужен для проверки обновлений из `yumata/lampa-source` и не является списком всех отличающихся строк.

Текущая база upstream: `1e8f2ce8` (Lampa 3.2.8). Собственные изменения заканчиваются коммитом `b91c9c23`.

## 1. Сборка и доставка

- воспроизводимая сборка на Node.js 22 через `npm ci`, тесты и `npm run build`;
- отдельные OCI-образы frontend и metrics для `linux/amd64` и `linux/arm64`;
- публикация образов в GHCR из ветки `custom/main`;
- непривилегированный read-only nginx-контейнер с healthcheck;
- Docker Compose для локальной сборки и запуска готовых образов;
- gzip для JavaScript, CSS, JSON, XML и SVG;
- runtime-конфигурация создаётся при старте контейнера без пересборки frontend;
- метаданные сборки записываются в `build/web/custom/build-info.json`.

Основные файлы: `Dockerfile`, `docker-compose.yaml`, `deploy/`, `.github/workflows/`, `gulpfile.js`, `.nvmrc`, `package-lock.json`.

## 2. Runtime-флаги

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `LAMPA_CUB_TELEMETRY_ENABLED` | `false` | Отправка статистики через `src/services/metric.js` |
| `LAMPA_BUILTIN_ADS_ENABLED` | `false` | Встроенный рекламный lifecycle, preroll и `personal.lampa` |
| `LAMPA_SHOTS_ENABLED` | `false` | Автоматическая загрузка встроенного плагина Shots |
| `LAMPA_PLAYBACK_METRICS_ENABLED` | `true` | Локальная диагностика воспроизведения |

Флаги не должны менять авторизацию CUB, синхронизацию аккаунта, загрузку пользовательских плагинов, HLS/DASH или внешние источники воспроизведения.

Основные файлы: `deploy/40-runtime-config.sh`, `public/runtime-config.js`, `src/custom/config.js`.

## 3. Отключаемые встроенные сервисы

- CUB-телеметрия отключена по умолчанию, но CUB-аккаунт и синхронизация не изменены;
- встроенная реклама и связанные запросы отключены по умолчанию;
- Shots не загружается автоматически по умолчанию;
- любой из сервисов можно вернуть runtime-флагом.

Основные файлы: `src/services/metric.js`, `src/core/personal.js`, `src/services/libs.js`, `src/interaction/advert/`, `src/custom/advertising_policy.js`.

## 4. Диагностика запуска

После открытия приложения frontend отправляет на локальный metrics-контейнер отчёт о критическом пути запуска, ресурсах, плагинах и состоянии CUB-синхронизации. История сохраняется в Docker volume.

Основные файлы: `src/utils/startup_metrics.js`, `src/interaction/loading_progress.js`, `metrics/server.js`.

## 5. Диагностика воспроизведения

Для каждой попытки фиксируются этап resolver/player, время до медиасобытий, ожидания, ошибки, тип потока, домен и обезличенные сетевые запросы. Полные URL, query-параметры, cookies, заголовки и названия фильмов не сохраняются.

Точки интеграции с upstream:

- `src/app.js` — инициализация диагностики;
- `src/interaction/loading.js` — события resolver;
- `src/interaction/player/video.js` — нативные медиасобытия;
- `Lampa.Player.listener` и `Lampa.PlayerVideo.listener` — жизненный цикл попытки;
- глобальные события запросов — длительность и результат сетевых запросов.

Основные файлы: `src/utils/playback_metrics.js`, `src/interaction/loading.js`, `src/interaction/player/video.js`, `metrics/server.js`.

## 6. Брендинг и документация

- название страницы `Astronaut Lampa`;
- собственная иконка для VIDAA;
- инструкции по LAN, Docker, GHCR, VidaaEdge, откату и диагностике.

## Что намеренно не изменено

- протокол и данные CUB-аккаунта;
- синхронизация между устройствами;
- API загрузки внешних плагинов;
- контракт плагинов с `Lampa.Player`;
- выбор балансера и получение ссылок внешними онлайн-плагинами;
- декодирование HLS/DASH и работа встроенного плеера, кроме пассивной отправки диагностических событий.

## Обязательная проверка обновления upstream

1. `npm test -- --run` и `npm run build` проходят без ошибок.
2. Контейнеры frontend и metrics становятся healthy.
3. CUB-вход и синхронизация сохраняются после перезапуска контейнера.
4. Внешний плагин MODs загружается и открывает источники.
5. MP4 и HLS запускаются на Hisense VIDAA и iPad; DASH проверяется при наличии источника.
6. Метрики различают resolver timeout, player timeout, playing, error и closed/ended.
7. При значениях по умолчанию нет запросов встроенной рекламы, CUB-телеметрии и Shots.
8. При включении соответствующих флагов отключённые сервисы возвращаются без пересборки.

Новая архитектура плеера считается совместимой только после прохождения этого списка. Успешное разрешение Git-конфликтов само по себе совместимость не подтверждает.
