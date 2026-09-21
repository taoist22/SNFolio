/* eslint-env jest */
// AsyncStorage is a native module, so every suite that reaches calendarStorage —
// directly or transitively — needs the mock. Registering it globally avoids
// per-file jest.mock() calls in suites that never touch storage themselves.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Production uses Android Keystore through CalendarFile. Give storage tests an
// in-memory equivalent so they exercise the encrypted-settings split.
const secureValues = {};
const {NativeModules} = require('react-native');
NativeModules.CalendarFile = {
  getSecret: jest.fn(async key => secureValues[key] || null),
  setSecret: jest.fn(async (key, value) => {
    secureValues[key] = value;
    return true;
  }),
  readTextFile: jest.fn(async () => ''),
  readBackupFile: jest.fn(async () => ''),
  writeBackupFile: jest.fn(async path => path),
  storeImportedCalendar: jest.fn(async name => `/private/imports/${name}`),
  listNoteFiles: jest.fn(async () => []),
  listFolderEntries: jest.fn(async () => []),
  getStorageRoots: jest.fn(async () => ['/storage/emulated/0']),
  moveFolder: jest.fn(async (_source, destination) => destination),
  openNote: jest.fn(async () => true),
  openDocument: jest.fn(async () => true),
};

beforeEach(() => {
  for (const key of Object.keys(secureValues)) delete secureValues[key];
});
