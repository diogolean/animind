import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inferCreationPlan, inferLanguage } from "../lib/planner";

describe("local plan language", () => {
  it("keeps an English debate in English and names the pair", () => {
    const prompt = "Socrates and Nietzsche debate wonder";
    assert.equal(inferLanguage(prompt), "en-US");
    const plan = inferCreationPlan(prompt);
    assert.equal(plan.language, "en-US");
    assert.equal(plan.mode, "debate");
    assert.deepEqual(plan.characters.map((character) => character.name), ["Socrates", "Nietzsche"]);
  });

  it("still hears Spanish and Portuguese from their own words", () => {
    assert.equal(inferLanguage("Una conversacion sobre la verdad"), "es-ES");
    assert.equal(inferLanguage("Sócrates e Nietzsche debatem sobre a verdade"), "pt-BR");
    const plan = inferCreationPlan("Sócrates e Nietzsche debatem sobre a verdade");
    assert.equal(plan.language, "pt-BR");
    assert.deepEqual(plan.characters.map((character) => character.name), ["Sócrates", "Nietzsche"]);
  });
});
