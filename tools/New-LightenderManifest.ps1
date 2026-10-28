[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SiteDirectory,

    [Parameter(Mandatory = $true)]
    [string]$BuildId,

    [string]$OutputPath,
    [string[]]$Files,
    [string]$ChunkManifestPath
)

$ErrorActionPreference = 'Stop'
$site = (Resolve-Path -LiteralPath $SiteDirectory).Path
if (-not $OutputPath) {
    $OutputPath = Join-Path $site 'lightender-manifest.json'
}
$destination = if ([System.IO.Path]::IsPathRooted($OutputPath)) {
    $OutputPath
} else {
    Join-Path $site $OutputPath
}

if (-not $Files -or $Files.Count -eq 0) {
    $Files = @(
        'index.html',
        'MhLightender-HTML5-Shipping.css',
        'LightenderDomShim.js',
        'lightender-distribution.js',
        'lightender-sw.js',
        'MhLightender-HTML5-Shipping.UE4.js',
        'MhLightender-HTML5-Shipping.js',
        'MhLightender-HTML5-Shipping.data.js',
        'MhLightender-HTML5-Shipping.wasm',
        'MhLightender-HTML5-Shipping.data',
        'Utility.js'
    )
}

$packageDelivery = $null
if ($ChunkManifestPath) {
    $chunkManifestFile = Join-Path $site $ChunkManifestPath
    if (-not (Test-Path -LiteralPath $chunkManifestFile -PathType Leaf)) {
        throw "Chunk manifest does not exist: $chunkManifestFile"
    }
    $chunkManifest = Get-Content -Raw -LiteralPath $chunkManifestFile | ConvertFrom-Json
    if (-not $chunkManifest.sourceFile -or -not $chunkManifest.chunks) {
        throw "Invalid chunk manifest: $chunkManifestFile"
    }

    $Files = @($Files | Where-Object { $_ -ne $chunkManifest.sourceFile })
    $Files += $ChunkManifestPath
    foreach ($chunk in $chunkManifest.chunks) {
        $Files += $chunk.path
    }
    $Files = @($Files | Select-Object -Unique)
    $packageDelivery = [ordered]@{
        type = 'chunked'
        path = $chunkManifest.sourceFile
        manifest = $ChunkManifestPath.Replace('\', '/')
        sourceBytes = [int64]$chunkManifest.sourceBytes
        sourceSha256 = $chunkManifest.sourceSha256
    }
}

$entries = @()
$totalBytes = [int64]0
foreach ($relativePath in $Files) {
    $filePath = Join-Path $site $relativePath
    if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
        throw "Manifest input file does not exist: $filePath"
    }

    $item = Get-Item -LiteralPath $filePath
    $hash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $totalBytes += [int64]$item.Length
    $entries += [ordered]@{
        path = $relativePath.Replace('\', '/')
        size = [int64]$item.Length
        sha256 = $hash
    }
}

$manifest = [ordered]@{
    schema = 'keyless-abyss.lightender-distribution/v1'
    version = 1
    buildId = $BuildId
    package = 'MhLightender-HTML5-Shipping'
    totalBytes = $totalBytes
    files = $entries
}
if ($packageDelivery) {
    $manifest.packageDelivery = $packageDelivery
}

$json = $manifest | ConvertTo-Json -Depth 6
$utf8 = New-Object System.Text.UTF8Encoding($false)
New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
[System.IO.File]::WriteAllText($destination, $json + [Environment]::NewLine, $utf8)
Write-Output "Wrote $destination ($($entries.Count) files, $totalBytes bytes)."
