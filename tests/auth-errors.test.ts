import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { apiErrorMessage } from "../lib/i18n";

const loginForm = readFileSync(new URL("../components/login-form.tsx", import.meta.url), "utf8");
const loginRoute = readFileSync(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8");
const characters = readFileSync(new URL("../components/my-characters.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("../components/character-detail.tsx", import.meta.url), "utf8");
const library = readFileSync(new URL("../components/biblioteca.tsx", import.meta.url), "utf8");
const spend = readFileSync(new URL("../components/spend-panel.tsx", import.meta.url), "utf8");
const composer = readFileSync(new URL("../components/composer.tsx", import.meta.url), "utf8");

describe("visible API errors follow the selected language", () => {
  it("maps auth and library failures by code", () => {
    assert.equal(apiErrorMessage("en", { code: "auth_invalid" }), "Email or password is incorrect");
    assert.equal(apiErrorMessage("pt-BR", { code: "auth_invalid" }), "E-mail ou senha incorretos");
    assert.equal(apiErrorMessage("en", { error: "E-mail ou senha incorretos" }), "Request failed");
    assert.equal(apiErrorMessage("en", { code: "google_denied" }), "Google did not authorize this sign-in.");
    assert.equal(apiErrorMessage("pt-BR", { code: "google_state" }), "A entrada com Google expirou. Tente de novo.");
    assert.equal(apiErrorMessage("en", { code: "accounts_unavailable" }), "Accounts are not available on this deploy.");
    assert.equal(apiErrorMessage("en", { code: "character_missing" }), "Character not found");
    assert.equal(apiErrorMessage("pt-BR", { code: "forbidden" }), "Sem permissão");
    assert.match(loginRoute, /code: "auth_invalid"/);
  });

  it("does not render the server sentence", () => {
    for (const source of [loginForm, characters, detail, library, spend, composer]) {
      assert.equal(source.includes("apiErrorMessage"), true, source.slice(0, 40));
      assert.equal(source.includes("data.error"), false);
      assert.equal(source.includes("body.error"), false);
      assert.equal(source.includes(".message"), false);
    }
    assert.equal(loginForm.includes("E-mail ou senha incorretos"), false);
    assert.equal(loginForm.includes("O login com Google"), false);
    assert.equal(characters.includes("A biblioteca da conta não está disponível"), false);
    assert.equal(detail.includes("Personagem não encontrado"), false);
    assert.equal(spend.includes("Sem permissão"), false);
  });
});
