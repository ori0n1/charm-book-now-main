import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const agendaSource = readFile("src/routes/_authenticated/admin.agenda.tsx", "utf8");

test("Agenda initializes from the device local day and renders that month immediately", async () => {
  const source = await agendaSource;

  expect(source).toContain(
    "const [selectedDate, setSelectedDate] = useState(() => startOfLocalDay(new Date()))",
  );
  expect(source).toContain("const mobileCalendarMonth = selectedDate");
  expect(source).not.toContain("setMobileCalendarMonth(");
  expect(source).toContain("selectedButton.offsetLeft - (scroller.clientWidth");
  expect(source).not.toContain('behavior: "smooth"');
});

test("Today and PWA resume reset the selected day, month and mobile date anchor", async () => {
  const source = await agendaSource;

  expect(source).toContain("function resetAgendaToToday(now: Date = new Date())");
  expect(source).toContain("setMobileDateAnchor(today)");
  expect(source).toContain("setSelectedDate(today)");
  expect(source).toContain('document.addEventListener("visibilitychange", handleVisibilityChange)');
  expect(source.match(/onClick=\{\(\) => resetAgendaToToday\(\)\}/g)?.length).toBeGreaterThanOrEqual(2);
});

test("local calendar helpers do not parse the selected date as UTC", async () => {
  const source = await agendaSource;

  expect(source).toContain("new Date(value.getFullYear(), value.getMonth(), value.getDate())");
  expect(source).toContain("new Date(year, month - 1, day)");
  expect(source).not.toContain('new Date(value + "T00:00:00.000Z")');
});
