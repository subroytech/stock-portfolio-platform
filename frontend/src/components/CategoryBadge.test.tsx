import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import CategoryBadge from './CategoryBadge';

describe('CategoryBadge', () => {
  test('renders the right letter and full-name tooltip for each category', () => {
    const cases: { category: Parameters<typeof CategoryBadge>[0]['category']; letter: string }[] = [
      { category: 'Definition', letter: 'D' },
      { category: 'Interpretation', letter: 'I' },
      { category: 'Reliability', letter: 'R' },
      { category: 'How to Use', letter: 'U' },
      { category: 'Common Mistakes', letter: '!' },
    ];

    for (const { category, letter } of cases) {
      const { unmount } = render(<CategoryBadge category={category} />);
      const badge = screen.getByTestId('category-badge');
      expect(badge).toHaveTextContent(letter);
      expect(badge).toHaveAttribute('title', category);
      unmount();
    }
  });

  test('each category gets a visually distinct background color', () => {
    const categories: Parameters<typeof CategoryBadge>[0]['category'][] = [
      'Definition', 'Interpretation', 'Reliability', 'How to Use', 'Common Mistakes',
    ];
    const classNames = new Set<string>();
    for (const category of categories) {
      const { container, unmount } = render(<CategoryBadge category={category} />);
      classNames.add(container.querySelector('[data-testid="category-badge"]')!.className);
      unmount();
    }
    expect(classNames.size).toBe(categories.length);
  });
});
