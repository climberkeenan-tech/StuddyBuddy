import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Markdown } from './Markdown';

afterEach(cleanup);

describe('Markdown', () => {
  it('renders headings, bold, inline code, and lists', () => {
    const src = ['# Title', '', 'Some **bold** and `code` here.', '', '- first', '- second'].join('\n');
    render(<Markdown>{src}</Markdown>);

    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument();
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getByText('code').tagName).toBe('CODE');
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('renders links with a safe target', () => {
    render(<Markdown>{'See [the docs](https://example.com) now.'}</Markdown>);
    const link = screen.getByRole('link', { name: 'the docs' });
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('renders fenced code blocks and pipe tables', () => {
    const src = ['```', 'const x = 1;', '```', '', '| A | B |', '| - | - |', '| 1 | 2 |'].join('\n');
    render(<Markdown>{src}</Markdown>);
    expect(screen.getByText('const x = 1;')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'A' })).toBeInTheDocument();
  });
});
