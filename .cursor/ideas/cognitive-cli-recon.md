# Cognitive Testing - API / UI reconnaissance (CLI groundwork)

**Date:** 2026-04-10 (supplemented **2026-04-11** with password-chain and RTDB research)  
**Scope:** [Cognitive Testing](https://cognitivetesting.online/) SPA, HTTP APIs on `us-central1-cognitive-testing.cloudfunctions.net`, Firebase auth, Azure-backed file APIs.  
**Method:** Chrome DevTools MCP (network + DOM), live UI flows, static analysis of shipped `main.*.chunk.js`, scripted API probes (local only; no secrets in this file).

---

## CLI scope at a glance

This doc is recon for a future **`cognitive`-style CLI** (not shipped here). Below is what you can implement **with high confidence** versus what still needs work or verification.

### Grounded today (enough detail to build)

| Area | Capability |
|------|----------------|
| **Auth (email + password)** | `signInWithPassword` with **automation-1713b** web API key, then `auth-generateToken` + cognitive `verifyCustomToken` to obtain the **cognitive** `id_token` used by Cloud Functions; **refresh** via `securetoken.googleapis.com` with **cognitive** key + cognitive `refresh_token`. See **Headless email + password** and **API calls after auth**. |
| **List apps and suites** | `GET apps-getAdminAppsAndSuites?email=...` with cognitive `Authorization` token; response shape documented in **Supplement**. |
| **List / link processes** | `GET tests-getMyProcesses?mail=...` with same token; `Apps` / `Suites` string arrays documented in **Supplement**. |
| **Push / pull / list process files** | `azure-createTxtFile`, `azure-getTxtFile`, `azure-listFilesAndDirectories` under `Processes/{id}/Steps/{n}`; prior art: `resources/cli-tools/sync_actions_to_cognitive.py` (push + list + optional AppUsage) and `resources/cli-tools/fetch_actions_from_cognitive.py` (pull `Actions.txt`). Headers today are mainly `Origin` + JSON body; see **File sync** and Azure notes. |
| **Public Firebase keys** | All `AIzaSy...` client keys from `main.c532a256.chunk.js` and how they are used are in **Public Firebase web API keys**. |

### Likely next (documented shape; confirm with one live call)

| Area | Notes |
|------|--------|
| **`apps-createApp`** | Request/response captured; **cognitive** `id_token` expected same as listings (not re-hit in probes to avoid junk apps). |
| **`tests-getSearchBy`** | POST body pattern from bundle; `type` enum and full response need one capture. |
| **Other `tests-*` / `azure-*` names** | Listed in **Cloud Functions inventory**; per-call auth and JSON schema not all captured. |

### Remaining / harder

| Area | Notes |
|------|--------|
| **Create suite (UI parity)** | After naming, the SPA updates **Firebase** (`ra.g` / RTDB / Firestore) **and** Azure. **Azure-only** steps are documented; **metadata** parity requires duplicating **`ra.g`** writes or the **RTDB REST** path (bundle uses `?auth=` secret shipped in JS -- weak; see **New suite** in **Supplement**). |
| **Create app (full parity)** | HTTP `apps-createApp` plus **RTDB** `Area` / `Process` / `Apps` pattern in **New app**; single HAR still useful. |
| **Azure calls and auth** | Some captures showed **no** `Authorization` on `azure-createDirectory` / `azure-createTxtFile`; treat as **unconfirmed** for CLI (may be origin-only, IAM, or omitted in DevTools). |
| **Microsoft / OAuth-only users** | UI supports **Login with Microsoft**; headless flow not documented here. |
| **Full contract matrix** | Phase 0 HAR across login, create, list, save still recommended in **Plan**. |

---

## Security and secrets

- **Do not commit passwords, ID tokens, refresh tokens, service credentials, or `.env`** to the repo. Use environment variables or OS secret stores for a future CLI; keep local `.env` out of version control.
- **Email/password login was captured (2026-04-10)** after signing out, using Chrome DevTools MCP against a fresh navigation to `https://cognitivetesting.online/`. Use the same flow only with **test** accounts and secrets that are not committed.
- If credentials appear in **chat logs, CI output, or shared captures**, treat them as exposed: **rotate the password** per policy and prefer SSO / short-lived tokens where possible.
- Firebase **Web API keys** are **public client config** (also present in the shipped bundle and in Identity Toolkit `?key=` query params). They are **not** server secrets, but avoid scattering them in tickets; refer to “primary Cognitive Firebase key” vs “secondary project key” in prose when enough.
- The SPA also references **Firebase Realtime Database REST** URLs with an **`auth=` query** parameter. That value is **shipped inside `main.*.chunk.js`** (client-side). Treat it as **exposed**; do not rely on it for secrecy. Prefer user-scoped tokens where possible.

---

## Headless email + password: what actually works (2026-04-11)

The UI’s email/password box maps to Firebase **password sign-in against the `automation-1713b` project**, **not** against the `cognitive-testing` web API key:

| API key (prefix) | Project (inferred) | `signInWithPassword` / `verifyPassword` with real user password |
|--------------------|--------------------|---------------------------------------------------------------------|
| `AIzaSyAAA1Ov40...` | **automation-1713b** | **Works** – returns `idToken`, `refreshToken`, etc. |
| `AIzaSyBhs_Z3...` | **cognitive-testing** | **`PASSWORD_LOGIN_DISABLED`** |
| Other keys in bundle | varies | `EMAIL_NOT_FOUND` / `INVALID_PASSWORD` for the same test user |

So an earlier probe that only tried the **cognitive-testing** key was **misleading** for “can the CLI use password?”: you must use the **automation** key for the initial password sign-in (same as exposed in the client bundle).

**Minimal chain to obtain a Cloud-Functions-friendly ID token (verified end-to-end):**

1. **`POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<automation web API key>`**  
   - Body: `{"email":"...","password":"...","returnSecureToken":true}`  
   - Yields **`idToken` A** (automation). **This token alone is *not* accepted** by `apps-getAdminAppsAndSuites` (**401 Invalid auth** in probe).

2. **`POST https://us-central1-cognitive-testing.cloudfunctions.net/auth-generateToken`**  
   - Headers: `Content-Type: text/plain`, `Origin: https://cognitivetesting.online`, **`Authorization: <same automation web API key>`** (not Bearer user JWT).  
   - Body (JSON as UTF-8 text): `{"uid":"<email>"}`  
   - Response: **raw custom JWT string** (not JSON).

3. **`POST https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyCustomToken?key=<cognitive-testing web API key>`**  
   - Body: `{"token":"<custom JWT from step 2>","returnSecureToken":true}`  
   - Yields **`idToken` B** (cognitive-testing) + **`refreshToken` B**.

4. Use **`idToken` B** as **`Authorization`** on **`apps-getAdminAppsAndSuites`** / **`tests-getMyProcesses`** (same headers as in the supplement below) → **HTTP 200** in probe.

**Refresh without re-entering password (verified):**

- Use **`refreshToken` B** with **`POST https://securetoken.googleapis.com/v1/token?key=<cognitive-testing web API key>`** and form body `grant_type=refresh_token&refresh_token=...`.  
- **Fails** with `PROJECT_NUMBER_MISMATCH` if you mistakenly use the **automation** API key here.  
- **Succeeds** with the **cognitive-testing** API key → new `id_token` for Cloud Functions.

**CLI takeaway:** Store **`refreshToken` B** + **cognitive web API key** for refresh; re-run steps 2–3 if the custom-token path expires or policy changes.

---

## Chrome DevTools MCP: capturing login from zero

Use the **user-chrome-devtools** MCP (or manual DevTools Network) with a **clean navigation** so the request list resets (`list_network_requests` is “since the last navigation”).

1. **`navigate_page`** `type=url`, `url=https://cognitivetesting.online/`, optional `ignoreCache=true`.  
2. **`wait_for`** text such as `Log in`, `Email`, or `Password`.  
3. **`take_snapshot`** and note `uid` values for the **Email** and **Password** textboxes and the **Login** button.  
4. **`fill`** email and password (from a local secret store / `.env`, not from this doc).  
5. **`click`** **Login**; **`wait_for`** `Signed in as` or `APPS`.  
6. **`list_network_requests`** with `resourceTypes`: `xhr`, `fetch`, and optionally `preflight`.  
7. **`get_network_request`** with `reqid` for each step you need to document (redact bodies that contain passwords or long JWTs in notes you share).

**Unauthenticated login screen (observed):**

- Heading **Log in**; **Email** and **Password** fields; primary **Login** button.  
- **Forgotten password?** link.  
- **Login with Microsoft** (alternate provider).  
- **Don't have an account? Sign up**.  
- Hero image from Firebase Storage under the `cognitive-testing` bucket (marketing asset URL in Network tab if needed).

---

## High-level architecture

| Layer | Role |
|--------|------|
| `https://cognitivetesting.online` | React (or similar) SPA; routes include `/`, `/suites`, `/actions` (client-side context selects app/suite/process). |
| `https://www.googleapis.com/identitytoolkit/v3/relyingparty/*` | Firebase Identity Toolkit: `getAccountInfo`, `verifyCustomToken`, etc. |
| `https://us-central1-cognitive-testing.cloudfunctions.net/*` | Primary HTTPS API for apps, Azure file ops, tests, parsing, and custom token issuance. |
| `https://us-central1-automation-1713b.cloudfunctions.net/*` | Separate analytics endpoint (see existing `sync_actions_to_cognitive.py`). |
| Firebase Realtime Database hosts | Present in `localStorage` (e.g. `cognitive-testing`, `automation-1713b`, `stk-readers-575dd`). Much **app/suite metadata** likely syncs here rather than only via REST. |
| Azure (via Cloud Functions) | Process files live under paths like `Processes/{processId}/Steps/{stepIndex}/`. |

---

## Auth flow (observed)

### A. Cold start: email + password (Firebase Identity Toolkit)

After **Login** on a signed-out session, XHR/fetch order was:

| Step | Method | Endpoint / host | Role |
|------|--------|-----------------|------|
| 1 | POST | Identity Toolkit **password** sign-in (e.g. `signInWithPassword` or `verifyPassword`) with **`automation-1713b` web API key** | Primary **email/password** check (see **Headless email + password** above). **Not** the cognitive-testing key (that returns `PASSWORD_LOGIN_DISABLED`). |
| 2 | POST | `getAccountInfo` (automation key) | Account metadata. |
| 3 | POST | `https://us-central1-cognitive-testing.cloudfunctions.net/auth-generateToken` | Backend **custom JWT** for the next step (`Authorization` header = **automation** web API key; body `{"uid":email}`). |
| 4 | POST | `verifyCustomToken` with **`cognitive-testing` web API key** | Produces **cognitive** `idToken` / `refreshToken` used for many Cloud Functions. |
| 5+ | POST | `getAccountInfo`, `auth-generateTokenFridaAdmin`, `verifyCustomToken` (third key), etc. | Frida-admin Firebase project bootstrap (third-party token); **`apps-getAdminAppsAndSuites` still returned 401** when probed with only the third-project `idToken` — use **cognitive** token from step 4 for those listings. |

**`verifyPassword` (step 1) – request shape:**

- **Headers:** `content-type: application/json`, `origin: https://cognitivetesting.online`, Firebase client markers (`x-client-version: Chrome/JsCore/...`).  
- **Body:** `{"email":"<email>","password":"<password>","returnSecureToken":true}`.  
- **Response (JSON):** `idToken`, `refreshToken`, `expiresIn`, `localId`, `email`, `displayName`, etc. (standard Identity Toolkit).  
- **CLI analogue:** **`accounts:signInWithPassword`** (REST v1) or **`verifyPassword`** (v3) with the **automation-1713b** `?key=` (this tenant allows password on that project).

**`PASSWORD_LOGIN_DISABLED` on cognitive-testing only:** Password sign-in must target the **`automation-1713b`** API key (see **Headless email + password**). OAuth (Google / Microsoft) remains an alternate path in the UI.

**`auth-generateToken` / `auth-generateTokenFridaAdmin`:**

- **Headers:** `content-type: text/plain`, `origin: https://cognitivetesting.online`, **`authorization: <automation web API key>`** (not a user Bearer JWT).  
- **Body (JSON sent as text):** `{"uid":"<user email>"}`.  
- **Response:** Single string custom JWT for `verifyCustomToken` (cognitive key for the first call; third key for Frida-admin).

These Cloud Function calls **follow** successful password sign-in (automation) or OAuth; they bridge into the **cognitive** Firebase session used for several HTTP APIs.

### B. Already signed in (session restore)

If the SPA still has a valid Firebase session, the trace may **omit** `verifyPassword` and start at **`auth-generateToken`** + `verifyCustomToken` chain (as in earlier notes). Treat section A as the **source of truth** for full login.

### C. API calls after auth

Many calls use **`Authorization: <Firebase ID token>`** (Bearer-style JWT string), not the Web API key alone.

**Which ID token for Cloud Functions? (reconciled 2026-04-11)**

| Token source | `apps-getAdminAppsAndSuites` (probe) |
|--------------|--------------------------------------|
| **`idToken` right after `signInWithPassword` (automation key only)** | **401** `Invalid auth.` |
| **`idToken` after `auth-generateToken` + `verifyCustomToken` (cognitive key)** | **200** |
| **`idToken` after Frida-admin `verifyCustomToken` only** | **401** in probe |

In a **long-lived browser session**, IndexedDB may hold an **automation**-labeled row whose access token already reflects post-bootstrap state; for a **CLI**, treat the **cognitive `idToken` from `verifyCustomToken` (cognitive-testing key)** as the one to send to **`apps-getAdminAppsAndSuites`** / **`tests-getMyProcesses`**.

**Staying logged in (refresh) without the browser:**

- After step 4 of **Headless email + password**, persist **`refreshToken`** from the **cognitive** `verifyCustomToken` response.
- **Refresh:** `POST https://securetoken.googleapis.com/v1/token?key=<cognitive-testing web API key>` with form `grant_type=refresh_token&refresh_token=<that refresh token>`.
- **Response (verified 200):** new `id_token` (and rotated `refresh_token`). Using the **automation** API key on this endpoint returns **`PROJECT_NUMBER_MISMATCH`**.

**CLI implication:**

- **Email + password CLI** is viable: **automation** `signInWithPassword` → **`auth-generateToken`** → **cognitive** `verifyCustomToken` → use **cognitive** `id_token` / refresh as above.  
- **OAuth** (Google / Microsoft) remains for users who do not use password.  
- **`PASSWORD_LOGIN_DISABLED` on cognitive-testing** only means “do not call password sign-in with the **cognitive** API key.”

---

## Public Firebase web API keys (`main.c532a256.chunk.js`, 2026-04-11)

These are **client** keys (not secret server keys). Password sign-in for your tenant uses the **automation** row; `PASSWORD_LOGIN_DISABLED` applies when using the **cognitive-testing** key alone.

| Key (full, from bundle) | Typical use in this app (from probes + bundle) |
|-------------------------|--------------------------------------------------|
| `AIzaSyAAA1Ov40AMxbl5waVkjVw0X7AMbxW1-YY` | **automation-1713b** – `signInWithPassword`, `auth-generateToken` `Authorization` header |
| `AIzaSyBhs_Z3-wh659Z39_OfKrTjglZaoAZQ4fE` | **cognitive-testing** – `verifyCustomToken` after `auth-generateToken`, **securetoken refresh** for CF `id_token` |
| `AIzaSyCqaga6fYhgwa_KfasAMFhGSwQ9GDq6UE0` | **Frida-admin** Firebase – third `verifyCustomToken` in chain |
| `AIzaSyDKNFcIsaK0x16ItfolFdHTnsfM6959j44` | Present in bundle (exact call sites vary) |
| `AIzaSyDddpAwa3B1rRogmLiufS2XFWhgKOADZHc` | Present in bundle (exact call sites vary) |

---

## Cloud Functions inventory (from `main.c532a256.chunk.js`)

These string literals are embedded in the production bundle (complete list as of this build):

| Function name | Likely purpose (inferred) |
|----------------|---------------------------|
| `actions-parseString` | Parse automation / action strings |
| `apps-createApp` | Create app |
| `apps-getAdminAppsAndSuites` | List apps and suites for admin UI |
| `auth-createUser` | User provisioning |
| `auth-generateToken` | Issue custom token from email uid |
| `auth-generateTokenFridaAdmin` | Frida admin Firebase custom token |
| `azure-createDirectory` | Create blob path prefix |
| `azure-createTxtFile` | Create/update text file under a path |
| `azure-deleteDirectory` | Delete tree |
| `azure-deleteFile` | Delete file |
| `azure-getTxtFile` | Download text file |
| `azure-getUrl` | SAS or read URL for blob |
| `azure-listFilesAndDirectories` | List folder |
| `azure-uploadFileToAzure` | Upload binary / file |
| `tests-createProductiveTest` | Test lifecycle |
| `tests-createTestInApp` | Test lifecycle |
| `tests-duplicateTest` | Test lifecycle |
| `tests-getMyProcesses` | List processes for user |
| `tests-getSearchBy` | Search |
| `tests-moveTest` | Move test between apps/suites |

**Follow-up:** Grep or bundle-analyze future builds if function names change; confirm each endpoint’s **method, JSON schema, and required auth** with a controlled capture per call.

---

## Captured requests (representative)

### Create app - `apps-createApp`

- **Auth:** Firebase ID JWT in `Authorization` header (expected to be the **cognitive** `idToken` after the same `auth-generateToken` + `verifyCustomToken` chain as listings; not re-probed here to avoid creating junk apps).  
- **Body (observed):**  
  `{"appId": <number>, "nombre": "<display name>", "mail": "<owner email>"}`  
- **Response (observed):** JSON with `ID`, `Name`, `Users`, `usersArray`.  
- **Note:** `appId` in the request matched the created `ID` in the response (client may generate or reserve the id before POST).

### Create suite (new suite wizard) - Azure layout

Observed sequence for a new suite under an app:

1. **POST** `azure-createDirectory` `{"path":"Processes/<processId>"}` -> `true`  
2. **POST** `azure-createDirectory` `{"path":"Processes/<processId>/Steps"}` -> `true`  
3. **POST** `azure-createDirectory` `{"path":"Processes/<processId>/Steps/0"}` -> `true`  
4. **POST** `azure-createTxtFile`  
   `{"path":"Processes/<processId>/Steps/0","file":{"name":"Actions.txt","content":"Hello World"}}` -> `true`

**Important:** In this capture, **`azure-createDirectory` / `azure-createTxtFile` did not include an `Authorization` header** (unlike `apps-createApp`). Validate whether auth is implied by cookies, VPC, Cloud Function IAM, or if the capture omitted headers. **Do not assume these endpoints are unauthenticated** until verified.

**IDs:** `appId` (example: `3825232`) and suite `processId` (example: `5373297`) differ. **`apps-getAdminAppsAndSuites`** exposes the mapping as `suites: { "<processId>": "<suiteName>" }` per app; **`tests-getMyProcesses`** links a process back to app strings `"<appId> - <name>"`.

### File sync (already implemented locally)

The project script `resources/cli-tools/sync_actions_to_cognitive.py` documents and uses:

- **POST** `https://us-central1-cognitive-testing.cloudfunctions.net/azure-createTxtFile`  
- **POST** `https://us-central1-cognitive-testing.cloudfunctions.net/azure-listFilesAndDirectories`  
- **POST** `https://us-central1-automation-1713b.cloudfunctions.net/AppUsage-ScriptChange?auth=...`  

with `Origin: https://cognitivetesting.online` and JSON bodies. This is the best **prior art** for a CLI file-upload path.

---

## Client-side state (observed)

- **`localStorage.arr`:** Large JSON string; appears to hold suite/process objects (e.g. `Steps`, `DateCreated`, tags).  
- **`localStorage.lastID`:** Numeric string (e.g. last selected process id in UI).  
- **`localStorage.clientConfigAdmin`:** Comma-separated admin emails.

A robust CLI should not depend on `localStorage` layout; prefer stable HTTP APIs or official SDK docs if Cognitive publishes them.

---

## UI routes (mental model)

- **`/`** - Apps grid; "New App".  
- **`/suites`** - Suites for the **currently selected app** (breadcrumb shows app name).  
- **`/actions`** - Editor context is driven by selected process/step (direct URL load may bounce to `/` if context missing).

---

## Plan: `cognitive` CLI (for agents and humans)

### Phase 0 - Contract lock-in

1. Capture **one full HAR** per flow on a **clean profile**: login (see **Chrome DevTools MCP** and **Auth flow A** above for the email/password chain), list apps, create app, list suites, create suite, open process, save files, search tests.  
2. For each `.../cloudfunctions.net/*` call, record: **auth headers**, **body schema**, **errors**.  
3. ~~Confirm whether `apps-getAdminAppsAndSuites` returns enough data~~ **Done** (see **Supplement: list APIs** below).

### Phase 1 - MVP commands

Suggested interface (names are illustrative):

```text
cognitive auth login          # email/password via automation signIn + custom-token chain, or OAuth
cognitive auth print-token    # debug; optional
cognitive apps list
cognitive apps create --name "My App"
cognitive suites list --app <appId>
cognitive suites create --app <appId> --name "My Suite"
cognitive process show --id <processId>
cognitive files sync --process <processId> --step <n> --dir <folder>  # wrap sync_actions_to_cognitive.py
```

Implementation sketch:

- **Language:** Python 3.11+ (matches existing tooling) or Go for single binary.  
- **HTTP:** `httpx` or `urllib` with shared client adding `Origin` and `Authorization` where required.  
- **Config:** `~/.config/cognitive/credentials.json` or env: `COGNITIVE_ID_TOKEN` (short-lived) + refresh strategy.

### Phase 2 - Agent-oriented features

- **JSON output** mode on all commands (`--json`) for agents.  
- **Idempotency:** create app/suite with `--if-not-exists` by listing first.  
- **Dry run** (`--dry-run`) mirroring `sync_actions_to_cognitive.py`.  
- **Thin wrapper** around existing upload script to avoid duplicating Azure payload rules.

### Phase 3 - Hardening

- Token refresh and clock skew handling.  
- Rate limiting and retries with backoff on Cloud Functions.  
- Redact tokens in logs; structured logging.  
- Optional: vendor **official** Cognitive API docs if available internally (this doc is reverse-engineered).

---

## Recon artifacts created during this session

- **Test app:** `CLI-Recon-2026-04-10` (app id **3825232** in UI).  
- **Test suite:** `CLI-Recon-Suite-1` with process path **`Processes/5373297/...`** (initial `Actions.txt` content `Hello World`).

You can delete these from the UI if they were only for mapping.

---

## Supplement (2026-04-10): list APIs and data shapes

### `apps-getAdminAppsAndSuites`

- **Method:** `GET`  
- **URL:** `https://us-central1-cognitive-testing.cloudfunctions.net/apps-getAdminAppsAndSuites?email=<url-encoded email>`  
- **Headers:** `Authorization: <cognitive-testing Firebase ID token>` (the one from **`verifyCustomToken` with the cognitive-testing web API key** after `auth-generateToken`; see **Headless email + password**), `Content-Type: text/plain`, `Origin: https://cognitivetesting.online`  
- **Note:** A raw **`signInWithPassword` idToken (automation only)** was **rejected (401)** in an April 2026 probe; do not confuse the two.  
- **Response:** JSON object whose **keys are app IDs** (strings). Each value is an object with at least:
  - **`name`** (string) – app display name  
  - **`suites`** (object) – map **`processId` (string) -> suite display name (string)**  
  - Example entry: `"3825232": { "name": "CLI-Recon-2026-04-10", "suites": { "5373297": "CLI-Recon-Suite-1" } }`  
- **Live check:** HTTP **200**, `appCount` in the tens for the probed account.

### `tests-getMyProcesses`

- **Method:** `GET`  
- **URL:** `https://us-central1-cognitive-testing.cloudfunctions.net/tests-getMyProcesses?mail=<url-encoded email>`  
- **Headers:** Same as above (`Authorization` = **cognitive** ID token after custom-token exchange, `Content-Type: text/plain`, `Origin`).  
- **Response:** JSON object whose **keys are process IDs** (strings). Each value is an object with:
  - **`Apps`** – array of strings like `"<appId> - <appName>"`  
  - **`Suites`** – array of strings like `"<processId> - <suiteName>"` (process id here matches the suite’s process / Azure path id)  
- **Example** for process `5373297`:  
  `Apps: ["3825232 - CLI-Recon-2026-04-10"]`, `Suites: ["5373297 - CLI-Recon-Suite-1"]`  
- **Live check:** HTTP **200**; object size large for active users (hundreds of processes).

### `tests-getSearchBy` (admin search modal)

From `main.c532a256.chunk.js`: **POST** JSON body shaped like  
`{ "arregloProcesos": [<process id strings>], "value": <search term>, "type": <type> }`  
with **`Authorization`** = Firebase ID token (same helper as other admin calls). Used after optionally loading `tests-getMyProcesses` into state.

### New suite: Firebase + Azure (from bundle)

After the user enters a suite name, the SPA roughly:

1. Writes **audit / activity** records via a Firebase helper (`ra.Y`) with `type: "newSuite"`.  
2. Calls internal helper **`ra.g(actionID, suiteName, userID, appId, suitesMap)`** which returns an object containing **`Processes: [<newProcessId>]`** (and likely updates **Firebase RTDB / Firestore** so the new suite appears under the app).  
3. **`POST`** `azure-createDirectory` / `azure-createTxtFile` as already documented (`Processes/<id>/Steps/0`, seed `Hello World` in `Actions.txt`).

**Parallel path (admin / generator UI in same `main` chunk):** Another flow **does not** rely on `ra.g` for scaffolding. It uses **Firebase Realtime Database REST** against **`https://automation-1713b.firebaseio.com/`** with **`?auth=<secret>`** where **`<secret>` is assigned in the client** (`autoKey` / similar in minified code — **do not commit**; extract from bundle if you must mirror behavior). Sequence:

1. Find a free numeric **process id** by polling **`GET .../Process/{id}.json?auth=...`** until empty.  
2. **`GET .../Area/{appId}.json?auth=...`**, append `id` to **`Processes`** array (or create `[id]`), then **`PUT .../Area/{appId}/Processes.json?auth=...`** with JSON array body.  
3. **`PUT .../Process/{id}.json?auth=...`** with process metadata (includes `StepsFRIDA`, `Name`, `ID`, `ProcessIdentifier`, etc. — see bundle slice near `checaID` / `generateScript`).  
4. Same **Azure** directory + **`azure-createTxtFile`** sequence as the main suite wizard.

**Firestore:** Elsewhere the bundle uses **`firestore().collection("Suites").where("Processes","array-contains", ...)`** for cleanup / linkage; full write schema for new suites is not fully spelled out here.

**CLI gap (narrowed):** Either **call the same RTDB REST pattern** (understanding security is **weak** if the `auth` secret is public) or **reverse `ra.g`** / capture its writes. **Listing** is covered by **`apps-getAdminAppsAndSuites`** + **`tests-getMyProcesses`**.

### New app (partial RTDB picture from bundle)

One code path calls `Fe(parseInt(seed),"Area")` and `Fe(o,"Process")`, then:

- **`Area/{appId}.set({ ID, Name, Processes: [processId], Users: [...] })`**  
- **`Process/{processId}.set({ ... default step metadata ... })`**  
- **`Apps/{userKey}/Suites.set(...)`** (updates user app list)

Plus HTTP **`apps-createApp`** may still be required for parity with the UI. Treat **full headless app creation** as **multi-step** until `apps-createApp` + RTDB writes are captured in one HAR.

---

## References

- Web app: [https://cognitivetesting.online/](https://cognitivetesting.online/)  
- Existing local uploader: `resources/cli-tools/sync_actions_to_cognitive.py`  
- Firebase Auth REST (for design comparison): [Google Identity Toolkit REST API](https://cloud.google.com/identity-platform/docs/reference/rest)
