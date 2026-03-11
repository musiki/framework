/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />
/// <reference types="auth-astro" />

import type { Session } from "@auth/core/types";

declare namespace App {
  interface Locals {
    session: Session | null;
  }
}
