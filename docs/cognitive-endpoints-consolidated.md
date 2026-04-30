# Cognitive Endpoints - Consolidated Learnings

## Source of truth script

All tested flows are consolidated in:

- `scripts/tmp_cognitive_probe.py`

This script now performs, in one run:

1. Auth bootstrap from `.env` credentials
2. Create app
3. List all apps
4. Get suites under a specific app (the app just created)
5. Get user processes (`tests-getMyProcesses`)
6. Create suite storage scaffold (Azure sequence used by UI)
7. Map/create process flow inside suite (`New Process`)

## Credentials and auth bootstrap

Input variables expected in `.env`:

- `COGNITIVE_USER` (or `COGNITIVE_EMAIL`)
- `COGNITIVE_PASS` (or `COGNITIVE_PASSWORD`)

Bootstrap chain (tested):

1. `POST https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=<AUTOMATION_KEY>`
2. `POST https://us-central1-cognitive-testing.cloudfunctions.net/auth-generateToken` with header `Authorization: <AUTOMATION_KEY>` and body `{"uid":"<email>"}`
3. `POST https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyCustomToken?key=<COGNITIVE_KEY>`
4. Use returned `idToken` as raw `Authorization` header (no `Bearer ` prefix)

## Tested endpoints and contracts

### 1) Create app

- Method: `POST`
- URL: `https://us-central1-cognitive-testing.cloudfunctions.net/apps-createApp`
- Headers:
  - `Authorization: <raw cognitive token>`
  - `Content-Type: text/plain;charset=UTF-8`
- Body:

```json
{"appId":7574296,"nombre":"Tmp-Probe-1777574296","mail":"rodrigo.gracia@softtek.com"}
```

- Last tested result: `200` with `{"ID":...,"Name":...,"Users":[...]}`

### 2) List all apps (includes suites per app)

- Method: `GET`
- URL: `https://us-central1-cognitive-testing.cloudfunctions.net/apps-getAdminAppsAndSuites?email=<url-encoded-email>`
- Headers:
  - `Authorization: <raw cognitive token>`
  - `Content-Type: text/plain`
- Last tested result: `200` with object keyed by app id:

```json
{
  "3320302": {
    "name": "Tmp-IterProbe-1777573320302",
    "suites": {
      "4308144": "Test2",
      "5640573": "Tmp-Suite-Mapping-20260430-1234"
    }
  }
}
```

### 3) Get suites under one app

No separate "get suites by app" endpoint was required.

Tested approach:

- Call `apps-getAdminAppsAndSuites`
- Read `response["<appId>"]["suites"]`

Last tested in script:

- `app_id=7574296`
- `suites_count=0`
- `suites={}`

### 4) Get user processes

- Method: `GET`
- URL: `https://us-central1-cognitive-testing.cloudfunctions.net/tests-getMyProcesses?mail=<url-encoded-email>`
- Headers:
  - `Authorization: <raw cognitive token>`
  - `Content-Type: text/plain`
- Last tested result: `200` with large map of process records containing `Apps` and `Suites`.

### 4b) Get all processes within a suite (tested)

Endpoint used:

- `GET https://us-central1-cognitive-testing.cloudfunctions.net/tests-getMyProcesses?mail=<url-encoded-email>`

How suite-level listing is derived:

- Parse each returned process record's `Suites` array.
- Keep processes where any entry starts with `"<suiteId> - "`.

Latest validated example:

- `suite_id=5640573`
- `matched_processes_count=2`
- sample IDs: `4962233`, `5640573`

### 5) Create suite inside app - tested scope

The endpoint sequence that was successfully tested is the Azure scaffold used during suite creation:

1. `POST https://us-central1-cognitive-testing.cloudfunctions.net/azure-createDirectory` with `{"path":"Processes/<processId>"}`
2. `POST https://us-central1-cognitive-testing.cloudfunctions.net/azure-createDirectory` with `{"path":"Processes/<processId>/Steps"}`
3. `POST https://us-central1-cognitive-testing.cloudfunctions.net/azure-createDirectory` with `{"path":"Processes/<processId>/Steps/0"}`
4. `POST https://us-central1-cognitive-testing.cloudfunctions.net/azure-createTxtFile` with:

```json
{"path":"Processes/<processId>/Steps/0","file":{"name":"Actions.txt","content":"Hello World"}}
```

Last tested run:

- `processId=7574307`
- all four calls returned `200` + `true`

Important: this tested sequence confirms storage scaffolding success. App-to-suite metadata linkage is handled by additional client-side Firebase logic in UI flows.

### 6) Create process inside suite (UI `New Process`) - tested scope

Observed from live UI action on `/tests`:

1. `POST https://us-central1-cognitive-testing.cloudfunctions.net/azure-createDirectory` with `{"path":"Processes/<processId>"}`
2. `POST https://us-central1-cognitive-testing.cloudfunctions.net/azure-createDirectory` with `{"path":"Processes/<processId>/Steps"}`
3. `POST https://us-central1-cognitive-testing.cloudfunctions.net/azure-createDirectory` with `{"path":"Processes/<processId>/Steps/0"}`
4. `POST https://us-central1-cognitive-testing.cloudfunctions.net/azure-createTxtFile` with:

```json
{"path":"Processes/<processId>/Steps/0","file":{"name":"Actions.txt","content":"Hello world"}}
```

Captured example:

- Process name: `Tmp-Process-Mapping-20260430-1239`
- Process ID: `4962233`
- All four calls returned `200` + `true`

Notes:

- In this process flow capture, seed text was `Hello world` (lowercase `w`).
- No separate dedicated `tests-createProcess` endpoint appeared in XHR/fetch for this action.

## Latest verified run

Command:

- `python "scripts/tmp_cognitive_probe.py"`

Verified statuses in that run:

- `apps-createApp`: `200`
- `apps-getAdminAppsAndSuites`: `200`
- `tests-getMyProcesses`: `200`
- `azure-createDirectory` (x3): `200`
- `azure-createTxtFile`: `200`
