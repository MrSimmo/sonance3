# Prompt 3.7-fix24 — Item 3.4: MD5 helper — array-join in `rhex`

**Parent ticket:** `tickets/ticket-3.7.md` — read it first.

## Objective

Convert the `rhex` (and any companion) string-concatenation loops in the MD5 implementation in `js/utils.js` to use an array push + `.join('')` pattern.

## Context

- `js/utils.js:244-253, 263-290` — MD5 helpers including `rhex(num)` build hex strings using `s += hex_chr[...] + hex_chr[...]` in a loop.
- Token computation `md5(password + salt)` is called per API request via `js/api.js:34`.
- This is a low-impact change but cheap.

## Task

1. In `js/utils.js`, find each loop that builds a hex string via `+=` concatenation.
2. Convert to:
   ```js
   var chars = [];
   for (var j = 0; j < 4; j++) {
       chars.push(hex_chr[(num >> (j * 8 + 4)) & 0x0F]);
       chars.push(hex_chr[(num >> (j * 8))     & 0x0F]);
   }
   return chars.join('');
   ```
3. Verify the output bytes match exactly. Add a one-shot self-test (only at module init in dev mode, not in production) that asserts `md5('') === 'd41d8cd98f00b204e9800998ecf8427e'` and `md5('abc') === '900150983cd24fb0d6963f7d28e17f72'`. Remove the assertion before commit (or keep it gated behind a dev flag).

## Constraints

- Do not change the MD5 algorithm or any other crypto.
- Output bytes must be identical for all inputs.

## Acceptance criteria

- The known-vector self-test passes.
- API requests still succeed (subsonic auth still works).
- Browser Smoke Test passes.

## Out of scope

- Replacing MD5 with a different algorithm.
- WebCrypto integration.

## Verification

1. In DevTools console: `SonanceUtils.md5('')` returns `'d41d8cd98f00b204e9800998ecf8427e'`; `SonanceUtils.md5('abc')` returns `'900150983cd24fb0d6963f7d28e17f72'`.
2. Confirm the app can ping the Navidrome server and load Library after this change.
3. Browser Smoke Test from ticket-3.7.md.
