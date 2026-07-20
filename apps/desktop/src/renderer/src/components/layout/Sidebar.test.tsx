import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useAppStore } from '@renderer/stores/app-store';

afterEach(cleanup);

describe('Sidebar', () => {
  it('renders the brand and primary navigation', async () => {
    await useAppStore.getState().refreshCourses();
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    expect(screen.getByText('StuddyBuddy')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Dashboard/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Record/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ask AI/ })).toBeInTheDocument();
  });

  it('lists the seeded mock courses', async () => {
    await useAppStore.getState().refreshCourses();
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Biology')).toBeInTheDocument();
    expect(screen.getByText('European History')).toBeInTheDocument();
  });
});
