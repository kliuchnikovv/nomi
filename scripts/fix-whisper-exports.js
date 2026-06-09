#!/usr/bin/env node
/**
 * whisper.rn@0.6.0 ships a broken `exports` map: it only declares `"./*"`, with
 * no `"."` entry and no `"./package.json"`. Two things break as a result:
 *
 *   1. React Native codegen does `require.resolve('whisper.rn/package.json')` to
 *      read each dependency's `codegenConfig`. The broken map redirects
 *      `./package.json` to a non-existent `./lib/commonjs/package.json`, so the
 *      resolve throws, codegen silently skips whisper.rn, and the iOS build
 *      fails with `'RNWhisperSpec/RNWhisperSpec.h' file not found`.
 *   2. TypeScript (bundler resolution) can't resolve the bare `whisper.rn`
 *      import for the same reason.
 *
 * This postinstall script patches the installed package.json to add the missing
 * entries. It is idempotent — safe to run on every install. Remove once
 * whisper.rn ships a corrected exports map upstream.
 */
const fs = require('fs');
const path = require('path');

function findPkg() {
    try {
        // Resolve from this repo; require.resolve still works here because we
        // only need the directory, and Node falls back to `main` for the bare
        // specifier even with the broken map.
        return path.join(
            path.dirname(require.resolve('whisper.rn/lib/commonjs/index.js')),
            '..',
            '..',
            'package.json',
        );
    } catch {
        const guess = path.join(
            __dirname,
            '..',
            'node_modules',
            'whisper.rn',
            'package.json',
        );
        return fs.existsSync(guess) ? guess : null;
    }
}

function main() {
    const pkgPath = findPkg();
    if (!pkgPath || !fs.existsSync(pkgPath)) {
        // whisper.rn not installed (e.g. partial workspace) — nothing to do.
        return;
    }
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    // Build an explicit conditional entry pointing at concrete files. The
    // wildcard `"./*": "src/*"` can't be used for subpaths because package-exports
    // resolution does NOT append source extensions — `whisper.rn/realtime-transcription`
    // would map to the extensionless `src/realtime-transcription`, which Metro
    // "resolves" but never bundles, throwing `Cannot find module` at runtime. So we
    // pin each subpath we import to real files (with extensions).
    const entry = sub => ({
        types: `./lib/typescript/${sub}.d.ts`,
        'react-native': `./src/${sub}.ts`,
        import: `./lib/module/${sub}.js`,
        require: `./lib/commonjs/${sub}.js`,
    });

    const desired = {
        '.': {
            types: './lib/typescript/index.d.ts',
            'react-native': './src/index.ts',
            import: './lib/module/index.js',
            require: './lib/commonjs/index.js',
        },
        './package.json': './package.json',
        './realtime-transcription': entry('realtime-transcription/index'),
        './realtime-transcription/adapters/AudioPcmStreamAdapter': entry(
            'realtime-transcription/adapters/AudioPcmStreamAdapter',
        ),
    };

    const existing = pkg.exports || {};
    // Idempotent: skip if every desired key is already present.
    const alreadyPatched = Object.keys(desired).every(k => existing[k]);
    if (alreadyPatched) {
        return;
    }
    // Explicit subpaths first, then the original wildcard fallback.
    pkg.exports = { ...desired, ...existing };
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log('[fix-whisper-exports] patched whisper.rn exports map');
}

main();
