import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MonsterQuest } from './MonsterQuest';
import type { RushQuestion } from '../lib';

afterEach(cleanup);

const QUESTIONS: RushQuestion[] = [
  { id: 'a', prompt: 'Pick alpha', choices: ['Alpha', 'Beta', 'Gamma', 'Delta'], correctIndex: 0, explanation: 'Alpha it is.' },
  { id: 'b', prompt: 'Pick beta', choices: ['Alpha', 'Beta', 'Gamma', 'Delta'], correctIndex: 1, explanation: 'Beta it is.' },
  { id: 'c', prompt: 'Pick gamma', choices: ['Alpha', 'Beta', 'Gamma', 'Delta'], correctIndex: 2, explanation: 'Gamma it is.' },
];

function startQuest() {
  render(<MonsterQuest questions={QUESTIONS} onComplete={vi.fn()} onExit={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Start quest' }));
}

const distance = () => screen.getByText(/\d+ m$/).textContent;

describe('MonsterQuest', () => {
  it('resumes walking when one of two held directions is released', async () => {
    startQuest();
    const start = distance();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => expect(distance()).not.toBe(start));

    // Both held: the knight stands still. Releasing Left must resume the walk right.
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    await new Promise((r) => setTimeout(r, 80));
    const paused = distance();
    fireEvent.keyUp(window, { key: 'ArrowLeft' });
    await waitFor(() => expect(distance()).not.toBe(paused));
    fireEvent.keyUp(window, { key: 'ArrowRight' });
  });

  it('clears the damage popup after a hit instead of leaving a faint ghost', async () => {
    startQuest();
    fireEvent.click(screen.getByRole('button', { name: 'Skip to battle' }));
    const prompt = await screen.findByText(/^Pick (alpha|beta|gamma)$/);
    const answer = { 'Pick alpha': /Alpha$/, 'Pick beta': /Beta$/, 'Pick gamma': /Gamma$/ }[prompt.textContent!]!;
    fireEvent.click(screen.getByRole('button', { name: answer }));

    expect(await screen.findByText('-1 HP')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('-1 HP')).not.toBeInTheDocument(), { timeout: 2500 });
  });
});
