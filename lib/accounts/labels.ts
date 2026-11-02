import type { LibraryStatus, Role } from "./types";

export const ROLE_LABEL: Record<Role, string> = {
  user: "Usuário",
  admin: "Admin",
  super_admin: "Super admin",
};

export const STATUS_LABEL: Record<LibraryStatus, string> = {
  draft: "Rascunho",
  ready: "Pronto",
  archived: "Arquivado",
};
