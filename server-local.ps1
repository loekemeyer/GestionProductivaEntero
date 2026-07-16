# ============================================================
#  Servidor estatico local para Gestion Productiva
#  PowerShell puro - NO instala nada, NO requiere admin.
#  Solo escucha en 127.0.0.1 (no se expone a la red).
#  Sirve los archivos de su propia carpeta.
#
#  Endpoint especial: GET /_gp_ping  -> "GP" (identifica nuestro server)
# ============================================================
param(
  [int]$Port = 5501,
  [string]$Root = ''
)

$ErrorActionPreference = 'Stop'

# Carpeta raiz: usa -Root si se paso, sino la carpeta del script
if ($Root) {
  $rootFull = [System.IO.Path]::GetFullPath($Root.Trim('"'))
} else {
  $r = $PSScriptRoot
  if (-not $r) { $r = Split-Path -Parent $MyInvocation.MyCommand.Definition }
  $rootFull = [System.IO.Path]::GetFullPath($r)
}

# Log de errores a archivo local (mismo lugar para todas las PCs)
$logFile = Join-Path $env:TEMP 'gp-server.log'
function Log($msg) {
  try {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Add-Content -LiteralPath $logFile -Value $line -ErrorAction SilentlyContinue
  } catch {}
}

Log "==== Inicio server. Port=$Port Root=$rootFull ===="

# Tipos MIME
$mime = @{
  '.html'='text/html; charset=utf-8'; '.htm'='text/html; charset=utf-8';
  '.js'='text/javascript; charset=utf-8'; '.mjs'='text/javascript; charset=utf-8';
  '.css'='text/css; charset=utf-8'; '.json'='application/json; charset=utf-8';
  '.map'='application/json; charset=utf-8'; '.txt'='text/plain; charset=utf-8';
  '.csv'='text/csv; charset=utf-8'; '.xml'='application/xml; charset=utf-8';
  '.png'='image/png'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.gif'='image/gif';
  '.svg'='image/svg+xml'; '.ico'='image/x-icon'; '.webp'='image/webp'; '.bmp'='image/bmp';
  '.woff'='font/woff'; '.woff2'='font/woff2'; '.ttf'='font/ttf'; '.otf'='font/otf';
  '.eot'='application/vnd.ms-fontobject';
  '.mp4'='video/mp4'; '.webm'='video/webm'; '.mp3'='audio/mpeg'; '.wav'='audio/wav';
  '.wasm'='application/wasm'; '.pdf'='application/pdf'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Prefixes.Add("http://127.0.0.1:$Port/")

try {
  $listener.Start()
  Log "Listener Start() OK"
} catch {
  Log "Listener Start() FAIL: $($_.Exception.Message)"
  # Si falla por URLACL, intentar reservar con netsh (requiere admin pero por las dudas)
  Write-Host "ERROR al iniciar HttpListener: $($_.Exception.Message)"
  Write-Host "Si el problema persiste, ejecuta como administrador:"
  Write-Host "  netsh http add urlacl url=http://localhost:$Port/ user=Everyone"
  Read-Host "Presiona Enter para salir"
  exit 1
}

Write-Host "Servidor Gestion Productiva escuchando en http://localhost:$Port/  (raiz: $rootFull)"
Write-Host "Log: $logFile"
Write-Host "Cerra esta ventana para detener el servidor."

while ($listener.IsListening) {
  try { $ctx = $listener.GetContext() } catch { break }
  try {
    $req = $ctx.Request
    $res = $ctx.Response

    # Path decodificado (HttpListener ya decodifica %20 etc.)
    $rel = $req.Url.LocalPath

    # === Endpoint de healthcheck / identificacion ===
    if ($rel -eq '/_gp_ping') {
      $res.ContentType = 'text/plain; charset=utf-8'
      $res.Headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
      $body = [System.Text.Encoding]::UTF8.GetBytes('GP')
      $res.ContentLength64 = $body.Length
      $res.OutputStream.Write($body, 0, $body.Length)
      $res.Close()
      continue
    }

    if ([string]::IsNullOrEmpty($rel) -or $rel -eq '/') { $rel = '/Inicio/index.html' }
    $rel = $rel.TrimStart('/') -replace '/', '\'

    $target = [System.IO.Path]::GetFullPath((Join-Path $rootFull $rel))

    # Anti path-traversal: el archivo debe quedar DENTRO de la carpeta raiz
    if (-not $target.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
      $res.StatusCode = 403; $res.Close(); continue
    }

    # Si apunta a una carpeta, buscar su index.html
    if (Test-Path -LiteralPath $target -PathType Container) {
      $target = Join-Path $target 'index.html'
    }

    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
      $res.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
      $res.OutputStream.Write($msg, 0, $msg.Length)
      $res.Close()
      Log "404 $rel"
      continue
    }

    $ext = [System.IO.Path]::GetExtension($target).ToLowerInvariant()
    $ct = $mime[$ext]; if (-not $ct) { $ct = 'application/octet-stream' }
    $res.ContentType = $ct
    # Sin cache: asegura que siempre se sirva la ultima version del codigo
    $res.Headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'

    $bytes = [System.IO.File]::ReadAllBytes($target)
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    $res.Close()
  } catch {
    Log "ERROR en request: $($_.Exception.Message)"
    try { $ctx.Response.StatusCode = 500; $ctx.Response.Close() } catch {}
  }
}

Log "Listener stopped"
