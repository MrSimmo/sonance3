You are performing a pre-release security and confidentiality REVIEW on Sonance — a music player app for Samsung Tizen TVs — before pushing to a PUBLIC GitHub repository.

## IMPORTANT: READ-ONLY REVIEW
DO NOT modify any files. DO NOT delete anything. DO NOT create a .gitignore. ONLY scan, analyse, and output a review report to `review.md` in the project root.

## STEP 1: Scan for Hardcoded Credentials and Personal Data

Search EVERY file in the project for the following. Report ALL findings with file path and line number.

### 1a. IP Addresses and Hostnames
```bash
grep -rn '192\.168\.' --include='*.js' --include='*.html' --include='*.css' --include='*.xml' .
grep -rn '10\.0\.' --include='*.js' --include='*.html' --include='*.css' --include='*.xml' .
grep -rn '172\.1[6-9]\.\|172\.2[0-9]\.\|172\.3[0-1]\.' --include='*.js' --include='*.html' --include='*.css' --include='*.xml' .
grep -rn 'localhost' --include='*.js' --include='*.html' --include='*.css' --include='*.xml' .
grep -rn 'nas\.local\|mac-mini\.local' --include='*.js' --include='*.html' --include='*.css' --include='*.xml' --include='*.md' .
```

Flag any IP or hostname found in JS/HTML/CSS/XML source files. Note whether it's in active code or in a comment.

### 1b. Passwords, Tokens, API Keys
```bash
grep -rni 'password\|passwd\|secret\|token\|apikey\|api_key\|api-key' --include='*.js' --include='*.html' --include='*.xml' .
grep -rni 'Bearer \|Basic ' --include='*.js' --include='*.html' .
grep -rn 'salt=' --include='*.js' .
```

Distinguish between: variable/parameter names (expected in auth code) vs actual credential values (must be flagged).

### 1c. Personal Names and Email Addresses
```bash
grep -rni 'simpson\|pirie\|andy@\|simmo' --include='*.js' --include='*.html' --include='*.css' --include='*.xml' .
grep -rni '@.*\.com\|@.*\.co\.uk\|@.*\.group' --include='*.js' --include='*.html' --include='*.xml' .
```

Note: "By Simmo" in the UI is intentional branding — flag it but mark as OK.

### 1d. Server URLs and Port Numbers
```bash
grep -rn '4534\|4533' --include='*.js' --include='*.html' --include='*.xml' .
grep -rn 'navidrome' --include='*.js' --include='*.html' --include='*.xml' .
```

Flag hardcoded port numbers or server-specific references in source files.

### 1e. Debug/Test Code
```bash
grep -rn 'console\.log\|console\.warn\|console\.error' --include='*.js' . | wc -l
grep -rn 'TODO\|FIXME\|HACK\|XXX\|TEMP' --include='*.js' --include='*.html' --include='*.css' .
grep -rn 'debug\|Debug\|DEBUG' --include='*.js' --include='*.html' --include='*.css' .
```

Report total console.log count and flag any that contain personal data or server addresses. List all TODO/FIXME/HACK comments.

### 1f. Hardcoded Test Data
```bash
grep -rn 'Tribe Called Quest\|Phony Rappers\|Guns.*Roses\|Spaghetti\|Lauren Daigle\|Helter Skelter' --include='*.js' --include='*.html' .
```

Flag any test song/album/artist names hardcoded in source files.

### 1g. Derived credentials — Subsonic `t` / `s` token pairs (ADDED v3.9 Session 6)

**A Subsonic `t`/`s` pair is a replayable credential in its own right.** The
server accepts any request where `t == md5(password + s)`, so a captured pair
grants full account access without the password ever being written down. A
`grep` for the password will never find one. Session 4 found two live pairs in a
tracked document this way (`docs/perf-baseline.md`, since redacted).

### 1h. The password itself — search by SHAPE, not by token (ADDED v3.9 Session 6)

