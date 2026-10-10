/* ============================================
   Sonance — Auth Manager
   ============================================ */

var AuthManager = (function() {
    'use strict';

    var log = SonanceUtils.log;
    var error = SonanceUtils.error;

    var KEYS = {
        SERVER_URL: 'sonance_server_url',
        USERNAME: 'sonance_username',
        PASSWORD: 'sonance_password',
        LOGGED_IN: 'sonance_logged_in',
        SELECTED_LIBRARIES: 'sonance_selected_libraries',
        // v3.13 (P5, D200): the Jellyfin session. No BACKEND means Subsonic,
        // so a 3.12 session is untouched. Logout removes them with the rest.
        BACKEND: 'sonance_backend',
        JF_TOKEN: 'sonance_jf_token',
        JF_USER_ID: 'sonance_jf_user_id',
        JF_SERVER_VERSION: 'sonance_jf_server_version'
    };

    // Kept at logout, like the auth salt: one device entry on the Jellyfin
    // server per install (a second sign-in from one device id revokes that
    // device's previous token, 12.x).
    var JF_DEVICE_ID = 'sonance_jf_device_id';

    var _apiInstance = null;

    // V3.8: parse the persisted library selection. Returns an array of ids
    // or null (= "all libraries"). Bad JSON / missing key both fall through
    // to null so the user always boots into the safe "show everything" path.
    function _readSelectedLibraries() {
        try {
            var raw = localStorage.getItem(KEYS.SELECTED_LIBRARIES);
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            if (!parsed || !Array.isArray(parsed) || parsed.length === 0) return null;
            return parsed;
        } catch (e) {
            return null;
        }
    }

    // V3.7-fix14: in-memory mirror of credentials so hot callsites avoid
    // hitting localStorage every time. Populated once at module init and
    // updated write-through by login/logout.
    var _creds = {
        serverUrl: localStorage.getItem(KEYS.SERVER_URL) || '',
        username: localStorage.getItem(KEYS.USERNAME) || '',
        password: localStorage.getItem(KEYS.PASSWORD) || '',
        loggedIn: localStorage.getItem(KEYS.LOGGED_IN) === 'true',
        selectedLibraries: _readSelectedLibraries(),
        backend: localStorage.getItem(KEYS.BACKEND) || '',
        jfToken: localStorage.getItem(KEYS.JF_TOKEN) || '',
        jfUserId: localStorage.getItem(KEYS.JF_USER_ID) || '',
        jfVersion: localStorage.getItem(KEYS.JF_SERVER_VERSION) || ''
    };

    function _safeSet(key, value) {
        try { localStorage.setItem(key, value); }
        catch (e) { /* quota — silently swallow */ }
    }

    function isLoggedIn() {
        return _creds.loggedIn;
    }

    function getCredentials() {
        // Return a copy so callers can't mutate the mirror.
        return {
            serverUrl: _creds.serverUrl,
            username: _creds.username,
            password: _creds.password
        };
    }

    // --- Jellyfin (v3.13 R1-R3) ---------------------------------------------

    function _jellyfinDeviceId() {
        try {
            var id = localStorage.getItem(JF_DEVICE_ID);
            if (id) return id;
            id = 'sonance-' + SonanceUtils.generateSalt(24);
            localStorage.setItem(JF_DEVICE_ID, id);
            return id;
        } catch (e) {
            return 'sonance-' + SonanceUtils.generateSalt(24);
        }
    }

    // The adapter reports a new token (a sign-in, R3's silent re-login) and
    // the server version (each ping); they are kept here.
    function _onJellyfinSession(fields) {
        if (fields.token) {
            _safeSet(KEYS.JF_TOKEN, fields.token);
            _creds.jfToken = fields.token;
        }
        if (fields.userId) {
            _safeSet(KEYS.JF_USER_ID, fields.userId);
            _creds.jfUserId = fields.userId;
        }
        if (fields.version) {
            _safeSet(KEYS.JF_SERVER_VERSION, fields.version);
            _creds.jfVersion = fields.version;
        }
    }

    function _jellyfinApi(serverUrl, username, password, token, userId) {
        return new JellyfinAPI({
            serverUrl: serverUrl,
            username: username,
            password: password,
            token: token,
            userId: userId,
            deviceId: _jellyfinDeviceId(),
            onSession: _onJellyfinSession,
            selectedLibraries: getSelectedLibraries
        });
    }

    // P3: what a Subsonic login fails with on a server that is not one
    // (Jellyfin answers /rest/ping.view with a 404).
    function _notSubsonic(err) {
        var msg = (err && err.message) || '';
        return !!err && (err.name === 'SyntaxError' || msg.indexOf('Server returned HTTP 404') !== -1 ||
            msg.indexOf('Invalid response from server') !== -1);
    }

    function _clearJellyfinSession() {
        [KEYS.BACKEND, KEYS.JF_TOKEN, KEYS.JF_USER_ID, KEYS.JF_SERVER_VERSION].forEach(function(k) {
            try { localStorage.removeItem(k); } catch (e) { /* ignore */ }
        });
        _creds.backend = '';
        _creds.jfToken = '';
        _creds.jfUserId = '';
        _creds.jfVersion = '';
    }

    function _loginJellyfin(serverUrl, username, password, info) {
        var api = _jellyfinApi(serverUrl, username, password, '', '');
        return api.signIn().then(function(session) {
            _safeSet(KEYS.SERVER_URL, serverUrl);
            _safeSet(KEYS.USERNAME, username);
            _safeSet(KEYS.PASSWORD, password);
            _safeSet(KEYS.LOGGED_IN, 'true');
            _safeSet(KEYS.BACKEND, 'jellyfin');
            _onJellyfinSession({ token: session.token, userId: session.userId, version: info.Version });

            _creds.serverUrl = serverUrl;
            _creds.username = username;
            _creds.password = password;
            _creds.loggedIn = true;
            _creds.backend = 'jellyfin';
            _apiInstance = api;

            log('Auth', 'Login successful (Jellyfin)');
            return { ok: true };
        });
    }

    function login(serverUrl, username, password) {
        log('Auth', 'Attempting login to ' + serverUrl + ' as ' + username);

        // Normalize server URL — strip trailing slashes
        serverUrl = serverUrl.replace(/\/+$/, '');

        // v3.13 (P3, R2): an empty password can only be a Jellyfin account.
        // Probe first; anything else is "Please enter a password", with no
        // Subsonic request.
        if (!password) {
            return JellyfinAPI.probe(serverUrl).then(function(info) {
                if (!info) {
                    var needPassword = new Error('Please enter a password');
                    needPassword.needPassword = true;
                    throw needPassword;
                }
                return _loginJellyfin(serverUrl, username, password, info);
            });
        }

        var api = new SubsonicAPI({
            serverUrl: serverUrl,
            username: username,
            password: password
        });

        return api.ping().then(function() {
            // Store credentials
            _safeSet(KEYS.SERVER_URL, serverUrl);
            _safeSet(KEYS.USERNAME, username);
            _safeSet(KEYS.PASSWORD, password);
            _safeSet(KEYS.LOGGED_IN, 'true');

            // Mirror in memory.
            _creds.serverUrl = serverUrl;
            _creds.username = username;
            _creds.password = password;
            _creds.loggedIn = true;

            // Cache API instance
            _apiInstance = api;
            // v3.13: a Jellyfin session left by a failed boot is not this one.
            _clearJellyfinSession();

            log('Auth', 'Login successful');
            return { ok: true };
        }, function(err) {
            // v3.13 (P3): not a Subsonic server? A Jellyfin one signs in;
            // anything else keeps the Subsonic error. Wrong credentials, a
            // timeout or an unreachable server never get here.
            if (!_notSubsonic(err)) throw err;
            return JellyfinAPI.probe(serverUrl).then(function(info) {
                if (!info) throw err;
                return _loginJellyfin(serverUrl, username, password, info);
            });
        });
    }

    function logout() {
        log('Auth', 'Logging out');
        // V3.7-fix6: drop the API localStorage cache for this user before we
        // wipe the credentials (the cache key uses username + serverUrl).
        var creds = getCredentials();
        if (typeof SubsonicAPI !== 'undefined' && SubsonicAPI.clearLocalCache) {
            SubsonicAPI.clearLocalCache(creds.username, creds.serverUrl);
        }
        // V3.9 T4/T8: the in-memory response cache is module-global and
        // survived logout, so within the 5-minute TTL the next user was served
        // this user's library (reproduced on the mock rig). Drop it, stop
        // paying for anything still on the wire, and drop the decoded cover
        // URLs, which carry this identity's auth params.
        //
        // NOTE the auth salt is deliberately NOT cleared: it lives under
        // sonance_authsalt_v1__ and persisting it is what keeps previously
        // cached cover art addressable across a login (v3.9 decision D2).
        if (typeof SubsonicAPI !== 'undefined') {
            if (SubsonicAPI.abortAll) SubsonicAPI.abortAll();
            if (SubsonicAPI.clearCache) SubsonicAPI.clearCache();
        }
        // v3.13 (R3): revoke the Jellyfin token, best effort and not awaited;
        // after abortAll, so it is not cancelled with the rest.
        if (_creds.backend === 'jellyfin') {
            var jf = getApi();
            if (jf && jf.endSession) jf.endSession();
        }
        if (typeof ImageCache !== 'undefined' && ImageCache.clear) {
            ImageCache.clear();
        }
        Object.keys(KEYS).forEach(function(key) {
            localStorage.removeItem(KEYS[key]);
        });
        // Reset in-memory mirror.
        _creds.serverUrl = '';
        _creds.username = '';
        _creds.password = '';
        _creds.loggedIn = false;
        _creds.selectedLibraries = null;
        _creds.backend = '';
        _creds.jfToken = '';
        _creds.jfUserId = '';
        _creds.jfVersion = '';
        _apiInstance = null;
        if (typeof StarredCache !== 'undefined') {
            StarredCache.clear();
        }
    }

    // V3.8: getter returns the in-memory mirror (array or null).
    function getSelectedLibraries() {
        return _creds.selectedLibraries;
    }

    // V3.8: setter accepts array or null. Empty array is treated as null
    // ("all libraries") so that path stays the cheap unfiltered path.
    function setSelectedLibraries(ids) {
        if (!ids || !ids.length) {
            try { localStorage.removeItem(KEYS.SELECTED_LIBRARIES); }
            catch (e) { /* ignore */ }
            _creds.selectedLibraries = null;
            return;
        }
        try {
            _safeSet(KEYS.SELECTED_LIBRARIES, JSON.stringify(ids));
        } catch (e) { /* quota — silently swallow */ }
        _creds.selectedLibraries = ids.slice();
    }

    function getApi() {
        if (_apiInstance) return _apiInstance;

        var creds = getCredentials();
        if (!creds.serverUrl || !creds.username) {
            return null;
        }

        // v3.13 (R1): the backend the session was made on.
        if (_creds.backend === 'jellyfin') {
            _apiInstance = _jellyfinApi(creds.serverUrl, creds.username, creds.password, _creds.jfToken, _creds.jfUserId);
            return _apiInstance;
        }

        _apiInstance = new SubsonicAPI(creds);
        return _apiInstance;
    }

    // v3.13 (R1, R11): 'jellyfin' or 'subsonic', and Jellyfin's version.
    function getBackend() {
        return _creds.backend === 'jellyfin' ? 'jellyfin' : 'subsonic';
    }

    function getServerVersion() {
        return _creds.jfVersion;
    }

    function getServerDisplay() {
        return _creds.serverUrl.replace(/^https?:\/\//, '');
    }

    function getUsername() {
        return _creds.username;
    }

    return {
        isLoggedIn: isLoggedIn,
        getCredentials: getCredentials,
        login: login,
        logout: logout,
        getApi: getApi,
        getBackend: getBackend,
        getServerVersion: getServerVersion,
        getServerDisplay: getServerDisplay,
        getUsername: getUsername,
        getSelectedLibraries: getSelectedLibraries,
        setSelectedLibraries: setSelectedLibraries
    };
})();
