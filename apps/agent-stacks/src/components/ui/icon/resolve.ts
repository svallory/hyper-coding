// Server-only: the Lucide map must never reach the browser bundle (see icon.marko).
import { lucideInner } from "./render.ts";

export const resolveIconInner = lucideInner;
