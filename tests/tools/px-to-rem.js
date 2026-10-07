#!/usr/bin/env node
'use strict';

// Sonance v3.10 S2 (R4, ticket-3.10 §6.1): convert css/styles.css from px to
// rem on a 10px root, so the whole stylesheet follows the Interface size
// setting. Run once; kept so the conversion is reviewable and repeatable.
//
// Usage: node tests/tools/px-to-rem.js <in.css> [out.css] [--dry]
//   out defaults to in (rewrite in place). --dry reports without writing.
//
// Rules (docs/UI-MOCKUP-REFERENCE.md "Interface size"):
// - Npx -> (N/10)rem, by moving the decimal point in the digit string, so
//   13px -> 1.3rem and -6.5px -> -0.65rem exactly; no float arithmetic.
// - Hairlines stay px (D63): a 1px token in a border / border-top /
//   border-bottom / border-left / border-right declaration.
// - The .np-bg-image filter keeps its blur() in px (§6.5, D47).
// - Comments are left alone: a px value in a comment describes 100 %.
// Running it on an already-converted file changes nothing.

var fs = require('fs');

var args = process.argv.slice(2);
var dry = args.indexOf('--dry') > -1;
args = args.filter(function(a) { return a !== '--dry'; });
var inPath = args[0];
var outPath = args[1] || inPath;
if (!inPath) {
    console.error('usage: px-to-rem.js <in.css> [out.css] [--dry]');
    process.exit(2);
}

var HAIRLINE_PROPS = { 'border': 1, 'border-top': 1, 'border-bottom': 1, 'border-left': 1, 'border-right': 1 };

var src = fs.readFileSync(inPath, 'utf8');

// Same-length copy with every comment blanked, so indices line up with `src`
// and nothing inside a comment is matched or mistaken for structure.
var mask = src.replace(/\/\*[\s\S]*?\*\//g, function(c) { return c.replace(/[^\n]/g, ' '); });

// "13" -> "1.3", "6.5" -> "0.65", "100" -> "10", "0.5" -> "0.05", "0" -> "0".
function divTen(num) {
    var neg = num.charAt(0) === '-';
    if (neg) num = num.slice(1);
    if (num.charAt(0) === '.') num = '0' + num;
    var parts = num.split('.');
    var int = parts[0], frac = parts[1] || '';
    var digits = int + frac;
    var point = int.length - 1;            // new position of the decimal point
    var intPart = digits.slice(0, point) || '0';
    var fracPart = digits.slice(point);
    intPart = intPart.replace(/^0+(?=\d)/, '');
    fracPart = fracPart.replace(/0+$/, '');
    var out = fracPart ? intPart + '.' + fracPart : intPart;
    if (out === '0') return '0';
    return (neg ? '-' : '') + out;
}

function lineOf(idx) {
    var n = 1;
    for (var i = 0; i < idx; i++) if (src.charCodeAt(i) === 10) n++;
    return n;
}

// Property of the declaration that contains `idx`: text after the nearest
// preceding `{` or `;`, up to its first `:`.
function propertyAt(idx) {
    var i = idx;
    while (i > 0 && mask[i - 1] !== '{' && mask[i - 1] !== ';') i--;
    var decl = mask.slice(i, idx);
    var colon = decl.indexOf(':');
    return colon < 0 ? null : decl.slice(0, colon).trim().toLowerCase();
}

// Selector of the innermost rule that contains `idx`.
function selectorAt(idx) {
    var depth = 0;
    for (var i = idx - 1; i >= 0; i--) {
        var c = mask[i];
        if (c === '}') depth++;
        else if (c === '{') {
            if (depth === 0) {
                var j = i;
                while (j > 0 && mask[j - 1] !== '}' && mask[j - 1] !== '{' && mask[j - 1] !== ';') j--;
                return mask.slice(j, i).trim();
            }
            depth--;
        }
    }
    return '';
}

var re = /(^|[^-\w.])(-?(?:\d+\.?\d*|\.\d+))px\b/g;
var edits = [];
var kept = { hairline: [], blur: [] };
var byProp = {};
var m;
while ((m = re.exec(mask)) !== null) {
    var numStart = m.index + m[1].length;
    var num = m[2];
    var tokenEnd = numStart + num.length + 2;
    var prop = propertyAt(numStart);
    if (!prop) {
        console.error('px outside a declaration at line ' + lineOf(numStart) + ': ' + src.slice(numStart, tokenEnd));
        process.exit(1);
    }
    if (HAIRLINE_PROPS[prop] && num === '1') {
        kept.hairline.push(lineOf(numStart));
        continue;
    }
    if (prop === 'filter' && /(^|[\s,])\.np-bg-image(\s*$|[\s,:])/.test(selectorAt(numStart))) {
        kept.blur.push(lineOf(numStart));
        continue;
    }
    byProp[prop] = (byProp[prop] || 0) + 1;
    edits.push({ start: numStart, end: tokenEnd, text: divTen(num) + 'rem' });
}

var out = '';
var last = 0;
edits.forEach(function(e) {
    out += src.slice(last, e.start) + e.text;
    last = e.end;
});
out += src.slice(last);

var remaining = (out.replace(/\/\*[\s\S]*?\*\//g, '').match(/\d px|\dpx/g) || []).length;
console.log(JSON.stringify({
    converted: edits.length,
    keptHairline: kept.hairline.length,
    keptBlur: kept.blur.length,
    pxLeftOutsideComments: remaining,
    hairlineLines: kept.hairline,
    blurLines: kept.blur,
    byProperty: byProp
}, null, 1));

if (!dry) {
    fs.writeFileSync(outPath, out);
    console.log('wrote ' + outPath);
}
