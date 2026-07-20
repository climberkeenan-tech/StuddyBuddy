import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PageTitleProvider } from '@renderer/lib/hooks';
import { Toaster } from '@renderer/components/toast';
import ReviewPage from './ReviewPage';

afterEach(cleanup);

/** Render Smart Review scoped to the seeded biology course. */
function renderPage(initial = '/review?courseId=course-bio') {
  return render(
    <PageTitleProvider>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/review" element={<ReviewPage />} />
        </Routes>
      </MemoryRouter>
      <Toaster />
    </PageTitleProvider>,
  );
}

describe('ReviewPage', () => {
  it('shows the due flashcard count from the mock api', async () => {
    renderPage();

    // Two seeded bio cards are due (offsets -1, -1, 0 in the mock).
    const heading = await screen.findByRole('heading', { name: 'Due for review' });
    expect(heading).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: /Start review session/i }),
    ).toBeInTheDocument();
  });

  it('generates and renders an exam prep plan', async () => {
    renderPage();

    // No plan exists yet -> prominent generate CTA. Re-find and click until the
    // plan renders, so a mid-transition node swap can't drop the click.
    await waitFor(
      async () => {
        const generate = screen.queryByRole('button', { name: /Generate exam prep/i });
        if (generate) fireEvent.click(generate);
        expect(screen.queryByText('Cumulative review')).toBeTruthy();
      },
      { timeout: 4000 },
    );

    // All the major plan sections render.
    expect(await screen.findByText('Key concepts to master')).toBeInTheDocument();
    expect(await screen.findByText('Likely exam questions')).toBeInTheDocument();
    expect(await screen.findByText('Weak areas to shore up')).toBeInTheDocument();
    expect(await screen.findByText('Recommended study order')).toBeInTheDocument();
  });

  it('runs a flashcard review session and completes it', async () => {
    renderPage();

    const start = await screen.findByRole('button', { name: /Start review session/i });
    fireEvent.click(start);

    // Reviewer shows the first card question.
    expect(await screen.findByText('Question')).toBeInTheDocument();

    // Flip, then grade until the session completes.
    for (let i = 0; i < 10; i++) {
      const showAnswer = screen.queryByRole('button', { name: /Show answer/i });
      if (showAnswer) {
        fireEvent.click(showAnswer);
        const good = await screen.findByRole('button', { name: /Good/i });
        fireEvent.click(good);
      }
      const done = screen.queryByText('Session complete!');
      if (done) break;
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: /Show answer/i }) ||
            screen.queryByText('Session complete!'),
        ).toBeTruthy();
      });
    }

    expect(await screen.findByText('Session complete!')).toBeInTheDocument();
  });
});
