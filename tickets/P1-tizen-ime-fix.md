# P1 — Fix Login Screen Input Navigation for Tizen IME

## Problem
On Samsung Tizen TVs, when a native `<input>` field is focused, the TV's built-in on-screen keyboard (IME) takes over d-pad events. After typing and pressing "Done" on the IME, the keyboard dismisses but focus remains on the same input field. The up/down d-pad keys then move the cursor within the field (start/end of text) instead of moving to the next field. The app's FocusManager never receives these key events because the IME consumes them.

This makes the login screen unusable on the actual TV — users cannot navigate between Server URL, Port, Username, and Password fields using the remote.

## Root Cause
Tizen's IME intercepts all d-pad input while a native `<input>` is focused. The FocusManager's `keydown` listener on `document` is bypassed entirely.

## Solution
Intercept the Enter/Done key (keyCode 13) on each input field. When fired:
1. Prevent default behaviour
2. Blur the current input (dismisses the IME)
3. Auto-advance focus to the next input field in sequence
4. On the last field (Password), trigger the form submission instead

Additionally, add explicit `focus`/`blur` event listeners on each input to sync the FocusManager state, so that when the IME dismisses, the FocusManager knows which field is active.

## Prerequisites
- Read CLAUDE.md for project rules
- Read PROGRESS.md for current state
- This is a targeted bugfix — do NOT modify any other screens or modules

## Tasks

### P1.1 — Input Field Navigation Chain
In `screens/login.js`, define the field order and wire up Enter key handling:

```javascript
// Field order: serverUrl → port → username → password → submit
var fields = [serverUrlInput, portInput, usernameInput, passwordInput];

fields.forEach(function(input, index) {
    input.addEventListener('keydown', function(e) {
        if (e.keyCode === 13) {  // Enter / Done from IME
            e.preventDefault();
            e.stopPropagation();
            input.blur();  // dismiss the IME

            if (index < fields.length - 1) {
                // Advance to next field
                var nextField = fields[index + 1];
                nextField.focus();
            } else {
                // Last field — trigger connect
                handleConnect();
            }
        }
    });
});
```

### P1.2 — Sync FocusManager with IME State
When a native input receives browser focus (user taps into it or IME opens), update the FocusManager so it knows which element is focused:

```javascript
fields.forEach(function(input, index) {
    input.addEventListener('focus', function() {
        // Tell FocusManager this input is now focused
        // Disable FocusManager d-pad handling while IME is active
        if (window.focusManager) {
            window.focusManager.setInputMode(true);
        }
    });

    input.addEventListener('blur', function() {
        // Re-enable FocusManager d-pad handling
        if (window.focusManager) {
            window.focusManager.setInputMode(false);
        }
    });
});
```

### P1.3 — FocusManager Input Mode
In `focus.js`, add an input mode flag that suppresses d-pad handling when a native input has focus:

- Add `this._inputMode = false` to FocusManager constructor
- Add `setInputMode(enabled)` method that sets the flag
- In the main `keydown` handler, if `_inputMode === true`, only intercept Back/Escape (keyCode 10009/27) — let all other keys pass through to the IME
- Back/Escape while in input mode should blur the active element (dismiss IME) and set input mode to false

### P1.4 — Down/Up Arrow Fallback
As a belt-and-braces measure, also handle arrow keys on the inputs themselves for cases where the IME is already dismissed but the input still has focus:

```javascript
fields.forEach(function(input, index) {
    input.addEventListener('keydown', function(e) {
        // Down arrow — move to next field
        if (e.keyCode === 40 && index < fields.length - 1) {
            e.preventDefault();
            input.blur();
            fields[index + 1].focus();
        }
        // Up arrow — move to previous field
        if (e.keyCode === 38 && index > 0) {
            e.preventDefault();
            input.blur();
            fields[index - 1].focus();
        }
    });
});
```

Note: These will only fire if the IME is NOT active (i.e. the keyboard has been dismissed but the field still has focus). When the IME is active, it will consume these events — that's fine, the Enter/Done handler covers that case.

### P1.5 — Visual Focus Indicator on Inputs
Ensure input fields show the standard focus ring when focused (the CSS `:focus` state should already handle this via the existing styles, but verify):

- Focused input: `outline: 2px solid var(--accent)`, `outline-offset: 2px`
- Ensure the currently focused input is visually distinct from unfocused inputs

### P1.6 — Testing
Test in browser with keyboard only:
- [ ] Tab/Enter on Server URL field → focus moves to Port field
- [ ] Enter on Port field → focus moves to Username field  
- [ ] Enter on Username field → focus moves to Password field
- [ ] Enter on Password field → triggers Connect
- [ ] Down arrow moves between fields (when IME not active)
- [ ] Up arrow moves between fields (when IME not active)
- [ ] Escape/Back blurs the focused input
- [ ] After blurring, FocusManager resumes normal d-pad handling
- [ ] Visual focus ring shows on the active input field
- [ ] Connect button still works via Enter/d-pad from FocusManager

Note: Full IME behaviour can only be verified on the actual Tizen TV. Browser testing confirms the key handlers are wired correctly.

## Acceptance Criteria
- [ ] Enter/Done on each input field advances to the next field
- [ ] Enter/Done on Password field triggers form submission
- [ ] Down/Up arrows navigate between fields when IME is dismissed
- [ ] FocusManager pauses d-pad handling while a native input has focus
- [ ] Back/Escape dismisses IME and returns to FocusManager control
- [ ] No regressions on any other screen
- [ ] Zero new JS errors

## Update PROGRESS.md
Add a "Patches" section documenting this fix.
