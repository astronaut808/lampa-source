# Локальная разработка

## Требования

- Node.js 22;
- npm;
- Git.

## Установка и запуск

```bash
npm ci
npm run start
```

Dev-сервер доступен на `http://localhost:3000`. Он следит за изменениями исходников.

## Проверки

```bash
npm test -- --run
npm run build
test -s build/web/index.html
test -s build/web/app.js
```

Upstream Sass выводит предупреждения об устаревших API. Сейчас они не прерывают сборку.

## Рекламная политика

Флаг находится в `src/custom/config.js`. Проверяемая чистая функция находится в `src/custom/advertising_policy.js`.

Не изменяйте `Account.hasPremium()`, CUB manifest и token storage для отключения рекламы.