The test account's username and password are short common English words — and
they are the **same** word. A whole-token `grep` for either returns **216 lines
of pure narrative prose** across this repo and proves nothing at all. Search
**value position** instead: the secret used as a string literal, an HTML
attribute value, a shell/env assignment, a JSON field value, a
`localStorage.setItem` argument, or a Subsonic `u=` / `p=` query parameter.

**Known trap:** stale *documentation* can leak a live credential even though
nobody ever wrote one down. Session 6 found the ticket's description of the mock
harness naming a user/pass the harness had not used for several sessions — and
that stale value happened to equal the live account's username *and* password.
Check that every credential a document mentions matches what the code does.

### Running 1g and 1h

Both checks are one script. Write it with a **quoted heredoc** — the regexes
contain quotes and backslashes that a `node -e '…'` one-liner cannot survive.
It reads the password from the gitignored account file and never prints it.

```bash
cat > /tmp/sonance-cred-audit.js <<'AUDIT_EOF'
'use strict';
// Shape-based credential audit. Prints file:line only, never a secret.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execSync } = require('child_process');
const ROOT = process.cwd();

const acct = fs.readFileSync(path.join(ROOT, 'TEST-ACCOUNT.local.md'), 'utf8');
const g = (l) => (acct.match(new RegExp('\\|\\s*' + l + '\\s*\\|\\s*`([^`]+)`')) || [])[1];
const USER = g('Username'), PASS = g('Password');
if (!USER || !PASS) { console.error('cannot parse TEST-ACCOUNT.local.md'); process.exit(1); }

const SKIP_DIRS  = new Set(['.git', '.playwright-mcp', 'node_modules', 'screenshots']);
const SKIP_FILES = new Set(['TEST-ACCOUNT.local.md']);
const TEXT = /\.(js|css|html|md|json|xml|sh|txt|yml|yaml)$/i;

const files = [];
(function walk(d, rel) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(d, e.name), rel + e.name + '/'); continue; }
    if (SKIP_FILES.has(e.name)) continue;
    if (TEXT.test(e.name)) files.push({ abs: path.join(d, e.name), rel: rel + e.name });
  }
})(ROOT, '');

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const U = esc(USER), P = esc(PASS);

function valuePatterns(v) {
  return [
    ['string literal',       new RegExp('["\'`]' + v + '["\'`]')],
    ['html value attribute', new RegExp('value\\s*=\\s*["\']' + v + '["\']', 'i')],
    ['shell/env assignment', new RegExp('(SONANCE_USER|SONANCE_PASS|USER|PASS|PASSWORD|USERNAME)\\s*=\\s*["\']?' + v + '(["\']|\\s|$)')],
    ['subsonic query param', new RegExp('[?&](u|p|username|password)=' + v + '($|[&"\'`\\s])')],
    ['json field value',     new RegExp('"(user|username|pass|password)"\\s*:\\s*"' + v + '"', 'i')],
    ['localStorage setItem', new RegExp('setItem\\([^)]*["\']' + v + '["\']')]
  ];
}
const USER_PATS = valuePatterns(U), PASS_PATS = valuePatterns(P);
const valueHits = [], tokenPairs = [];
let naiveUser = 0, naivePass = 0;
const wholeUser = new RegExp('(^|[^A-Za-z0-9_])' + U + '([^A-Za-z0-9_]|$)');
const wholePass = new RegExp('(^|[^A-Za-z0-9_])' + P + '([^A-Za-z0-9_]|$)');

