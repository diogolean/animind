import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { apiErrorMessage, fill, translate } from "../lib/i18n";

const studio = readFileSync(new URL("../components/creation-studio.tsx", import.meta.url), "utf8");
const preview = readFileSync(new URL("../components/flow/progressive-preview.tsx", import.meta.url), "utf8");

describe("main flow copy", () => {
  it("keeps create, sheet, render, and job labels in both locales", () => {
    assert.equal(fill(translate("en", "statusCreating"), { name: "Ada", n: 1, total: 2 }), "Creating Ada · 1/2");
    assert.equal(fill(translate("pt-BR", "statusCreating"), { name: "Ada", n: 1, total: 2 }), "Criando Ada · 1/2");
    assert.equal(translate("en", "statusRendering"), "Rendering · {percent}%");
    assert.equal(translate("pt-BR", "generationOffTitle"), "Geração paga desligada");
    assert.equal(translate("en", "fixtureSheet"), "Fixture sheet");
    assert.match(translate("en", "generationOffBody"), /fixture/);
    assert.match(translate("pt-BR", "generationOffBody"), /fixture/);
    assert.equal(apiErrorMessage("en", { code: "price_unavailable" }), translate("en", "priceUnavailable"));
    assert.equal(apiErrorMessage("pt-BR", { code: "disabled" }), translate("pt-BR", "generationDisabled"));
    assert.equal(apiErrorMessage("en", new Error("Geração desligada")), translate("en", "requestFailed"));
  });

  it("does not leave Portuguese status strings in the main flow components", () => {
    for (const source of [studio, preview]) {
      assert.equal(source.includes("Renderizando"), false);
      assert.equal(source.includes("Preparando cenário"), false);
      assert.equal(source.includes("Preparando animação"), false);
      assert.equal(source.includes("Escrevendo e animando"), false);
      assert.equal(source.includes("Gerando no núcleo"), false);
      assert.equal(source.includes("Personagem indisponível"), false);
      assert.equal(source.includes("Um debate com"), false);
    }
  });
});
