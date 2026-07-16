# ============================================================
#  Gestion Productiva - Launcher  (v4, robusto)
#  Lo invoca "Abrir Gestion Productiva.bat".
#  - Reusa nuestro server si ya esta corriendo (responde /_gp_ping).
#  - Si no, mata servers zombie, levanta uno nuevo en un puerto
#    registrado en Supabase (5501 preferido), espera, abre Chrome.
#  - Loguea TODO a %TEMP%\gp-launcher.log
#  Compatible PowerShell 5.1 (sin backtick-escapes en strings).
# ============================================================
param(
  [Parameter(Mandatory=$true)][string]$GpRoot,
  [Parameter(Mandatory=$true)][string]$ServerScript
)

$NL = [Environment]::NewLine
$LogFile = Join-Path $env:TEMP 'gp-launcher.log'

function Log([string]$msg) {
  $line = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $msg
  try { Add-Content -LiteralPath $LogFile -Value $line -ErrorAction SilentlyContinue } catch {}
}

try { Set-Content -LiteralPath $LogFile -Value ('=== GP Launcher v4 ' + (Get-Date) + ' ===') } catch {}
Log ('PS ' + $PSVersionTable.PSVersion.ToString())
Log ('GpRoot=' + $GpRoot)
Log ('ServerScript=' + $ServerScript)

try { Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue } catch {}

function Show-Error([string]$msg) {
  Log ('MSGBOX: ' + $msg)
  try { [System.Windows.Forms.MessageBox]::Show($msg, 'Gestion Productiva', 'OK', 'Warning') | Out-Null } catch {}
}

# Host y puertos: SOLO puertos registrados en Supabase (redirect OAuth).
# 5502 lo reserva Windows (winnat), por eso no esta.
$BindHost = '127.0.0.1'
$Ports = @(5501, 5503, 5504, 5505, 5506, 5507, 5500)

function Test-Ping([int]$Port) {
  try {
    $r = Invoke-WebRequest -Uri ('http://' + $BindHost + ':' + $Port + '/_gp_ping') -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
    return ($r.Content -eq 'GP')
  } catch { return $false }
}

