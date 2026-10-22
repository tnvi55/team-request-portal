import type { RequestStatus } from '@trp/contracts';

const LABEL: Record<RequestStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

/** Text + colour, so status is never conveyed by colour alone. */
export function StatusBadge({ status }: { status: RequestStatus }) {
  return <span className={`badge badge-${status.toLowerCase()}`}>{LABEL[status]}</span>;
}

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