function scan(rel, text) {
  text.split('\n').forEach((line, i) => {
    const at = rel + ':' + (i + 1);
    if (wholeUser.test(line)) naiveUser++;
    if (wholePass.test(line)) naivePass++;
    USER_PATS.forEach(([w, re]) => { if (re.test(line)) valueHits.push('username ' + at + ' [' + w + ']'); });
    PASS_PATS.forEach(([w, re]) => { if (re.test(line)) valueHits.push('password ' + at + ' [' + w + ']'); });
    const T = /[?&"'\s]t=([0-9a-fA-F]{32})/g;
    let m;
    while ((m = T.exec(line))) {
      const S = /[?&"'\s]s=([A-Za-z0-9_-]{2,64})/g;
      let sm;
      while ((sm = S.exec(line))) {
        if (crypto.createHash('md5').update(PASS + sm[1]).digest('hex') === m[1].toLowerCase()) {
          tokenPairs.push(at);
        }
      }
    }
  });
}

files.forEach(f => { try { scan(f.rel, fs.readFileSync(f.abs, 'utf8')); } catch (e) {} });

// The .wgt archives ship to the TV — scan inside them too.
const wgts = fs.readdirSync(ROOT).filter(f => f.endsWith('.wgt'));
for (const w of wgts) {
  let names = [];
  try { names = execSync('unzip -Z1 ' + JSON.stringify(w)).toString().trim().split('\n'); } catch (e) { continue; }
  for (const n of names) {
    if (!TEXT.test(n)) continue;
    try { scan(w + '!' + n, execSync('unzip -p ' + JSON.stringify(w) + ' ' + JSON.stringify(n)).toString()); } catch (e) {}
  }
}

console.log('files scanned            : ' + files.length);
console.log('.wgt archives scanned    : ' + wgts.length + (wgts.length ? ' (' + wgts.join(', ') + ')' : ''));
console.log('naive whole-token hits   : username ' + naiveUser + ' lines, password ' + naivePass + ' lines  <-- NOISE, not a test');
console.log('');
valueHits.forEach(h => console.log('VALUE POSITION  ' + h));
tokenPairs.forEach(h => console.log('REPLAYABLE TOKEN PAIR  ' + h));
console.log('');
console.log('value-position hits      : ' + valueHits.length + '   (acceptance: 0)');
console.log('replayable t/s pairs     : ' + tokenPairs.length + '   (acceptance: 0)');
process.exit(valueHits.length + tokenPairs.length ? 1 : 0);
AUDIT_EOF
node /tmp/sonance-cred-audit.js
```

**Acceptance: `0` value-position hits and `0` replayable token pairs.** If a
token pair is found, redact both `t=` and `s=` to placeholders — keeping
whatever the line was demonstrating — and treat the account as compromised. If
the password turns up in value position, correcting the file is necessary but
not sufficient: the value is in the repo's history, so rotate it.

## STEP 2: Review config.xml

Report on:
- App ID — is it appropriate for public release?
- `<access origin="*">` — note the security implication
- Privileges listed — are they all necessary?
- Any hardcoded URLs or personal data

## STEP 3: Review index.html

Report on:
- Any hardcoded server URLs or IPs
- Any test credentials
- Audio elements with pre-set src attributes
- Any debug elements left in the DOM

## STEP 4: Review for Files That Shouldn't Be Committed

List any files present that are typically excluded from public repos:
- `.DS_Store` files
- `__MACOSX/` folders
- `.playwright-mcp/` folders
- Built binary files (`.wgt`)
- Screenshot files used during development
- Any other temporary or generated files

## STEP 5: Output Review Report

Write ALL findings to `review.md` in the project root. Format:

```markdown
# Sonance Pre-Release Security Review
Date: [today's date]

## Summary
- Total files scanned: X
- Issues found: X (Critical: X, Warning: X, Info: X)
- Clean for public release: YES / NO / YES WITH FIXES

## Critical Issues (must fix before release)
[List each with file:line and description]

## Warnings (should fix)
[List each with file:line and description]

## Informational (acceptable but noted)
[List each with file:line and description]

## Files to Exclude from Git
[List files/folders that should be in .gitignore or deleted]

## Derived Credential Audit
- Replayable `t`/`s` pairs found: X  (acceptance: 0)
- Password/username in value position: X  (acceptance: 0)
- `.wgt` archives scanned: X

## Console.log Audit
- Total console statements: X
- Containing personal data: X
- Recommendation: [keep/remove/selective removal]

## Config & Permissions Review
[config.xml and index.html findings]
```

## RULES
- DO NOT modify any files
- DO NOT delete anything
- DO NOT create .gitignore
- ONLY output review.md
- Run autonomously
