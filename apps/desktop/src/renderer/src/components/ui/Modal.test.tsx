import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from './Modal';
import { Button } from './Button';

afterEach(cleanup);

describe('Modal', () => {
  it('renders in a portal with an accessible name and moves focus inside', async () => {
    render(
      <Modal open onClose={() => {}} title="Delete course">
        <Button>Confirm</Button>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Delete course' });
    expect(dialog).toBeInTheDocument();
    // Focus should land on the first focusable control inside the panel.
    await vi.waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Escapable">
        <p>content</p>
      </Modal>,
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on Escape when not dismissible', async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Locked" dismissible={false}>
        <p>content</p>
      </Modal>,
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    render(
      <Modal open={false} onClose={() => {}} title="Hidden">
        <p>content</p>
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
