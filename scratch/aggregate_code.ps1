$desktopPath = [Environment]::GetFolderPath('Desktop')
$outputFile = Join-Path $desktopPath "kasam360_all_code.txt"
$sourceBase = "c:\Users\Eren\Desktop\k360\kasam360"

# Use UTF8 without BOM
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false

# Header
$finalContent = "=== KASAM360 SOURCE CODE BACKUP ===`n"
$finalContent += "Generated on: $(Get-Date)`n"
$finalContent += ("-" * 40) + "`n`n"

# Targeted directories
$dirs = @("backend\src", "mobile\src")
$rootFiles = @("backend\server.js", "mobile\App.tsx", "mobile\index.js")

foreach ($relDir in $dirs) {
    $absDir = Join-Path $sourceBase $relDir
    if (Test-Path $absDir) {
        $files = Get-ChildItem -Path $absDir -Recurse -File | Where-Object {
            $_.Extension -in ".js", ".ts", ".tsx", ".css", ".json"
        }
        foreach ($file in $files) {
            $relativePath = $file.FullName.Replace($sourceBase + "\", "")
            $finalContent += "`n`n" + ("#" * 80) + "`n"
            $finalContent += "FILE: $relativePath`n"
            $finalContent += ("#" * 80) + "`n`n"
            $finalContent += (Get-Content $file.FullName -Raw) + "`n"
        }
    }
}

foreach ($relFile in $rootFiles) {
    $absFile = Join-Path $sourceBase $relFile
    if (Test-Path $absFile) {
        $finalContent += "`n`n" + ("#" * 80) + "`n"
        $finalContent += "FILE: $relFile`n"
        $finalContent += ("#" * 80) + "`n`n"
        $finalContent += (Get-Content $absFile -Raw) + "`n"
    }
}

[System.IO.File]::WriteAllText($outputFile, $finalContent, $Utf8NoBom)
Write-Host "Code backup finalized at: $outputFile"
