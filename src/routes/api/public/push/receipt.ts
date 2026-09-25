import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase-admin.server";

const PushReceipt = z.object({
  deliveryId: z.string().uuid(),
  receiptToken: z.string().uuid(),
  stage: z.enum(["received", "displayed"]),
});

export const Route = createFileRoute("/api/public/push/receipt")({
  server: {
    handlers: {
      GET: async () =>
        new Response(null, {
          status: 405,
          headers: { Allow: "POST" },
        }),
      POST: async ({ request }) => {
        try {
          const contentLength = Number(request.headers.get("content-length") ?? "0");
          if (Number.isFinite(contentLength) && contentLength > 2048) {
            return new Response(null, { status: 413 });
          }

          const input = PushReceipt.parse(await request.json());
          const sb = getAdminClient();
          const { data, error } = await (sb as any).rpc(
            "acknowledge_studio_notification_delivery",
            {
              p_delivery_id: input.deliveryId,
              p_receipt_token: input.receiptToken,
              p_stage: input.stage,
            },
          );
          if (error) {
            console.error("[notifications] device_receipt_failed", {
              delivery_id: input.deliveryId,
              stage: input.stage,
              reason: error.message,
            });
            return new Response(null, { status: 400 });
          }
          if (!data) return new Response(null, { status: 404 });
          return Response.json({ received: true });
        } catch (error) {
          console.warn("[notifications] invalid_device_receipt", {
            reason: error instanceof Error ? error.message : "invalid_receipt",
          });
          return new Response(null, { status: 400 });
        }
      },
    },
  },
});
