param(
    [string]$OutputDirectory,
    [string]$SourceDirectory
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$extensionRoot = if ([string]::IsNullOrWhiteSpace($SourceDirectory)) {
    Join-Path $projectRoot 'extension'
} else {
    [System.IO.Path]::GetFullPath($SourceDirectory)
}
$manifestPath = Join-Path $extensionRoot 'manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $projectRoot 'dist'
}

$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
if (-not (Test-Path -LiteralPath $outputRoot)) {
    New-Item -ItemType Directory -Path $outputRoot | Out-Null
}

$artifactName = "full-web-page-screenshot-$($manifest.version).zip"
$artifactPath = Join-Path $outputRoot $artifactName
$checksumPath = "$artifactPath.sha256"

if (Test-Path -LiteralPath $artifactPath) {
    Remove-Item -LiteralPath $artifactPath -Force -Confirm:$false
}
if (Test-Path -LiteralPath $checksumPath) {
    Remove-Item -LiteralPath $checksumPath -Force -Confirm:$false
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$fixedTimestamp = [DateTimeOffset]::new(1980, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
$sourceFiles = @(Get-ChildItem -LiteralPath $extensionRoot -Recurse -File | Sort-Object {
        [System.IO.Path]::GetRelativePath($extensionRoot, $_.FullName).Replace('\', '/')
    })
if ($sourceFiles.Count -eq 0) {
    throw 'Extension source directory is empty.'
}

$archiveStream = [System.IO.File]::Open(
    $artifactPath,
    [System.IO.FileMode]::CreateNew,
    [System.IO.FileAccess]::Write,
    [System.IO.FileShare]::None
)
$writer = [System.IO.Compression.ZipArchive]::new(
    $archiveStream,
    [System.IO.Compression.ZipArchiveMode]::Create,
    $false
)
try {
    foreach ($sourceFile in $sourceFiles) {
        $entryName = [System.IO.Path]::GetRelativePath(
            $extensionRoot,
            $sourceFile.FullName
        ).Replace('\', '/')
        $entry = $writer.CreateEntry(
            $entryName,
            [System.IO.Compression.CompressionLevel]::Optimal
        )
        $entry.LastWriteTime = $fixedTimestamp
        $inputStream = [System.IO.File]::OpenRead($sourceFile.FullName)
        $entryStream = $entry.Open()
        try {
            $inputStream.CopyTo($entryStream)
        } finally {
            $entryStream.Dispose()
            $inputStream.Dispose()
        }
    }
} finally {
    $writer.Dispose()
    $archiveStream.Dispose()
}

$archive = [System.IO.Compression.ZipFile]::OpenRead($artifactPath)
try {
    $manifestEntry = $archive.Entries | Where-Object { $_.FullName -eq 'manifest.json' }
    if ($null -eq $manifestEntry) {
        throw 'Release archive does not contain manifest.json at its root.'
    }
} finally {
    $archive.Dispose()
}

$hash = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
$checksumLine = "$hash  $artifactName`n"
[System.IO.File]::WriteAllText($checksumPath, $checksumLine, [System.Text.UTF8Encoding]::new($false))

Write-Output "Built: $artifactPath"
Write-Output "SHA256: $hash"
