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
LAMPA_METRICS_IMAGE=ghcr.io/astronaut808/lampa-source-metrics
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

## Метрики запуска

После открытия Lampa телевизор автоматически отправляет обезличенный отчёт в
локальный collector. Перезапуск контейнера отчёт не создаёт: измеряется именно
запуск интерфейса на устройстве.

Последний запуск:

```bash
curl -s http://127.0.0.1:8090/metrics | jq
```

Последние 20 запусков:

```bash
curl -s http://127.0.0.1:8090/metrics/history | jq
```

История хранится в Docker volume `lampa-metrics`. В отчёт не включаются токены,
email, поисковые запросы или параметры URL.

## Режим разработчика

Обычный запуск не задерживается ради скрытого меню разработчика. Для его
явного открытия добавьте параметр к адресу Lampa:

```text
http://192.168.1.101:8090/?developer=1
```

HLS, DASH, QRCode и устаревший YouTube API не загружаются при старте. Нужная
библиотека подключается автоматически при первом обращении.
