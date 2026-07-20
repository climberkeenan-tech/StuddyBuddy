import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PageTitleProvider } from '@renderer/lib/hooks';
import LecturePage from './LecturePage';

afterEach(cleanup);

/** Render the lecture workspace for the seeded, fully-materialed bio lecture. */
function renderPage() {
  return render(
    <PageTitleProvider>
      <MemoryRouter initialEntries={['/courses/course-bio/lectures/lec-bio-1']}>
        <Routes>
          <Route path="/courses/:courseId/lectures/:lectureId" element={<LecturePage />} />
        </Routes>
      </MemoryRouter>
    </PageTitleProvider>,
  );
}

async function goToTab(name: RegExp) {
  const tab = await screen.findByRole('tab', { name });
  fireEvent.click(tab);
}

describe('LecturePage', () => {
  it('renders the header, transcript, notes and concepts', async () => {
    renderPage();

    // Sticky header title.
    expect(await screen.findByRole('heading', { level: 1, name: 'DNA Replication' })).toBeInTheDocument();

    // Transcript tab is the default view.
    expect(await screen.findByText(/Today we are going to walk through/)).toBeInTheDocument();
    expect(screen.getByText(/Professor asked/)).toBeInTheDocument();

    // Notes tab renders structured note blocks.
    await goToTab(/Notes/);
    expect(await screen.findByText('At the Replication Fork')).toBeInTheDocument();

    // Concepts tab renders concept cards (the name also appears in watchlists).
    await goToTab(/Concepts/);
    expect((await screen.findAllByText('Semi-conservative replication')).length).toBeGreaterThan(0);
  });

  it('opens the concept explainer and loads an AI explanation', async () => {
    renderPage();
    await goToTab(/Concepts/);

    const conceptCard = await screen.findByRole('button', { name: 'Explain Semi-conservative replication' });
    fireEvent.click(conceptCard);

    // Modal opens and the mock explanation streams in.
    expect(await screen.findByText(/in plain terms/i)).toBeInTheDocument();
  });

  it('flips a flashcard to reveal its answer', async () => {
    renderPage();
    await goToTab(/Study/);

    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));

    // Front is shown first.
    expect(await screen.findByText(/What does/)).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Show answer' }));
    expect(await screen.findByText(/Each new DNA molecule keeps one original strand/)).toBeInTheDocument();
  });

  it('answers a multiple-choice question and reveals feedback', async () => {
    renderPage();
    await goToTab(/Study/);

    fireEvent.click(await screen.findByRole('button', { name: 'Take quiz' }));

    // First question prompt.
    expect(await screen.findByText('DNA replication is best described as:')).toBeInTheDocument();

    // Choose the correct answer and see feedback.
    fireEvent.click(await screen.findByRole('button', { name: /Semi-conservative/ }));
    await waitFor(() => expect(screen.getByText(/Correct!/)).toBeInTheDocument());
  });
});
