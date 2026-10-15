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

    // The five games appear as cards.
    expect(await screen.findByRole('heading', { name: 'Quiz Rush' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Concept Match' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Memory Game' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Concept Map' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Monster Quest' })).toBeInTheDocument();

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
    for (const name of [
      'Start Quiz Rush',
      'Start Concept Match',
      'Start Memory Game',
      'Start Concept Map',
      'Start Monster Quest',
    ]) {
      expect(await screen.findByRole('button', { name })).toBeEnabled();
    }
  });

  it('walks the Monster Quest hero to the monster and wins the battle', async () => {
    const spy = vi.spyOn(api.gamification, 'recordEvent');
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Start Monster Quest' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start quest' }));

    // Exploring: the scene and walk controls are up. Holding a walk key moves
    // the hero toward the lair; then skip the rest of the walk.
    expect(screen.getByRole('img', { name: /walks through a valley/ })).toBeInTheDocument();
    const distance = () => screen.getByText(/\d+ m$/).textContent;
    const before = distance();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => expect(distance()).not.toBe(before));
    fireEvent.keyUp(window, { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('button', { name: 'Skip to battle' }));

    // Battle: the seeded lecture has three questions, so three hits win.
    expect(await screen.findByText(/A wild Muddlebeast blocks the path!/)).toBeInTheDocument();
    const correct = /Semi-conservative|Lagging strand|DNA ligase/;
    for (let i = 0; i < 3; i++) {
      fireEvent.click(await screen.findByRole('button', { name: correct }));
      const advance = i < 2 ? /Next question/ : /Claim victory/;
      fireEvent.click(await screen.findByRole('button', { name: advance }));
    }

    expect(await screen.findByText('Outstanding')).toBeInTheDocument();
    expect(screen.getByText(/You defeated the Muddlebeast with 3 hearts to spare/)).toBeInTheDocument();
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'game-completed',
          lectureId: 'lec-bio-1',
          data: expect.objectContaining({ game: 'quest', won: true, scorePct: 100 }),
        }),
      ),
    );

    spy.mockRestore();
  });
});
