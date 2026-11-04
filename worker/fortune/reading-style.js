import { findExample } from "./reading-examples.js";
export function composeStory({ name, question }) {
 const example = findExample(question);
 if (!example) throw new Error("Live Tapp readings need an API key. Choose a labeled sample question to preview the experience.");
 return `${name}, ${example.answer.charAt(0).toLowerCase() + example.answer.slice(1)}`;
}
