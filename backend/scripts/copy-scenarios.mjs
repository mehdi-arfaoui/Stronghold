import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const sourceDir = path.join(root, "src", "scenarios", "cyber");
const targetDir = path.join(root, "dist", "scenarios", "cyber");

fs.mkdirSync(targetDir, { recursive: true });

const files = fs.readdirSync(sourceDir).filter((file) => file.endsWith(".json"));
for (const file of files) {
  fs.copyFileSync(path.join(sourceDir, file), path.join(targetDir, file));
}
