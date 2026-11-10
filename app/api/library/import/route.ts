import { json } from "@/lib/core";
import { StoreConfigError } from "@/lib/accounts/config";
import { importCharacterPackage, ImportError } from "@/lib/accounts/import-character";
import { isUser, requireUser } from "@/lib/accounts/http";
import { resolveOwner } from "@/lib/accounts/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function textField(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(req: Request) {
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "Envie a pasta como multipart (puppet.json e as camadas PNG)", code: "import_rejected" }, 400);
  }
  const owner = await resolveOwner(actor, textField(form.get("ownerEmail")) || undefined);
  if (!owner.ok) return json({ error: owner.error, code: "import_rejected" }, owner.status);
  const files: { path: string; bytes: Buffer }[] = [];
  for (const entry of form.getAll("file")) {
    if (!(entry instanceof File) || !entry.name) continue;
    files.push({ path: entry.name, bytes: Buffer.from(await entry.arrayBuffer()) });
  }
  try {
    const character = await importCharacterPackage({
      ownerId: owner.value.id,
      name: textField(form.get("name")) || undefined,
      personaSheetRef: textField(form.get("personaSheetRef")) || undefined,
      status: textField(form.get("status")) || undefined,
      files,
    });
    return json({ character }, 201);
  } catch (error) {
    if (error instanceof ImportError) return json({ error: error.message, code: "import_rejected" }, error.status);
    if (error instanceof StoreConfigError) return json({ error: error.message, code: error.code }, error.status);
    throw error;
  }
}
