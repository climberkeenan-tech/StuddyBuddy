import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, useAppStore } from './app-store';

describe('app-store theme application', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.removeAttribute('data-reduce-motion');
  });

  it('applies an explicit dark theme to <html>', () => {
    applyTheme('dark', 'off');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('applies an explicit light theme (removes dark)', () => {
    document.documentElement.classList.add('dark');
    applyTheme('light', 'off');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('sets data-reduce-motion when reduceMotion is on', () => {
    applyTheme('dark', 'on');
    expect(document.documentElement.hasAttribute('data-reduce-motion')).toBe(true);
    applyTheme('dark', 'off');
    expect(document.documentElement.hasAttribute('data-reduce-motion')).toBe(false);
  });

  it("follows the OS (matchMedia matches:false) under 'system' modes", () => {
    // The test setup mocks matchMedia to report matches:false.
    applyTheme('system', 'system');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.hasAttribute('data-reduce-motion')).toBe(false);
  });

  it('optimistically updates settings and re-applies the theme', async () => {
    await useAppStore.getState().updateSettings({ theme: 'dark' });
    expect(useAppStore.getState().settings.theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
