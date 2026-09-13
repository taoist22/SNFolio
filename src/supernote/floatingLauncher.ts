import { captureCurrentNote } from './recentNotes';
import { AppState, DeviceEventEmitter, NativeModules } from 'react-native';
import { PluginManager } from 'sn-plugin-lib';
import { calendarStorage } from '../storage/calendarStorage';

const native = NativeModules.FolioLauncher;
let minimized = false;
let foreground = AppState.currentState === 'active';
let recentHandler: (() => void) | undefined;
let quickHandler: (() => void) | undefined;
let pendingQuick = false;
let started = false;
export function registerQuickAdd(handler: () => void): () => void {
  quickHandler = handler;
  if (pendingQuick) { pendingQuick = false; handler(); }
  return () => { quickHandler = undefined; };
}
export function registerRecentNotes(handler: () => void): () => void {
  recentHandler = handler;
  return () => { recentHandler = undefined; };
}
export async function showFloatingIcon(): Promise<void> {
  if (calendarStorage.getSettings().floatingLauncherEnabled) await native?.show();
}
export async function removeFloatingIcon(): Promise<void> {
  minimized = false;
  pendingQuick = false;
  await native?.hide();
}
export async function handleToolbarLauncher(): Promise<void> {
  await removeFloatingIcon();
  // The host performs its existing toolbar toggle; reconcile after that transition.
  setTimeout(() => {
    if (AppState.currentState === 'active') void showFloatingIcon().catch(() => {});
  }, 250);
}
export async function exitFolio(): Promise<void> {
  await removeFloatingIcon();
  await PluginManager.closePluginView();
}
export async function minimizeFolio(): Promise<void> {
  if (!calendarStorage.getSettings().floatingLauncherEnabled) { await exitFolio(); return; }
  if (!native) throw new Error('Floating launcher is not available in this build.');
  await native.show();
  minimized = true;
  try {
    const closed = await PluginManager.closePluginView();
    if (closed === false) throw new Error('SNFolio could not minimize. Please try again.');
  }
  catch (error) { await removeFloatingIcon(); throw error; }
}
export function startFloatingLauncher(): void {
  if (started) return;
  started = true;
  void native?.hide();
  DeviceEventEmitter.addListener('FolioLauncherTap', async (action: string) => {
    try {
      if (foreground && action !== 'quick') {
        await captureCurrentNote();
        recentHandler?.();
        return;
      }
      if (!foreground) await captureCurrentNote();
      const opened = foreground ? true : await PluginManager.showPluginView();
      if (opened === false) return;
      if (action === 'quick') {
        if (quickHandler) quickHandler();
        else pendingQuick = true;
      }
    } catch (_) { /* Keep the icon available to retry. */ }
  });
  AppState.addEventListener('change', state => {
    foreground = state === 'active';
    if (foreground) {
      void captureCurrentNote();
      void showFloatingIcon().catch(() => {});
    }
    else if (minimized && calendarStorage.getSettings().floatingLauncherEnabled) void native?.show().catch(() => {});
  });
  PluginManager.registerPluginLifeListener({ onMsg: (message: any) => {
    const state = typeof message === 'number' ? message : message?.state;
    if (state === 4 || state === 5) void removeFloatingIcon();
  } });
}
