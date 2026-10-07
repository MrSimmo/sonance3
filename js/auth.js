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
        SELECTED_LIBRARIES: 'sonance_selected_libraries'
    };

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
        selectedLibraries: _readSelectedLibraries()
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

    function login(serverUrl, username, password) {
        log('Auth', 'Attempting login to ' + serverUrl + ' as ' + username);

        // Normalize server URL — strip trailing slashes
        serverUrl = serverUrl.replace(/\/+$/, '');

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

            log('Auth', 'Login successful');
            return { ok: true };
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

        _apiInstance = new SubsonicAPI(creds);
        return _apiInstance;
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
        getServerDisplay: getServerDisplay,
        getUsername: getUsername,
        getSelectedLibraries: getSelectedLibraries,
        setSelectedLibraries: setSelectedLibraries
    };
})();
