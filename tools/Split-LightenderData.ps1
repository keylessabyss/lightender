[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InputFile,

    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory,

    [double]$MaxChunkMiB = 22.0,

    [string]$PublicPathPrefix = 'chunks',

    [string]$ManifestName = 'lightender-chunks.json'
)

$ErrorActionPreference = 'Stop'
$inputPath = (Resolve-Path -LiteralPath $InputFile).Path
$inputItem = Get-Item -LiteralPath $inputPath
$maxChunkBytes = [int64][Math]::Floor($MaxChunkMiB * 1024 * 1024)
if ($maxChunkBytes -lt 1) { throw 'MaxChunkMiB must produce at least one byte per chunk.' }

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$outputPath = (Resolve-Path -LiteralPath $OutputDirectory).Path
$baseName = [System.IO.Path]::GetFileName($inputPath)
$chunkCount = [int][Math]::Ceiling([double]$inputItem.Length / [double]$maxChunkBytes)
$buffer = New-Object byte[] (1024 * 1024)
$chunks = @()
$packageHash = [System.Security.Cryptography.SHA256]::Create()
$stream = New-Object System.IO.FileStream($inputPath, ([System.IO.FileMode]::Open), ([System.IO.FileAccess]::Read), ([System.IO.FileShare]::Read))

try {
    for ($index = 0; $index -lt $chunkCount; $index++) {
        $chunkName = '{0}.part.{1:D4}' -f $baseName, $index
        $chunkPath = Join-Path $outputPath $chunkName
        $chunkHash = [System.Security.Cryptography.SHA256]::Create()
        $chunkStream = New-Object System.IO.FileStream($chunkPath, ([System.IO.FileMode]::Create), ([System.IO.FileAccess]::Write), ([System.IO.FileShare]::None))
        $remaining = [Math]::Min($maxChunkBytes, $inputItem.Length - ([int64]$index * $maxChunkBytes))
        $chunkBytes = [int64]0

        try {
            while ($chunkBytes -lt $remaining) {
                $toRead = [int][Math]::Min($buffer.Length, $remaining - $chunkBytes)
                $read = $stream.Read($buffer, 0, $toRead)
                if ($read -le 0) { throw "Unexpected end of input while writing chunk $chunkName." }
                $chunkStream.Write($buffer, 0, $read)
                [void]$chunkHash.TransformBlock($buffer, 0, $read, $buffer, 0)
                [void]$packageHash.TransformBlock($buffer, 0, $read, $buffer, 0)
                $chunkBytes += $read
            }
        }
        finally {
            $chunkStream.Dispose()
        }

        [void]$chunkHash.TransformFinalBlock([byte[]]::new(0), 0, 0)
        $publicPath = (($PublicPathPrefix.Trim('/')) + '/' + $chunkName).Replace('\', '/')
        $chunks += [ordered]@{
            path = $publicPath
            file = $chunkName
            index = $index
            offset = [int64]$index * $maxChunkBytes
            size = $chunkBytes
            sha256 = ([BitConverter]::ToString($chunkHash.Hash)).Replace('-', '').ToLowerInvariant()
        }
        $chunkHash.Dispose()
    }
}
finally {
    $stream.Dispose()
}

[void]$packageHash.TransformFinalBlock([byte[]]::new(0), 0, 0)
$manifest = [ordered]@{
    schema = 'keyless-abyss.lightender-chunks/v1'
    sourceFile = $baseName
    sourceBytes = [int64]$inputItem.Length
    sourceSha256 = ([BitConverter]::ToString($packageHash.Hash)).Replace('-', '').ToLowerInvariant()
    maxChunkBytes = $maxChunkBytes
    chunkCount = $chunks.Count
    chunks = $chunks
}
$packageHash.Dispose()

$manifestPath = Join-Path $outputPath $ManifestName
$json = $manifest | ConvertTo-Json -Depth 8
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($manifestPath, $json + [Environment]::NewLine, $utf8)
Write-Output "Wrote $($chunks.Count) chunks and $manifestPath ($($inputItem.Length) source bytes)."
