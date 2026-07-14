function Read-VpkCString {
    param([Parameter(Mandatory)][IO.BinaryReader]$Reader)

    $bytes = [Collections.Generic.List[byte]]::new()
    while (($value = $Reader.ReadByte()) -ne 0) {
        $bytes.Add($value)
    }
    return [Text.Encoding]::UTF8.GetString($bytes.ToArray())
}

function Write-VpkCString {
    param(
        [Parameter(Mandatory)][IO.BinaryWriter]$Writer,
        [Parameter(Mandatory)][string]$Value
    )

    $Writer.Write([Text.Encoding]::UTF8.GetBytes($Value))
    $Writer.Write([byte]0)
}

function Get-Md5Bytes {
    param([Parameter(Mandatory)][AllowEmptyCollection()][byte[]]$Bytes)

    $md5 = [Security.Cryptography.MD5]::Create()
    try {
        return ,$md5.ComputeHash($Bytes)
    }
    finally {
        $md5.Dispose()
    }
}

function Read-VpkDirectory {
    param([Parameter(Mandatory)][string]$Path)

    $stream = [IO.File]::OpenRead($Path)
    $reader = [IO.BinaryReader]::new($stream)
    try {
        $signature = $reader.ReadUInt32()
        if ($signature -ne 0x55AA1234) {
            throw "Invalid VPK signature in $Path"
        }

        $version = $reader.ReadUInt32()
        if ($version -notin 1, 2) {
            throw "Unsupported VPK version $version in $Path"
        }

        $treeSize = $reader.ReadUInt32()
        if ($version -eq 2) {
            [void]$reader.ReadUInt32() # file data section size
            [void]$reader.ReadUInt32() # archive MD5 section size
            [void]$reader.ReadUInt32() # other MD5 section size
            [void]$reader.ReadUInt32() # signature section size
        }

        $headerSize = $stream.Position
        $treeEnd = $headerSize + $treeSize
        $entries = [Collections.Generic.List[object]]::new()

        while ($stream.Position -lt $treeEnd) {
            $extension = Read-VpkCString $reader
            if ([string]::IsNullOrEmpty($extension)) { break }

            while ($true) {
                $directory = Read-VpkCString $reader
                if ([string]::IsNullOrEmpty($directory)) { break }

                while ($true) {
                    $fileName = Read-VpkCString $reader
                    if ([string]::IsNullOrEmpty($fileName)) { break }

                    $crc = $reader.ReadUInt32()
                    $preloadLength = $reader.ReadUInt16()
                    $archiveIndex = $reader.ReadUInt16()
                    $offset = $reader.ReadUInt32()
                    $length = $reader.ReadUInt32()
                    $terminator = $reader.ReadUInt16()
                    if ($terminator -ne 0xFFFF) {
                        throw "Invalid VPK entry terminator in $Path"
                    }

                    [byte[]]$preloadBytes = @()
                    if ($preloadLength -gt 0) {
                        $preloadBytes = $reader.ReadBytes($preloadLength)
                    }

                    $normalizedDirectory = if ($directory -eq " ") { "" } else { $directory.TrimEnd("/") }
                    $entryPath = (($normalizedDirectory + "/" + $fileName + "." + $extension).TrimStart("/"))
                    $entries.Add([pscustomobject]@{
                        Path = $entryPath
                        Crc = $crc
                        PreloadBytes = $preloadBytes
                        ArchiveIndex = $archiveIndex
                        Offset = $offset
                        Length = $length
                    })
                }
            }
        }

        return [pscustomobject]@{
            HeaderSize = $headerSize
            TreeSize = $treeSize
            Entries = $entries.ToArray()
        }
    }
    finally {
        $reader.Dispose()
        $stream.Dispose()
    }
}

function Get-VpkEntryPaths {
    param([Parameter(Mandatory)][string]$Path)

    return @((Read-VpkDirectory $Path).Entries | ForEach-Object { $_.Path })
}

