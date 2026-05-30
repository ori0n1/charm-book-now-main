import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import {
  createStaffInviteLink,
  getTeamAccess,
  inviteStaffAccess,
  removeStaffAccess,
  resendStaffInvite,
  updateStaffAccessRole,
} from "@/lib/access.functions";
import {
  getSegmentConfig,
  inferSegmentCategory,
  normalizeSegmentText,
  type SegmentLabels,
  type BusinessSegment,
} from "@/lib/segments";
import { uploadStudioAsset } from "@/lib/upload";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Loader2,
  MessageCircle,
  Plus,
  Pencil,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/equipa")({
  component: TeamPage,
});

type Staff = {
  id: string;
  name: string;
  role: string | null;
  whatsapp: string | null;
  bio: string | null;
  photo_url: string | null;
  rating: number | null;
  is_active: boolean;
};
type Service = { id: string; name: string; category_id: string | null };
type Category = { id: string; label: string; sort_order: number };
type Suggestion = { id: string; label: string };
type AccessRole = "manager" | "staff" | "desk_staff";
type StaffAccess = {
  staffId: string;
  userId: string;
  email: string;
  role: AccessRole;
  status: "active" | "pending";
  inviteStatus?: "pending" | "sent" | "viewed" | "password_created" | "active" | "cancelled" | "expired";
  inviteUrl?: string | null;
  inviteCode?: string | null;
  inviteExpiresAt?: string | null;
  whatsapp?: string | null;
  staffName?: string;
  photoUrl?: string | null;
  invitedAt: string | null;
  lastSignInAt: string | null;
};
type InviteShare = {
  staffId: string;
  staffName: string;
  whatsapp: string | null;
  role: AccessRole;
  status: string;
  inviteUrl: string;
  inviteCode: string | null;
  inviteExpiresAt: string | null;
};
type ServicePreset = {
  name: string;
  category: string;
  duration: number;
  price: number;
};

const SERVICE_PRESETS: ServicePreset[] = [
  { name: "Corte de cabelo", category: "Cabelo", duration: 45, price: 30 },
  { name: "Brushing", category: "Cabelo", duration: 45, price: 25 },
  { name: "Coloração", category: "Cabelo", duration: 120, price: 65 },
  { name: "Hidratação capilar", category: "Cabelo", duration: 60, price: 35 },
  { name: "Unha em gel", category: "Unhas", duration: 90, price: 35 },
  { name: "Banho de gel", category: "Unhas", duration: 75, price: 30 },
  { name: "Manicure", category: "Unhas", duration: 45, price: 18 },
  { name: "Pedicure", category: "Unhas", duration: 50, price: 22 },
  { name: "Design de sobrancelha", category: "Sobrancelhas", duration: 30, price: 18 },
  { name: "Henna de sobrancelha", category: "Sobrancelhas", duration: 35, price: 22 },
  { name: "Extensão de pestanas", category: "Pestanas", duration: 120, price: 55 },
  { name: "Lifting de pestanas", category: "Pestanas", duration: 60, price: 35 },
  { name: "Limpeza de pele", category: "Estética", duration: 75, price: 45 },
  { name: "Tratamento facial", category: "Estética", duration: 60, price: 40 },
  { name: "Depilação a cera", category: "Depilação", duration: 30, price: 20 },
  { name: "Massagem relaxante", category: "Massagem", duration: 60, price: 50 },
];

const DEFAULT_CATEGORY_LABELS = [
  "Cabelo",
  "Unhas",
  "Estética",
  "Sobrancelhas",
  "Pestanas",
  "Depilação",
  "Massagem",
];

const CATEGORY_RULES: { label: string; words: string[] }[] = [
  {
    label: "Unhas",
    words: ["unha", "gel", "verniz", "manicure", "pedicure", "nail", "acrilico", "alongamento"],
  },
  {
    label: "Cabelo",
    words: [
      "cabelo",
      "corte",
      "brushing",
      "escova",
      "coloracao",
      "coloracao",
      "madeixa",
      "luzes",
      "hidrata",
      "capilar",
    ],
  },
  {
    label: "Sobrancelhas",
    words: ["sobrancelha", "brow", "design"],
  },
  {
    label: "Pestanas",
    words: ["pestana", "cilio", "cilios", "lash"],
  },
  {
    label: "Depilação",
    words: ["depilacao", "cera", "laser"],
  },
  {
    label: "Massagem",
    words: ["massagem", "relaxante", "drenagem"],
  },
  {
    label: "Estética",
    words: [
      "facial",
      "pele",
      "limpeza",
      "estetica",
      "corporal",
      "tratamento",
      "maquilhagem",
      "microagulhamento",
    ],
  },
];

const normalizeText = normalizeSegmentText;

function inferCategoryLabel(serviceName: string) {
  const normalized = normalizeText(serviceName);
  return (
    CATEGORY_RULES.find((rule) =>
      rule.words.some((word) => normalized.includes(normalizeText(word))),
    )?.label ?? "Estética"
  );
}

