import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { translate, voiceChipValue } from "../lib/i18n";

describe("voice chip locale", () => {
  it("names the automatic voice from the active locale", () => {
    assert.equal(voiceChipValue("en", "male"), `${translate("en", "maleShort")} · ${translate("en", "automaticVoice")}`);
    assert.equal(voiceChipValue("pt-BR", "male"), `${translate("pt-BR", "maleShort")} · ${translate("pt-BR", "automaticVoice")}`);
    assert.equal(voiceChipValue("pt-BR", "female", "Nanami"), `${translate("pt-BR", "femaleShort")} · Nanami`);
  });
});
