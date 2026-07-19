# Обновление из upstream

Рабочая ветка: `custom/main`.

```bash
git fetch upstream
git switch custom/main
git rebase upstream/main
npm ci
npm test -- --run
npm run build
docker build -t astronaut-lampa:upstream-check .
```

Особенно внимательно проверяйте конфликты в:

- `gulpfile.js`;
- `src/interaction/advert/`;
- `src/custom/`;
- `package.json` и `package-lock.json`.

После rebase вручную проверьте CUB, плагины и отсутствие запроса `/api/ad/get/preroll`.
