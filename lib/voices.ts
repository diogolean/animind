import type { LanguageCode, VoiceCatalog, VoiceGender, VoiceLanguage, VoiceOption } from "./contract";

type EdgeVoiceRow = readonly [locale: string, ...voices: `${string}:${"f" | "m"}`[]];

/**
 * Generated from edge-tts' complete voice list on 2026-11-01.
 * 322 voices across 142 locales. Keep this fallback in sync with GET /v1/voices.
 */
const EDGE_TTS_VOICES = [
  ["af-ZA", "AdriNeural:f", "WillemNeural:m"],
  ["sq-AL", "AnilaNeural:f", "IlirNeural:m"],
  ["am-ET", "AmehaNeural:m", "MekdesNeural:f"],
  ["ar-DZ", "AminaNeural:f", "IsmaelNeural:m"],
  ["ar-BH", "AliNeural:m", "LailaNeural:f"],
  ["ar-EG", "SalmaNeural:f", "ShakirNeural:m"],
  ["ar-IQ", "BasselNeural:m", "RanaNeural:f"],
  ["ar-JO", "SanaNeural:f", "TaimNeural:m"],
  ["ar-KW", "FahedNeural:m", "NouraNeural:f"],
  ["ar-LB", "LaylaNeural:f", "RamiNeural:m"],
  ["ar-LY", "ImanNeural:f", "OmarNeural:m"],
  ["ar-MA", "JamalNeural:m", "MounaNeural:f"],
  ["ar-OM", "AbdullahNeural:m", "AyshaNeural:f"],
  ["ar-QA", "AmalNeural:f", "MoazNeural:m"],
  ["ar-SA", "HamedNeural:m", "ZariyahNeural:f"],
  ["ar-SY", "AmanyNeural:f", "LaithNeural:m"],
  ["ar-TN", "HediNeural:m", "ReemNeural:f"],
  ["ar-AE", "FatimaNeural:f", "HamdanNeural:m"],
  ["ar-YE", "MaryamNeural:f", "SalehNeural:m"],
  ["az-AZ", "BabekNeural:m", "BanuNeural:f"],
  ["bn-BD", "NabanitaNeural:f", "PradeepNeural:m"],
  ["bn-IN", "BashkarNeural:m", "TanishaaNeural:f"],
  ["bs-BA", "VesnaNeural:f", "GoranNeural:m"],
  ["bg-BG", "BorislavNeural:m", "KalinaNeural:f"],
  ["my-MM", "NilarNeural:f", "ThihaNeural:m"],
  ["ca-ES", "EnricNeural:m", "JoanaNeural:f"],
  ["zh-HK", "HiuGaaiNeural:f", "HiuMaanNeural:f", "WanLungNeural:m"],
  ["zh-CN", "XiaoxiaoNeural:f", "XiaoyiNeural:f", "YunjianNeural:m", "YunxiNeural:m", "YunxiaNeural:m", "YunyangNeural:m"],
  ["zh-CN-liaoning", "XiaobeiNeural:f"],
  ["zh-TW", "HsiaoChenNeural:f", "YunJheNeural:m", "HsiaoYuNeural:f"],
  ["zh-CN-shaanxi", "XiaoniNeural:f"],
  ["hr-HR", "GabrijelaNeural:f", "SreckoNeural:m"],
  ["cs-CZ", "AntoninNeural:m", "VlastaNeural:f"],
  ["da-DK", "ChristelNeural:f", "JeppeNeural:m"],
  ["nl-BE", "ArnaudNeural:m", "DenaNeural:f"],
  ["nl-NL", "ColetteNeural:f", "FennaNeural:f", "MaartenNeural:m"],
  ["en-AU", "WilliamMultilingualNeural:m", "NatashaNeural:f"],
  ["en-CA", "ClaraNeural:f", "LiamNeural:m"],
  ["en-HK", "YanNeural:f", "SamNeural:m"],
  ["en-IN", "NeerjaExpressiveNeural:f", "NeerjaNeural:f", "PrabhatNeural:m"],
  ["en-IE", "ConnorNeural:m", "EmilyNeural:f"],
  ["en-KE", "AsiliaNeural:f", "ChilembaNeural:m"],
  ["en-NZ", "MitchellNeural:m", "MollyNeural:f"],
  ["en-NG", "AbeoNeural:m", "EzinneNeural:f"],
  ["en-PH", "JamesNeural:m", "RosaNeural:f"],
  ["en-US", "AvaNeural:f", "AndrewNeural:m", "EmmaNeural:f", "BrianNeural:m", "AnaNeural:f", "AndrewMultilingualNeural:m", "AriaNeural:f", "AvaMultilingualNeural:f", "BrianMultilingualNeural:m", "ChristopherNeural:m", "EmmaMultilingualNeural:f", "EricNeural:m", "GuyNeural:m", "JennyNeural:f", "MichelleNeural:f", "RogerNeural:m", "SteffanNeural:m"],
  ["en-SG", "LunaNeural:f", "WayneNeural:m"],
  ["en-ZA", "LeahNeural:f", "LukeNeural:m"],
  ["en-TZ", "ElimuNeural:m", "ImaniNeural:f"],
  ["en-GB", "LibbyNeural:f", "MaisieNeural:f", "RyanNeural:m", "SoniaNeural:f", "ThomasNeural:m"],
  ["et-EE", "AnuNeural:f", "KertNeural:m"],
  ["fil-PH", "AngeloNeural:m", "BlessicaNeural:f"],
  ["fi-FI", "HarriNeural:m", "NooraNeural:f"],
  ["fr-BE", "CharlineNeural:f", "GerardNeural:m"],
  ["fr-CA", "ThierryNeural:m", "AntoineNeural:m", "JeanNeural:m", "SylvieNeural:f"],
  ["fr-FR", "VivienneMultilingualNeural:f", "RemyMultilingualNeural:m", "DeniseNeural:f", "EloiseNeural:f", "HenriNeural:m"],
  ["fr-CH", "ArianeNeural:f", "FabriceNeural:m"],
  ["gl-ES", "RoiNeural:m", "SabelaNeural:f"],
  ["ka-GE", "EkaNeural:f", "GiorgiNeural:m"],
  ["de-AT", "IngridNeural:f", "JonasNeural:m"],
  ["de-DE", "SeraphinaMultilingualNeural:f", "FlorianMultilingualNeural:m", "AmalaNeural:f", "ConradNeural:m", "KatjaNeural:f", "KillianNeural:m"],
  ["de-CH", "JanNeural:m", "LeniNeural:f"],
  ["el-GR", "AthinaNeural:f", "NestorasNeural:m"],
  ["gu-IN", "DhwaniNeural:f", "NiranjanNeural:m"],
  ["he-IL", "AvriNeural:m", "HilaNeural:f"],
  ["hi-IN", "MadhurNeural:m", "SwaraNeural:f"],
  ["hu-HU", "NoemiNeural:f", "TamasNeural:m"],
  ["is-IS", "GudrunNeural:f", "GunnarNeural:m"],
  ["id-ID", "ArdiNeural:m", "GadisNeural:f"],
  ["iu-Latn-CA", "SiqiniqNeural:f", "TaqqiqNeural:m"],
  ["iu-Cans-CA", "SiqiniqNeural:f", "TaqqiqNeural:m"],
  ["ga-IE", "ColmNeural:m", "OrlaNeural:f"],
  ["it-IT", "GiuseppeMultilingualNeural:m", "DiegoNeural:m", "ElsaNeural:f", "IsabellaNeural:f"],
  ["ja-JP", "KeitaNeural:m", "NanamiNeural:f"],
  ["jv-ID", "DimasNeural:m", "SitiNeural:f"],
  ["kn-IN", "GaganNeural:m", "SapnaNeural:f"],
  ["kk-KZ", "AigulNeural:f", "DauletNeural:m"],
  ["km-KH", "PisethNeural:m", "SreymomNeural:f"],
  ["ko-KR", "HyunsuMultilingualNeural:m", "InJoonNeural:m", "SunHiNeural:f"],
  ["lo-LA", "ChanthavongNeural:m", "KeomanyNeural:f"],
  ["lv-LV", "EveritaNeural:f", "NilsNeural:m"],
  ["lt-LT", "LeonasNeural:m", "OnaNeural:f"],
  ["mk-MK", "AleksandarNeural:m", "MarijaNeural:f"],
  ["ms-MY", "OsmanNeural:m", "YasminNeural:f"],
  ["ml-IN", "MidhunNeural:m", "SobhanaNeural:f"],
  ["mt-MT", "GraceNeural:f", "JosephNeural:m"],
  ["mr-IN", "AarohiNeural:f", "ManoharNeural:m"],
  ["mn-MN", "BataaNeural:m", "YesuiNeural:f"],
  ["ne-NP", "HemkalaNeural:f", "SagarNeural:m"],
  ["nb-NO", "FinnNeural:m", "PernilleNeural:f"],
  ["ps-AF", "GulNawazNeural:m", "LatifaNeural:f"],
  ["fa-IR", "DilaraNeural:f", "FaridNeural:m"],
  ["pl-PL", "MarekNeural:m", "ZofiaNeural:f"],
  ["pt-BR", "ThalitaMultilingualNeural:f", "AntonioNeural:m", "FranciscaNeural:f"],
  ["pt-PT", "DuarteNeural:m", "RaquelNeural:f"],
  ["ro-RO", "AlinaNeural:f", "EmilNeural:m"],
  ["ru-RU", "DmitryNeural:m", "SvetlanaNeural:f"],
  ["sr-RS", "NicholasNeural:m", "SophieNeural:f"],
  ["si-LK", "SameeraNeural:m", "ThiliniNeural:f"],
  ["sk-SK", "LukasNeural:m", "ViktoriaNeural:f"],
  ["sl-SI", "PetraNeural:f", "RokNeural:m"],
  ["so-SO", "MuuseNeural:m", "UbaxNeural:f"],
  ["es-AR", "ElenaNeural:f", "TomasNeural:m"],
  ["es-BO", "MarceloNeural:m", "SofiaNeural:f"],
  ["es-CL", "CatalinaNeural:f", "LorenzoNeural:m"],
  ["es-CO", "GonzaloNeural:m", "SalomeNeural:f"],
  ["es-ES", "XimenaNeural:f", "AlvaroNeural:m", "ElviraNeural:f"],
  ["es-CR", "JuanNeural:m", "MariaNeural:f"],
  ["es-CU", "BelkysNeural:f", "ManuelNeural:m"],
  ["es-DO", "EmilioNeural:m", "RamonaNeural:f"],
  ["es-EC", "AndreaNeural:f", "LuisNeural:m"],
  ["es-SV", "LorenaNeural:f", "RodrigoNeural:m"],
  ["es-GQ", "JavierNeural:m", "TeresaNeural:f"],
  ["es-GT", "AndresNeural:m", "MartaNeural:f"],
  ["es-HN", "CarlosNeural:m", "KarlaNeural:f"],
  ["es-MX", "DaliaNeural:f", "JorgeNeural:m"],
  ["es-NI", "FedericoNeural:m", "YolandaNeural:f"],
  ["es-PA", "MargaritaNeural:f", "RobertoNeural:m"],
  ["es-PY", "MarioNeural:m", "TaniaNeural:f"],
  ["es-PE", "AlexNeural:m", "CamilaNeural:f"],
  ["es-PR", "KarinaNeural:f", "VictorNeural:m"],
  ["es-US", "AlonsoNeural:m", "PalomaNeural:f"],
  ["es-UY", "MateoNeural:m", "ValentinaNeural:f"],
  ["es-VE", "PaolaNeural:f", "SebastianNeural:m"],
  ["su-ID", "JajangNeural:m", "TutiNeural:f"],
  ["sw-KE", "RafikiNeural:m", "ZuriNeural:f"],
  ["sw-TZ", "DaudiNeural:m", "RehemaNeural:f"],
  ["sv-SE", "MattiasNeural:m", "SofieNeural:f"],
  ["ta-IN", "PallaviNeural:f", "ValluvarNeural:m"],
  ["ta-MY", "KaniNeural:f", "SuryaNeural:m"],
  ["ta-SG", "AnbuNeural:m", "VenbaNeural:f"],
  ["ta-LK", "KumarNeural:m", "SaranyaNeural:f"],
  ["te-IN", "MohanNeural:m", "ShrutiNeural:f"],
  ["th-TH", "NiwatNeural:m", "PremwadeeNeural:f"],
  ["tr-TR", "EmelNeural:f", "AhmetNeural:m"],
  ["uk-UA", "OstapNeural:m", "PolinaNeural:f"],
  ["ur-IN", "GulNeural:f", "SalmanNeural:m"],
  ["ur-PK", "AsadNeural:m", "UzmaNeural:f"],
  ["uz-UZ", "MadinaNeural:f", "SardorNeural:m"],
  ["vi-VN", "HoaiMyNeural:f", "NamMinhNeural:m"],
  ["cy-GB", "AledNeural:m", "NiaNeural:f"],
  ["zu-ZA", "ThandoNeural:f", "ThembaNeural:m"],
] as const satisfies readonly EdgeVoiceRow[];

