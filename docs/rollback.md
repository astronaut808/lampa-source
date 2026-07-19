# Откат

Каждому проверенному образу назначайте неизменяемый тег, например Git SHA:

```bash
docker build --build-arg BUILD_REVISION=<git-sha> -t astronaut-lampa:<git-sha> .
```

Для отката измените `LAMPA_TAG` в `.env` на предыдущий `sha-<commit>` или release-тег и выполните:

```bash
docker compose pull
docker compose up -d
curl -fsS http://127.0.0.1:8090/healthz
```

Не удаляйте предыдущий образ до проверки новой версии на телевизоре.
