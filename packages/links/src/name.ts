import type { Linker } from "./types";

export const nameLinker: Linker = {
  channel: "name",
  sameLanguage: false,
  matches: (request, offer) => request.key === offer.key,
  offerKeys: (offer) => [offer.key],
  requestKeys: (request) => [request.key],
  label: () => "nome",
  labelKey: "name",
  // A shared name between languages is a guess: the code does not prove the call.
  doubt: () => "name-only",
};
