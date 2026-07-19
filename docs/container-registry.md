# Публикация Docker-образа в GHCR

Workflow `.github/workflows/publish-ghcr.yml` публикует multi-architecture образ:

```text
ghcr.io/astronaut808/lampa-source
```

## Теги

- push в `custom/main`: `latest` и `sha-<короткий SHA>`;
- Git-тег `custom-v0.1.0`: `custom-v0.1.0` и `sha-<короткий SHA>`;
- ручной запуск workflow: `sha-<короткий SHA>`.

Образы собираются для `linux/amd64` и `linux/arm64`. Во время Docker build автоматически выполняются тесты и production-сборка.

## Первый publish

```bash
git push -u origin custom/main
```

Проверьте workflow `Publish GHCR image` во вкладке Actions. После первой публикации откройте package settings на GitHub и сделайте package публичным, если сервер должен скачивать образ без авторизации.

## Релиз

```bash
git tag custom-v0.1.0
git push origin custom-v0.1.0
```

На сервере укажите:

```dotenv
LAMPA_IMAGE=ghcr.io/astronaut808/lampa-source
LAMPA_TAG=custom-v0.1.0
```

Затем:

```bash
docker compose pull
docker compose up -d
```

Workflow использует встроенный `GITHUB_TOKEN`; отдельный PAT для публикации не требуется. Для скачивания закрытого package серверу потребуется `docker login ghcr.io`.
