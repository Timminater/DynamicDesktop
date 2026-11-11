param([string]$WebView2Package)

# Build DynamicDesktop with the .NET Framework C# compiler included with Windows.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$lib = Join-Path $root 'lib'
$bin = Join-Path $root 'bin'
New-Item -ItemType Directory -Force $lib, $bin | Out-Null
$version = '1.0.4191.47'
$assemblies = @(
    @{ Entry = 'lib/net462/Microsoft.Web.WebView2.Core.dll'; Name = 'Microsoft.Web.WebView2.Core.dll' },
    @{ Entry = 'lib/net462/Microsoft.Web.WebView2.WinForms.dll'; Name = 'Microsoft.Web.WebView2.WinForms.dll' },
    @{ Entry = 'runtimes/win-x64/native/WebView2Loader.dll'; Name = 'WebView2Loader.dll' }
)
$missing = @($assemblies | Where-Object { -not (Test-Path -LiteralPath (Join-Path $lib $_.Name)) })
if ($missing.Count -gt 0) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (-not $WebView2Package) { $WebView2Package = Join-Path $lib "Microsoft.Web.WebView2.$version.nupkg" }
    if (-not (Test-Path -LiteralPath $WebView2Package -PathType Leaf)) {
        throw "WebView2 SDK $version is required. Provide a local package with -WebView2Package or place it in host/lib."
    }
    $archive = (Resolve-Path -LiteralPath $WebView2Package).Path
    $package = $null
    try {
        $package = [IO.Compression.ZipFile]::OpenRead($archive)
        foreach ($assembly in $assemblies) {
            $entry = $package.GetEntry($assembly.Entry)
            if ($null -eq $entry) { throw "The dependency package is missing $($assembly.Entry)." }
            $sourceStream = $entry.Open()
            $targetStream = $null
            try {
                $targetStream = [IO.File]::Create((Join-Path $lib $assembly.Name))
                $sourceStream.CopyTo($targetStream)
            } finally {
                if ($null -ne $targetStream) { $targetStream.Dispose() }
                $sourceStream.Dispose()
            }
        }
    } finally {
        if ($null -ne $package) { $package.Dispose() }
    }
}
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $csc)) { throw 'The .NET Framework C# compiler was not found. Build on 64-bit Windows.' }
$appVersion = (Get-Content -LiteralPath (Join-Path $root '..\tools\version.json') -Raw | ConvertFrom-Json).version
if ($appVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid application version' }
$versionSource = Join-Path $bin 'DynamicDesktop-version.cs'
$versionText = @"
using System.Reflection;
[assembly: AssemblyTitle("DynamicDesktop")]
[assembly: AssemblyProduct("DynamicDesktop")]
[assembly: AssemblyVersion("$appVersion.0")]
[assembly: AssemblyFileVersion("$appVersion.0")]
[assembly: AssemblyCopyright("Copyright 2026 DynamicDesktop authors")]
"@
[IO.File]::WriteAllText($versionSource, $versionText, (New-Object Text.UTF8Encoding($false)))
& $csc /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 /win32manifest:"$root\app.manifest" `
    /win32icon:"$root\DynamicDesktop.ico" `
    /out:"$bin\DynamicDesktop.exe" `
    /r:System.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll `
    /r:"$lib\Microsoft.Web.WebView2.Core.dll" /r:"$lib\Microsoft.Web.WebView2.WinForms.dll" `
    "$root\DesktopHost.cs" "$root\Themes.cs" "$root\ReleaseUpdates.cs" "$versionSource"
if ($LASTEXITCODE -ne 0) { throw 'DynamicDesktop compilation failed.' }
foreach ($assembly in $assemblies) { Copy-Item -LiteralPath (Join-Path $lib $assembly.Name) -Destination $bin -Force }
Copy-Item -LiteralPath (Join-Path $root 'DynamicDesktop.ico') -Destination (Join-Path $bin 'DynamicDesktop.ico') -Force
Write-Host "Build complete: $bin\DynamicDesktop.exe"
