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

# Copy the complete generated shell and runtime set. Keeping these files
# together is important because lightender-manifest.json records the exact
# size and SHA-256 for every entry; mixing an old shell with a new manifest
# makes installation fail safely.
$runtimeFiles = @(
	'index.html',
	'MhLightender-HTML5-Shipping.css',
	'LightenderDomShim.js',
	'lightender-distribution.js',
	'lightender-sw.js',
    'MhLightender-HTML5-Shipping.UE4.js',
    'MhLightender-HTML5-Shipping.js',
    'MhLightender-HTML5-Shipping.data.js',
    'MhLightender-HTML5-Shipping.wasm',
    'Utility.js'
)
$textRuntimeFiles = @(
    'index.html',
    'MhLightender-HTML5-Shipping.css',
    'LightenderDomShim.js',
    'lightender-distribution.js',
    'lightender-sw.js',
    'MhLightender-HTML5-Shipping.UE4.js',
    'MhLightender-HTML5-Shipping.js',
    'MhLightender-HTML5-Shipping.data.js',
    'Utility.js'
)

function Normalize-TextFileToLf([string]$Path) {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $text = [System.IO.File]::ReadAllText($Path, $utf8)
    $text = $text.Replace("`r`n", "`n").Replace("`r", "`n")
    [System.IO.File]::WriteAllText($Path, $text, $utf8)
}

foreach ($name in $runtimeFiles) {
    $source = Join-Path $build $name
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Generated runtime artifact was not found: $source"
    }
    Copy-Item -LiteralPath $source -Destination (Join-Path $site $name) -Force
}
foreach ($name in $textRuntimeFiles) {
    Normalize-TextFileToLf (Join-Path $site $name)
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
Normalize-TextFileToLf (Join-Path $chunkDirectory 'lightender-chunks.json')

$sourceHash = (Get-FileHash -LiteralPath $dataPath -Algorithm SHA256).Hash.ToLowerInvariant()
$chunkManifest = Get-Content -Raw -LiteralPath (Join-Path $chunkDirectory 'lightender-chunks.json') | ConvertFrom-Json
$fingerprintInput = New-Object System.Text.StringBuilder
foreach ($name in $runtimeFiles) {
    $fileHash = (Get-FileHash -LiteralPath (Join-Path $site $name) -Algorithm SHA256).Hash.ToLowerInvariant()
    [void]$fingerprintInput.Append($name).Append(':').Append($fileHash).Append("`n")
}
$sha256 = [System.Security.Cryptography.SHA256]::Create()
$fingerprintBytes = $sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($fingerprintInput.ToString()))
$runtimeFingerprint = ([BitConverter]::ToString($fingerprintBytes)).Replace('-', '').ToLowerInvariant()
$sha256.Dispose()
$buildId = 'shipping-' + $sourceHash.Substring(0, 12) + '-chunked-' + $chunkManifest.chunks.Count + '-runtime-' + $runtimeFingerprint.Substring(0, 12)
& $manifestTool -SiteDirectory $site -BuildId $buildId -ChunkManifestPath 'chunks/lightender-chunks.json'

Write-Output "Published Lightender build $buildId to $site using a $MaxChunkMiB MiB maximum chunk size."
