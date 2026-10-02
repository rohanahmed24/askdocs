import { headers } from "next/headers";
import { cache } from "react";
import { auth } from "@/lib/auth";

/** The signed-in session for this request, or null. Cached per request. */
export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));
