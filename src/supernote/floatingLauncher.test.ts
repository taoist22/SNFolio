import { NativeModules, AppState, DeviceEventEmitter } from 'react-native';
import { PluginManager } from 'sn-plugin-lib';
import { calendarStorage } from '../storage/calendarStorage';
jest.mock('sn-plugin-lib', () => ({ PluginManager: {
  closePluginView: jest.fn(async () => true), showPluginView: jest.fn(async () => true), registerPluginLifeListener: jest.fn(),
} }));
NativeModules.FolioLauncher = { show: jest.fn(async () => true), hide: jest.fn(async () => true) };
const { minimizeFolio, exitFolio, removeFloatingIcon } = require('./floatingLauncher');

beforeEach(() => {
  jest.clearAllMocks();
  calendarStorage.updateSettings({ floatingLauncherEnabled: true });
});
test('minimize shows the icon before closing and Exit removes it', async () => {
  await minimizeFolio();
  expect(NativeModules.FolioLauncher.show).toHaveBeenCalledTimes(1);
  expect(PluginManager.closePluginView).toHaveBeenCalledTimes(1);
  expect(NativeModules.FolioLauncher.show.mock.invocationCallOrder[0]).toBeLessThan((PluginManager.closePluginView as jest.Mock).mock.invocationCallOrder[0]);
  await exitFolio();
  expect(NativeModules.FolioLauncher.hide).toHaveBeenCalledTimes(1);
});
test('disabled launcher closes without showing an icon', async () => {
  calendarStorage.updateSettings({ floatingLauncherEnabled: false });
  await minimizeFolio();
  expect(NativeModules.FolioLauncher.show).not.toHaveBeenCalled();
  expect(NativeModules.FolioLauncher.hide).toHaveBeenCalled();
  expect(PluginManager.closePluginView).toHaveBeenCalled();
});
test('overlay failure leaves the plugin open', async () => {
  NativeModules.FolioLauncher.show.mockRejectedValueOnce(new Error('permission denied'));
  await expect(minimizeFolio()).rejects.toThrow('permission denied');
  expect(PluginManager.closePluginView).not.toHaveBeenCalled();
});
test('failed close removes the icon, and toolbar cleanup does not toggle the host view', async () => {
  (PluginManager.closePluginView as jest.Mock).mockResolvedValueOnce(false);
  await expect(minimizeFolio()).rejects.toThrow('could not minimize');
  expect(NativeModules.FolioLauncher.hide).toHaveBeenCalled();
  jest.clearAllMocks();
  await removeFloatingIcon();
  expect(PluginManager.closePluginView).not.toHaveBeenCalled();
});

test('single tap chooses notes in the foreground and reopens the plugin in the background', async () => {
  let changeState: (state: string) => void = () => {};
  let tap: (action: string) => Promise<void> = async () => {};
  const stateSpy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    changeState = callback as (state: string) => void;
    return { remove: jest.fn() };
  });
  const eventSpy = jest.spyOn(DeviceEventEmitter, 'addListener').mockImplementation((_event, callback) => {
    tap = async action => { await callback(action); };
    return { remove: jest.fn() } as unknown as ReturnType<typeof DeviceEventEmitter.addListener>;
  });
  const launcher = require('./floatingLauncher');
  const recent = jest.fn();
  const unregister = launcher.registerRecentNotes(recent);
  launcher.startFloatingLauncher();
  changeState('active');
  await tap('open');
  expect(recent).toHaveBeenCalledTimes(1);
  expect(PluginManager.showPluginView).not.toHaveBeenCalled();
  changeState('background');
  await tap('open');
  expect(PluginManager.showPluginView).toHaveBeenCalledTimes(1);
  expect(recent).toHaveBeenCalledTimes(1);
  unregister(); stateSpy.mockRestore(); eventSpy.mockRestore();
});
