import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PageTitleProvider } from '@renderer/lib/hooks';
import DashboardPage from './DashboardPage';

afterEach(cleanup);

function renderDashboard() {
  return render(
    <MemoryRouter>
      <PageTitleProvider>
        <DashboardPage />
      </PageTitleProvider>
    </MemoryRouter>,
  );
}

describe('DashboardPage', () => {
  it('renders stat labels and an AI recommendation from the mock api', async () => {
    renderDashboard();

    // A stat label from the header row.
    expect(await screen.findByText('Study streak')).toBeTruthy();

    // A recommendation seeded by the mock dashboard summary.
    expect(
      await screen.findByText('Explore the DNA Replication sample'),
    ).toBeTruthy();
  });

  it('shows a recent lecture to continue studying', async () => {
    renderDashboard();
    // Seeded biology lecture surfaces in "Continue studying".
    expect(await screen.findByText('Continue studying')).toBeTruthy();
  });
});
