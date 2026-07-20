import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PageTitleProvider } from '@renderer/lib/hooks';
import { api } from '@renderer/lib/api';
import RecordPage from './RecordPage';

afterEach(cleanup);

function renderRecord(entry = '/record?courseId=course-bio') {
  return render(
    <PageTitleProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/record" element={<RecordPage />} />
          <Route
            path="/courses/:courseId/lectures/:lectureId"
            element={<div>Lecture workspace</div>}
          />
        </Routes>
      </MemoryRouter>
    </PageTitleProvider>,
  );
}

describe('RecordPage', () => {
  it('shows the honest web-preview banner instead of pretending to record', async () => {
    renderRecord();
    expect(await screen.findByText(/Web preview\./i)).toBeInTheDocument();
  });

  it('explains that real recording needs the desktop app rather than fabricating one', async () => {
    // In the browser preview (mock backend) the app must never invent a recording;
    // pressing Record surfaces an honest explainer and starts no session.
    const startSpy = vi.spyOn(api.recording, 'start');
    renderRecord();

    await userEvent.click(await screen.findByRole('button', { name: 'Start recording' }));

    expect(
      await screen.findByText(/Real recording lives in the desktop app/i),
    ).toBeInTheDocument();
    // No capture session was started, and the fake stop/save controls never appear.
    expect(startSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Stop & save/i })).not.toBeInTheDocument();
    startSpy.mockRestore();
  });
});
