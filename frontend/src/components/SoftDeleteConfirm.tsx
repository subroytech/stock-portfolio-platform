// The owner's Delete warning (Lifecycle: Active -> Soft-Delete). Shared by the Legacy Dashboard's
// portfolio selector and the Flex page's portfolio pills, so the wording and the confirm step stay
// identical. Confirming only hides the portfolio from the owner; an admin can restore it.

export function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface SoftDeleteConfirmProps {
  name: string;
  isPending: boolean;
  errorMessage: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function SoftDeleteConfirm({ name, isPending, errorMessage, onConfirm, onCancel }: SoftDeleteConfirmProps) {
  return (
    <div
      role="alertdialog"
      aria-labelledby="delete-portfolio-title"
      data-testid="delete-portfolio-warning"
      className="flex w-full flex-col gap-2 rounded-card border border-danger/40 bg-danger/5 p-3"
    >
      <p id="delete-portfolio-title" className="text-sm text-text-primary">
        This will remove the portfolio <strong>{name}</strong>. To get it restored you will have to raise a
        support ticket, and restoration may not be guaranteed.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={isPending}
          data-testid="delete-portfolio-confirm"
          className="rounded-btn bg-danger px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-60"
        >
          {isPending ? 'Deleting…' : 'Delete portfolio'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-btn border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-primary"
        >
          Cancel
        </button>
      </div>
      {errorMessage && <p className="text-xs text-danger">{errorMessage}</p>}
    </div>
  );
}
