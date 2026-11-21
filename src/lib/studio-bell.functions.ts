import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

const BellInput = z.object({ studioId: z.string().uuid() });

export const getStudioBellNotifications = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => BellInput.parse(input))
  .handler(async ({ data, context }) => {
    const userId = String(context.userId ?? '').trim();
    if (!userId) throw new Response('Unauthorized', { status: 401 });
    const [{ getAdminClient }, { findOwnerSelfRescheduleIds, projectOwnerBell }] = await Promise.all([
      import('@/lib/supabase-admin.server'),
      import('@/lib/owner-self-reschedule.server'),
    ]);
    const admin = getAdminClient();
    const { data: memberships, error: membershipError } = await admin.from('user_roles')
      .select('role').eq('studio_id', data.studioId).eq('user_id', userId);
    if (membershipError) throw new Error(membershipError.message);
    if (!memberships?.length) throw new Response('Forbidden', { status: 403 });
    const role = ['saas_owner', 'studio_owner', 'manager', 'staff', 'desk_staff']
      .find((candidate) => memberships.some((membership) => membership.role === candidate));
    if (!role) throw new Response('Forbidden', { status: 403 });

    // Keep history and unread count under the caller's RLS, as before.
    const sb = context.supabase as any;
    const [historyResult, unreadResult] = await Promise.all([
      sb.from('studio_notifications')
        .select('id,studio_id,appointment_id,kind,title,body,payload,action_url,read_at,created_at,appointments:appointment_id(starts_at,studio_id)')
        .eq('studio_id', data.studioId).order('created_at', { ascending: false }).limit(100),
      sb.from('studio_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('studio_id', data.studioId).is('read_at', null),
    ]);
    if (historyResult.error) throw new Error(historyResult.error.message);
    if (unreadResult.error) throw new Error(unreadResult.error.message);
    const history = historyResult.data ?? [];
    const count = Number(unreadResult.count ?? 0);
    if (!['studio_owner', 'saas_owner'].includes(role)) {
      return { items: history, unreadCount: count };
    }

    // The 100-row history limit must not undercount older unread self events.
    const unreadReschedules: any[] = [];
    for (let page = 0; ; page += 500) {
      const { data: rows, error } = await sb.from('studio_notifications')
        .select('id,studio_id,appointment_id,kind,created_at,payload')
        .eq('studio_id', data.studioId).eq('kind', 'appointment_rescheduled')
        .is('read_at', null).order('created_at', { ascending: false }).order('id')
        .range(page, page + 499);
      if (error) throw new Error(error.message);
      unreadReschedules.push(...(rows ?? []));
      if ((rows ?? []).length < 500) break;
    }
    const notices = [...new Map([...history, ...unreadReschedules].map((item: any) => [item.id, item])).values()];
    const hidden = await findOwnerSelfRescheduleIds(admin, data.studioId, userId, role, notices);
    return projectOwnerBell(history, unreadReschedules, count, hidden);
  });
