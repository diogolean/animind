import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { assetLabel, statusLabel, translate } from "../lib/i18n";

const library = readFileSync(new URL("../components/biblioteca.tsx", import.meta.url), "utf8");
const libraryPage = readFileSync(new URL("../app/biblioteca/page.tsx", import.meta.url), "utf8");
const characters = readFileSync(new URL("../components/my-characters.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("../components/character-detail.tsx", import.meta.url), "utf8");
const composer = readFileSync(new URL("../components/composer.tsx", import.meta.url), "utf8");

describe("library chrome follows the locale", () => {
  it("gives English and Portuguese their own library words", () => {
    assert.equal(translate("en", "library"), "Library");
    assert.equal(translate("pt-BR", "library"), "Biblioteca");
    assert.equal(translate("en", "libraryAll"), "All");
    assert.equal(translate("pt-BR", "libraryAll"), "Tudo");
    assert.equal(translate("en", "libraryEmpty"), "Nothing in this filter. Import a character or finish a creation.");
    assert.equal(translate("pt-BR", "libraryEmpty"), "Nada neste filtro. Importe um personagem ou termine uma criação.");
    assert.equal(assetLabel("en", "character"), "Character");
    assert.equal(assetLabel("pt-BR", "character"), "Personagem");
    assert.equal(assetLabel("en", "view"), "View");
    assert.equal(assetLabel("pt-BR", "emotion_sheet"), "Emoções");
    assert.equal(translate("en", "libraryEmpty").includes("Nada neste filtro"), false);
    assert.equal(translate("en", "assetCharacter").includes("Personagem"), false);
  });

  it("asks the locale for the title, the filters, and the empty state", () => {
    assert.equal(library.includes(">Biblioteca<"), false);
    assert.equal(library.includes(">Tudo<"), false);
    assert.equal(library.includes("Nada neste filtro"), false);
    assert.equal(library.includes("Tudo o que foi gerado"), false);
    assert.equal(library.includes("Personagens, vistas, roteiros"), false);
    assert.equal(library.includes("ASSET_LABEL"), false);
    assert.match(library, /t\("library"\)/);
    assert.match(library, /t\("libraryAll"\)/);
    assert.match(library, /t\("libraryEmpty"\)/);
    assert.match(library, /assetLabel\(locale/);
  });

  it("does not pin the browser tab to one language", () => {
    assert.equal(libraryPage.includes('"Library"'), false);
    assert.equal(libraryPage.includes('"Biblioteca"'), false);
    assert.match(libraryPage, /absolute:\s*"Animindly"/);
    assert.equal(library.includes('document.title = "Library"'), false);
    assert.equal(library.includes('document.title = "Biblioteca"'), false);
    assert.match(library, /document\.title = `\$\{t\("library"\)\} · Animindly`/);
  });
});

describe("my characters chrome follows the locale", () => {
  it("gives English and Portuguese their own signed-in words", () => {
    assert.equal(translate("en", "charactersEmpty"), "No characters yet.");
    assert.equal(translate("pt-BR", "charactersEmpty"), "Nenhum personagem ainda.");
    assert.equal(translate("en", "noFrontView"), "No front view");
    assert.equal(translate("pt-BR", "noFrontView"), "Sem vista frontal");
    assert.equal(translate("en", "approvedCatalog"), "Approved catalog");
    assert.equal(translate("pt-BR", "approvedCatalog"), "Catálogo aprovado");
    assert.equal(translate("en", "importFolder"), "Import a folder");
    assert.equal(translate("pt-BR", "importFolder"), "Importar pasta");
    assert.equal(translate("en", "charactersEmpty").includes("Nenhum personagem"), false);
    assert.equal(statusLabel("en", "ready"), "Ready");
    assert.equal(statusLabel("pt-BR", "ready"), "Pronto");
  });

  it("does not leave those sentences in the signed-in pages", () => {
    for (const source of [characters, detail]) {
      assert.equal(source.includes("Nenhum personagem ainda."), false);
      assert.equal(source.includes("Sem vista frontal"), false);
      assert.equal(source.includes("Catálogo aprovado"), false);
      assert.equal(source.includes("Importar pasta"), false);
      assert.equal(source.includes("STATUS_LABEL"), false);
    }
    assert.match(characters, /t\("charactersEmpty"\)/);
    assert.match(characters, /t\("noFrontView"\)/);
    assert.match(characters, /t\("approvedCatalog"\)/);
    assert.match(characters, /t\("importFolder"\)/);
    assert.match(characters, /statusLabel\(locale/);
    assert.match(detail, /t\("approvedCatalog"\)/);
    assert.match(detail, /statusLabel\(locale/);
  });
});

describe("the local plan sentence is a sentence in each locale", () => {
  it("keeps the English and replaces the broken Portuguese", () => {
    assert.equal(
      translate("en", "localPlan"),
      "Understanding uses local rules on this server. No provider model is called for this step.",
    );
    assert.equal(
      translate("pt-BR", "localPlan"),
      "A etapa de entendimento usa regras locais neste servidor. Nenhum modelo de provedor é chamado neste passo.",
    );
    assert.equal(translate("pt-BR", "localPlan").startsWith("Entendendo usa"), false);
  });
});

describe("composer is not a page", () => {
  it("says so in the file and no route imports it", () => {
    assert.match(composer, /COMPOSER_UNSERVED/);
    const pages = [
      "app/page.tsx",
      "app/biblioteca/page.tsx",
      "app/characters/page.tsx",
      "app/characters/[id]/page.tsx",
      "app/login/page.tsx",
      "app/admin/gastos/page.tsx",
      "app/layout.tsx",
    ];
    for (const page of pages) {
      const source = readFileSync(new URL(`../${page}`, import.meta.url), "utf8");
      assert.equal(source.includes("components/composer"), false, page);
    }
  });
});
