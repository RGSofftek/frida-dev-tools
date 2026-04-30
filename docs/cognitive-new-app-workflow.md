# Cognitive Workflow: Create New App

## Scope

This document maps the "New App" creation workflow from the Cognitive web UI and the network request(s) required to reproduce it in a CLI.

Captured on: 2026-04-30  
Environment: `https://cognitivetesting.online/`  
Actor: authenticated user with admin/write claims

## UI Workflow

1. Open Cognitive home page (Apps list).
2. Click `New App`.
3. In dialog `Enter your App name`, type app name.
4. Click `OK`.
5. Wait for confirmation dialog (`Done` / `App created`).
6. Click `Ok` to close confirmation.
7. New app appears in the Apps list.

## Network Requests Observed

After login/reload, many auth requests are present; the app creation action itself is a single request:

- `POST https://us-central1-cognitive-testing.cloudfunctions.net/apps-createApp` (HTTP 200)

No extra create-specific follow-up request was required to persist the app; list UI updated after success dialog dismissal.

## Required Create-App Request Contract

### Endpoint

- Method: `POST`
- URL: `https://us-central1-cognitive-testing.cloudfunctions.net/apps-createApp`
- Content-Type: `text/plain;charset=UTF-8`
- Origin: `https://cognitivetesting.online`

### Headers

- `authorization: <Firebase ID token with admin/write claims>`
  - Token must represent the logged-in user.
  - Do not hardcode; obtain from the active auth flow.

### Request Body (JSON)

```json
{
  "appId": 6158345,
  "nombre": "Tmp-App-Mapping-20260430-1215",
  "mail": "rodrigo.gracia@softtek.com"
}
```

Field notes:

- `appId`: numeric app identifier chosen by frontend.
- `nombre`: app name from the modal input.
- `mail`: current user email.

### Response Body (200)

```json
{
  "ID": 6158345,
  "Name": "Tmp-App-Mapping-20260430-1215",
  "Users": [
    {
      "mail": "rodrigo.gracia@softtek.com",
      "permisos": "A"
    }
  ],
  "usersArray": [
    "rodrigo.gracia@softtek.com"
  ]
}
```

## Auth Prerequisites (Observed)

Before create-app, session establishes a token chain with calls such as:

- `auth-generateToken`
- `auth-generateTokenFridaAdmin`
- `verifyCustomToken` (Firebase Identity Toolkit)

For CLI implementation, the critical requirement is to send a valid `authorization` token accepted by `apps-createApp`.

## Endpoint: Fetch All Apps

### Endpoint

- Method: `GET`
- URL: `https://us-central1-cognitive-testing.cloudfunctions.net/apps-getAdminAppsAndSuites?email=<url-encoded-email>`

### Required Request Shape

- Header: `Authorization: <raw token>` (no `Bearer ` prefix)
- Query: `email` is required

### Response Shape (200)

The response is an object keyed by app ID, for example:

```json
{
  "1304255": {
    "name": "HEB 2021",
    "suites": {
      "5597412": "Enero",
      "5891085": "Febrero"
    }
  }
}
```

## Behavior Matrix (Iterative Probe)

Observed from live browser token matrix tests:

- `apps-getAdminAppsAndSuites` with automation token (`firebase ... :automation`): `200`
- `apps-getAdminAppsAndSuites` with default token (`firebase ... :[DEFAULT]`): `401 Invalid auth`
- `apps-getAdminAppsAndSuites` with fridaAdmin token (`firebase ... :fridaAdmin`): `401 Invalid auth`
- `apps-getAdminAppsAndSuites` without token: `500 Internal Server Error`
- `apps-getAdminAppsAndSuites` missing `email` query: `400 Invalid parameter(s)`
- `apps-getAdminAppsAndSuites` with `Authorization: Bearer <token>`: `401 Invalid auth`

- `apps-createApp` with automation token + `Content-Type: text/plain;charset=UTF-8`: `200`
- `apps-createApp` with default token: `401 Invalid auth`
- `apps-createApp` with fridaAdmin token: `401 Invalid auth`
- `apps-createApp` without token: `500 Internal Server Error`
- `apps-createApp` with `Content-Type: application/json`: `401 Invalid auth`
- `apps-createApp` missing `mail`: `400 Invalid parameter(s)`

## Validation Checklist for CLI

- Authenticate and obtain the automation token accepted by these endpoints.
- Send `Authorization` as the raw token value (do not prepend `Bearer `).
- Generate/provide a numeric `appId`.
- For create-app, send `Content-Type: text/plain;charset=UTF-8`.
- Send `nombre` and `mail` in request body.
- For list-apps, include `email` query parameter.
- Expect `200` with `ID/Name/Users`.
- Optionally confirm app visible in Apps listing.

## Capture Artifact

Created during mapping:

- App name: `Tmp-App-Mapping-20260430-1215`
- App ID: `6158345`