const voiceLabel = (name: string) =>
  name.replace(/(?:Multilingual|Expressive)?Neural$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");

const FALLBACK_VOICES = Object.fromEntries(
  EDGE_TTS_VOICES.map(([locale, ...voices]) => [
    locale,
    voices.map((voice): VoiceOption => {
      const [name, voiceGender] = voice.split(":") as [string, "f" | "m"];
      return {
        id: `${locale}-${name}`,
        label: voiceLabel(name),
        language: locale,
        gender: voiceGender === "f" ? "female" : "male",
      };
    }),
  ]),
) as Record<string, VoiceOption[]>;

const displayName = (locale: string, displayLocale: string) => {
  try {
    return new Intl.DisplayNames([displayLocale], { type: "language" }).of(locale) ?? locale;
  } catch {
    return locale;
  }
};

const flag = (locale: string) => {
  try {
    const region = new Intl.Locale(locale).region;
    return region?.length === 2
      ? String.fromCodePoint(...[...region].map((letter) => 127397 + letter.charCodeAt(0)))
      : undefined;
  } catch {
    return undefined;
  }
};

const PREFERRED_NATIVE_NAMES: Record<string, string> = {
  "en-US": "English",
  "pt-BR": "Português BR",
  "es-ES": "Español",
};

const toLanguage = (locale: string): VoiceLanguage => ({
  id: locale,
  nativeName: PREFERRED_NATIVE_NAMES[locale] ?? displayName(locale, locale),
  englishName: displayName(locale, "en"),
  flag: flag(locale),
});

export const EDGE_TTS_LANGUAGES = EDGE_TTS_VOICES.map(([locale]) => toLanguage(locale));

const gender = (value: unknown): VoiceGender =>
  /^(f|female|femin)/i.test(String(value ?? "")) ? "female" : "male";

export function normalizeVoiceCatalog(data: unknown, language: LanguageCode, source: VoiceCatalog["source"]): VoiceCatalog {
  const raw = Array.isArray(data) ? data : (data as { voices?: unknown[] } | null)?.voices;
  const voices = Array.isArray(raw)
    ? raw.flatMap((item) => {
        const value = item as Record<string, unknown>;
        const id = String(value.id ?? value.voice ?? value.shortName ?? value.ShortName ?? value.name ?? value.Name ?? "");
        if (!id) return [];
        const voiceLanguage = String(value.language ?? value.lang ?? value.locale ?? value.Locale ?? language) as LanguageCode;
        return [{
          id,
          label: String(value.label ?? value.displayName ?? value.FriendlyName ?? voiceLabel(id.slice(voiceLanguage.length + 1))),
          language: voiceLanguage,
          gender: gender(value.gender ?? value.Gender),
          ...(value.previewUrl ? { previewUrl: String(value.previewUrl) } : {}),
        } satisfies VoiceOption];
      })
    : [];
  const coreLanguages = [...new Set(voices.map((voice) => voice.language))].map(toLanguage);
  const selectedFromCore = voices.filter((voice) => voice.language === language);
  const selected = selectedFromCore.length ? selectedFromCore : FALLBACK_VOICES[language] ?? FALLBACK_VOICES["en-US"];
  const first = (voiceGender: VoiceGender) => selected.find((voice) => voice.gender === voiceGender)?.id ?? selected[0].id;
  return {
    voices: selected,
    defaultByGender: { male: first("male"), female: first("female") },
    languages: coreLanguages.length > 1 ? coreLanguages : EDGE_TTS_LANGUAGES,
    source: selectedFromCore.length ? source : "fallback",
  };
}

export function fallbackVoiceCatalog(language: LanguageCode): VoiceCatalog {
  return normalizeVoiceCatalog(null, language, "fallback");
}
