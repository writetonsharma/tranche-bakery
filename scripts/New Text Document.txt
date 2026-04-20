param(
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot)
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-ImageMagick {
    $magick = Get-Command magick -ErrorAction SilentlyContinue
    if (-not $magick) {
        throw "ImageMagick ('magick') is required but was not found in PATH."
    }
}

function Get-JpegFiles {
    param(
        [string]$Path,
        [switch]$ExcludeThumbs
    )

    $files = Get-ChildItem -Path $Path -Recurse -File | Where-Object {
        $_.Extension -match '^\.jpe?g$'
    }

    if ($ExcludeThumbs) {
        $files = $files | Where-Object { $_.Name -notmatch '-thumb\.jpg$' }
    }

    return $files
}

function Optimize-Jpeg {
    param(
        [string]$FilePath,
        [string]$Resize,
        [int]$Quality
    )

    & magick $FilePath -resize $Resize -strip -interlace Plane -quality $Quality $FilePath
}

function Create-Thumb {
    param(
        [string]$FilePath
    )

    $thumbPath = Join-Path (Split-Path -Parent $FilePath) (([System.IO.Path]::GetFileNameWithoutExtension($FilePath)) + '-thumb.jpg')
    & magick $FilePath -thumbnail '240x240^' -gravity center -extent 240x240 -strip -interlace Plane -quality 58 $thumbPath
}

Assert-ImageMagick

$imagesRoot = Join-Path $RepoRoot 'Images'
$homePath = Join-Path $imagesRoot 'HomePage'
$productsPath = Join-Path $imagesRoot 'Products'

if (-not (Test-Path $imagesRoot)) {
    throw "Images directory not found at $imagesRoot"
}

$beforeBytes = (Get-JpegFiles -Path $imagesRoot | Measure-Object Length -Sum).Sum

$homeFiles = Get-JpegFiles -Path $homePath
foreach ($file in $homeFiles) {
    if ($file.Name -eq 'HeroImage.jpg') {
        Optimize-Jpeg -FilePath $file.FullName -Resize '1600x1600>' -Quality 82
    }
    else {
        Optimize-Jpeg -FilePath $file.FullName -Resize '1400x1400>' -Quality 78
    }
}

$productFiles = Get-JpegFiles -Path $productsPath -ExcludeThumbs
foreach ($file in $productFiles) {
    Optimize-Jpeg -FilePath $file.FullName -Resize '1400x1400>' -Quality 76
}

foreach ($file in $productFiles) {
    Create-Thumb -FilePath $file.FullName
}

$afterBytes = (Get-JpegFiles -Path $imagesRoot | Measure-Object Length -Sum).Sum

[PSCustomObject]@{
    RepoRoot = $RepoRoot
    BeforeMB = [math]::Round($beforeBytes / 1MB, 2)
    AfterMB = [math]::Round($afterBytes / 1MB, 2)
    SavedMB = [math]::Round(($beforeBytes - $afterBytes) / 1MB, 2)
} | Format-List
