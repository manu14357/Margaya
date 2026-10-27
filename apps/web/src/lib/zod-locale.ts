import { z } from "zod/v4";

// Zod sets its English messages with a module side effect, but its package
// declares `"sideEffects": false`, so a production build drops that call and
// every validation message falls back to "Invalid input". Set them here, where
// the call is kept.
z.config(z.locales.en());
