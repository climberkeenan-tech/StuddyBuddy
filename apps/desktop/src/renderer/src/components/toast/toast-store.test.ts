import { beforeEach, describe, expect, it } from 'vitest';
import { useToastStore } from './toast-store';

describe('toast-store', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [], celebrations: [] });
  });

  it('pushes a toast with a default duration and returns its id', () => {
    const id = useToastStore.getState().push({ variant: 'success', title: 'Saved' });
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.id).toBe(id);
    expect(toasts[0]!.duration).toBeGreaterThan(0);
  });

  it('gives error toasts a longer default duration than others', () => {
    useToastStore.getState().push({ variant: 'info', title: 'Info' });
    useToastStore.getState().push({ variant: 'error', title: 'Boom' });
    const [info, error] = useToastStore.getState().toasts;
    expect(error!.duration).toBeGreaterThan(info!.duration);
  });

  it('dismisses a toast by id', () => {
    const id = useToastStore.getState().push({ variant: 'info', title: 'Bye' });
    useToastStore.getState().dismiss(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('queues an achievement celebration', () => {
    useToastStore.getState().celebrate({ achievementId: 'streak-7', name: 'On Fire', icon: 'flame', xp: 120, tier: 'silver' });
    const celebrations = useToastStore.getState().celebrations;
    expect(celebrations).toHaveLength(1);
    expect(celebrations[0]!.name).toBe('On Fire');
    expect(celebrations[0]!.id).toBeTruthy();
  });
});
