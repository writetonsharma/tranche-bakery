param(
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
    [switch]$CleanDerived
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:DerivedSuffixPattern = '-(thumb|phone|tablet|desktop)\.jpg$'

$script:HomeHeroProfiles = @(
    @{ Suffix = 'phone'; Resize = '640x960>'; Quality = 70 },
    @{ Suffix = 'tablet'; Resize = '1024x1280>'; Quality = 76 },
    @{ Suffix = 'desktop'; Resize = '1600x1600>'; Quality = 82 }
)

$script:HomeProfiles = @(
    @{ Suffix = 'phone'; Resize = '560x560>'; Quality = 68 },
    @{ Suffix = 'tablet'; Resize = '960x960>'; Quality = 74 },
    @{ Suffix = 'desktop'; Resize = '1400x1400>'; Quality = 78 }
)

$script:ProductProfiles = @(
    @{ Suffix = 'phone'; Resize = '560x560>'; Quality = 66 },
    @{ Suffix = 'tablet'; Resize = '960x960>'; Quality = 72 },
    @{ Suffix = 'desktop'; Resize = '1400x1400>'; Quality = 76 }
)

function Assert-ImageMagick {
    $magick = Get-Command magick -ErrorAction SilentlyContinue
    if (-not $magick) {
        throw "ImageMagick ('magick') is required but was not found in PATH."
    }
}

function Get-JpegFiles {
    param(
        [string]$Path,
        [switch]$ExcludeDerived
    )

    if (-not (Test-Path $Path)) {
        return @()
    }

    $files = Get-ChildItem -Path $Path -Recurse -File | Where-Object {
        $_.Extension -match '^\.jpe?g$'
    }

    if ($ExcludeDerived) {
        $files = $files | Where-Object { $_.Name -notmatch $script:DerivedSuffixPattern }
    }

    return $files
}

function Get-BytesTotal {
    param(
        [object[]]$Files
    )

    if (-not $Files -or $Files.Count -eq 0) {
        return 0
    }

    return [int64](($Files | Measure-Object -Property Length -Sum).Sum)
}

function Get-DerivativePath {
    param(
        [string]$FilePath,
        [string]$Suffix
    )

    $parent = Split-Path -Parent $FilePath
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($FilePath)
    return Join-Path $parent ($baseName + '-' + $Suffix + '.jpg')
}

function Invoke-MagickTransform {
    param(
        [string]$SourcePath,
        [string]$DestinationPath,
        [string]$Resize,
        [int]$Quality,
        [switch]$SquareThumb
    )

    $arguments = @($SourcePath)

    if ($SquareThumb) {
        $arguments += @('-thumbnail', '240x240^', '-gravity', 'center', '-extent', '240x240')
    }
    else {
        $arguments += @('-resize', $Resize)
    }

    $arguments += @('-strip', '-interlace', 'Plane', '-quality', $Quality, $DestinationPath)
    & magick @arguments
}

function Optimize-Jpeg {
    param(
        [string]$FilePath,
        [string]$Resize,
        [int]$Quality
    )

    Invoke-MagickTransform -SourcePath $FilePath -DestinationPath $FilePath -Resize $Resize -Quality $Quality
}

function New-ResponsiveVariants {
    param(
        [System.IO.FileInfo]$File,
        [object[]]$Profiles
    )

    $generatedCount = 0

    foreach ($profile in $Profiles) {
        $derivativePath = Get-DerivativePath -FilePath $File.FullName -Suffix $profile.Suffix
        Invoke-MagickTransform -SourcePath $File.FullName -DestinationPath $derivativePath -Resize $profile.Resize -Quality $profile.Quality
        $generatedCount += 1
    }

    return $generatedCount
}

function Create-Thumb {
    param(
        [System.IO.FileInfo]$File
    )

    $thumbPath = Get-DerivativePath -FilePath $File.FullName -Suffix 'thumb'
    Invoke-MagickTransform -SourcePath $File.FullName -DestinationPath $thumbPath -Quality 58 -SquareThumb
}

function Remove-DerivedFiles {
    param(
        [string]$Path
    )

    if (-not (Test-Path $Path)) {
        return 0
    }

    $derivedFiles = Get-ChildItem -Path $Path -Recurse -File | Where-Object {
        $_.Extension -match '^\.jpe?g$' -and $_.Name -match $script:DerivedSuffixPattern
    }

    foreach ($file in $derivedFiles) {
        Remove-Item -LiteralPath $file.FullName -Force
    }

    return $derivedFiles.Count
}

Assert-ImageMagick

$imagesRoot = Join-Path $RepoRoot 'Images'
$homePath = Join-Path $imagesRoot 'HomePage'
$productsPath = Join-Path $imagesRoot 'Products'

if (-not (Test-Path $imagesRoot)) {
    throw "Images directory not found at $imagesRoot"
}

$originalFilesBefore = Get-JpegFiles -Path $imagesRoot -ExcludeDerived
$originalBytesBefore = Get-BytesTotal -Files $originalFilesBefore

$removedDerivedFiles = 0
if ($CleanDerived) {
    $removedDerivedFiles = Remove-DerivedFiles -Path $imagesRoot
}

$homeFiles = Get-JpegFiles -Path $homePath -ExcludeDerived
$homeResponsiveCount = 0
foreach ($file in $homeFiles) {
    if ($file.Name -eq 'HeroImage.jpg') {
        Optimize-Jpeg -FilePath $file.FullName -Resize '1600x1600>' -Quality 82
        $homeResponsiveCount += New-ResponsiveVariants -File $file -Profiles $script:HomeHeroProfiles
    }
    else {
        Optimize-Jpeg -FilePath $file.FullName -Resize '1400x1400>' -Quality 78
        $homeResponsiveCount += New-ResponsiveVariants -File $file -Profiles $script:HomeProfiles
    }
}

$productFiles = Get-JpegFiles -Path $productsPath -ExcludeDerived
$productResponsiveCount = 0
$thumbCount = 0
foreach ($file in $productFiles) {
    Optimize-Jpeg -FilePath $file.FullName -Resize '1400x1400>' -Quality 76
    $productResponsiveCount += New-ResponsiveVariants -File $file -Profiles $script:ProductProfiles
    Create-Thumb -File $file
    $thumbCount += 1
}

$originalFilesAfter = Get-JpegFiles -Path $imagesRoot -ExcludeDerived
$derivedFilesAfter = Get-ChildItem -Path $imagesRoot -Recurse -File | Where-Object {
    $_.Extension -match '^\.jpe?g$' -and $_.Name -match $script:DerivedSuffixPattern
}

$originalBytesAfter = Get-BytesTotal -Files $originalFilesAfter
$derivedBytesAfter = Get-BytesTotal -Files $derivedFilesAfter

[PSCustomObject]@{
    RepoRoot = $RepoRoot
    CleanDerived = [bool]$CleanDerived
    RemovedDerivedFiles = $removedDerivedFiles
    HomeOriginals = $homeFiles.Count
    ProductOriginals = $productFiles.Count
    ResponsiveVariantsGenerated = $homeResponsiveCount + $productResponsiveCount
    ThumbsGenerated = $thumbCount
    OriginalsBeforeMB = [math]::Round($originalBytesBefore / 1MB, 2)
    OriginalsAfterMB = [math]::Round($originalBytesAfter / 1MB, 2)
    OriginalsSavedMB = [math]::Round(($originalBytesBefore - $originalBytesAfter) / 1MB, 2)
    DerivedAssetsMB = [math]::Round($derivedBytesAfter / 1MB, 2)
    TotalImageFootprintMB = [math]::Round(($originalBytesAfter + $derivedBytesAfter) / 1MB, 2)
} | Format-List
