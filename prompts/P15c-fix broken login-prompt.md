You are patching Sonance — a music player app for Samsung Tizen TVs. This is an URGENT fix — login is broken after P15c.

BEFORE WRITING ANY CODE:
1. Read js/api.js — find where the base URL is constructed from the server address and port
2. Read js/screens/login.js — find where the user input is passed to the API client

## THE PROBLEM
After P15c cleared the hardcoded login defaults, login fails with:
```
Failed to execute 'fetch' on 'Window': Failed to parse URL from 192.168.0.2:4534/rest/ping.view?u=REDACTED&...
```

The URL `192.168.0.2:4534/rest/ping.view` is missing the `http://` protocol prefix. The browser/Tizen WebView cannot parse it as a valid URL without the protocol.

Previously the hardcoded default likely included `http://` — now with user input, they naturally type just the IP without the protocol.

## THE FIX

Find where the server URL is assembled (likely in `js/api.js` or `js/screens/login.js`) and add protocol normalisation:

```javascript
function normaliseServerUrl(url) {
    url = url.trim();
    // If user didn't include a protocol, prepend http://
    if (url && url.indexOf('://') === -1) {
        url = 'http://' + url;
    }
    // Remove trailing slash
    if (url.charAt(url.length - 1) === '/') {
        url = url.substring(0, url.length - 1);
    }
    return url;
}
```

Apply this wherever the server URL is first used — either:
- When the login form is submitted (before passing to the API client)
- Or in the API client constructor/init when it receives the server address

Also update the placeholder text to hint that `http://` is optional:
```
placeholder = 'Server address (e.g. 192.168.0.1)'
```

## TESTING
- Type `192.168.0.2` with port `4534` → login succeeds (http:// auto-prepended)
- Type `http://192.168.0.2` with port `4534` → login succeeds (already has protocol)
- Type `https://my.server.com` with port `443` → login succeeds (https preserved)
- Empty fields → shows validation error, doesn't crash

Rebuild Sonance.wgt. Update PROGRESS.md.
