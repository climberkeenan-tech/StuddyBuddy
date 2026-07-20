import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PageTitleProvider } from '@renderer/lib/hooks';
import { api } from '@renderer/lib/api';
import CoursePage from './CoursePage';

afterEach(cleanup);

function renderCourse(courseId = 'course-bio') {
  return render(
    <PageTitleProvider>
      <MemoryRouter initialEntries={[`/courses/${courseId}`]}>
        <Routes>
          <Route path="/courses/:courseId" element={<CoursePage />} />
          <Route path="/" element={<div>Home</div>} />
        </Routes>
      </MemoryRouter>
    </PageTitleProvider>,
  );
}

describe('CoursePage', () => {
  it('renders the course identity and its lectures from the mock api', async () => {
    renderCourse('course-bio');

    // Course header identity.
    expect(await screen.findByRole('heading', { name: /Biology/ })).toBeInTheDocument();
    expect(screen.getByText(/Dr\. Elena Vasquez/)).toBeInTheDocument();

    // Seeded lectures for the biology course.
    expect(await screen.findByText('DNA Replication')).toBeInTheDocument();
    expect(screen.getByText('Cell Division: Mitosis & Meiosis')).toBeInTheDocument();
  });

  it('imports a demo lecture through the api and refreshes the list', async () => {
    const spy = vi.spyOn(api.lectures, 'importDemo');
    renderCourse('course-bio');

    await screen.findByText('DNA Replication');

    await userEvent.click(screen.getByRole('button', { name: /Import demo/i }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith('course-bio'));
    expect(await screen.findByText('Imported Demo Lecture')).toBeInTheDocument();
    spy.mockRestore();
  });

  it('shows an empty state when a course has no lectures', async () => {
    const empty = await api.courses.create({
      name: 'Astrophysics',
      instructor: 'Dr. Sagan',
      semester: 'Fall 2026',
      color: '#2563eb',
      icon: 'atom',
    });
    renderCourse(empty.id);

    expect(await screen.findByText('No lectures yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Import demo lecture/i })).toBeInTheDocument();
  });

  it('renames a lecture inline via the kebab menu', async () => {
    const spy = vi.spyOn(api.lectures, 'update');
    renderCourse('course-bio');

    const title = await screen.findByText('DNA Replication');
    const row = title.closest('[role="button"]') as HTMLElement;

    await userEvent.click(within(row).getByRole('button', { name: /Options for DNA Replication/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));

    const input = await screen.findByLabelText('Lecture title');
    await userEvent.clear(input);
    await userEvent.type(input, 'DNA Replication (edited){Enter}');

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('lec-bio-1', { title: 'DNA Replication (edited)' }),
    );
    spy.mockRestore();
  });
});
