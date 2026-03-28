/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />
/// <reference types="auth-astro" />

import type { Session } from "@auth/core/types";

declare global {
  namespace App {
    interface Locals {
      session: Session | null;
    }
  }

  interface Window {
    __musikiDashboardRemount?: () => void;
  }
}

declare module 'tabulator-tables' {
  export const TabulatorFull: any;
}

export {};
