# Cognitive Logs Page Runbook (via DevTools MCP)

Goal: Enter the logs/results page in Cognitive Testing using the icon you shared (the `Results`/`audit` icon in the process row).

## Preconditions
- You are logged into `https://cognitivetesting.online`.
- You are in the target suite/process list page (example: `.../tests`).

## Repeatable Navigation Steps
1. Open the process list page (example: `https://cognitivetesting.online/tests`).
2. Locate the target process row (example used: `TimbradoFacturasGlobales`).
3. Click the row icon/link with:
   - visual icon: `audit`
   - destination: `https://cognitivetesting.online/results`
   - tooltip/meaning: `Results`
4. Confirm the URL is `.../results`.
5. Confirm results/logs UI loaded by checking:
   - summary cards (`Average Execution Time`, `Total Runs`, `Failed Rate`, `Success Rate`)
   - run timeline/date selector
   - `Downloadable files` section with log artifacts (`ERROR.txt`, images, log txt)

## MCP Notes
- UIDs from snapshots are session-specific and can change; do not hardcode UIDs long-term.
- Reliable selectors are the process row text and the `audit` results icon/link to `/results`.
- If the row is not visible, use search/filter first, then click the `audit` icon.

## Last Verified Flow
- Start page: `https://cognitivetesting.online/tests`
- Process clicked: `TimbradoFacturasGlobales` (`1555960`)
- Icon clicked: `audit` (`Results`)
- Final page: `https://cognitivetesting.online/results`

## Request-level API Flow (captured)
The UI uses Cloud Functions under:
- `https://us-central1-cognitive-testing.cloudfunctions.net`

### 1) List available execution folders (runs)
`POST /azure-listFilesAndDirectories`

Request body:
```json
{"path":"Processes/1555960/rodrigo.gracia@softtek.com"}
```

Response: array of run directories (example includes latest):
```json
[
  {"kind":"directory","name":"2026041022101897"},
  {"kind":"directory","name":"2026041622085624"}
]
```

### 2) List files for a specific run result
`POST /azure-listFilesAndDirectories`

Request body:
```json
{"path":"Processes/1555960/rodrigo.gracia@softtek.com/2026041622085624/Result"}
```

Response example:
```json
[
  {"kind":"file","name":"ERROR.txt","properties":{"contentLength":71}},
  {"kind":"file","name":"ErrorImage.png","properties":{"contentLength":296768}},
  {"kind":"file","name":"log-2026041622085624.txt","properties":{"contentLength":19269}}
]
```

### 3A) Download a text log directly
`POST /azure-getTxtFile`

Request body:
```json
{"path":"Processes/1555960/rodrigo.gracia@softtek.com/2026041622085624/Result","fileName":"log-2026041622085624.txt"}
```

Response body: plain text log content.

### 3B) Get a temporary signed URL (works for text or binary)
`POST /azure-getUrl`

Request body:
```json
{"path":"Processes/1555960/rodrigo.gracia@softtek.com/2026041622085624/Result","fileName":"log-2026041622085624.txt"}
```

Response body: Azure signed URL string. Then `GET` that URL to download file bytes.

## How to determine "latest log"
- In this account structure, run folder names are sortable timestamps (`yyyyMMddHHmmssxx` style).
- Sort descending and pick the first directory name from:
  - `Processes/<processId>/<userEmail>`
- Then list `.../<runId>/Result` and select file:
  - prefer `log-*.txt` as execution log
  - `ERROR.txt` is summary/error-only

## Minimal PowerShell template
```powershell
$base = "https://us-central1-cognitive-testing.cloudfunctions.net"
$processId = 1555960
$userEmail = "rodrigo.gracia@softtek.com"

# 1) Runs
$runs = Invoke-RestMethod -Method Post -Uri "$base/azure-listFilesAndDirectories" -ContentType "application/json" -Body (@{ path = "Processes/$processId/$userEmail" } | ConvertTo-Json -Compress)
$latestRun = ($runs | Where-Object { $_.kind -eq "directory" } | Sort-Object name -Descending | Select-Object -First 1).name

# 2) Files in latest run
$resultPath = "Processes/$processId/$userEmail/$latestRun/Result"
$files = Invoke-RestMethod -Method Post -Uri "$base/azure-listFilesAndDirectories" -ContentType "application/json" -Body (@{ path = $resultPath } | ConvertTo-Json -Compress)
$logFile = ($files | Where-Object { $_.name -like "log-*.txt" } | Select-Object -First 1).name

# 3) Download log as text
$logText = Invoke-RestMethod -Method Post -Uri "$base/azure-getTxtFile" -ContentType "application/json" -Body (@{ path = $resultPath; fileName = $logFile } | ConvertTo-Json -Compress)
$outPath = Join-Path (Get-Location) $logFile
[System.IO.File]::WriteAllText($outPath, [string]$logText, [System.Text.Encoding]::UTF8)
```
