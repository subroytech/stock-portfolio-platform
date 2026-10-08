import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import SecurityQuestionPicker from './SecurityQuestionPicker';

const QUESTIONS = Array.from({ length: 9 }, (_, i) => ({ id: `q${i + 1}`, questionText: `Question ${i + 1}` }));
const EMPTY_SLOTS = Array(5).fill(null);

describe('SecurityQuestionPicker', () => {
  test('renders 5 slots, each defaulting to the placeholder option', () => {
    render(<SecurityQuestionPicker questions={QUESTIONS} requiredCount={5} slotSelections={EMPTY_SLOTS} answers={{}} onSlotChange={vi.fn()} onAnswerChange={vi.fn()} />);
    for (let i = 0; i < 5; i++) {
      expect(screen.getByTestId(`security-question-slot-${i}`)).toHaveValue('');
    }
    expect(screen.getByTestId('security-question-count')).toHaveTextContent('0 of 5 answered');
  });

  test('the first slot offers all 15 (well, 9 in this fixture) questions when nothing is selected anywhere', () => {
    render(<SecurityQuestionPicker questions={QUESTIONS} requiredCount={5} slotSelections={EMPTY_SLOTS} answers={{}} onSlotChange={vi.fn()} onAnswerChange={vi.fn()} />);
    const slot0 = screen.getByTestId('security-question-slot-0');
    // +1 for the "— select a question —" placeholder option.
    expect(within(slot0).getAllByRole('option')).toHaveLength(QUESTIONS.length + 1);
  });

  test('once slot 0 picks a question, that question disappears from slot 1\'s options (but stays in slot 0\'s own)', () => {
    const slots = ['q1', null, null, null, null];
    render(<SecurityQuestionPicker questions={QUESTIONS} requiredCount={5} slotSelections={slots} answers={{}} onSlotChange={vi.fn()} onAnswerChange={vi.fn()} />);

    const slot0Options = within(screen.getByTestId('security-question-slot-0')).getAllByRole('option').map((o) => o.getAttribute('value'));
    expect(slot0Options).toContain('q1');

    const slot1Options = within(screen.getByTestId('security-question-slot-1')).getAllByRole('option').map((o) => o.getAttribute('value'));
    expect(slot1Options).not.toContain('q1');
    expect(slot1Options).toHaveLength(QUESTIONS.length); // 9 remaining + placeholder - the picked one
  });

  test('an answer input only appears once a slot has picked a question', () => {
    const slots = ['q2', null, null, null, null];
    render(<SecurityQuestionPicker questions={QUESTIONS} requiredCount={5} slotSelections={slots} answers={{}} onSlotChange={vi.fn()} onAnswerChange={vi.fn()} />);
    expect(screen.getByTestId('security-question-answer-q2')).toBeInTheDocument();
    expect(screen.queryByTestId('security-question-answer-q1')).not.toBeInTheDocument();
  });

  test('picking a question in a slot calls onSlotChange with that slot index and question id', async () => {
    const onSlotChange = vi.fn();
    render(<SecurityQuestionPicker questions={QUESTIONS} requiredCount={5} slotSelections={EMPTY_SLOTS} answers={{}} onSlotChange={onSlotChange} onAnswerChange={vi.fn()} />);
    await userEvent.selectOptions(screen.getByTestId('security-question-slot-2'), 'q5');
    expect(onSlotChange).toHaveBeenCalledWith(2, 'q5');
  });

  test('resetting a slot back to the placeholder calls onSlotChange with null', async () => {
    const onSlotChange = vi.fn();
    const slots = ['q3', null, null, null, null];
    render(<SecurityQuestionPicker questions={QUESTIONS} requiredCount={5} slotSelections={slots} answers={{}} onSlotChange={onSlotChange} onAnswerChange={vi.fn()} />);
    await userEvent.selectOptions(screen.getByTestId('security-question-slot-0'), '');
    expect(onSlotChange).toHaveBeenCalledWith(0, null);
  });

  test('typing in an answer box calls onAnswerChange with the question id and value', async () => {
    const onAnswerChange = vi.fn();
    const slots = ['q1', null, null, null, null];
    render(<SecurityQuestionPicker questions={QUESTIONS} requiredCount={5} slotSelections={slots} answers={{}} onSlotChange={vi.fn()} onAnswerChange={onAnswerChange} />);
    await userEvent.type(screen.getByTestId('security-question-answer-q1'), 'x');
    expect(onAnswerChange).toHaveBeenCalledWith('q1', 'x');
  });

  test('answer inputs enforce the 20-character max length', () => {
    const slots = ['q1', null, null, null, null];
    render(<SecurityQuestionPicker questions={QUESTIONS} requiredCount={5} slotSelections={slots} answers={{}} onSlotChange={vi.fn()} onAnswerChange={vi.fn()} />);
    expect(screen.getByTestId('security-question-answer-q1')).toHaveAttribute('maxlength', '20');
  });

  test('the answered count only counts slots with both a question and a non-empty answer', () => {
    const slots = ['q1', 'q2', null, null, null];
    render(<SecurityQuestionPicker questions={QUESTIONS} requiredCount={5} slotSelections={slots} answers={{ q1: 'filled' }} onSlotChange={vi.fn()} onAnswerChange={vi.fn()} />);
    expect(screen.getByTestId('security-question-count')).toHaveTextContent('1 of 5 answered');
  });
});
