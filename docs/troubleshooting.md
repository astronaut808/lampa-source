# Диагностика

## Lampa не открывается

```bash
docker compose -f deploy/compose.yaml ps
docker compose -f deploy/compose.yaml logs --tail=100 lampa
curl -v http://127.0.0.1:8090/healthz
```

Проверьте firewall сервера и доступность порта `8090` из той же сети Wi-Fi/LAN.

## На телевизоре старая версия

Проверьте `http://<СЕРВЕР>:8090/custom/build-info.json`, затем полностью завершите приложение или перезагрузите телевизор. JS и CSS отдаются с `Cache-Control: no-cache`.

## CUB не входит

Проверьте время телевизора, DNS, доступность CUB и ошибки сети. Не создавайте CUB reverse proxy до подтверждения реальной CORS-проблемы.

## Плагин не загружается

Проверьте URL, status, MIME type, CORS и отсутствие редиректа на HTML. HTTP-страница Lampa может загружать HTTPS-ресурсы; обратный вариант может блокироваться как mixed content.

## VidaaEdge не устанавливает приложение

Проверьте, что `vidaahub.com` резолвится в IP VidaaEdge именно на телевизоре и открывается по HTTPS. Если интерфейс загружается, но установка не начинается, прошивка может не предоставлять требуемые Hisense API.
