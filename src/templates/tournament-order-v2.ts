import { createTournamentOrderTemplate } from "./template-builders.js";

/** Versioned starter course that guarantees targeted puzzles pass the no-guess trace. */
export const tournamentOrderV2Template = createTournamentOrderTemplate("tournament-order-v2", true);
