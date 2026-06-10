# SIG # Begin signature block
# MIIFiQYJKoZIhvcNAQcCoIIFejCCBXYCAQExCzAJBgUrDgMCGgUAMGkGCisGAQQB
# gjcCAQSgWzBZMDQGCisGAQQBgjcCAR4wJgIDAQAABBAfzDtgWUsITrck0sYpfvNR
# AgEAAgEAAgEAAgEAAgEAMCEwCQYFKw4DAhoFAAQU8NdPR6/Gpt5i/uMG341/pgQn
# 9FOgggMkMIIDIDCCAgigAwIBAgIQTkv+euojNaNGjFkOfsZktDANBgkqhkiG9w0B
# AQsFADAaMRgwFgYDVQQDDA9NVVNUQlJVTjI0MjQwMTIwHhcNMjYwNDEzMTM1OTM5
# WhcNMjkwNDEzMTQwOTM5WjAaMRgwFgYDVQQDDA9NVVNUQlJVTjI0MjQwMTIwggEi
# MA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCiNDIXP5Ec1XvSSSvNnmMyBk7J
# OodOpS/qSpjgzTrwCXVIfJsH8tr4aFLBg2swJV57PjSWsQaprAcOSwqXlYM0+pVT
# 0qtbmFOvrBHcRL12BEJnL3FKyPorgWH9uYn9M7v4uccy5Re58ezlUC7AFeHcm4xG
# cExRBgNKdDY9wDuODbH2CZ8DnnCual73BVtmq9PSGiEppV0QbKESFTkjWF+IRxyO
# 7BGZW0F+Ad3F48L3hj0ybArg9NhNVtd9/oEG5PxRTWYhWQcuD5SyWek81xV8JgWj
# FluzWhOIc5NCqJr+5zLnG28Zlmw9SXo45VMbyVP9Skkdo5zW8e8z1NrbdnlZAgMB
# AAGjYjBgMA4GA1UdDwEB/wQEAwIHgDATBgNVHSUEDDAKBggrBgEFBQcDAzAaBgNV
# HREEEzARgg9NVVNUQlJVTjI0MjQwMTIwHQYDVR0OBBYEFE78Lr7EgtaZSp++tL1m
# ovdMCPWMMA0GCSqGSIb3DQEBCwUAA4IBAQBAmNQrAEOU9Z2mhBTpavjTnlqthfu6
# YjT4kOBCmPuQfGpgLNGEZ9vIn4VPXZO2uU222OzzsbaEaEuLYn5edjL+9L2JTp5i
# 8+aEuUB1L+1CfZLReCKCcXyeUHW6MyJ4xw9QJnRUgiLeYsGFslweS1Fm9u3uwrqB
# BwiMnV/0sHE3EpuNaxu3WLbAaltG2TEiYmw2yV2+Pyw4FhF7cqcDZwt/BJtJyGJU
# AF7wzFScTFb6L2OwkVepfw1dFE7CeFyQf1xBxW2ZQ4uUlR1YI4xs9yZA0kHHawTr
# 3zgYqS1r7WfOwtGXTlY3EyhxahRGlzLpN+g0oRYWBRf7rT3SL3lNKQMSMYIBzzCC
# AcsCAQEwLjAaMRgwFgYDVQQDDA9NVVNUQlJVTjI0MjQwMTICEE5L/nrqIzWjRoxZ
# Dn7GZLQwCQYFKw4DAhoFAKB4MBgGCisGAQQBgjcCAQwxCjAIoAKAAKECgAAwGQYJ
# KoZIhvcNAQkDMQwGCisGAQQBgjcCAQQwHAYKKwYBBAGCNwIBCzEOMAwGCisGAQQB
# gjcCARUwIwYJKoZIhvcNAQkEMRYEFJKG78fOlVhmINQ4yMK+6NAP3za/MA0GCSqG
# SIb3DQEBAQUABIIBAIZvQ+GQk51KdGOpIU07iZCDHBUWyFvdRGRvxCdttF/brwql
# PAgMLmkXbq/RjOM6C/gVA7UW75lLOiqLAM3PZjiQ4+O4HgUooMKKkEko/RWIy/5K
# pdT+J8eQxwm1TXMQCU7BVfijnh3XHbG/skZ+h216dRmjVZJ/bV7ALZNE7svHwT8g
# u9Mm+DQuulym794KXEWLMCRs24zDEWHR0NKMuf91BTdMPvRr2gzG4eu1DpzfB/84
# 6iRw35TZKeLKYwkDzzvZHJoWK/6Af/YMtE11OMIjQ/Eke2PYnAmpHijzcvWI303G
# okCQEgu1/o6YiXynUFPjkNkx/pn2YCadziFTEvQ=
# SIG # End signature block


# Agent Evaluation App - Backup Helper
# Copies data.json to backup folder with timestamp.

$ErrorActionPreference = "Stop"

$AppRoot = Split-Path -Parent $PSScriptRoot
$DataFile = Join-Path $AppRoot "data\data.json"
$BackupFolder = Join-Path $AppRoot "backup"

if (!(Test-Path -LiteralPath $BackupFolder)) {
    New-Item -ItemType Directory -Path $BackupFolder | Out-Null
}

if (!(Test-Path -LiteralPath $DataFile)) {
    Write-Host "data.json not found: $DataFile" -ForegroundColor Yellow
    exit
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupFile = Join-Path $BackupFolder "data-backup-$timestamp.json"

Copy-Item -LiteralPath $DataFile -Destination $backupFile -Force

Write-Host "Backup created:" -ForegroundColor Green
Write-Host $backupFile