function normalizePhone(value?: string | null) {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("351") || digits.length > 9) return digits;
  return `351${digits}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "Ainda sem entrada";
  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function accessRoleLabel(role: AccessRole) {
  if (role === "manager") return "Acesso completo";
  if (role === "staff") return "Acesso limitado";
  return "Apenas balcão";
}

function inviteStatusLabel(status: string) {
  if (status === "sent") return "Convite enviado";
  if (status === "viewed") return "Convite visualizado";
  if (status === "password_created") return "Senha criada";
  if (status === "accepted" || status === "active") return "Conta ativa";
  if (status === "cancelled") return "Convite cancelado";
  if (status === "expired") return "Convite expirado";
  return "Convite pendente";
}

function TeamPage() {
  const { studio } = useCurrentStudio();
  const labels = getSegmentConfig(studio?.business_segment).labels;
  const [staff, setStaff] = useState<Staff[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [staffServices, setStaffServices] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Staff | null>(null);
  const [creating, setCreating] = useState(false);
  const loadAccess = useServerFn(getTeamAccess);
  const createInviteLink = useServerFn(createStaffInviteLink);
  const inviteAccess = useServerFn(inviteStaffAccess);
  const resendInvite = useServerFn(resendStaffInvite);
  const updateAccessRole = useServerFn(updateStaffAccessRole);
  const removeAccess = useServerFn(removeStaffAccess);
  const inviteDesk = async () => {
    throw new Error("Escolha uma profissional e configure o acesso no respetivo card.");
  };
  const [access, setAccess] = useState<Record<string, StaffAccess>>({});
  const [accessModal, setAccessModal] = useState<Staff | null>(null);
  const [accessEmail, setAccessEmail] = useState("");
  const [accessRole, setAccessRole] = useState<AccessRole>("desk_staff");
  const [inviteExpiry, setInviteExpiry] = useState("");
  const [shareInvite, setShareInvite] = useState<InviteShare | null>(null);
  const [accessBusy, setAccessBusy] = useState(false);
  const [deskEmail, setDeskEmail] = useState("");
  const [deskBusy, setDeskBusy] = useState(false);

  async function load() {
    if (!studio) return;
    setLoading(true);
    const [{ data: st }, { data: sv }, { data: cat }, { data: sug }, { data: ss }] =
      await Promise.all([
        supabase
          .from("staff")
          .select("id,name,role,whatsapp,bio,photo_url,rating,is_active")
          .eq("studio_id", studio.id)
          .order("sort_order")
          .order("name"),
        supabase
          .from("services")
          .select("id,name,category_id")
          .eq("studio_id", studio.id)
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("service_categories")
          .select("id,label,sort_order")
          .eq("studio_id", studio.id)
          .order("sort_order"),
        supabase.from("service_category_suggestions").select("id,label").order("sort_order"),
        supabase.from("staff_services").select("staff_id,service_id"),
      ]);
    const staffList = (st ?? []) as Staff[];
    setStaff(staffList);
    setServices((sv ?? []) as Service[]);
    setCategories((cat ?? []) as Category[]);
    setSuggestions((sug ?? []) as Suggestion[]);
    const staffIds = new Set(staffList.map((s) => s.id));
    const map: Record<string, string[]> = {};
    (ss ?? []).forEach((r) => {
      const k = (r as { staff_id: string }).staff_id;
      const v = (r as { service_id: string }).service_id;
      if (!staffIds.has(k)) return;
      (map[k] ||= []).push(v);
    });
    setStaffServices(map);
    setLoading(false);
    void loadTeamAccess();
  }

  async function loadTeamAccess() {
    if (!studio) return;
    try {
      const rows = (await loadAccess({ data: { studioId: studio.id } })) as StaffAccess[];
      setAccess(Object.fromEntries(rows.map((row) => [row.staffId, row])));
    } catch {
      setAccess({});
    }
  }

  useEffect(() => {
    void load();
  }, [studio]);

  async function remove(id: string) {
    if (!confirm(labels.deleteProfessionalConfirm)) return;
    const { error } = await supabase.from("staff").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(labels.professionalDeleted);
    load();
  }

  async function authorizeDeskStaff() {
    if (!studio || deskBusy) return;
    const email = deskEmail.trim();
    if (!email) return toast.error("Introduza o email da funcionária.");
    setDeskBusy(true);
    try {
      await inviteDesk({ data: { studioId: studio.id, email } });
      setDeskEmail("");
      toast.success("Acesso Balcão autorizado para este estúdio.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível autorizar o acesso.");
    } finally {
      setDeskBusy(false);
    }
  }

  function openAccessModal(member: Staff) {
    const current = access[member.id];
    setAccessModal(member);
    setAccessEmail(current?.email ?? "");
    setAccessRole(current?.role ?? "desk_staff");
    setInviteExpiry(current?.inviteExpiresAt ? current.inviteExpiresAt.slice(0, 10) : "");
  }

  async function saveAccess() {
    if (!studio || !accessModal || accessBusy) return;
    setAccessBusy(true);
    try {
      const current = access[accessModal.id];
      let closeAfterSave = true;
      if (current) {
        if (current.userId) {
          await updateAccessRole({
            data: { studioId: studio.id, staffId: accessModal.id, role: accessRole },
          });
          toast.success("Permissão atualizada.");
        } else {
          const invite = (await createInviteLink({
            data: {
              studioId: studio.id,
              staffId: accessModal.id,
              role: accessRole,
              expiresAt: inviteExpiry ? new Date(`${inviteExpiry}T23:59:59`).toISOString() : null,
            },
          })) as InviteShare;
          setShareInvite(invite);
          closeAfterSave = false;
          toast.success("Convite atualizado.");
        }
      } else {
        const invite = (await createInviteLink({
          data: {
            studioId: studio.id,
            staffId: accessModal.id,
            role: accessRole,
            expiresAt: inviteExpiry ? new Date(`${inviteExpiry}T23:59:59`).toISOString() : null,
          },
        })) as InviteShare;
        setShareInvite(invite);
        closeAfterSave = false;
        toast.success("Convite criado.");
      }
      await load();
      if (closeAfterSave) setAccessModal(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível guardar o acesso.");
    } finally {
      setAccessBusy(false);
    }
  }

  async function resendAccess(member: Staff) {
    if (!studio) return;
    setAccessBusy(true);
    try {
      const invite = (await resendInvite({ data: { studioId: studio.id, staffId: member.id } })) as
        | InviteShare
        | { ok: true; email: string };
      if ("inviteUrl" in invite) setShareInvite(invite);
      toast.success("Convite reenviado.");
      await loadTeamAccess();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível reenviar o convite.");
    } finally {
      setAccessBusy(false);
    }
  }

  async function regenerateAccess(member: Staff) {
    if (!studio || accessBusy) return;
    const current = access[member.id];
    setAccessBusy(true);
    try {
      const invite = (await createInviteLink({
        data: {
          studioId: studio.id,
          staffId: member.id,
          role: current?.role ?? "desk_staff",
          expiresAt: current?.inviteExpiresAt ?? null,
        },
      })) as InviteShare;
      setShareInvite(invite);
      toast.success("Novo link criado.");
      await loadTeamAccess();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel criar um novo link.");
    } finally {
      setAccessBusy(false);
    }
  }

  async function revokeAccess(member: Staff) {
    if (!studio) return;
    if (!confirm("Remover o acesso desta profissional ao painel?")) return;
    setAccessBusy(true);
    try {
      await removeAccess({ data: { studioId: studio.id, staffId: member.id } });
      toast.success("Acesso removido.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível remover o acesso.");
    } finally {
      setAccessBusy(false);
    }
  }

  function whatsappShareUrl(invite: InviteShare) {
    const phone = normalizePhone(invite.whatsapp);
    const message = encodeURIComponent(
      `Olá ${invite.staffName}, aqui está o teu convite para aceder ao balcão do estúdio: ${invite.inviteUrl}${
        invite.inviteCode ? `\nCódigo: ${invite.inviteCode}` : ""
      }`,
    );
    return phone ? `https://wa.me/${phone}?text=${message}` : `https://wa.me/?text=${message}`;
  }

  async function copyInviteLink(invite: InviteShare) {
    await navigator.clipboard.writeText(invite.inviteUrl);
    toast.success("Link copiado.");
  }

  async function openInviteShare(member: Staff) {
    const current = access[member.id];
    if (current?.inviteUrl) {
      setShareInvite({
        staffId: member.id,
        staffName: member.name,
        whatsapp: current.whatsapp ?? member.whatsapp,
        role: current.role,
        status: current.inviteStatus ?? current.status,
        inviteUrl: current.inviteUrl,
        inviteCode: current.inviteCode ?? null,
        inviteExpiresAt: current.inviteExpiresAt ?? null,
      });
      return;
    }
    openAccessModal(member);
  }

  if (loading) return <p className="text-sm text-muted-foreground">A carregar...</p>;

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Equipa</p>
          <h2 className="mt-1 text-2xl font-light tracking-tight">
            {staff.length} {labels.professionalPlural}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background"
        >
          <Plus className="h-4 w-4" /> Nova
        </button>
      </header>

      <section className="rounded-2xl border border-border bg-card/80 p-4 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              Acessos da equipa
            </p>
            <h3 className="mt-1 text-base font-semibold">Convites ligados a cada profissional</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Abra o card de uma profissional para convidar, reenviar convite, alterar permissao ou
              remover acesso ao painel.
            </p>
          </div>
        </div>
      </section>

      <section className="hidden rounded-2xl border border-border bg-card/80 p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="max-w-xl">
            <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              Acesso limitado
            </p>
            <h3 className="mt-1 text-base font-semibold">Funcionária Balcão</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Autorize uma funcionária a entrar apenas na página Balcão para registar atendimentos
              presenciais deste estúdio.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row md:max-w-lg">
            <input
              type="email"
              value={deskEmail}
              onChange={(event) => setDeskEmail(event.target.value)}
              placeholder="email@exemplo.pt"
              className="h-11 min-w-0 flex-1 rounded-2xl border border-border bg-background px-4 text-sm outline-none transition focus:border-foreground/40"
            />
            <button
              type="button"
              onClick={authorizeDeskStaff}
              disabled={deskBusy}
              className="h-11 rounded-2xl bg-foreground px-5 text-xs font-bold uppercase tracking-[0.14em] text-background transition hover:opacity-90 disabled:opacity-60"
            >
              {deskBusy ? "A autorizar" : "Autorizar"}
            </button>
          </div>
        </div>
      </section>

      {staff.length === 0 ? (
        <p className="rounded-lg border border-border px-4 py-10 text-center text-sm text-muted-foreground">
          {labels.emptyProfessionals}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {staff.map((m) => {
            const memberAccess = access[m.id];
            return (
            <article
              key={m.id}
              className={`rounded-lg border p-4 ${m.is_active ? "border-border" : "border-border/50 opacity-60"}`}
            >
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 overflow-hidden rounded-full bg-muted">
                  {m.photo_url && (
                    <img src={m.photo_url} alt={m.name} className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-medium">{m.name}</h3>
                  {m.role && <p className="truncate text-xs text-muted-foreground">{m.role}</p>}
                </div>
              </div>
              {m.bio && <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{m.bio}</p>}
              <div className="mt-3 rounded-2xl border border-border/80 bg-background/55 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${
                        memberAccess
                          ? memberAccess.status === "pending"
                            ? "bg-amber-500/10 text-amber-600"
                            : "bg-emerald-500/10 text-emerald-500"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {memberAccess
                        ? inviteStatusLabel(memberAccess.inviteStatus ?? memberAccess.status)
                        : "Sem acesso"}
                    </span>
                    <p className="mt-2 truncate text-xs text-muted-foreground">
                      {memberAccess ? memberAccess.email : "Sem login autorizado"}
                    </p>
                    {memberAccess && (
                      <>
                        <p className="mt-1 text-xs font-medium">{accessRoleLabel(memberAccess.role)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Ultimo acesso: {formatDateTime(memberAccess.lastSignInAt)}
                        </p>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => (memberAccess ? openInviteShare(m) : openAccessModal(m))}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-foreground px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-background shadow-sm transition hover:opacity-90"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    {memberAccess?.inviteUrl ? "Partilhar" : memberAccess ? "Acesso" : "Convidar"}
                  </button>
                </div>
                {memberAccess && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {memberAccess.status === "pending" && (
                      <button
                        type="button"
                        onClick={() => resendAccess(m)}
                        disabled={accessBusy}
                        className="rounded-xl border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-60"
                      >
                        Reenviar convite
                      </button>
                    )}
                    {memberAccess.status === "pending" && (
                      <button
                        type="button"
                        onClick={() => regenerateAccess(m)}
                        disabled={accessBusy}
                        className="rounded-xl border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-60"
                      >
                        Regenerar link
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => revokeAccess(m)}
                      disabled={accessBusy}
                      className="rounded-xl border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-60"
                    >
                      Remover acesso
                    </button>
                  </div>
                )}
              </div>
              <div className="mt-3 flex items-center justify-between">
                {m.rating !== null && (
                  <div className="flex items-center gap-1 text-xs">
                    <Star className="h-3.5 w-3.5 fill-foreground" /> {Number(m.rating).toFixed(1)}
                  </div>
                )}
                <div className="ml-auto flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(m)}
                    className="rounded-md border border-border p-1.5"
                    aria-label="Editar"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(m.id)}
                    className="rounded-md border border-border p-1.5"
                    aria-label="Eliminar"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </article>
          );
          })}
        </div>
      )}

      {(editing || creating) && studio && (
        <StaffModal
          key={editing?.id ?? "new"}
          studioId={studio.id}
          services={services}
          categories={categories}
          suggestions={suggestions}
          assigned={editing ? (staffServices[editing.id] ?? []) : []}
          labels={labels}
          businessSegment={studio.business_segment}
          staff={editing}
          onReloadCatalog={load}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={async (savedId, wasCreated) => {
            setEditing(null);
            setCreating(false);
            await load();
            if (wasCreated && savedId && studio) {
              try {
                const invite = (await createInviteLink({
                  data: { studioId: studio.id, staffId: savedId, role: "desk_staff", expiresAt: null },
                })) as InviteShare;
                setShareInvite(invite);
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Não foi possível criar o convite.");
              }
            }
          }}
        />
      )}

      {accessModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center md:p-6">
          <div className="w-full max-w-md rounded-t-3xl bg-background p-5 shadow-2xl md:rounded-3xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                  Acesso ao painel
                </p>
                <h3 className="mt-1 text-xl font-light">{accessModal.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Configure como esta profissional pode entrar no painel.
                </p>
              </div>
              <button type="button" onClick={() => setAccessModal(null)} aria-label="Fechar">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <div className="rounded-2xl border border-border bg-card p-3">
                <p className="text-xs font-semibold">Convite por WhatsApp</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  O sistema cria um link único com código opcional para enviar no WhatsApp,
                  copiar ou mostrar em QR Code.
                </p>
              </div>
              <label className="block text-xs">
                <span className="text-muted-foreground">Tipo de acesso</span>
                <select
                  value={accessRole}
                  onChange={(event) => setAccessRole(event.target.value as AccessRole)}
                  className="mt-1 h-11 w-full appearance-none rounded-2xl border border-border bg-background px-4 text-sm outline-none transition focus:border-foreground/40"
                >
                  <option value="desk_staff">Apenas Balcão</option>
                  <option value="staff">Limitado</option>
                  <option value="manager">Completo</option>
                </select>
              </label>
              <label className="block text-xs">
                <span className="text-muted-foreground">Expira em</span>
                <input
                  type="date"
                  value={inviteExpiry}
                  onChange={(event) => setInviteExpiry(event.target.value)}
                  className="mt-1 h-11 w-full rounded-2xl border border-border bg-background px-4 text-sm outline-none transition focus:border-foreground/40"
                />
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  Deixe vazio para manter o convite sem expiração.
                </span>
              </label>
              <div className="rounded-2xl border border-border bg-card p-3 text-xs leading-relaxed text-muted-foreground">
                <p>
                  <strong className="text-foreground">Apenas Balcão:</strong> registo de
                  atendimentos presenciais.
                </p>
                <p className="mt-1">
                  <strong className="text-foreground">Limitado:</strong> agenda, clientes e balcão.
                </p>
                <p className="mt-1">
                  <strong className="text-foreground">Completo:</strong> acesso de gestão do
                  estúdio.
                </p>
              </div>
              <button
                type="button"
                onClick={saveAccess}
                disabled={accessBusy}
                className="h-12 w-full rounded-2xl bg-foreground text-xs font-bold uppercase tracking-[0.16em] text-background transition hover:opacity-90 disabled:opacity-60"
              >
                {accessBusy ? "A guardar" : access[accessModal.id]?.userId ? "Guardar permissão" : "Criar convite"}
              </button>
            </div>
          </div>
        </div>
      )}

      {shareInvite && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/55 md:items-center md:p-6">
          <div className="w-full max-w-md rounded-t-3xl bg-background p-5 shadow-2xl md:rounded-3xl">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-foreground text-lg font-semibold text-background">
                  {shareInvite.staffName.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                    Convite pronto
                  </p>
                  <h3 className="truncate text-xl font-light">{shareInvite.staffName}</h3>
                  <p className="text-sm text-muted-foreground">
                    {inviteStatusLabel(shareInvite.status)} · {accessRoleLabel(shareInvite.role)}
                  </p>
                </div>
              </div>
              <button type="button" onClick={() => setShareInvite(null)} aria-label="Fechar">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-5 rounded-2xl border border-border bg-card p-3">
              <p className="break-all text-xs text-muted-foreground">{shareInvite.inviteUrl}</p>
              {shareInvite.inviteCode && (
                <p className="mt-2 text-xs">
                  Código: <span className="font-semibold">{shareInvite.inviteCode}</span>
                </p>
              )}
            </div>

            <div className="mt-4 grid grid-cols-[1fr_auto] gap-3">
              <a
                href={whatsappShareUrl(shareInvite)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-foreground px-4 text-sm font-semibold text-background transition hover:opacity-90"
              >
                <MessageCircle className="h-4 w-4" />
                Enviar no WhatsApp
              </a>
              <button
                type="button"
                onClick={() => copyInviteLink(shareInvite)}
                className="grid h-12 w-12 place-items-center rounded-2xl border border-border"
                aria-label="Copiar link"
                title="Copiar link"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 flex items-center justify-center rounded-2xl border border-border bg-white p-4">
              <QRCodeSVG value={shareInvite.inviteUrl} size={132} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StaffModal({
  studioId,
  services,
  categories,
  suggestions,
  assigned,
  labels,
  businessSegment,
  staff,
  onClose,
  onSaved,
  onReloadCatalog,
}: {
  studioId: string;
  services: Service[];
  categories: Category[];
  suggestions: Suggestion[];
  assigned: string[];
  labels: SegmentLabels;
  businessSegment: BusinessSegment;
  staff: Staff | null;
  onClose: () => void;
  onSaved: (staffId: string, wasCreated: boolean) => void | Promise<void>;
  onReloadCatalog: () => void | Promise<void>;
}) {
  const validAssigned = useMemo(() => {
    const known = new Set(services.map((s) => s.id));
    return assigned.filter((id) => known.has(id));
  }, [assigned, services]);
  const [name, setName] = useState(staff?.name ?? "");
  const [role, setRole] = useState(staff?.role ?? "");
  const [whatsapp, setWhatsapp] = useState(staff?.whatsapp ?? "");
  const [bio, setBio] = useState(staff?.bio ?? "");
  const [photo, setPhoto] = useState(staff?.photo_url ?? "");
  const [active, setActive] = useState(staff?.is_active ?? true);
  const [serviceIds, setServiceIds] = useState<string[]>(validAssigned);
  const [saving, setSaving] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    const preview = URL.createObjectURL(file);
    setPhoto(preview);
    setPhotoUploading(true);
    try {
      const { url } = await uploadStudioAsset(studioId, file, "staff");
      setPhoto(url);
    } catch (e) {
      toast.error((e as Error).message);
      setPhoto(staff?.photo_url ?? "");
    } finally {
      URL.revokeObjectURL(preview);
      setPhotoUploading(false);
    }
  }

  async function save() {
    if (!name.trim()) return toast.error("Nome obrigatório");
    if (!whatsapp.trim()) return toast.error("WhatsApp obrigatório");
    if (photoUploading) return toast.error("Aguarde o upload da foto terminar.");
    setSaving(true);
    if (!staff) {
      const { data: duplicate } = await supabase
        .from("staff")
        .select("id")
        .eq("studio_id", studioId)
        .eq("whatsapp", whatsapp.trim())
        .maybeSingle();
      if (duplicate?.id) {
        setSaving(false);
        return toast.error("Já existe uma profissional com este WhatsApp.");
      }
    }
    const payload = {
      studio_id: studioId,
      name: name.trim(),
      role: role.trim() || null,
      whatsapp: whatsapp.trim(),
      bio: bio.trim() || null,
      photo_url: photo || null,
      is_active: active,
    };
    const res = staff
      ? await supabase.from("staff").update(payload).eq("id", staff.id).select("id").single()
      : await supabase.from("staff").insert(payload).select("id").single();
    if (res.error) {
      setSaving(false);
      return toast.error(res.error.message);
    }
    const id = res.data!.id;
    await supabase.from("staff_services").delete().eq("staff_id", id);
    if (serviceIds.length) {
      await supabase
        .from("staff_services")
        .insert(serviceIds.map((sid) => ({ staff_id: id, service_id: sid })));
    }
    setSaving(false);
    toast.success(labels.professionalSaved);
    onSaved(id, !staff);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center md:p-6">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-background p-5 md:rounded-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-light">
            {staff ? labels.editProfessional : labels.newProfessional}
          </h3>
          <button type="button" onClick={onClose} aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={photoUploading}
              className="relative h-16 w-16 overflow-hidden rounded-full border border-dashed border-border bg-muted/30 disabled:opacity-80"
            >
              {photo ? (
                <img src={photo} className="h-full w-full object-cover" alt="" />
              ) : (
                <Upload className="m-auto h-4 w-4 text-muted-foreground" />
              )}
              {photoUploading && (
                <span className="absolute inset-0 grid place-items-center bg-background/70 backdrop-blur-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </span>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
                e.currentTarget.value = "";
              }}
            />
            <p className="text-xs text-muted-foreground">
              {photoUploading ? "A carregar foto..." : "Toque para alterar a foto"}
            </p>
          </div>
          <label className="block text-xs">
            <span className="text-muted-foreground">Nome</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Ana Silva"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-xs">
            <span className="text-muted-foreground">Função / cargo</span>
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder={labels.professionalRolePlaceholder}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-xs">
            <span className="text-muted-foreground">WhatsApp</span>
            <input
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="+351 912 345 678"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-xs">
            <span className="text-muted-foreground">Descrição</span>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder={labels.professionalBioPlaceholder}
              rows={2}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>

          <section className="space-y-2">
            <div>
              <p className="text-sm font-medium text-foreground">Serviços que realiza</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Selecione serviços já registados. As categorias servem apenas para organizar a lista
                e nunca substituem o nome do serviço.
              </p>
            </div>

            <ServicesPicker
              studioId={studioId}
              services={services}
              categories={categories}
              suggestions={suggestions}
              businessSegment={businessSegment}
              value={serviceIds}
              onChange={setServiceIds}
              onReloadCatalog={onReloadCatalog}
            />
          </section>

          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{" "}
            Ativa
          </label>
        </div>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-md border border-border py-2.5 text-sm"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || photoUploading}
            className="flex-1 rounded-md bg-foreground py-2.5 text-sm font-medium text-background disabled:opacity-50"
          >
            {saving ? "A guardar..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ServicesPicker({
  studioId,
  services,
  categories,
  suggestions,
  businessSegment,
  value,
  onChange,
  onReloadCatalog,
}: {
  studioId: string;
  services: Service[];
  categories: Category[];
  suggestions: Suggestion[];
  businessSegment: BusinessSegment;
  value: string[];
  onChange: (v: string[]) => void;
  onReloadCatalog: () => void | Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [newServiceName, setNewServiceName] = useState("");
  const [newServiceDuration, setNewServiceDuration] = useState(60);
  const [newServicePrice, setNewServicePrice] = useState(30);
  const [selectedCategoryLabel, setSelectedCategoryLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyPreset, setBusyPreset] = useState("");
  const segmentConfig = getSegmentConfig(businessSegment);

  const selected = useMemo(() => new Set(value), [value]);
  const selectedServices = useMemo(
    () => services.filter((s) => selected.has(s.id)),
    [services, selected],
  );
  const typedService = query.trim();

  const categoryOptions = useMemo(() => {
    const labels = [
      ...segmentConfig.defaultCategoryLabels,
      ...suggestions.map((s) => s.label),
      ...categories.map((c) => c.label),
    ];
    const seen = new Set<string>();
    return labels.filter((label) => {
      const key = normalizeText(label);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [categories, segmentConfig.defaultCategoryLabels, suggestions]);

  const suggestedCategoryLabel = inferSegmentCategory(newServiceName || typedService, businessSegment);
  const currentCategoryLabel = selectedCategoryLabel || suggestedCategoryLabel;
  const exactService = services.find(
    (s) => normalizeText(s.name) === normalizeText(newServiceName || typedService),
  );

  const quickPresets = useMemo(() => {
    const q = normalizeText(query);
    return segmentConfig.servicePresets.filter((preset) => {
      const presetName = normalizeText(preset.name);
      const categoryName = normalizeText(preset.category);
      return !q || presetName.includes(q) || categoryName.includes(q);
    }).slice(0, 8);
  }, [query, segmentConfig.servicePresets]);

  const grouped = useMemo(() => {
    const q = normalizeText(query);
    const filterFn = (s: Service) => !q || normalizeText(s.name).includes(q);
    const buckets: { cat: Category | null; items: Service[] }[] = [];

    categories.forEach((c) => {
      const items = services.filter((s) => s.category_id === c.id).filter(filterFn);
      if (!q || items.length) buckets.push({ cat: c, items });
    });

    const uncategorized = services.filter((s) => !s.category_id).filter(filterFn);
    if (uncategorized.length) buckets.push({ cat: null, items: uncategorized });
    return buckets;
  }, [services, categories, query]);

  const canCreateFromSearch =
    typedService.length >= 2 &&
    !services.some((s) => normalizeText(s.name) === normalizeText(typedService));

  function toggle(id: string) {
    onChange(selected.has(id) ? value.filter((x) => x !== id) : [...value, id]);
  }

  async function ensureCategory(label: string) {
    const normalized = normalizeText(label);
    const existing = categories.find((c) => normalizeText(c.label) === normalized);
    if (existing) return existing.id;

    const nextOrder = (categories.at(-1)?.sort_order ?? 0) + 10;
    const { data, error } = await supabase
      .from("service_categories")
      .insert({ studio_id: studioId, label: label.trim(), sort_order: nextOrder })
      .select("id")
      .single();

    if (error || !data) throw new Error(error?.message ?? "Não foi possível criar a categoria");
    return data.id as string;
  }

  async function createService() {
    const trimmed = newServiceName.trim();
    if (!trimmed) return toast.error("Digite o nome do serviço");

    const existing = services.find((s) => normalizeText(s.name) === normalizeText(trimmed));
    if (existing) {
      if (!selected.has(existing.id)) onChange([...value, existing.id]);
      toast.info("Este serviço já existia e foi selecionado");
      setCreating(false);
      setNewServiceName("");
      return;
    }

    setBusy(true);
    try {
      const categoryId = await ensureCategory(currentCategoryLabel);
      const { data, error } = await supabase
        .from("services")
        .insert({
          studio_id: studioId,
          name: trimmed,
          duration_min: newServiceDuration,
          price: newServicePrice,
          category_id: categoryId,
          is_active: true,
        })
        .select("id")
        .single();

      if (error || !data) throw new Error(error?.message ?? "Não foi possível criar o serviço");
      toast.success(`Serviço criado em ${currentCategoryLabel}`);
      onChange([...value, data.id]);
      setQuery("");
      setCreating(false);
      setNewServiceName("");
      setSelectedCategoryLabel("");
      setNewServiceDuration(60);
      setNewServicePrice(30);
      await onReloadCatalog();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function selectPreset(preset: ServicePreset) {
    const existing = services.find((s) => normalizeText(s.name) === normalizeText(preset.name));
    if (existing) {
      toggle(existing.id);
      return;
    }

    setBusyPreset(preset.name);
    try {
      const categoryId = await ensureCategory(preset.category);
      const { data, error } = await supabase
        .from("services")
        .insert({
          studio_id: studioId,
          name: preset.name,
          duration_min: preset.duration,
          price: preset.price,
          category_id: categoryId,
          is_active: true,
        })
        .select("id")
        .single();

      if (error || !data) throw new Error(error?.message ?? "Não foi possível criar o serviço");
      toast.success(`Serviço criado em ${preset.category}`);
      onChange([...value, data.id]);
      setQuery("");
      await onReloadCatalog();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyPreset("");
    }
  }

  function startCreate(name = "") {
    setNewServiceName(name);
    setSelectedCategoryLabel(inferSegmentCategory(name, businessSegment));
    setCreating(true);
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card/40 p-3 sm:p-4">
      {selectedServices.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Selecionados
          </p>
          <div className="flex flex-wrap gap-1.5">
            {selectedServices.map((s) => (
              <span
                key={s.id}
                className="inline-flex items-center gap-1 rounded-full bg-foreground px-2.5 py-1 text-[11px] text-background"
              >
                {s.name}
                <button type="button" onClick={() => toggle(s.id)} aria-label={`Remover ${s.name}`}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {quickPresets.length > 0 && (
        <div className="space-y-2">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Seleção rápida
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {segmentConfig.labels.quickPickIntro}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {quickPresets.map((preset) => {
              const existing = services.find(
                (service) => normalizeText(service.name) === normalizeText(preset.name),
              );
              const isSelected = existing ? selected.has(existing.id) : false;
              const isBusy = busyPreset === preset.name;
              return (
                <button
                  key={`${preset.category}-${preset.name}`}
                  type="button"
                  onClick={() => selectPreset(preset)}
                  disabled={!!busyPreset}
                  className={`rounded-md border px-3 py-2 text-left text-xs transition disabled:opacity-60 ${
                    isSelected
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-background hover:bg-muted"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{preset.name}</span>
                    {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </span>
                  <span
                    className={`mt-0.5 block ${
                      isSelected ? "text-background/70" : "text-muted-foreground"
                    }`}
                  >
                    {isBusy
                      ? "A criar..."
                      : `${preset.category} · ${preset.duration} min · €${preset.price}`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <label className="block text-xs">
          <span className="text-muted-foreground">Pesquisar serviço</span>
          <span className="relative mt-1 block">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={segmentConfig.labels.serviceSearchPlaceholder}
              className="w-full rounded-md border border-border bg-background py-2 pl-8 pr-3 text-sm"
            />
          </span>
        </label>
        {canCreateFromSearch && (
          <button
            type="button"
            onClick={() => startCreate(typedService)}
            className="flex w-full items-center justify-between rounded-md border border-dashed border-border bg-background px-3 py-2 text-left text-xs hover:bg-muted"
          >
            <span>
              Adicionar novo serviço: <strong>{typedService}</strong>
            </span>
            <span className="text-muted-foreground">
              Categoria sugerida: {inferSegmentCategory(typedService, businessSegment)}
            </span>
          </button>
        )}
      </div>

      {services.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-4 text-center">
          <p className="text-sm font-medium">Ainda não há serviços registados</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {segmentConfig.labels.firstServiceHint}
          </p>
          <button
            type="button"
            onClick={() => startCreate()}
            className="mt-3 rounded-md bg-foreground px-3 py-2 text-xs font-medium text-background"
          >
            Criar serviço
          </button>
        </div>
      ) : grouped.length > 0 ? (
        <div className="max-h-72 overflow-y-auto rounded-md border border-border bg-background">
          {grouped.map(({ cat, items }) => {
            const key = cat?.id ?? "uncat";
            const open = openCats[key] !== false;
            return (
              <div key={key} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  onClick={() => setOpenCats((m) => ({ ...m, [key]: !open }))}
                  className="flex w-full items-center justify-between px-3 py-2 text-left"
                >
                  <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {open ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    {cat?.label ?? "Sem categoria"}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{items.length} serviços</span>
                </button>
                {open && (
                  <ul className="pb-1">
                    {items.map((s) => {
                      const on = selected.has(s.id);
                      return (
                        <li key={s.id}>
                          <button
                            type="button"
                            onClick={() => toggle(s.id)}
                            className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-sm transition ${on ? "bg-muted" : "hover:bg-muted/60"}`}
                          >
                            <span className="min-w-0 truncate">{s.name}</span>
                            <span
                              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-foreground bg-foreground text-background" : "border-border"}`}
                            >
                              {on && <Check className="h-3 w-3" />}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          Nenhum serviço encontrado para esta pesquisa.
        </div>
      )}

      {creating && (
        <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Novo serviço
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              O nome fica salvo como serviço. A categoria é apenas o grupo onde ele aparece.
            </p>
          </div>
          {exactService && (
            <button
              type="button"
              onClick={() => toggle(exactService.id)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-left text-xs"
            >
              Este serviço já existe. Toque para selecionar <strong>{exactService.name}</strong>.
            </button>
          )}
          <label className="block text-xs">
            <span className="text-muted-foreground">Nome do serviço</span>
            <input
              value={newServiceName}
              onChange={(e) => {
                setNewServiceName(e.target.value);
                setSelectedCategoryLabel(inferSegmentCategory(e.target.value, businessSegment));
              }}
              placeholder={segmentConfig.labels.serviceSearchPlaceholder}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-xs">
            <span className="text-muted-foreground">Categoria detectada</span>
            <select
              value={currentCategoryLabel}
              onChange={(e) => setSelectedCategoryLabel(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              {categoryOptions.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-muted-foreground">
              Duração (min)
              <input
                type="number"
                min={5}
                step={5}
                value={newServiceDuration}
                onChange={(e) => setNewServiceDuration(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-[11px] text-muted-foreground">
              Preço (€)
              <input
                type="number"
                min={0}
                step="0.5"
                value={newServicePrice}
                onChange={(e) => setNewServicePrice(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="flex-1 rounded-md border border-border py-2 text-xs"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={busy || !newServiceName.trim()}
              onClick={createService}
              className="flex-1 rounded-md bg-foreground py-2 text-xs font-medium text-background disabled:opacity-50"
            >
              {busy ? "A criar..." : "Criar e selecionar"}
            </button>
          </div>
        </div>
      )}

      {services.length > 0 && !creating && (
        <button
          type="button"
          onClick={() => startCreate(query.trim())}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border py-2 text-xs text-muted-foreground hover:bg-muted"
        >
          <Plus className="h-3.5 w-3.5" /> Adicionar serviço que ainda não existe
        </button>
      )}
    </div>
  );
}
