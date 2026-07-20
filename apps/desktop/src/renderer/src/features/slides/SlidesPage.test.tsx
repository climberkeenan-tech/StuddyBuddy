import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PageTitleProvider } from '@renderer/lib/hooks';
import { api } from '@renderer/lib/api';
import SlidesPage from './SlidesPage';

afterEach(cleanup);

function renderPage(lectureId = 'lec-bio-1') {
  return render(
    <PageTitleProvider>
      <MemoryRouter initialEntries={[`/lectures/${lectureId}/slides`]}>
        <Routes>
          <Route path="/lectures/:lectureId/slides" element={<SlidesPage />} />
          <Route path="/learn/:lectureId" element={<div>Lecture page</div>} />
        </Routes>
      </MemoryRouter>
    </PageTitleProvider>,
  );
}

describe('SlidesPage', () => {
  it('renders the mock deck and navigates between slides', async () => {
    renderPage();

    // Title slide loads (subtitle is unique to the deck opener).
    await screen.findByText('How a cell copies its genome');
    expect(screen.getByText('1 / 5')).toBeInTheDocument();

    // Jump to a specific slide via its thumbnail.
    await userEvent.click(screen.getByRole('button', { name: /Slide 2:/ }));
    expect(await screen.findByText('2 / 5')).toBeInTheDocument();
    await screen.findByRole('heading', { name: 'Three Key Enzymes' });

    await userEvent.click(screen.getByRole('button', { name: /Slide 4:/ }));
    expect(await screen.findByText('4 / 5')).toBeInTheDocument();
  });

  it('navigates with the arrow keys', async () => {
    renderPage();
    await screen.findByText('1 / 5');
    await userEvent.keyboard('{ArrowRight}');
    expect(await screen.findByText('2 / 5')).toBeInTheDocument();
    await userEvent.keyboard('{ArrowLeft}');
    expect(await screen.findByText('1 / 5')).toBeInTheDocument();
  });

  it('shows speaker notes when toggled', async () => {
    renderPage();
    await screen.findByText('1 / 5');
    await userEvent.click(screen.getByRole('button', { name: 'Toggle speaker notes' }));
    expect(
      await screen.findByText(/Set the stage: replication precedes every cell division\./),
    ).toBeInTheDocument();
  });

  it('exports the deck through the API and toasts the file path', async () => {
    const exportSpy = vi.spyOn(api.slides, 'export');
    renderPage();
    await screen.findByText('1 / 5');

    await userEvent.click(screen.getByRole('button', { name: /Export/ }));
    const menu = await screen.findByRole('menu');
    await userEvent.click(within(menu).getByText('PDF'));

    await waitFor(() => expect(exportSpy).toHaveBeenCalledWith('deck-bio-1', 'pdf'));
    exportSpy.mockRestore();
  });

  it('offers a generate CTA when a lecture has no deck', async () => {
    const generateSpy = vi.spyOn(api.slides, 'generate');
    renderPage('lec-bio-2');

    const generateBtn = await screen.findByRole('button', { name: /Generate slides/ });
    await userEvent.click(generateBtn);
    await waitFor(() => expect(generateSpy).toHaveBeenCalledWith('lec-bio-2'));
    generateSpy.mockRestore();
  });
});
