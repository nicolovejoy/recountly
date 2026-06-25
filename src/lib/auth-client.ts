// Browser-side Better Auth client. baseURL is omitted, so it targets the current
// origin's /api/auth/* handler — correct for localhost, the preview URL, and
// prod alike. Used by the /login page.

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
