import fs from "fs";

const FILE = "./bling-tokens.json";

export function saveTokens(tokens) {
  fs.writeFileSync(FILE, JSON.stringify(tokens, null, 2));
}

export function loadTokens() {
  if (!fs.existsSync(FILE)) return null;
  return JSON.parse(fs.readFileSync(FILE));
}
