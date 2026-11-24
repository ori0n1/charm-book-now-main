import test from "node:test";
import assert from "node:assert/strict";
import { dateKeysBetween, periodDateKeys, summarizeProfessionalHistory, validPerformanceRange } from "../src/lib/professional-history.ts";

test("periods include today and respect calendar boundaries", () => {
  for (const days of [1, 7, 15, 30]) {
    const keys = periodDateKeys("2026-11-04", days);
    assert.equal(keys.length, days);
    assert.equal(keys.at(-1), "2026-11-04");
    assert.equal(keys[0], new Date(Date.UTC(2026, 10, 5 - days)).toISOString().slice(0, 10));
  }
  assert.equal(periodDateKeys("2026-03-01", 7)[0], "2026-02-23");
});

test("custom dates include both boundaries across month and leap-day changes", () => {
  assert.deepEqual(dateKeysBetween("2028-02-28", "2028-03-01"), [
    "2028-02-28", "2028-02-29", "2028-03-01",
  ]);
  assert.deepEqual(dateKeysBetween("2026-11-04", "2026-11-04"), ["2026-11-04"]);
});

test("custom range rejects invalid dates and excessive spans", () => {
  assert.equal(validPerformanceRange("2028-02-29", "2028-03-01"), true);
  assert.equal(validPerformanceRange("2026-01-01", "2027-01-01"), true);
  assert.equal(validPerformanceRange("2026-01-01", "2027-01-02"), false);
  assert.equal(validPerformanceRange("2026-02-30", "2026-03-01"), false);
  assert.equal(validPerformanceRange("2026-03-02", "2026-03-01"), false);
});

test("appointments are unique per professional and service lines remain distinct", () => {
  const result = summarizeProfessionalHistory(["ana", "paula"], ["2026-11-03", "2026-11-04"], [
    { staffId: "ana", appointmentId: "joint", date: "2026-11-03" },
    { staffId: "ana", appointmentId: "joint", date: "2026-11-03" },
    { staffId: "paula", appointmentId: "joint", date: "2026-11-03" },
    { staffId: "ana", appointmentId: "second", date: "2026-11-04" },
    { staffId: "unknown", appointmentId: "private", date: "2026-11-04" },
  ], [
    { staffId: "ana", lineId: "one", serviceId: "cut", name: "Corte", date: "2026-11-03" },
    { staffId: "ana", lineId: "two", serviceId: "cut", name: "Corte", date: "2026-11-03" },
    { staffId: "ana", lineId: "two", serviceId: "cut", name: "Corte", date: "2026-11-03" },
    { staffId: "ana", lineId: "three", serviceId: "color", name: "Cor", date: "2026-11-04" },
    { staffId: "paula", lineId: "four", serviceId: "color", name: "Cor", date: "2026-11-03" },
    { staffId: "unknown", lineId: "private", serviceId: "private", name: "Privado", date: "2026-11-04" },
  ]);
  assert.equal(result.ana.completed, 2);
  assert.deepEqual(result.ana.evolution.map((day) => day.completed), [1, 1]);
  assert.deepEqual(result.ana.evolution.map((day) => day.services), [
    [{ serviceId: "cut", name: "Corte", count: 2 }],
    [{ serviceId: "color", name: "Cor", count: 1 }],
  ]);
  assert.deepEqual(result.ana.topServices, [
    { serviceId: "cut", name: "Corte", count: 2, percent: 66.7 },
    { serviceId: "color", name: "Cor", count: 1, percent: 33.3 },
  ]);
  assert.equal(result.paula.completed, 1);
  assert.deepEqual(result.paula.topServices, [{ serviceId: "color", name: "Cor", count: 1, percent: 100 }]);
  assert.equal(result.unknown, undefined);
});

test("services with the same display name retain separate identities", () => {
  const result = summarizeProfessionalHistory(["ana"], ["2026-11-04"], [], [
    { staffId: "ana", lineId: "one", serviceId: "basic", name: "Corte", date: "2026-11-04" },
    { staffId: "ana", lineId: "two", serviceId: "premium", name: "Corte", date: "2026-11-04" },
  ]);
  assert.equal(result.ana.topServices.length, 2);
  assert.deepEqual(result.ana.topServices.map((item) => item.percent), [50, 50]);
  assert.deepEqual(result.ana.evolution[0].services.map((item) => item.count), [1, 1]);
});
