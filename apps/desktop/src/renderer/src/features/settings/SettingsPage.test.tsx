import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PageTitleProvider } from '@renderer/lib/hooks';
import { Toaster } from '@renderer/components/toast';
import { api } from '@renderer/lib/api';
import SettingsPage from './SettingsPage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPage() {
  return render(
    <PageTitleProvider>
      <MemoryRouter initialEntries={['/settings']}>
        <SettingsPage />
      </MemoryRouter>
      <Toaster />
    </PageTitleProvider>,
  );
}

describe('SettingsPage', () => {
  it('lists AI providers from the mock api', async () => {
    renderPage();
    expect(await screen.findByText('Anthropic Claude')).toBeInTheDocument();
    expect(await screen.findByText('Built-in Demo AI')).toBeInTheDocument();
    // Offline reassurance is present.
    expect(screen.getByText(/Works fully offline, no key required/i)).toBeInTheDocument();
  });

  it('saves an API key through the api', async () => {
    const spy = vi.spyOn(api.providers, 'setApiKey');
    renderPage();

    // Anthropic requires a key -> its password input is present.
    await screen.findByText('Anthropic Claude');
    const keyInput = screen.getAllByPlaceholderText(/Paste your API key/i)[0]!;
    fireEvent.change(keyInput, { target: { value: 'sk-test-123' } });

    const saveButtons = screen.getAllByRole('button', { name: 'Save' });
    fireEvent.click(saveButtons[0]!);

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith('anthropic', 'sk-test-123');
    });
  });

  it('persists a theme change through the api when toggled', async () => {
    const spy = vi.spyOn(api.settings, 'update');
    renderPage();

    // Move to the Appearance tab.
    fireEvent.click(await screen.findByRole('tab', { name: /Appearance/i }));

    const darkOption = await screen.findByRole('radio', { name: 'Dark' });
    fireEvent.click(darkOption);

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }));
    });
  });
});
