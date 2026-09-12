# Parser evaluation harness

Development-only probes; not imported by SNFolio. Fixtures are synthetic and never sent to a device or calendar service. See ../../docs/CALENDAR_PARSER_EVALUATION.md for findings and limits.

From the repository root, install the separately locked candidates into this directory (or copy this manifest/lock to a temporary directory and run npm ci there):

```sh
npm ci --prefix tools/parser-evaluation --ignore-scripts --no-audit --no-fund
TZ=UTC node tools/parser-evaluation/probe.cjs tools/parser-evaluation/node_modules
node_modules/react-native/sdks/hermesc/osx-bin/hermes tools/parser-evaluation/hermes-probe.js
```

The probe prints measurements, including expected mismatches; it is not a passing replacement-parser test suite. It writes hermes-probe.js beside the supplied node_modules directory. Raw recorded outputs were obtained with candidates installed under /private/tmp/snfolio-parser-evaluation. The separate lockfile pins ICAL.js 2.2.1 and node-ical 0.27.1. The probe uses the application's Babel dependency to load the existing TypeScript parser.

For the Android Metro smoke test, use an isolated entry requiring ICAL.js/dist/ical.es5.cjs with its directory in Metro watchFolders, bundle with platform android/dev false, then compile and execute with RN's bundled hermesc/hermes. This checks module packaging and host Hermes execution, not full plugin/device compatibility.