# Reusable solo si sirve la pagina real (descarta servers con root roto/truncado).
function Test-Serves([int]$Port) {
  try {
    $r = Invoke-WebRequest -Uri ('http://' + $BindHost + ':' + $Port + '/Inicio/index.html') -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

function Test-Listening([int]$Port) {
  try { return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) }
  catch { return $false }
}

try {
  # Normalizar carpeta raiz
  $GpRoot = [System.IO.Path]::GetFullPath($GpRoot.TrimEnd('\','/','.'))
  Log ('GpRoot normalizado=' + $GpRoot)
  if (-not (Test-Path -LiteralPath $GpRoot -PathType Container)) {
    Show-Error ('No existe la carpeta del proyecto:' + $NL + $GpRoot); exit 1
  }
  if (-not (Test-Path -LiteralPath $ServerScript -PathType Leaf)) {
    Show-Error ('No se copio el servidor a:' + $NL + $ServerScript); exit 1
  }

  # --- 1) Si NUESTRO server ya responde Y sirve la pagina real, reusarlo ---
  #     Solo chequeamos puertos Listening (cold start instantaneo).
  #     Validamos /Inicio (no solo ping) para descartar servers con root roto.
  $PortToUse = $null
  foreach ($p in $Ports) {
    if (Test-Listening $p) {
      if ((Test-Ping $p) -and (Test-Serves $p)) { $PortToUse = $p; Log ('Reuso server OK en ' + $p); break }
    }
  }

  # --- 2) Si no, limpiar zombies y levantar uno nuevo ---
  if (-not $PortToUse) {
    Log 'No hay server nuestro corriendo. Limpiando zombies...'
    $killed = 0
    # IMPORTANTE: excluir ESTE proceso ($PID) y al propio launcher (su CommandLine
    # contiene gp-server.ps1 como argumento -ServerScript). Solo matar procesos que
    # ESTAN ejecutando el server (-File ...gp-server.ps1 / server-local.ps1).
    Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
      Where-Object {
        $_.ProcessId -ne $PID -and
        $_.CommandLine -notmatch 'gp-launcher\.ps1' -and
        $_.CommandLine -match '(gp-server|server-local)\.ps1'
      } |
      ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $killed++ } catch {} }
    Log ('Zombies matados: ' + $killed)
    if ($killed -gt 0) { Start-Sleep -Milliseconds 600 }

    # Elegir primer puerto libre de la lista
    foreach ($p in $Ports) {
      if (-not (Test-Listening $p)) { $PortToUse = $p; Log ('Puerto libre elegido: ' + $p); break }
    }
    if (-not $PortToUse) {
      Log 'ERROR: ningun puerto registrado disponible'
      foreach ($p in $Ports) {
        $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
        if ($c) {
          $proc = Get-Process -Id ($c | Select-Object -First 1).OwningProcess -ErrorAction SilentlyContinue
          Log ('  ' + $p + ' ocupado por ' + $(if($proc){$proc.ProcessName}else{'?'}))
        }
      }
      Show-Error ('No hay puertos libres (5500-5507).' + $NL + 'Cerra otros servidores locales.' + $NL + 'Log: ' + $LogFile)
      exit 1
    }

    # Levantar server (oculto).
    # IMPORTANTE: ArgumentList como STRING UNICO con comillas explicitas.
    # PowerShell 5.1 Start-Process NO entrecomilla elementos de array con espacios,
    # asi -Root "Z:\AA IT\..." se truncaba a "Z:\AA" -> 404. El string evita el bug.
    Log ('Levantando server en ' + $BindHost + ':' + $PortToUse)
    $argLine = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Port {1} -Root "{2}"' -f $ServerScript, $PortToUse, $GpRoot
    Log ('argLine=' + $argLine)
    try {
      Start-Process -FilePath 'powershell.exe' -ArgumentList $argLine -WindowStyle Hidden
    } catch {
      Log ('Start-Process FALLO: ' + $_.Exception.Message)
      Show-Error ('No se pudo lanzar el servidor:' + $NL + $_.Exception.Message); exit 1
    }

    # Esperar hasta 20s a que responda Y sirva la pagina real
    $ready = $false
    for ($i = 0; $i -lt 100; $i++) {
      Start-Sleep -Milliseconds 200
      if (Test-Serves $PortToUse) { $ready = $true; break }
    }
    if (-not $ready) {
      Log ('ERROR: server no respondio en 20s en ' + $PortToUse)
      Show-Error ('El servidor no arranco en el puerto ' + $PortToUse + '.' + $NL + 'Log: ' + $LogFile + $NL + 'Server log: ' + (Join-Path $env:TEMP 'gp-server.log')); exit 1
    }
    Log ('Server listo en ' + $PortToUse)
  }

  # --- 3) Abrir Chrome ---
  $url = 'http://' + $BindHost + ':' + $PortToUse + '/Inicio/index.html'
  Log ('Abriendo: ' + $url)
  $chromePaths = @(
    ($env:ProgramFiles + '\Google\Chrome\Application\chrome.exe'),
    (${env:ProgramFiles(x86)} + '\Google\Chrome\Application\chrome.exe'),
    ($env:LocalAppData + '\Google\Chrome\Application\chrome.exe')
  )
  $chrome = $chromePaths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if ($chrome) {
    Log ('Chrome: ' + $chrome)
    Start-Process -FilePath $chrome -ArgumentList $url
  } else {
    Log 'Chrome no encontrado, navegador default'
    Start-Process $url
  }
  Log 'OK fin'
  exit 0

} catch {
  Log ('EXCEPCION: ' + $_.Exception.Message)
  Log ('Stack: ' + $_.ScriptStackTrace)
  Show-Error ('Error inesperado: ' + $_.Exception.Message + $NL + 'Log: ' + $LogFile)
  exit 1
}
