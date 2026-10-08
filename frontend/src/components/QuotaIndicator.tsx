import { isAtOrOverLimit, type QuotaMetric } from '../api/flexQuota';

interface QuotaIndicatorProps {
  label: string;
  metric: QuotaMetric;
  testId: string;
}

// Flex Portfolio quota UX polish (2026-09-06) - an always-visible current/limit indicator,
// shared by the Create Portfolio and Save Template flows, so a user has visibility into their
// limit before they ever hit it, not just after a 409. Switches to a warning style with a
// clear call-to-action once at/over the limit.
export default function QuotaIndicator({ label, metric, testId }: QuotaIndicatorProps) {
  const atLimit = isAtOrOverLimit(metric);
  return (
    <p
      data-testid={testId}
      className={`text-xs ${atLimit ? 'font-medium text-warning' : 'text-text-secondary'}`}
    >
      {label}: {metric.current}/{metric.limit}
      {atLimit && ' — limit reached. Ask an admin to raise it.'}
    </p>
  );
}
