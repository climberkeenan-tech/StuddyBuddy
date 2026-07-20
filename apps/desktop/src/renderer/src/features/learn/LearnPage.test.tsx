import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PageTitleProvider } from '@renderer/lib/hooks';
import { api } from '@renderer/lib/api';
import LearnPage from './LearnPage';

afterEach(cleanup);

/** Render the Learn hub for the seeded, fully-analyzed biology lecture. */
function renderPage() {
  return render(
    <PageTitleProvider>
      <MemoryRouter initialEntries={['/learn/lec-bio-1']}>
        <Routes>
          <Route path="/learn/:lectureId" element={<LearnPage />} />
        </Routes>
      </MemoryRouter>
    </PageTitleProvider>,
  );
}

describe('LearnPage', () => {
  it('renders the activity hub built from the lecture analysis', async () => {
    renderPage();

    // The four games appear as cards.
    expect(await screen.findByRole('heading', { name: 'Quiz Rush' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Concept Match' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Memory Game' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Concept Map' })).toBeInTheDocument();

    // Concepts-in-play stat reflects the four seeded bio concepts.
    expect(screen.getByText('Concepts in play')).toBeInTheDocument();
  });

  it('plays Quiz Rush to the end and records a game-completed event', async () => {
    const spy = vi.spyOn(api.gamification, 'recordEvent');
    renderPage();

    // Open Quiz Rush from its card, then start the round.
    fireEvent.click(await screen.findByRole('button', { name: 'Start Quiz Rush' }));
    fireEvent.click(await screen.findByRole('button', { name: /Start 3 questions/ }));

    // Answer all three questions correctly, advancing each time.
    const correct = [/Semi-conservative/, /Lagging strand/, /DNA ligase/];
    for (let i = 0; i < correct.length; i++) {
      const answer = correct[i]!;
      fireEvent.click(await screen.findByRole('button', { name: answer }));
      const advance = i < correct.length - 1 ? /Next question/ : /See results/;
      fireEvent.click(await screen.findByRole('button', { name: advance }));
    }

    // Results screen shows a perfect score and the event was recorded.
    expect(await screen.findByText('Outstanding')).toBeInTheDocument();
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'game-completed', lectureId: 'lec-bio-1' }),
      ),
    );

    spy.mockRestore();
  });

  it('enables every game for the well-analyzed seeded lecture', async () => {
    renderPage();
    for (const name of ['Start Quiz Rush', 'Start Concept Match', 'Start Memory Game', 'Start Concept Map']) {
      expect(await screen.findByRole('button', { name })).toBeEnabled();
    }
  });
});
