import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PageTitleProvider } from '@renderer/lib/hooks';
import SearchPage from './SearchPage';

afterEach(cleanup);

function renderPage(entry = '/search') {
  return render(
    <PageTitleProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/search" element={<SearchPage />} />
          <Route
            path="/courses/:courseId/lectures/:lectureId"
            element={<div>Lecture workspace</div>}
          />
        </Routes>
      </MemoryRouter>
    </PageTitleProvider>,
  );
}

describe('SearchPage', () => {
  it('answers a question with a grounded citation (Ask mode)', async () => {
    renderPage();

    const input = await screen.findByLabelText('Ask a question about your lectures');
    await userEvent.type(input, 'replication{Enter}');

    // The question echoes into the session transcript immediately.
    expect(await screen.findByText('replication')).toBeInTheDocument();

    // The grounded answer + at least one citation resolve from the mock.
    expect(await screen.findByText(/Based on your lectures/i)).toBeInTheDocument();
    expect(await screen.findByText('Sources:')).toBeInTheDocument();

    // A citation card carries a jump-to-source control.
    expect(await screen.findByRole('button', { name: 'Jump to source 1' })).toBeInTheDocument();
  });

  it('kindly reports when nothing matches (Ask mode)', async () => {
    renderPage();

    const input = await screen.findByLabelText('Ask a question about your lectures');
    await userEvent.type(input, 'zzznonexistenttopic{Enter}');

    expect(await screen.findByText(/No lecture matched this yet/i)).toBeInTheDocument();
  });

  it('returns ranked hits (Search mode)', async () => {
    renderPage();

    await userEvent.click(await screen.findByRole('radio', { name: /Search/i }));

    const input = await screen.findByLabelText('Search transcripts');
    await userEvent.type(input, 'replication');

    // Debounced search resolves ranked hits from the mock.
    await waitFor(() =>
      expect(screen.getByText(/result(s)?$/)).toBeInTheDocument(),
    );
    expect(await screen.findAllByText('Biology')).not.toHaveLength(0);
  });
});
