# Astronaut Lampa

Поддерживаемый форк [Lampa](https://github.com/yumata/lampa-source) для запуска в домашней сети и установки на Hisense VIDAA через VidaaEdge.

Отличия от upstream:

- встроенная реклама, CUB-телеметрия и Shots управляются runtime-флагами и отключены по умолчанию;
- добавлена локальная диагностика запуска и воспроизведения;
- CUB-клиент и загрузчик внешних плагинов не изменены;
- добавлена воспроизводимая production-сборка;
- добавлен read-only Docker-контейнер с nginx;
- добавлены инструкции для LAN и VidaaEdge.

Проект не связан официально с Lampa, CUB, VIDAA или Hisense.

## Локальный запуск

Требуется Node.js 22.

```bash
npm ci
npm run start
```

Откройте `http://localhost:3000`.

Одноразовая production-сборка:

```bash
npm test -- --run
npm run build
```

Результат находится в `build/web`. Метаданные сборки доступны в `build/web/custom/build-info.json`.

## Запуск готового образа в домашней сети

```bash
cp .env.example .env
docker compose pull
docker compose up -d
curl -fsS http://127.0.0.1:8090/healthz
```

С другого устройства откройте `http://<IP-СЕРВЕРА>:8090`.

Образ публикуется в `ghcr.io/astronaut808/lampa-source`. Локальная сборка остаётся доступна через `docker compose -f deploy/compose.yaml up -d --build`.

## Документация

- [Локальная разработка](docs/local-development.md)
- [Архитектура](docs/architecture.md)
- [Отличия от upstream](docs/customizations.md)
- [Публикация в GHCR](docs/container-registry.md)
- [Развёртывание в LAN](docs/deployment.md)
- [Установка на Hisense через VidaaEdge](docs/hisense-installation.md)
- [Проверка CUB](docs/cub-validation.md)
- [Совместимость плагинов](docs/plugin-compatibility.md)
- [Обновление upstream](docs/upstream-update.md)
- [Откат](docs/rollback.md)
- [Диагностика](docs/troubleshooting.md)
- [Диагностика воспроизведения](docs/playback-diagnostics.md)
