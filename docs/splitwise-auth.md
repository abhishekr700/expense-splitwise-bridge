# Splitwise Authentication & Session Persistence Guide

## 1. Background & The Developer API Paywall

Splitwise placed their official Developer API behind a **Splitwise Pro** subscription paywall. When querying `https://secure.splitwise.com/api/v3.0/` endpoints with standard API keys or developer OAuth tokens, the backend responds with HTTP 403:

```json
{
  "errors": {
    "base": [
      "This app can't access Splitwise right now because its developer doesn't have an active Splitwise Pro subscription. Please contact the app's developer for help."
    ]
  }
}
```

Since the official mobile and web apps still perform read operations without a Pro subscription, we can authenticate as a first-party client rather than a developer third-party app.

---

## 2. Technical Mechanics

### Web Session vs. Mobile Traffic
* **Mobile Traffic (OAuth 1.0a)**: The mobile application uses OAuth 1.0a signed with device secrets and enforces SSL certificate pinning, making proxying via Burp Suite brittle and difficult to maintain.
* **Web Client (`secure.splitwise.com`)**: The desktop web application talks to the **exact same** `/api/v3.0/` backend endpoints (`get_groups`, `get_expenses`, `get_current_user`), but authenticates using standard HTTP session cookies. There is no certificate pinning and no developer API restriction.

### Critical Cookies
1. **`user_credentials`**: A long-lived credential token issued upon login with an explicit multi-month TTL (e.g., ~3 months).
2. **`_splitwise_session`**: An encrypted Rails session cookie containing active session metadata.
3. **`swdid`**: A persistent device/browser identifier cookie valid for decades.

Either `user_credentials` or `_splitwise_session` is sufficient to authorize `/api/v3.0/` calls when accompanied by standard browser headers (`Accept: application/json`, `User-Agent`, `X-Requested-With: XMLHttpRequest`, `Referer: https://secure.splitwise.com/`).

---

## 3. Auto-Renewal & Rolling Expiration

Whenever an authenticated request is made to Splitwise's API, the server sends back a fresh `Set-Cookie` header for `_splitwise_session` with an expiration timestamp set **13 months into the future**.

```http
set-cookie: _splitwise_session=...; expires=Mon, 15 Nov 2027 10:48:57 GMT; path=/; secure; httponly; samesite=lax
```

### How the Importer Automates This
1. **Bootstrapping**: On first launch, the app reads the initial cookie string from `SPLITWISE_COOKIE_PATH` (defaults to `./data/cookies.txt`). If the file does not exist, it falls back to the `SPLITWISE_SESSION_COOKIE` environment variable.
2. **Header Interception**: On every API response, `updateSessionCookieFromHeaders()` checks for incoming `Set-Cookie` headers.
3. **Disk Persistence**: When a refreshed `_splitwise_session` is received, it updates the in-memory string and writes it immediately to `./data/cookies.txt`.
4. **Indefinite Validity**: Because the cron job runs regularly (e.g., every 2 hours), each execution rolls the session forward another 13 months. The session never expires under normal operation.

---

## 4. Docker & Volume Persistence

In containerized environments, writing runtime state to `.env` or container filesystems fails because:
* `.env` is parsed before container startup and cannot be safely mutated.
* Container filesystems are ephemeral across restarts and image rebuilds.
* Containers execute as the non-root `node` user (`USER node`).

### Architecture
* **Volume Mapping**: `docker-compose.yml` mounts the host `./data` folder into `/app/data`:
  ```yaml
  volumes:
    - ./data:/app/data
  environment:
    - SPLITWISE_COOKIE_PATH=/app/data/cookies.txt
    - SPLITWISE_SESSION_COOKIE=${SPLITWISE_SESSION_COOKIE}
  ```
* **Permissions**: The `Dockerfile` creates `/app/data` with `node:node` ownership so the process can write without permission errors.
* **Security**: Both `.gitignore` and `.dockerignore` exclude `data/` so live session tokens are never committed to version control or baked into container images.

---

## 5. How to Bootstrap or Refresh Cookies Manually

If you ever log out of all sessions manually on Splitwise's website and need a fresh cookie:

1. Open your browser and navigate to [https://secure.splitwise.com](https://secure.splitwise.com).
2. Log into your Splitwise account.
3. Open **Developer Tools** (`Cmd + Option + I` or `F12`) and select the **Network** tab.
4. Filter by `Fetch/XHR` and click on any expense or group.
5. Click any request made to `secure.splitwise.com` (e.g., `get_expenses` or `get_groups`).
6. In **Request Headers**, copy the entire value of the `Cookie:` header.
7. Paste this string either into:
   * `./data/cookies.txt` (directly on disk), or
   * `SPLITWISE_SESSION_COOKIE` in your `.env` file.
8. Run `node dumpGroups.js` to verify connectivity. The app will immediately persist and roll the new cookie.
