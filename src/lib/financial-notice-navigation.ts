export function financialNoticeActionUrl(notice: { id: string }) {
  const payoutId = /^payout:(po_[A-Za-z0-9]+):paid$/.exec(notice.id)?.[1];
  return payoutId
    ? `/admin/recebimento?payout=${encodeURIComponent(payoutId)}`
    : "/admin/recebimento";
}
