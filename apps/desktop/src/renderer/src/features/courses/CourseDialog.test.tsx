import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CourseDialog } from './CourseDialog';

afterEach(cleanup);

describe('CourseDialog', () => {
  it('validates that a name is required before saving', async () => {
    const onSaved = vi.fn();
    render(<CourseDialog open onClose={() => {}} onSaved={onSaved} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add course' }));
    expect(await screen.findByText('Give your course a name.')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('creates a course through the mock api and reports it via onSaved', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<CourseDialog open onClose={onClose} onSaved={onSaved} />);

    await userEvent.type(screen.getByLabelText('Course name'), 'Organic Chemistry');
    await userEvent.type(screen.getByLabelText('Instructor'), 'Dr. Bloom');
    await userEvent.click(screen.getByRole('button', { name: 'Add course' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const created = onSaved.mock.calls[0]![0];
    expect(created.name).toBe('Organic Chemistry');
    expect(created.instructor).toBe('Dr. Bloom');
    expect(created.id).toBeTruthy();
    expect(onClose).toHaveBeenCalled();
  });
});
