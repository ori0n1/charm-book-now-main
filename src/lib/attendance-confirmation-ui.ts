export type AttendanceReviewItem = {
  id: string;
  startsAt?: string;
  starts_at?: string;
};

export function attendancePendingSummaryLabel(count: number) {
  if (count === 1) return "1 atendimento para confirmar";
  return `${count} atendimentos para confirmar`;
}

export function buildAttendanceReviewState<T extends AttendanceReviewItem>(
  items: T[],
  focusedId: string | null,
) {
  const ordered = [...items].sort(
    (left, right) =>
      new Date(attendanceItemStartsAt(left)).getTime() -
      new Date(attendanceItemStartsAt(right)).getTime(),
  );
  const focused = focusedId ? ordered.find((item) => item.id === focusedId) ?? null : null;
  const visibleItems = focused ? [focused] : ordered;
  return {
    mode: focused ? ("single" as const) : ("group" as const),
    visibleItems,
    totalPending: ordered.length,
    summaryLabel: attendancePendingSummaryLabel(ordered.length),
  };
}

function attendanceItemStartsAt(item: AttendanceReviewItem) {
  return item.startsAt ?? item.starts_at ?? "";
}

export function isAttendanceClosingReview(
  now: Date,
  selectedDate: Date,
  availability: Array<{ endMinutes: number }>,
) {
  if (
    now.getFullYear() !== selectedDate.getFullYear() ||
    now.getMonth() !== selectedDate.getMonth() ||
    now.getDate() !== selectedDate.getDate() ||
    availability.length === 0
  ) {
    return false;
  }
  const closingMinutes = Math.max(...availability.map((period) => period.endMinutes));
  return now.getHours() * 60 + now.getMinutes() >= closingMinutes;
}
