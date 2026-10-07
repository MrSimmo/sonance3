# P3 — Fix Connect Button Navigation & Update In-App Icons

## Problem 1: Connect Button Unreachable
After the P1 IME patch, pressing Down on the Password field does nothing. The user cannot navigate from the last input field to the Connect button using the d-pad.

## Problem 2: In-App Icons Don't Match App Icon
The sidebar logo and login screen logo still show the old music note SVG. They need to match the new app icon (Option B — stylised S with sound wave arcs on pink-to-purple gradient).

## Fix 1: Connect Button Navigation
In `js/screens/login.js`, extend the input field keydown handler so that pressing Down on the last field (Password) blurs the input, exits input mode, and moves FocusManager focus to the Connect button.

Also handle Up on the Connect button to return focus to the Password field.

### Changes to login.js

1. In the Down arrow handler for the last input field (index === fields.length - 1), instead of doing nothing, blur the input and focus the Connect button:

```javascript
if (e.keyCode === 40) {
    e.preventDefault();
    input.blur();
    if (index < fields.length - 1) {
        fields[index + 1].focus();
    } else {
        if (window.focusManager) {
            window.focusManager.setInputMode(false);
        }
        var connectBtn = document.querySelector('.login-connect-btn') 
            || document.querySelector('#login-connect')
            || document.querySelector('.login-card button');
        if (connectBtn) {
            connectBtn.focus();
        }
    }
}
```

2. Add a keydown handler on the Connect button so Up arrow returns to the Password field:

```javascript
connectBtn.addEventListener('keydown', function(e) {
    if (e.keyCode === 38) {  // Up arrow
        e.preventDefault();
        var lastField = fields[fields.length - 1];
        lastField.focus();
    }
});
```

3. Ensure the Connect button has a visible focus state (the pink outline ring) when focused via d-pad.

## Fix 2: Update In-App Icons

The sidebar logo (in `js/app.js` or wherever the sidebar is rendered) and the login screen logo (in `js/screens/login.js`) both currently render an inline SVG music note inside a gradient square. Replace both with the new icon design: a stylised "S" made from sound wave arcs.

### New Icon SVG (for inline use)

The gradient background square stays the same (`linear-gradient(135deg, #e44d8a, #8a4dff)`, border-radius 10px). Only the **inner SVG content** changes. Replace the music note paths with:

```svg
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Stylised S from arcs -->
  <path d="M14.5,5.5 A5.5,5.5 0 0,0 9.5,9" stroke="white" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.95"/>
  <path d="M9.5,9 A5.5,5.5 0 0,1 14.5,12.5" stroke="white" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.95"/>
  <path d="M14.5,12.5 A5.5,5.5 0 0,0 9.5,16" stroke="white" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.2"/>
  <!-- Sound emanation - right -->
  <path d="M17,6.5 Q19,8 17,9.5" stroke="white" stroke-width="1.2" fill="none" stroke-linecap="round" opacity="0.5"/>
  <path d="M18.5,5.5 Q21.5,8 18.5,10.5" stroke="white" stroke-width="1" fill="none" stroke-linecap="round" opacity="0.3"/>
  <!-- Sound emanation - left -->
  <path d="M7,10.5 Q5,12 7,13.5" stroke="white" stroke-width="1.2" fill="none" stroke-linecap="round" opacity="0.5"/>
  <path d="M5.5,9.5 Q2.5,12 5.5,14.5" stroke="white" stroke-width="1" fill="none" stroke-linecap="round" opacity="0.3"/>
</svg>
```

### Locations to update:

1. **Login screen logo** (`js/screens/login.js`) — the large icon at the top of the login card. Find the SVG that renders the music note inside the gradient box and replace the inner paths with the S-wave design above. Keep the outer gradient container the same size and styling.

2. **Sidebar logo** (`js/app.js` or the sidebar rendering code) — the 36×36px icon next to "Sonance" text. Same replacement: keep the gradient box, swap the inner SVG paths.

Both should use the same SVG paths scaled to fit their container. The viewBox `0 0 24 24` will scale naturally to any container size.

## Testing
- [ ] Down arrow from Password field → focus moves to Connect button
- [ ] Connect button shows focus ring when focused
- [ ] Enter on Connect button triggers login
- [ ] Up arrow from Connect button → focus moves back to Password field
- [ ] Enter on Password field still triggers login directly (existing P1 behaviour preserved)
- [ ] Login screen icon shows the S-wave design (not music note)
- [ ] Sidebar icon shows the S-wave design (not music note)
- [ ] Both icons have the pink-to-purple gradient background
- [ ] Icons render cleanly at both sizes (login ~80px, sidebar 36px)
- [ ] No regressions on any other screen

## Acceptance Criteria
- [ ] Full d-pad loop: Server URL → Port → Username → Password → Connect → (Up back to Password)
- [ ] Connect button visually focused with accent ring
- [ ] Login screen icon matches new app icon design
- [ ] Sidebar icon matches new app icon design
- [ ] Only login.js, app.js (or sidebar renderer), and PROGRESS.md modified

## Update PROGRESS.md
