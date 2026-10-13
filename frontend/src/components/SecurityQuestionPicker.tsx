import type { SecurityQuestion } from '../api/auth';

const ANSWER_MAX_LENGTH = 20;

interface SecurityQuestionPickerProps {
  questions: SecurityQuestion[];
  requiredCount: number;
  // One entry per slot (always `requiredCount` long) - null means that slot hasn't picked a
  // question yet. Ordered/fixed-slot rather than an unordered "selected ids" list, so slot 1
  // always offers the full catalog and each later slot's dropdown narrows as earlier slots fill
  // in - the design explicitly asked for over a flat checkbox list.
  slotSelections: (string | null)[];
  answers: Record<string, string>;
  onSlotChange: (slotIndex: number, questionId: string | null) => void;
  onAnswerChange: (questionId: string, value: string) => void;
}

// Self-Registration & Password Policy - `requiredCount` fixed "Question N" slots, each a
// dropdown offering only questions not already picked in another slot (a question already
// selected in *this* slot stays in *this* slot's own options, so switching back to it is
// still possible). Answering only becomes available once a slot has picked a question. Shared
// by SignupPage.tsx (registration) and ManageSecurityQuestionsPage.tsx (post-login) - one
// picker, not two copies.
export default function SecurityQuestionPicker({ questions, requiredCount, slotSelections, answers, onSlotChange, onAnswerChange }: SecurityQuestionPickerProps) {
  const answeredCount = slotSelections.filter((id) => id != null && (answers[id] ?? '').trim().length > 0).length;

  return (
    <div>
      <p className="mb-2 text-xs text-text-secondary" data-testid="security-question-count">
        {answeredCount} of {requiredCount} answered. Each answer can be up to {ANSWER_MAX_LENGTH} characters.
      </p>
      <div className="space-y-3">
        {Array.from({ length: requiredCount }, (_, slotIndex) => {
          const selectedId = slotSelections[slotIndex] ?? '';
          // Available in this slot's dropdown: any question not picked in a DIFFERENT slot,
          // plus whichever question this slot itself currently holds (so it stays selectable).
          const availableForSlot = questions.filter(
            (q) => q.id === selectedId || !slotSelections.includes(q.id),
          );
          return (
            <div key={slotIndex} className="rounded-btn border border-border px-3 py-2">
              <label className="mb-1 block text-sm text-text-primary" htmlFor={`security-question-slot-${slotIndex}`}>
                Question {slotIndex + 1}
              </label>
              <select
                id={`security-question-slot-${slotIndex}`}
                value={selectedId}
                onChange={(e) => onSlotChange(slotIndex, e.target.value || null)}
                data-testid={`security-question-slot-${slotIndex}`}
                className="w-full rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
              >
                <option value="">— select a question —</option>
                {availableForSlot.map((q) => (
                  <option key={q.id} value={q.id}>{q.questionText}</option>
                ))}
              </select>
              {selectedId && (
                <input
                  required
                  maxLength={ANSWER_MAX_LENGTH}
                  value={answers[selectedId] ?? ''}
                  onChange={(e) => onAnswerChange(selectedId, e.target.value)}
                  placeholder="Your answer"
                  data-testid={`security-question-answer-${selectedId}`}
                  className="mt-2 w-full rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
