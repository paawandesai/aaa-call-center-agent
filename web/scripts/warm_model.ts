// Build step: download the embedding model into .models so the first caller doesn't wait for it.
import { embed } from "../lib/embed";
console.log("embedding dims:", (await embed(["warm up"]))[0].length);
