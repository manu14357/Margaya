import azAZ from "../../../../i18n/az-AZ.json";
import deDE from "../../../../i18n/de-DE.json";
import elGR from "../../../../i18n/el-GR.json";
import enUS from "../../../../i18n/en-US.json";
import esES from "../../../../i18n/es-ES.json";
import frFR from "../../../../i18n/fr-FR.json";
import hiIN from "../../../../i18n/hi-IN.json";
import idID from "../../../../i18n/id-ID.json";
import itIT from "../../../../i18n/it-IT.json";
import jaJP from "../../../../i18n/ja-JP.json";
import koKR from "../../../../i18n/ko-KR.json";
import mkMK from "../../../../i18n/mk-MK.json";
import nlNL from "../../../../i18n/nl-NL.json";
import plPL from "../../../../i18n/pl-PL.json";
import ptBR from "../../../../i18n/pt-BR.json";
import ruRU from "../../../../i18n/ru-RU.json";
import trTR from "../../../../i18n/tr-TR.json";
import ukUA from "../../../../i18n/uk-UA.json";
import viVN from "../../../../i18n/vi-VN.json";
import zhCN from "../../../../i18n/zh-CN.json";

// Keyed by language code: each app locale is the only one for its language.
const messages = {
  az: azAZ.invitations.email,
  de: deDE.invitations.email,
  el: elGR.invitations.email,
  en: enUS.invitations.email,
  es: esES.invitations.email,
  fr: frFR.invitations.email,
  hi: hiIN.invitations.email,
  id: idID.invitations.email,
  it: itIT.invitations.email,
  ja: jaJP.invitations.email,
  ko: koKR.invitations.email,
  mk: mkMK.invitations.email,
  nl: nlNL.invitations.email,
  pl: plPL.invitations.email,
  pt: ptBR.invitations.email,
  ru: ruRU.invitations.email,
  tr: trTR.invitations.email,
  uk: ukUA.invitations.email,
  vi: viVN.invitations.email,
  zh: zhCN.invitations.email,
} as const;

export function getWorkspaceInvitationEmailCopy(locale?: string | null) {
  const language = locale?.toLowerCase().split("-")[0];

  if (language && Object.hasOwn(messages, language)) {
    return messages[language as keyof typeof messages];
  }

  return messages.en;
}
