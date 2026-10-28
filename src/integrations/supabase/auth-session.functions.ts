import { createServerFn } from "@tanstack/react-start";
import { getVerifiedRequestUser, setPrivateAuthResponseHeaders } from "./server-client";

export const getVerifiedAuthState = createServerFn({ method: "GET" }).handler(async () => {
  setPrivateAuthResponseHeaders();
  const { user } = await getVerifiedRequestUser();
  return user
    ? { authenticated: true as const, userId: user.id }
    : { authenticated: false as const, userId: null };
});
