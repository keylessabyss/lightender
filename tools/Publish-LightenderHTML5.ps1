[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BuildDirectory,

    [Parameter(Mandatory = $true)]
    [string]$SiteDirectory,

    [double]$MaxChunkMiB = 22.5
)

$ErrorActionPreference = 'Stop'
$build = (Resolve-Path -LiteralPath $BuildDirectory).Path
$site = (Resolve-Path -LiteralPath $SiteDirectory).Path
$dataName = 'MhLightender-HTML5-Shipping.data'
$dataPath = Join-Path $build $dataName
if (-not (Test-Path -LiteralPath $dataPath -PathType Leaf)) {
    throw "Generated HTML5 package was not found: $dataPath"
}

# Copy only generated runtime artifacts. The website shell, installer,
# Service Worker, and custom CSS remain project-owned files in $site.
$runtimeFiles = @(
    'MhLightender-HTML5-Shipping.UE4.js',
    'MhLightender-HTML5-Shipping.js',
    'MhLightender-HTML5-Shipping.data.js',
    'MhLightender-HTML5-Shipping.wasm',
    'Utility.js'
)
foreach ($name in $runtimeFiles) {
    $source = Join-Path $build $name
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Generated runtime artifact was not found: $source"
    }
    Copy-Item -LiteralPath $source -Destination (Join-Path $site $name) -Force
}

$chunkDirectory = Join-Path $site 'chunks'
$oldChunks = Get-ChildItem -LiteralPath $chunkDirectory -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like ($dataName + '.part.*') -or $_.Name -eq 'lightender-chunks.json' }
if ($oldChunks) {
    $oldChunks | Remove-Item -Force
}

$splitTool = Join-Path $PSScriptRoot 'Split-LightenderData.ps1'
$manifestTool = Join-Path $PSScriptRoot 'New-LightenderManifest.ps1'
& $splitTool -InputFile $dataPath -OutputDirectory $chunkDirectory -MaxChunkMiB $MaxChunkMiB -PublicPathPrefix 'chunks' -ManifestName 'lightender-chunks.json'

$sourceHash = (Get-FileHash -LiteralPath $dataPath -Algorithm SHA256).Hash.ToLowerInvariant()
$buildId = 'shipping-' + $sourceHash.Substring(0, 12)
& $manifestTool -SiteDirectory $site -BuildId $buildId -ChunkManifestPath 'chunks/lightender-chunks.json'

Write-Output "Published Lightender build $buildId to $site using a $MaxChunkMiB MiB maximum chunk size."
