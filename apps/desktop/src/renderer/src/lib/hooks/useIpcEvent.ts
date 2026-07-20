import { useEffect, useRef } from 'react';
import type { IpcEventMap } from '@studdybuddy/shared';
import { onEvent } from '../api';

/**
 * Subscribe to a backend push event for the lifetime of the component. The
 * handler is kept in a ref so a changing closure never resubscribes — the
 * subscription is established once per `event`.
 *
 * @example
 * useIpcEvent('lecture:ready', ({ lectureId }) => reload());
 */
export function useIpcEvent<K extends keyof IpcEventMap>(
  event: K,
  handler: (payload: IpcEventMap[K]) => void,
): void {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    return onEvent(event, (payload) => ref.current(payload));
  }, [event]);
}
