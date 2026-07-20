import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs, type TabItem } from './Tabs';

afterEach(cleanup);

const items: TabItem[] = [
  { value: 'notes', label: 'Notes' },
  { value: 'cards', label: 'Flashcards' },
  { value: 'quiz', label: 'Quiz' },
];

describe('Tabs', () => {
  it('marks the active tab and calls onChange when another is clicked', async () => {
    const onChange = vi.fn();
    render(<Tabs items={items} value="notes" onChange={onChange} aria-label="Materials" />);

    const active = screen.getByRole('tab', { name: 'Notes' });
    expect(active).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(screen.getByRole('tab', { name: 'Quiz' }));
    expect(onChange).toHaveBeenCalledWith('quiz');
  });

  it('moves selection with arrow keys', async () => {
    const onChange = vi.fn();
    render(<Tabs items={items} value="notes" onChange={onChange} />);
    const active = screen.getByRole('tab', { name: 'Notes' });
    active.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('cards');
  });
});
