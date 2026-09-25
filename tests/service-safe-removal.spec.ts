import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const migrationPath = "supabase/migrations/20260916120000_safe_service_removal.sql";
const baseSchemaPath =
  "supabase/migrations/20260512115441_9eb19473-af5f-4ee3-92a3-61cb9a18457a.sql";
const manualEntriesPath = "supabase/migrations/20260521170000_manual_service_entries.sql";

const read = (path: string) => readFileSync(path, "utf8");

test("A-D: deletion archives every service with booking or manual financial history", () => {
  const sql = read(migrationPath);
  expect(sql).toContain("FROM public.appointment_services");
  expect(sql).toContain("FROM public.manual_service_entries");
  expect(sql).toMatch(/IF v_has_history THEN[\s\S]*SET is_active = false/);
  expect(sql).toContain("RETURN 'archived'");
  expect(sql).not.toMatch(/DELETE FROM public\.appointment_services|DELETE FROM public\.appointments/);
  expect(sql).not.toMatch(/DELETE FROM public\.manual_service_entries|DELETE FROM public\.payments/);
});

test("E-G: unused services are physically deleted and archived services stay out of new bookings", () => {
  const sql = read(migrationPath);
  const publicCatalog = read("src/hooks/use-live-studio.ts");
  const bookingSql = read("supabase/migrations/20260907201000_plan_aware_public_booking.sql");
  const agenda = read("src/routes/_authenticated/admin.agenda.tsx");
  const frontDesk = read("src/routes/_authenticated/admin.balcao.tsx");

  expect(sql).toMatch(/IF v_has_history THEN[\s\S]*RETURN 'archived';[\s\S]*DELETE FROM public\.services/);
  expect(publicCatalog).toContain('loadPublicTable("public_services", "services"');
  expect(publicCatalog).toContain('.eq("is_active", true)');
  expect(bookingSql).toContain("AND service.is_active = true");
  expect(bookingSql).toContain("AND s.is_active = true");
  expect(agenda).toMatch(/\.from\("services" as any\)[\s\S]*?\.eq\("is_active", true\)/);
  expect(frontDesk).toMatch(/\.from\("services"\)[\s\S]*?\.eq\("is_active", true\)/);
});

test("H-I: owner authorization, tenant scoping, row locking and FK fallback are enforced", () => {
  const sql = read(migrationPath);
  expect(sql).toContain("public.has_role(auth.uid(), p_studio_id, 'studio_owner')");
  expect(sql).toMatch(/WHERE id = p_service_id\s+AND studio_id = p_studio_id\s+FOR UPDATE/);
  expect(sql).toContain("IF NOT FOUND THEN");
  expect(sql).toContain("WHEN foreign_key_violation THEN");
  expect(sql).toContain("FROM PUBLIC, anon");
  expect(sql).toContain("TO authenticated");
  expect(sql).toContain('DROP POLICY IF EXISTS "Members manage services"');
  expect(sql).not.toMatch(/CREATE POLICY[^;]+FOR DELETE/s);
});

test("J-L: UI serializes removal, uses a clear dialog and never exposes database errors", () => {
  const ui = read("src/routes/_authenticated/admin.servicos.tsx");
  const removalFlow = ui.slice(ui.indexOf("async function remove(service"), ui.indexOf("if (loading)"));
  expect(ui).toContain('supabase.rpc("remove_or_archive_service"');
  expect(ui).toContain("p_service_id: service.id");
  expect(ui).toContain("p_studio_id: studio.id");
  expect(ui).toContain("if (!studio || removingServiceId) return");
  expect(ui).toContain("Excluir serviço?");
  expect(ui).toContain("O histórico de\n              agendamentos será preservado.");
  expect(ui).toContain("Serviço excluído com sucesso.");
  expect(ui).toContain("foi arquivado para preservar o histórico.");
  expect(ui).toContain("Não foi possível remover o serviço. Tente novamente.");
  expect(ui).toContain("console.error");
  expect(removalFlow).not.toContain('toast.error(error.message)');
  expect(ui).not.toMatch(/from\("services"\)\.delete\(\)/);
});

test("historical names, prices, duration and financial totals remain structurally preserved", () => {
  const base = read(baseSchemaPath);
  const manual = read(manualEntriesPath);
  const sql = read(migrationPath);

  expect(base).toContain("service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT");
  expect(base).toMatch(/CREATE TABLE public\.appointment_services[\s\S]*price NUMERIC\(10,2\) NOT NULL,[\s\S]*duration_min INTEGER NOT NULL/);
  expect(base).toContain("total_price NUMERIC(10,2) NOT NULL DEFAULT 0");
  expect(manual).toContain("amount NUMERIC(10,2) NOT NULL");
  expect(sql).not.toMatch(/UPDATE public\.appointment_services|UPDATE public\.appointments/);
  expect(sql).not.toMatch(/UPDATE public\.manual_service_entries|UPDATE public\.cash_register_movements/);
});
