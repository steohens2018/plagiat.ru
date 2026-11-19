# Локальный сервер СНД для Windows: отдаёт файлы приложения только этому компьютеру
# (адрес http://localhost:8765/) и открывает браузер. Ничего не пишет и не хранит.
# Адрес localhost браузер считает защищённым, поэтому шифрование и работа без сети действуют.
# Порт не меняйте: данные приложения привязаны к адресу вместе с портом.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path.TrimEnd('\')
$port = 8765
$prefix = "http://localhost:$port/"
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'; '.webmanifest' = 'application/manifest+json; charset=utf-8'
  '.png' = 'image/png'; '.svg' = 'image/svg+xml'; '.gz' = 'application/gzip'; '.wasm' = 'application/wasm'
  '.docx' = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; '.md' = 'text/plain; charset=utf-8'
}
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try { $listener.Start() }
catch {
  # Порт занят — скорее всего, СНД уже запущено: просто открываем браузер
  Write-Host "СНД уже запущено (или порт $port занят). Открываю браузер: $prefix"
  Start-Process $prefix
  Start-Sleep -Seconds 3
  exit 0
}
Write-Host "СНД работает: $prefix"
Write-Host 'Не закрывайте это окно, пока работаете. Чтобы остановить — закройте окно.'
Start-Process $prefix
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq '') { $rel = 'index.html' }
    $full = [IO.Path]::GetFullPath((Join-Path $root ($rel -replace '/', '\')))
    # Только файлы внутри папки приложения
    if (-not $full.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
      $res.StatusCode = 404
    } else {
      $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()
      if ($types.ContainsKey($ext)) { $res.ContentType = $types[$ext] } else { $res.ContentType = 'application/octet-stream' }
      $res.Headers.Add('Cache-Control', 'no-cache')
      $bytes = [IO.File]::ReadAllBytes($full)
      $res.ContentLength64 = $bytes.Length
      if ($ctx.Request.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
    }
  } catch {
    try { $res.StatusCode = 500 } catch { }
  } finally {
    try { $res.Close() } catch { }
  }
}
