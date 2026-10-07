import type { Category } from '../api/candlestickQuestionAnswer';

// Letter + color per category - explicit direction: replace the plain Category string with a
// small colored icon in dense UI (the browse list, the admin All Entries table), showing the full
// name via a tooltip instead. D/I/R follow the exact letters given; "How to Use"/"Common Mistakes"
// got U/! since a bare "?" reads as "uncertain" rather than "how-to" or "watch out for this" -
// easy to swap if a different pair is wanted.
const CATEGORY_BADGE: Record<Category, { letter: string; className: string }> = {
  Definition: { letter: 'D', className: 'bg-blue-500' },
  Interpretation: { letter: 'I', className: 'bg-indigo-500' },
  Reliability: { letter: 'R', className: 'bg-teal-500' },
  'How to Use': { letter: 'U', className: 'bg-orange-500' },
  'Common Mistakes': { letter: '!', className: 'bg-rose-500' },
};

interface CategoryBadgeProps {
  category: Category;
}

// title gives the full category name as a native tooltip on hover, per explicit direction ("Put
// the Detail String as Tool-Tip") - no extra tooltip library needed for a single-line hint.
export default function CategoryBadge({ category }: CategoryBadgeProps) {
  const { letter, className } = CATEGORY_BADGE[category];
  return (
    <span
      title={category}
      data-testid="category-badge"
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${className}`}
    >
      {letter}
    </span>
  );
}
