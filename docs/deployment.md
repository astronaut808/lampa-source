# Развёртывание в домашней сети

## Первый запуск

```bash
cp .env.example .env
docker compose pull
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:8090/healthz
```

Ожидаемый ответ healthcheck: `ok`.

## Настройки

Файл `.env`:

```dotenv
LAMPA_BIND_ADDRESS=0.0.0.0
LAMPA_PORT=8090
LAMPA_IMAGE=ghcr.io/astronaut808/lampa-source
LAMPA_TAG=latest
```

`0.0.0.0` открывает Lampa на всех интерфейсах сервера. Ограничьте доступ домашней сетью через firewall и не настраивайте проброс порта на роутере.

Для постоянного адреса рекомендуется локальная DNS-запись:

```text
lampa.home.arpa → IP домашнего сервера
```

Тогда URL телевизора будет `http://lampa.home.arpa:8090`.

## Обновление контейнера

```bash
docker compose pull
docker compose up -d
curl -fsS http://127.0.0.1:8090/healthz
```

Для предсказуемого production-запуска замените `latest` на конкретный тег `sha-<commit>` или `custom-v0.1.0`.

Если GHCR package закрытый, сначала выполните `docker login ghcr.io` с GitHub Personal Access Token, имеющим право `read:packages`. Секрет не сохраняйте в `.env`.

HTTPS для LAN-развёртывания Lampa не обязателен. Он понадобится только при публикации сервиса в интернет.
