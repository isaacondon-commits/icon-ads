# Provisiona UNA tablet como Device Owner por USB.
#
# Antes de correr esto, en la tablet:
#   1. Factory reset.
#   2. Asistente de configuracion: NO agregar ninguna cuenta de Google. Saltear todo.
#   3. Ajustes -> Acerca de -> tocar 7 veces "Numero de compilacion".
#   4. Ajustes -> Sistema -> Opciones de desarrollador -> Depuracion USB (ON).
#   5. Conectar la tablet por USB y aceptar "Permitir depuracion USB" (marcar Siempre).
#
# Despues: conectar WiFi / verificar SIM, y aceptar el dialogo de "filtrar llamadas".

$ErrorActionPreference = "Stop"
$ADB = "C:\Users\isaac\AppData\Local\Android\Sdk\platform-tools\adb.exe"
$APK = Join-Path $PSScriptRoot "..\app\build\outputs\apk\release\app-release.apk"
$COMPONENT = "com.iconads.player/.receiver.AdminReceiver"

if (-not (Test-Path $APK)) { Write-Host "ERROR: no existe $APK" -ForegroundColor Red; exit 1 }

Write-Host "== 1. Buscando la tablet ==" -ForegroundColor Cyan
$devs = & $ADB devices | Select-String "`tdevice$"
if ($devs.Count -eq 0) {
    Write-Host "No hay ninguna tablet en estado 'device'. Revisa el cable / la autorizacion de depuracion USB." -ForegroundColor Red
    & $ADB devices
    exit 1
}
if ($devs.Count -gt 1) {
    Write-Host "Hay mas de una tablet conectada. Deja solo una." -ForegroundColor Red
    & $ADB devices
    exit 1
}
Write-Host "OK: $($devs[0].ToString().Trim())" -ForegroundColor Green

Write-Host "== 2. Chequeando que no haya cuentas (si hay, set-device-owner falla) ==" -ForegroundColor Cyan
$accounts = & $ADB shell dumpsys account | Select-String "Account \{"
if ($accounts) {
    Write-Host "HAY CUENTAS en la tablet:" -ForegroundColor Red
    $accounts | ForEach-Object { Write-Host "  $_" }
    Write-Host "Borralas (Ajustes -> Cuentas) o hace factory reset y no agregues ninguna." -ForegroundColor Red
    exit 1
}
Write-Host "OK: sin cuentas" -ForegroundColor Green

Write-Host "== 3. Instalando el APK ==" -ForegroundColor Cyan
& $ADB install -r $APK
if ($LASTEXITCODE -ne 0) { Write-Host "Fallo la instalacion." -ForegroundColor Red; exit 1 }

Write-Host "== 4. Seteando Device Owner ==" -ForegroundColor Cyan
$out = & $ADB shell dpm set-device-owner $COMPONENT 2>&1
Write-Host $out
if ($out -notmatch "Success") {
    Write-Host "NO se pudo setear Device Owner. Ver el mensaje de arriba." -ForegroundColor Red
    exit 1
}

Write-Host "== 5. Verificando ==" -ForegroundColor Cyan
$dp = & $ADB shell dumpsys device_policy
if ($dp -match "Device Owner:") {
    Write-Host ""
    Write-Host "LISTO. Tablet provisionada como Device Owner." -ForegroundColor Green
    Write-Host "Ahora en la tablet: conecta WiFi, verifica la SIM de datos, y acepta el dialogo de filtrar llamadas."
} else {
    Write-Host "Raro: set-device-owner dijo Success pero dumpsys no muestra Device Owner. Revisar." -ForegroundColor Yellow
}
