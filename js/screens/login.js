/* ============================================
   Sonance — Login Screen
   ============================================ */

var LoginScreen = (function() {
    'use strict';

    var el = SonanceUtils.el;
    var $ = SonanceUtils.$;
    var log = SonanceUtils.log;
    var createSvg = SonanceUtils.createSvg;
    var SVG_PATHS = SonanceUtils.SVG_PATHS;

    var _container = null;
    var _onLoginSuccess = null;
    var _errorEl = null;
    var _btnEl = null;
    var _fields = {};

    // S-wave logo SVG — enlarged paths (P4.3: fill 70-80% of viewBox)
    function _createLogoSvg() {
        var ns = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        var paths = [
            { d: 'M15.5,4 A7,7 0 0,0 8.5,9', sw: '2.4', o: '0.95' },
            { d: 'M8.5,9 A7,7 0 0,1 15.5,14', sw: '2.4', o: '0.95' },
            { d: 'M15.5,14 A7,7 0 0,0 8.5,19', sw: '2.4', o: '0.2' },
            { d: 'M18,5 Q20.5,7.5 18,10', sw: '1.6', o: '0.5' },
            { d: 'M20,3.5 Q23.5,7.5 20,11.5', sw: '1.3', o: '0.3' },
            { d: 'M6,10 Q3.5,12 6,14', sw: '1.6', o: '0.5' },
            { d: 'M4,8.5 Q0.5,12 4,15.5', sw: '1.3', o: '0.3' }
        ];
        paths.forEach(function(p) {
            var path = document.createElementNS(ns, 'path');
            path.setAttribute('d', p.d);
            path.setAttribute('stroke', 'white');
            path.setAttribute('stroke-width', p.sw);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('opacity', p.o);
            svg.appendChild(path);
        });
        return svg;
    }

    function render(container, onLoginSuccess) {
        _container = container;
        _onLoginSuccess = onLoginSuccess;

        var screen = el('div', { className: 'login-screen' });

        var card = el('div', { className: 'login-card' });

        // Logo
        var logo = el('div', { className: 'login-logo' });
        var logoIcon = el('div', { className: 'login-logo-icon' });
        var logoSvg = _createLogoSvg();
        logoSvg.style.width = SonanceUtils.rem(30);
        logoSvg.style.height = SonanceUtils.rem(30);
        logoIcon.appendChild(logoSvg);
        logo.appendChild(logoIcon);
        logo.appendChild(el('div', { className: 'login-logo-title' }, 'Sonance'));
        logo.appendChild(el('div', { className: 'login-logo-subtitle' }, 'BY SIMMO'));
        card.appendChild(logo);

        // Server URL + Port row
        var serverRow = el('div', { className: 'login-server-row' });

        var serverField = el('div', { className: 'login-field' });
        serverField.appendChild(el('label', { for: 'login-server' }, 'Server URL'));
        _fields.server = el('input', {
            type: 'text',
            id: 'login-server',
            placeholder: 'Server address (e.g. 192.168.0.1)',
            value: '',
            tabindex: '1',
            className: 'focusable'
        });
        serverField.appendChild(_fields.server);
        serverRow.appendChild(serverField);

        var portField = el('div', { className: 'login-field' });
        portField.appendChild(el('label', { for: 'login-port' }, 'Port'));
        _fields.port = el('input', {
            type: 'text',
            id: 'login-port',
            placeholder: 'Port (e.g. 4533)',
            value: '',
            tabindex: '2',
            className: 'focusable'
        });
        portField.appendChild(_fields.port);
        serverRow.appendChild(portField);

        card.appendChild(serverRow);

        // Username
        var userField = el('div', { className: 'login-field' });
        userField.appendChild(el('label', { for: 'login-username' }, 'Username'));
        _fields.username = el('input', {
            type: 'text',
            id: 'login-username',
            placeholder: 'Your username',
            tabindex: '3',
            className: 'focusable'
        });
        userField.appendChild(_fields.username);
        card.appendChild(userField);

        // Password
        var passField = el('div', { className: 'login-field' });
        passField.appendChild(el('label', { for: 'login-password' }, 'Password'));
        _fields.password = el('input', {
            type: 'password',
            id: 'login-password',
            placeholder: 'Your password',
            tabindex: '4',
            className: 'focusable'
        });
        passField.appendChild(_fields.password);
        card.appendChild(passField);

        // Connect button
        _btnEl = el('button', {
            className: 'login-btn focusable',
            tabindex: '5',
            onClick: function() { _handleLogin(); }
        }, 'Connect');

        // V3-6-fix NAV-4: Up AND Left both retreat to the Password field.
        _btnEl.addEventListener('keydown', function(e) {
            if (e.keyCode === 38 || e.keyCode === 37) { // Up or Left
                e.preventDefault();
                _fields.password.focus();
            }
        });

        card.appendChild(_btnEl);

        // Error area
        _errorEl = el('div', { className: 'login-error' });
        card.appendChild(_errorEl);

        screen.appendChild(card);
        container.appendChild(screen);

        // P1: Input field navigation for Tizen IME compatibility
        // Field order: server → port → username → password
        var inputFields = [_fields.server, _fields.port, _fields.username, _fields.password];

        inputFields.forEach(function(input, index) {
            // Enter/Done: advance to next field, or submit on last field
            input.addEventListener('keydown', function(e) {
                if (e.keyCode === 13) { // Enter / Done from IME
                    e.preventDefault();
                    e.stopPropagation();
                    input.blur();
                    if (index < inputFields.length - 1) {
                        inputFields[index + 1].focus();
                    } else {
                        _handleLogin();
                    }
                }
                // V3-6-fix NAV-4: Down OR Right advance to the next field
                // (or to the Connect button on the last field). Always
                // intercept regardless of caret position — explicit user
                // request: "Down/Right identical, Up/Left identical".
                if (e.keyCode === 40 || e.keyCode === 39) { // Down or Right
                    e.preventDefault();
                    input.blur();
                    if (index < inputFields.length - 1) {
                        inputFields[index + 1].focus();
                    } else {
                        if (typeof FocusManager !== 'undefined') {
                            FocusManager.setInputMode(false);
                        }
                        var connectBtn = document.querySelector('.login-btn');
                        if (connectBtn) {
                            connectBtn.focus();
                        }
                    }
                }
                // V3-6-fix NAV-4: Up OR Left retreat to the previous field.
                if ((e.keyCode === 38 || e.keyCode === 37) && index > 0) {
                    e.preventDefault();
                    input.blur();
                    inputFields[index - 1].focus();
                }
                // Escape: blur input to return to FocusManager
                if (e.keyCode === 27 || e.keyCode === 10009) {
                    e.preventDefault();
                    input.blur();
                }
            });

            // Sync FocusManager input mode on focus/blur
            input.addEventListener('focus', function() {
                if (typeof FocusManager !== 'undefined') {
                    FocusManager.setInputMode(true);
                }
            });
            input.addEventListener('blur', function() {
                if (typeof FocusManager !== 'undefined') {
                    FocusManager.setInputMode(false);
                }
            });
        });

        log('Login', 'Login screen rendered');
    }

    // P15d: ensure the server address has a protocol before we build a URL —
    // fetch() rejects "192.168.0.2:4534/..." as unparseable.
    function _normaliseServerUrl(url) {
        url = (url || '').trim();
        if (url && url.indexOf('://') === -1) {
            url = 'http://' + url;
        }
        if (url.charAt(url.length - 1) === '/') {
            url = url.substring(0, url.length - 1);
        }
        return url;
    }

    function _handleLogin() {
        var server = _fields.server.value.trim();
        var port = _fields.port.value.trim();
        var username = _fields.username.value.trim();
        var password = _fields.password.value;

        // Clear previous error
        _hideError();

        // Validation
        if (!server) {
            _showError('Please enter a server URL');
            _fields.server.focus();
            return;
        }
        if (!username) {
            _showError('Please enter a username');
            _fields.username.focus();
            return;
        }
        if (!password) {
            _showError('Please enter a password');
            _fields.password.focus();
            return;
        }

        // Build full server URL — normalise first so user can omit http://
        var serverUrl = _normaliseServerUrl(server);
        if (port) {
            serverUrl = serverUrl + ':' + port;
        }

        // Set loading state
        _btnEl.textContent = 'Connecting...';
        _btnEl.disabled = true;

        AuthManager.login(serverUrl, username, password).then(function() {
            log('Login', 'Login successful, transitioning to app');
            if (_onLoginSuccess) {
                _onLoginSuccess();
            }
        }).catch(function(err) {
            var msg = err.message || 'Connection failed';
            if (msg.indexOf('timed out') !== -1) {
                msg = 'Connection timed out. Check the server address and ensure Navidrome is running.';
            } else if (msg.indexOf('Failed to fetch') !== -1 || msg.indexOf('NetworkError') !== -1) {
                msg = 'Cannot reach server. Check the address and your network connection.';
            } else if (msg.indexOf('Wrong username or password') !== -1) {
                msg = 'Wrong username or password.';
            }
            _showError(msg);
            _btnEl.textContent = 'Connect';
            _btnEl.disabled = false;
        });
    }

    function _showError(message) {
        _errorEl.textContent = message;
        _errorEl.className = 'login-error visible';
    }

    function _hideError() {
        _errorEl.textContent = '';
        _errorEl.className = 'login-error';
    }

    function activate() {
        // Pre-fill from stored credentials if available
        var creds = AuthManager.getCredentials();
        if (creds.serverUrl) {
            var parts = creds.serverUrl.split(':');
            if (parts.length === 3) {
                // http://host:port
                _fields.server.value = parts[0] + ':' + parts[1];
                _fields.port.value = parts[2];
            } else {
                _fields.server.value = creds.serverUrl;
            }
        }
        if (creds.username) {
            _fields.username.value = creds.username;
        }

        // Focus username if server is pre-filled, otherwise focus server
        if (_fields.server.value && _fields.username.value) {
            _fields.password.focus();
        } else if (_fields.server.value) {
            _fields.username.focus();
        } else {
            _fields.server.focus();
        }
    }

    function deactivate() {
        if (_container) {
            _container.textContent = '';
        }
    }

    return {
        render: render,
        activate: activate,
        deactivate: deactivate
    };
})();
