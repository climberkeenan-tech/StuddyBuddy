import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PageTitleProvider } from '@renderer/lib/hooks';
import { api, triggerMockEvent } from '@renderer/lib/api';
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
  it('starts a session (demo mode) and renders incoming transcript segments', async () => {
    renderRecord();

    await userEvent.click(await screen.findByRole('button', { name: 'Start recording' }));

    // The active view (session created) exposes the labelled stop control.
    await screen.findByRole('button', { name: /Stop & save/i });
    expect(await screen.findByText('Recording')).toBeInTheDocument();

    // Push a live segment for the active lecture and assert it renders.
    const { lectureId } = await api.recording.getStatus();
    expect(lectureId).toBeTruthy();
    triggerMockEvent('transcript:segments', {
      lectureId: lectureId as string,
      segments: [
        {
          id: 'seg-test-1',
          index: 0,
          startMs: 0,
          endMs: 2000,
          text: 'Today we are covering DNA replication.',
          kind: 'speech',
        },
      ],
    });

    expect(
      await screen.findByText('Today we are covering DNA replication.'),
    ).toBeInTheDocument();

    // Clean up the simulated recording loop.
    await api.recording.stop().catch(() => {});
  });

  it('stops the recording and navigates to the finished lecture', async () => {
    const stopSpy = vi.spyOn(api.recording, 'stop');
    renderRecord();

    await userEvent.click(await screen.findByRole('button', { name: 'Start recording' }));
    const stopButton = await screen.findByRole('button', { name: /Stop & save/i });

    await userEvent.click(stopButton);

    await waitFor(() => expect(stopSpy).toHaveBeenCalled());
    expect(await screen.findByText('Lecture workspace')).toBeInTheDocument();
    stopSpy.mockRestore();
  });
});
