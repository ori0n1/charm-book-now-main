import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://pwmdzpvnatrvfpgcvnzg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_F76-CiLv1Rvar307TdLRjg_8pphwxQP";

const STUDIO_SLUG = "bellza";
const STUDIO_ID = "012e3a9a-dcbf-4f4b-95ae-02707abedc85";
const STAFF_ID = "b12274c7-f315-47c6-9cbf-578832d284e6";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function nextMondayDate() {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  const daysUntilMonday = (8 - date.getUTCDay()) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + daysUntilMonday);
  return date.toISOString().slice(0, 10);
}

test("get_available_slots returns real future availability for active Bellza staff", async () => {
  const futureWorkingDate = nextMondayDate();

  const { data: studio, error: studioError } = await supabase
    .from("studios")
    .select("id, slug, timezone, min_booking_notice_min, is_active")
    .eq("slug", STUDIO_SLUG)
    .single();

  expect(studioError).toBeNull();
  expect(studio).toMatchObject({
    id: STUDIO_ID,
    slug: STUDIO_SLUG,
    timezone: "Europe/Lisbon",
    is_active: true,
  });

  const { data: staff, error: staffError } = await supabase
    .from("staff")
    .select("id, is_active, current_status")
    .eq("id", STAFF_ID)
    .eq("studio_id", STUDIO_ID)
    .single();

  expect(staffError).toBeNull();
  expect(staff).toMatchObject({ id: STAFF_ID, is_active: true });
  expect(staff?.current_status).not.toBe("absent");

  const { data: windows, error: windowsError } = await supabase
    .from("staff_availability")
    .select("weekday, start_time, end_time")
    .eq("studio_id", STUDIO_ID)
    .eq("staff_id", STAFF_ID)
    .eq("weekday", 1);

  expect(windowsError).toBeNull();
  expect(windows?.length).toBeGreaterThan(0);
  expect(windows?.[0]).toMatchObject({ start_time: "09:00:00", end_time: "18:00:00" });

  const { data: slots10, error: slots10Error } = await supabase.rpc("get_available_slots", {
    p_studio_slug: STUDIO_SLUG,
    p_staff_id: STAFF_ID,
    p_date: futureWorkingDate,
    p_duration_min: 10,
    p_slot_step_min: 15,
  });

  expect(slots10Error).toBeNull();
  expect(slots10?.length).toBeGreaterThan(0);
  expect(slots10?.[0]).toMatchObject({ staff_id: STAFF_ID, slot_label: "09:00" });

  const { data: services, error: servicesError } = await supabase
    .from("services")
    .select("id, name, duration_min, is_active")
    .eq("studio_id", STUDIO_ID)
    .eq("is_active", true)
    .gt("duration_min", 0)
    .order("duration_min", { ascending: true });

  expect(servicesError).toBeNull();
  expect(services?.length).toBeGreaterThan(0);

  const shortestService = services?.[0];
  expect(shortestService?.duration_min).toBeGreaterThan(0);

  const { data: realServiceSlots, error: realServiceSlotsError } = await supabase.rpc(
    "get_available_slots",
    {
      p_studio_slug: STUDIO_SLUG,
      p_staff_id: STAFF_ID,
      p_date: futureWorkingDate,
      p_duration_min: shortestService?.duration_min ?? 0,
      p_slot_step_min: 15,
    },
  );

  expect(realServiceSlotsError).toBeNull();
  expect(realServiceSlots?.length).toBeGreaterThan(0);
});
