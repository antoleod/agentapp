# SIG # Begin signature block
# MIIFiQYJKoZIhvcNAQcCoIIFejCCBXYCAQExCzAJBgUrDgMCGgUAMGkGCisGAQQB
# gjcCAQSgWzBZMDQGCisGAQQBgjcCAR4wJgIDAQAABBAfzDtgWUsITrck0sYpfvNR
# AgEAAgEAAgEAAgEAAgEAMCEwCQYFKw4DAhoFAAQUOmsaUy7vX3aV+lOR0PX/+WVc
# 12egggMkMIIDIDCCAgigAwIBAgIQTkv+euojNaNGjFkOfsZktDANBgkqhkiG9w0B
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
# gjcCARUwIwYJKoZIhvcNAQkEMRYEFHwEFXNNPr8HxC2WKj5SsyYCn6XOMA0GCSqG
# SIb3DQEBAQUABIIBABPNMabgkVmK80IHgQv3adS28WKtETzelJBL8bB83K0lkNCn
# X0ObkvjtWhscHeolPsCKRCWQmr27wCUVYZNyjvrWDr/ex2AN9qPG0LWV/+ICLrWt
# VlrUAcN8bxPnzKNgAU0UPoDPtDbU2wlyyqtpXm55tlJhGeHTdRqSA/DkITPh4Y5N
# hy7pGam7p+VeucqVYvnHrmPrwzGFlfn2r6GJHIXZ5SaWgaZHO3B1Nt8jLzXRLA6Z
# FfVp96Lp72l9utWLahFBg/7XN+CBxNmBnidT6/PAc3CQwpE5WXAIFmRyz1+WkuUJ
# cnQ4OXDWufFwM4XLz3EYup7DYwroMoIvl1M18mQ=
# SIG # End signature block

# Agent Evaluation App - Local Server Launcher
# Professional/transparent launcher: no hidden windows, no bypass, no admin required.

$ErrorActionPreference = "Stop"

$AppRoot = Split-Path -Parent $PSScriptRoot
$Port = 8080

Set-Location $AppRoot

Write-Host "Starting Agent Evaluation App..." -ForegroundColor Cyan
Write-Host "App folder: $AppRoot" -ForegroundColor Gray
Write-Host "URL: http://localhost:$Port" -ForegroundColor Green

try {
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://localhost:$Port/")
    $listener.Start()

    Start-Process "http://localhost:$Port/index.html"

    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $localPath = $request.Url.LocalPath.TrimStart("/")
        if ([string]::IsNullOrWhiteSpace($localPath)) {
            $localPath = "index.html"
        }

        $filePath = Join-Path $AppRoot $localPath

        if (Test-Path -LiteralPath $filePath -PathType Leaf) {
            $bytes = [System.IO.File]::ReadAllBytes($filePath)

            switch ([System.IO.Path]::GetExtension($filePath).ToLowerInvariant()) {
                ".html" { $response.ContentType = "text/html; charset=utf-8" }
                ".css"  { $response.ContentType = "text/css; charset=utf-8" }
                ".js"   { $response.ContentType = "application/javascript; charset=utf-8" }
                ".json" { $response.ContentType = "application/json; charset=utf-8" }
                default { $response.ContentType = "application/octet-stream" }
            }

            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        else {
            $message = "404 - File not found: $localPath"
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($message)
            $response.StatusCode = 404
            $response.ContentType = "text/plain; charset=utf-8"
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        }

        $response.OutputStream.Close()
    }
}
catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
}
finally {
    if ($listener -and $listener.IsListening) {
        $listener.Stop()
    }
}
