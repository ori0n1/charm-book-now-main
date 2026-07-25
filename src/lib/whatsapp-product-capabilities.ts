export type WhatsAppTemplatePurpose = "booking_confirmation" | "appointment_reminder";
export type WhatsAppTemplateAvailability = "available" | "planned";
export type WhatsAppBillingModel = "plan_add_on" | "usage_based";

export const WHATSAPP_TEMPLATE_CAPABILITIES = {
  bookingConfirmation: {
    purpose: "booking_confirmation",
    availability: "available",
    editableByStudio: false,
  },
  appointmentReminder: {
    purpose: "appointment_reminder",
    availability: "planned",
    editableByStudio: false,
  },
} as const satisfies Record<
  string,
  {
    purpose: WhatsAppTemplatePurpose;
    availability: WhatsAppTemplateAvailability;
    editableByStudio: boolean;
  }
>;

export const WHATSAPP_BILLING_CAPABILITY = {
  enabled: false,
  supportedModels: ["plan_add_on", "usage_based"],
} as const satisfies {
  enabled: boolean;
  supportedModels: readonly WhatsAppBillingModel[];
};
