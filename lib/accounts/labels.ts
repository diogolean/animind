import type { AssetKind, LibraryStatus, Role } from "./types";

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

export const ASSET_LABEL: Record<AssetKind, string> = {
  character: "Personagem",
  view: "Vista",
  emotion_sheet: "Emoções",
  image: "Imagem",
  script: "Roteiro",
  audio: "Áudio",
  video: "Vídeo",
  debate: "Debate",
};
