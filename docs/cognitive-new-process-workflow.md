# Cognitive Workflow: Create New Process (Inside Suite)

## Scope

This maps the `New Process` flow from inside a suite (`/tests`) and captures the exact network contract observed.

Captured on: 2026-04-30  
Environment: `https://cognitivetesting.online/tests`  
App context: `Tmp-IterProbe-1777573320302`  
Suite context: `Tmp-Suite-Mapping-20260430-1234`  
Created process artifact: `Tmp-Process-Mapping-20260430-1239` (`processId`: `4962233`)

## UI Workflow

1. Open suite processes page (`/tests`).
2. Click `New Process`.
3. Enter process name in `Enter your test name`.
4. Click `OK`.
5. Wait for `Done` / `Test created`.
6. Click `Ok`.
7. New process appears in list with a generated numeric ID.

## Network Sequence Observed

Creation was implemented with the same Azure scaffold pattern used in suite creation.

### 1) Create process root directory

- Method: `POST`
- URL: `https://us-central1-cognitive-testing.cloudfunctions.net/azure-createDirectory`
- Content-Type: `application/json`
- Body:

```json
{"path":"Processes/4962233"}
```

- Response: `true` (HTTP 200)

### 2) Create steps directory

- Method: `POST`
- URL: `https://us-central1-cognitive-testing.cloudfunctions.net/azure-createDirectory`
- Content-Type: `application/json`
- Body:

```json
{"path":"Processes/4962233/Steps"}
```

- Response: `true` (HTTP 200)

### 3) Create initial step folder

- Method: `POST`
- URL: `https://us-central1-cognitive-testing.cloudfunctions.net/azure-createDirectory`
- Content-Type: `application/json`
- Body:

```json
{"path":"Processes/4962233/Steps/0"}
```

- Response: `true` (HTTP 200)

### 4) Seed default actions file

- Method: `POST`
- URL: `https://us-central1-cognitive-testing.cloudfunctions.net/azure-createTxtFile`
- Content-Type: `application/json`
- Body:

```json
{"path":"Processes/4962233/Steps/0","file":{"name":"Actions.txt","content":"Hello world"}}
```

- Response: `true` (HTTP 200)

## Notes

- The process was created and appeared in UI as:
  - Name: `Tmp-Process-Mapping-20260430-1239`
  - ID: `4962233`
- Observed default seed text for process creation in this flow was `Hello world` (lowercase `w`), while suite-level seed previously appeared as `Hello World` in that flow.
- No additional dedicated `tests-createProcess` endpoint appeared in XHR/fetch for this action in this capture.
