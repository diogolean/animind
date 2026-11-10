import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { apiErrorMessage, fill, translate } from "../lib/i18n";

const studio = readFileSync(new URL("../components/creation-studio.tsx", import.meta.url), "utf8");
const preview = readFileSync(new URL("../components/flow/progressive-preview.tsx", import.meta.url), "utf8");
const avatar = readFileSync(new URL("../components/avatar-request.tsx", import.meta.url), "utf8");

describe("main flow copy", () => {
  it("keeps create, sheet, render, and job labels in both locales", () => {
    assert.equal(fill(translate("en", "statusCreating"), { name: "Ada", n: 1, total: 2 }), "Creating Ada · 1/2");
    assert.equal(fill(translate("pt-BR", "statusCreating"), { name: "Ada", n: 1, total: 2 }), "Criando Ada · 1/2");
    assert.equal(translate("en", "statusRendering"), "Rendering · {percent}%");
    assert.equal(translate("pt-BR", "generationOffTitle"), "Geração paga desligada");
    assert.equal(translate("en", "fixtureSheet"), "Sample quotes");
    assert.equal(translate("pt-BR", "fixtureSheet"), "Citações de exemplo");
    assert.match(translate("en", "generationOffBody"), /saved example/);
    assert.match(translate("pt-BR", "generationOffBody"), /exemplo guardado/);
    assert.equal(/fixture/i.test(translate("en", "generationOffBody")), false);
    assert.equal(/fixture/i.test(translate("pt-BR", "generationOffBody")), false);
    assert.equal(apiErrorMessage("en", { code: "price_unavailable" }), translate("en", "priceUnavailable"));
    assert.equal(apiErrorMessage("pt-BR", { code: "disabled" }), translate("pt-BR", "generationDisabled"));
    assert.equal(apiErrorMessage("en", new Error("Geração desligada")), translate("en", "requestFailed"));
    assert.equal(translate("en", "generateAvatar"), "Generate avatar");
    assert.equal(translate("pt-BR", "generateAvatar"), "Gerar avatar");
    assert.equal(translate("en", "waitingForSignIn"), "Waiting for sign-in");
    assert.equal(translate("pt-BR", "waitingForSignIn"), "Login necessário");
    assert.equal(translate("en", "avatarIncluded"), "Included in the automatic generation");
    assert.equal(translate("pt-BR", "avatarIncluded"), "Incluído na geração automática");
    assert.equal(translate("en", "avatarFixtureStage"), "Preview · {stage}");
    assert.equal(translate("pt-BR", "avatarFixtureStage"), "Prévia · {stage}");
    assert.equal(translate("en", "coreDevMock"), "Preview · paid generation is off");
    assert.equal(translate("pt-BR", "coreDevMock"), "Prévia · geração paga desligada");
    assert.equal(/dev mock|mock de dev|adapter|adaptador/i.test(translate("en", "coreDevMock") + translate("en", "avatarProviderOff")), false);
    assert.equal(translate("en", "planPrice"), "No published price. This step is not charged.");
    assert.equal(translate("pt-BR", "planPrice"), "Não há preço publicado. Este passo não é cobrado.");
    assert.equal(translate("en", "avatarPreviewResult"), "Preview only. No face was drawn, and nothing was charged.");
    assert.equal(translate("en", "debateFixtureLabel"), "Sample debate, not a live one");
    assert.equal(translate("pt-BR", "debateFixtureRun"), "Ver o debate de exemplo");
    assert.equal(/fixture/i.test(translate("en", "debateFixtureLabel") + translate("pt-BR", "debateFixtureBody")), false);
    assert.equal(translate("en", "noSavedQuotes"), "No saved quotes for {name}. This preview does not look anyone up live.");
    assert.match(studio, /persona-missing/);
    assert.match(studio, /noSavedQuotes/);
  });

  it("does not leave Portuguese status strings in the main flow components", () => {
    for (const source of [studio, preview, avatar]) {
      assert.equal(source.includes("Renderizando"), false);
      assert.equal(source.includes("Preparando cenário"), false);
      assert.equal(source.includes("Preparando animação"), false);
      assert.equal(source.includes("Escrevendo e animando"), false);
      assert.equal(source.includes("Gerando no núcleo"), false);
      assert.equal(source.includes("Personagem indisponível"), false);
      assert.equal(source.includes("Um debate com"), false);
      assert.equal(source.includes("Processando"), false);
      assert.equal(source.includes("Gerando"), false);
    }
  });
});
