param(
    [string]$NsisCompiler,
    [string]$WebView2Package,
    [switch]$SkipBuild,
    [switch]$PortableOnly,
    [switch]$SourceOnly
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'version.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid package version' }
$dist = Join-Path $root 'dist'
$cache = Join-Path $dist 'installer-tools'
$payload = Join-Path $dist ('payload-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $cache, $payload | Out-Null
if (-not $SkipBuild -and -not $SourceOnly) { & (Join-Path $root 'host\build.ps1') -WebView2Package $WebView2Package }

if (-not $PortableOnly -and -not $SourceOnly -and -not $NsisCompiler) {
    $nsisArchive = Join-Path $cache 'nsis-3.13.zip'
    $NsisCompiler = Join-Path $cache 'nsis-3.13\makensis.exe'
    if (-not (Test-Path -LiteralPath $NsisCompiler)) {
        $nsisHash = 'BA63DFFC4410EE89193E1CB5A41989991BD77C61068DA17E3156D136B7B0B3D8'
        if (-not (Test-Path -LiteralPath $nsisArchive) -or (Get-FileHash -LiteralPath $nsisArchive -Algorithm SHA256).Hash -ne $nsisHash) {
            throw 'Provide a local NSIS compiler with -NsisCompiler or place the verified NSIS 3.13 ZIP in dist/installer-tools.'
        }
        Expand-Archive -LiteralPath $nsisArchive -DestinationPath $cache -Force
    }
}
if (-not $PortableOnly -and -not $SourceOnly) {
    if (-not (Test-Path -LiteralPath $NsisCompiler)) { throw 'NSIS compiler missing' }
    $NsisCompiler = (Resolve-Path -LiteralPath $NsisCompiler).Path
}

# A fixed source list prevents other editions or private working files entering this package.
$sources = @('.gitattributes', '.gitignore', 'AGENTS.md', 'LICENSE', 'NOTICE', 'README.md', 'THIRD_PARTY_NOTICES.md', 'TRADEMARKS.md',
    'host\DesktopHost.cs', 'host\Themes.cs', 'host\ReleaseUpdates.cs', 'host\DynamicDesktop.ico', 'host\README.md', 'host\app.manifest', 'host\build.ps1', 'host\inspect.ps1',
    'tools\build-installer.ps1', 'tools\installer.nsi', 'tools\version.json',
    'docs\images\beach.webp', 'docs\images\meadow.webp', 'docs\images\maldives.webp')
$themeFiles = @('flat.html', 'meadow.html', 'settings.html', 'thumbs-data.js', 'share.js', 'serve.mjs', 'serve.ps1', 'themes.json',
    'beach-palms.js', 'meadow-boy.js', 'meadow-cat.js', 'environment.js', 'community-effects.js', 'living-designs.js', 'woodland.js', 'landscape.js',
    'locations.js', 'kelp.js', 'kelp-seabed.js',
    'i18n\en.json', 'i18n\nl.json',
    'assets\beach-coconut-palm-v2.png', 'assets\beach-coconut-palm-curved.png', 'assets\beach-coconut-palm-airy.png', 'assets\beach-coconut-palm-windswept.png', 'assets\beach-coconut-palm-arch.png',
    'assets\meadow-black-kitten.png', 'assets\meadow-kite-boy-level-face.png', 'assets\meadow-kite-boy-diagonal-run.png',
    'assets\kelp\cruise-sub.png', 'assets\kelp\super-sub.png', 'assets\kelp\nemo.png',
    'assets\kelp\c-explorer.png', 'assets\kelp\c-researcher.png', 'assets\kelp\greyshark.png')
$themes = (Get-Content -LiteralPath (Join-Path $root 'prototype\themes.json') -Raw -Encoding UTF8 | ConvertFrom-Json).themes
$ready = @($themes | Where-Object { $_.status -eq 'ready' })
$freePages = @{
    beach = 'flat.html'; meadow = 'meadow.html'; isles = 'isles.html'; circuit = 'circuit.html'; steampunk = 'steam.html'
    cosmos = 'cosmos.html'; 'living-lagoon' = 'living-lagoon.html'; 'living-sky' = 'living-sky.html'
    'living-colors' = 'living-colors.html'; woodland = 'woodland.html'; kelp = 'kelp.html'
    'beach-turquoise' = 'landscape.html?theme=beach-turquoise'
    'lake' = 'landscape.html?theme=lake'
    'forest' = 'landscape.html?theme=forest'
    'map' = 'landscape.html?theme=map'
    'worldmap' = 'landscape.html?theme=worldmap'
    'nauticalmap' = 'landscape.html?theme=nauticalmap'
    'lotus' = 'landscape.html?theme=lotus'
}
if ($ready.Count -ne $freePages.Count -or $themes.Count -ne $ready.Count -or
    @($themes.id | Sort-Object -Unique).Count -ne $themes.Count) { throw 'Unexpected theme catalog' }
$variantPages = @{ 'living-sky' = @('living-sky.html', 'landscape.html?theme=sky', 'landscape.html?theme=ocean') }
foreach ($theme in $ready) {
    if ($theme.locked -or -not $freePages.ContainsKey($theme.id) -or
        $theme.page -cne $freePages[$theme.id]) { throw 'Unexpected free theme: ' + $theme.id }
    $pages = @($theme.page)
    if ($variantPages.ContainsKey($theme.id)) {
        $expected = $variantPages[$theme.id]
        if (@($theme.variantPages).Count -ne $expected.Count) { throw 'Unexpected variant pages: ' + $theme.id }
        for ($i = 0; $i -lt $expected.Count; $i++) {
            if ($theme.variantPages[$i] -cne $expected[$i]) { throw 'Unexpected variant page: ' + $theme.id }
        }
        $pages += $theme.variantPages
    } elseif (@($theme.variantPages).Where({ $null -ne $_ }).Count -gt 0) { throw 'Unexpected variant pages: ' + $theme.id }
    foreach ($page in $pages) {
        $file = ($page -split '\?', 2)[0]
        if ($themeFiles -notcontains $file) { $themeFiles += $file }
    }
}
foreach ($theme in $themes) {
    $match = [regex]::Match([string]$theme.thumb, '^url\(([^\)?]+)')
    if (-not $match.Success) {
        if (([string]$theme.thumb).Contains('url(')) { throw 'Missing thumbnail URL: ' + $theme.id }
        continue
    }
    $thumbName = [uri]::UnescapeDataString($match.Groups[1].Value)
    if ($thumbName -notmatch '^(thumbs/[\w -]+\.webp|living-thumbs/[\w-]+\.svg)$') { throw 'Unexpected thumbnail path: ' + $thumbName }
    $thumbFile = $thumbName.Replace('/', '\')
    if ($themeFiles -notcontains $thumbFile) { $themeFiles += $thumbFile }
}
$sources += $themeFiles | ForEach-Object { 'prototype\' + $_ }
$sourceStage = Join-Path $payload 'source-stage'
foreach ($file in $sources) {
    $target = Join-Path $sourceStage $file
    New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
    Copy-Item -LiteralPath (Join-Path $root $file) -Destination $target
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($sourceStage, (Join-Path $payload 'DynamicDesktop-source.zip'))
$sourceOutput = Join-Path $dist 'DynamicDesktop-source.zip'
Copy-Item -LiteralPath (Join-Path $payload 'DynamicDesktop-source.zip') -Destination $sourceOutput -Force
$sourceHash = (Get-FileHash -LiteralPath $sourceOutput -Algorithm SHA256).Hash
[IO.File]::WriteAllText(($sourceOutput + '.sha256'), "$sourceHash  $([IO.Path]::GetFileName($sourceOutput))`r`n", (New-Object Text.UTF8Encoding($false)))
Write-Host "Source: $sourceOutput"
if ($SourceOnly) { return }
# Only program data is installed. The accompanying ZIP contains the exact corresponding source.
$runtimeFiles = @('host\bin\DynamicDesktop.exe', 'host\bin\DynamicDesktop.ico', 'host\bin\Microsoft.Web.WebView2.Core.dll', 'host\bin\Microsoft.Web.WebView2.WinForms.dll', 'host\bin\WebView2Loader.dll')
$installFiles = @('LICENSE', 'NOTICE', 'README.md', 'THIRD_PARTY_NOTICES.md', 'TRADEMARKS.md') + @($themeFiles | Where-Object { $_ -notin @('serve.mjs', 'serve.ps1') } | ForEach-Object { 'prototype\' + $_ }) + $runtimeFiles
foreach ($file in $installFiles) {
    $target = Join-Path $payload $file
    New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
    Copy-Item -LiteralPath (Join-Path $root $file) -Destination $target
}
$installFiles += 'DynamicDesktop-source.zip'
if ($PortableOnly) {
    $portableStage = Join-Path $payload 'portable'
    foreach ($file in $installFiles) {
        $target = Join-Path $portableStage $file
        New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
        Copy-Item -LiteralPath (Join-Path $payload $file) -Destination $target
    }
    foreach ($mode in 'portable', 'test') {
        $title = (Get-Culture).TextInfo.ToTitleCase($mode)
        $launcher = '@echo off' + "`r`n" + 'start "" "%~dp0host\bin\DynamicDesktop.exe" --' + $mode + "`r`n"
        [IO.File]::WriteAllText((Join-Path $portableStage "DynamicDesktop $title.cmd"), $launcher, [Text.Encoding]::ASCII)
    }
    $portableOutput = Join-Path $dist "DynamicDesktop-$version-win-x64-Portable.zip"
    $portableTemp = Join-Path $payload 'portable.zip'
    [IO.Compression.ZipFile]::CreateFromDirectory($portableStage, $portableTemp)
    Move-Item -LiteralPath $portableTemp -Destination $portableOutput -Force
    Write-Host "Portable: $portableOutput"
    return
}
$utf8 = New-Object Text.UTF8Encoding($true)
$fileLines = @()
$deleteLines = @()
$directories = @{}
foreach ($file in $installFiles) {
    if ($file -match '["$\r\n]') { throw 'Unsafe package path' }
    $dir = Split-Path $file
    $fileLines += 'SetOutPath "$INSTDIR' + $(if ($dir) { '\' + $dir } else { '' }) + '"'
    $fileLines += 'File "' + (Join-Path $payload $file) + '"'
    $deleteLines += 'Delete "$INSTDIR\' + $file + '"'
    while ($dir) { $directories[$dir] = $true; $dir = Split-Path $dir }
}
$deleteLines += $directories.Keys | Sort-Object Length -Descending | ForEach-Object { 'RMDir "$INSTDIR\' + $_ + '"' }
$fileList = Join-Path $payload 'files.nsh'
$deleteList = Join-Path $payload 'delete.nsh'
[IO.File]::WriteAllLines($fileList, [string[]]$fileLines, $utf8)
[IO.File]::WriteAllLines($deleteList, [string[]]$deleteLines, $utf8)
$output = Join-Path $dist "DynamicDesktop-$version-win-x64-Setup.exe"
& $NsisCompiler /V2 "/DVERSION=$version" "/DPAYLOAD=$payload" "/DOUTPUT=$output" "/DFILE_LIST=$fileList" "/DDELETE_LIST=$deleteList" (Join-Path $PSScriptRoot 'installer.nsi')
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed' }
$hash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash
[IO.File]::WriteAllText(($output + '.sha256'), "$hash  $([IO.Path]::GetFileName($output))`r`n", (New-Object Text.UTF8Encoding($false)))
$manifest = @($installFiles | ForEach-Object { @{ path = $_.Replace('\', '/'); sha256 = (Get-FileHash -LiteralPath (Join-Path $payload $_) -Algorithm SHA256).Hash } })
[IO.File]::WriteAllText(($output + '.manifest.json'), ($manifest | ConvertTo-Json -Depth 4), $utf8)
Write-Host "Installer: $output"
Write-Host "SHA256: $hash"
