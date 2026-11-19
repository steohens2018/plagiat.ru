#!/bin/sh
# Запуск СНД на этом компьютере: маленький сервер только для этого компьютера (127.0.0.1)
# и браузер по адресу http://localhost:8765/. Адрес localhost браузер считает защищённым,
# поэтому шифрование и работа без сети действуют так же, как на сайте.
# Порт не меняйте: данные приложения привязаны к адресу вместе с портом.
cd "$(dirname "$0")" || exit 1
PORT=8765
URL="http://localhost:$PORT/"
open_browser() { (sleep 1; xdg-open "$URL" >/dev/null 2>&1 || echo "Откройте в браузере: $URL") & }
if ! python3 -c "import socket; s = socket.socket(); s.bind(('127.0.0.1', $PORT))" 2>/dev/null; then
  echo "СНД уже запущено. Открываю браузер: $URL"
  open_browser; sleep 2; exit 0
fi
echo "СНД работает: $URL"
echo "Не закрывайте это окно, пока работаете. Чтобы остановить — закройте окно или нажмите Ctrl+C."
open_browser
exec python3 -m http.server "$PORT" --bind 127.0.0.1
