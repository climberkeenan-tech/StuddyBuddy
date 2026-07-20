import { BrowserWindow } from 'electron';
import { IPC_EVENT_PREFIX } from '@studdybuddy/shared';
import type { CoreEventBus, CoreEvents } from '@studdybuddy/core';

/**
 * Forwards every core domain event to all renderer windows 1:1 on the
 * `sb:event:*` channels. Core stays Electron-free; this is the only place
 * where domain events meet webContents.
 */
const BRIDGED_EVENTS: (keyof CoreEvents & string)[] = [
  'recording:status',
  'transcript:segments',
  'transcript:updated',
  'job:progress',
  'lecture:ready',
  'achievement:unlocked',
  'gamification:updated',
];

export function bridgeCoreEvents(bus: CoreEventBus): void {
  for (const event of BRIDGED_EVENTS) {
    bus.on(event, (payload) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(`${IPC_EVENT_PREFIX}${event}`, payload);
        }
      }
    });
  }
}