function Read-VpkEmbeddedEntry {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$EntryPath
    )

    $directory = Read-VpkDirectory $Path
    $matches = @($directory.Entries | Where-Object { $_.Path -eq $EntryPath })
    if ($matches.Count -ne 1) {
        throw "Expected exactly one '$EntryPath' entry in $Path"
    }

    $entry = $matches[0]
    if ($entry.ArchiveIndex -ne 0x7FFF) {
        throw "Entry '$EntryPath' is not embedded in $Path"
    }

    $stream = [IO.File]::OpenRead($Path)
    try {
        $stream.Position = $directory.HeaderSize + $directory.TreeSize + $entry.Offset
        [byte[]]$storedBytes = [byte[]]::new($entry.Length)
        $read = $stream.Read($storedBytes, 0, $storedBytes.Length)
        if ($read -ne $storedBytes.Length) {
            throw "Unexpected end of VPK data for '$EntryPath' in $Path"
        }
    }
    finally {
        $stream.Dispose()
    }

    [byte[]]$entryBytes = [byte[]]::new($entry.PreloadBytes.Length + $storedBytes.Length)
    if ($entry.PreloadBytes.Length -gt 0) {
        [Array]::Copy($entry.PreloadBytes, 0, $entryBytes, 0, $entry.PreloadBytes.Length)
    }
    [Array]::Copy($storedBytes, 0, $entryBytes, $entry.PreloadBytes.Length, $storedBytes.Length)

    return [pscustomobject]@{
        Bytes = $entryBytes
        Crc = $entry.Crc
    }
}

function ConvertTo-BotProfileOnlyVpk {
    param([Parameter(Mandatory)][string]$Path)

    $entryPaths = @(Get-VpkEntryPaths $Path)
    if ($entryPaths.Count -eq 1 -and $entryPaths[0] -eq "botprofile.db") {
        return
    }

    $botProfile = Read-VpkEmbeddedEntry $Path "botprofile.db"

    $treeStream = [IO.MemoryStream]::new()
    $treeWriter = [IO.BinaryWriter]::new($treeStream)
    try {
        Write-VpkCString $treeWriter "db"
        Write-VpkCString $treeWriter " "
        Write-VpkCString $treeWriter "botprofile"
        $treeWriter.Write([uint32]$botProfile.Crc)
        $treeWriter.Write([uint16]0)
        $treeWriter.Write([uint16]0x7FFF)
        $treeWriter.Write([uint32]0)
        $treeWriter.Write([uint32]$botProfile.Bytes.Length)
        $treeWriter.Write([uint16]0xFFFF)
        $treeWriter.Write([byte]0) # end file names
        $treeWriter.Write([byte]0) # end directories
        $treeWriter.Write([byte]0) # end extensions
        $treeWriter.Flush()
        [byte[]]$treeBytes = $treeStream.ToArray()
    }
    finally {
        $treeWriter.Dispose()
        $treeStream.Dispose()
    }

    $outputStream = [IO.MemoryStream]::new()
    $writer = [IO.BinaryWriter]::new($outputStream)
    try {
        $writer.Write([uint32]0x55AA1234)
        $writer.Write([uint32]2)
        $writer.Write([uint32]$treeBytes.Length)
        $writer.Write([uint32]$botProfile.Bytes.Length)
        $writer.Write([uint32]0)  # archive MD5 section
        $writer.Write([uint32]48) # tree, archive and whole-file MD5 values
        $writer.Write([uint32]0)  # signature section
        $writer.Write($treeBytes)
        $writer.Write($botProfile.Bytes)

        [byte[]]$treeHash = Get-Md5Bytes $treeBytes
        [byte[]]$archiveHash = Get-Md5Bytes ([byte[]]::new(0))
        $writer.Write($treeHash)
        $writer.Write($archiveHash)
        $writer.Flush()

        [byte[]]$wholeHash = Get-Md5Bytes $outputStream.ToArray()
        $writer.Write($wholeHash)
        $writer.Flush()
        [byte[]]$outputBytes = $outputStream.ToArray()
    }
    finally {
        $writer.Dispose()
        $outputStream.Dispose()
    }

    $temporaryPath = "$Path.tmp"
    try {
        [IO.File]::WriteAllBytes($temporaryPath, $outputBytes)
        $writtenEntries = @(Get-VpkEntryPaths $temporaryPath)
        if ($writtenEntries.Count -ne 1 -or $writtenEntries[0] -ne "botprofile.db") {
            throw "Repacked VPK validation failed for $Path"
        }
        Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}
