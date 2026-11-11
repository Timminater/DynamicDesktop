# Run the browser preview without Node.js.
param([ValidateRange(1, 65535)][int]$Port = 5178)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$types = @{
    '.html' = 'text/html; charset=utf-8'
    '.css' = 'text/css; charset=utf-8'
    '.js' = 'text/javascript; charset=utf-8'
    '.json' = 'application/json'
    '.png' = 'image/png'
    '.svg' = 'image/svg+xml'
    '.webp' = 'image/webp'
}
$server = [Net.HttpListener]::new()
$server.Prefixes.Add("http://localhost:$Port/")
try {
    $server.Start()
    Write-Host "DynamicDesktop: http://localhost:$Port/settings.html"
    while ($server.IsListening) {
        # Periodically return to PowerShell so Ctrl+C works while waiting for a connection.
        $pending = $server.GetContextAsync()
        while (-not $pending.Wait(250)) {}
        $context = $pending.GetAwaiter().GetResult()
        $response = $context.Response
        try {
            $method = $context.Request.HttpMethod
            if ($method -notin 'GET', 'HEAD') {
                $response.StatusCode = 405
                continue
            }
            $relative = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath).TrimStart('/')
            if (-not $relative) { $relative = 'flat.html' }
            if ($relative.Contains(':')) { $response.StatusCode = 404; continue }
            $file = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $relative))
            $extension = [IO.Path]::GetExtension($file)
            if (-not $file.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or
                -not $types.ContainsKey($extension) -or -not [IO.File]::Exists($file)) {
                $response.StatusCode = 404
                continue
            }
            $response.ContentType = $types[$extension]
            $response.Headers['Cache-Control'] = 'no-store'
            $response.ContentLength64 = ([IO.FileInfo]::new($file)).Length
            if ($method -eq 'GET') {
                $stream = [IO.File]::OpenRead($file)
                try { $stream.CopyTo($response.OutputStream) } finally { $stream.Dispose() }
            }
        } catch [IO.IOException] {
            # The browser may close a request during a theme switch.
        } catch [Net.HttpListenerException] {
        } finally {
            $response.Close()
        }
    }
} finally {
    $server.Close()
}
