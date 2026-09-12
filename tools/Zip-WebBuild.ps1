param([Parameter(Mandatory=$true)][string]$BuildRoot)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$manifest = Get-Content -LiteralPath (Join-Path $BuildRoot 'manifest.json') -Raw | ConvertFrom-Json
$zipPath = Join-Path $BuildRoot 'website.zip'
$archive = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in $manifest.files.PSObject.Properties) {
        if ($file.Name -match '(?:^|/)\.{1,2}(?:/|$)' -or $file.Name -notmatch '^[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*$') { throw 'Unsafe archive entry.' }
        [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,
            (Join-Path $BuildRoot ('upload/' + $file.Name)), $file.Name, [IO.Compression.CompressionLevel]::Optimal)
    }
} finally { $archive.Dispose() }
$archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    if ($archive.Entries.Count -ne $manifest.files.PSObject.Properties.Name.Count) { throw 'ZIP entry count mismatch.' }
    foreach ($entry in $archive.Entries) {
        $stream = $entry.Open()
        $algorithm = [Security.Cryptography.SHA256]::Create()
        try { $digest = [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
        finally { $stream.Dispose(); $algorithm.Dispose() }
        if ($digest -cne $manifest.files.($entry.FullName).sha256) { throw 'ZIP entry hash mismatch.' }
    }
} finally { $archive.Dispose() }
Write-Output 'ZIP verified against the complete manifest, including .htaccess files.'
