export function assertJointBookingCreationEnabled() {
  if (process.env.JOINT_BOOKING_CREATE_ENABLED === "false") {
    throw new Error("joint_booking_creation_disabled");
  }
}
