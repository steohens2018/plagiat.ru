# Сторонние библиотеки

Лежат рядом с приложением, чтобы оно работало без интернета и без CDN.

| Файл | Библиотека | Версия | Лицензия |
|---|---|---|---|
| `pizzip.min.js` | PizZip | 3.3.0 | MIT или GPL-3.0 (используется MIT) |
| `docxtemplater.min.js` | docxtemplater | 3.71.1 | MIT |
| `heic2any.min.js` | heic2any | 0.0.4 | MIT |
| `ocr/` | Tesseract.js 5.1.1 и русская модель `rus.traineddata` | 5.1.1 | Apache-2.0 |

`heic.html` и `heic-frame.js` — изолированная рамка для heic2any: этой библиотеке нужен
`eval`, а основное приложение его запрещает.
