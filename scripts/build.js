const fs = require("fs"),
  path = require("path"),
  { spawnSync } = require("child_process"),
  ejs = require("ejs");
const root = path.resolve(__dirname, "..");
let sources = 0,
  templates = 0;
function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? walk(path.join(dir, entry.name))
        : [path.join(dir, entry.name)],
    );
}
const files = [
  "app.js",
  ...["lib", "models", "routes", "scripts", "public"].flatMap((dir) =>
    walk(path.join(root, dir)).filter((f) => f.endsWith(".js")),
  ),
];
for (const file of files) {
  const result = spawnSync(
    process.execPath,
    ["--check", path.resolve(root, file)],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr || "JavaScript syntax check failed.");
    process.exit(1);
  }
  sources++;
}
for (const file of walk(path.join(root, "views")).filter((f) =>
  f.endsWith(".ejs"),
)) {
  try {
    ejs.compile(fs.readFileSync(file, "utf8"), { filename: file });
    templates++;
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
for (const asset of ["public/styles.css", "public/app.js"])
  if (!fs.statSync(path.join(root, asset)).size)
    throw Error("Missing production asset " + asset);
console.log(
  "Production validation build passed: " +
    sources +
    " JavaScript sources and " +
    templates +
    " EJS templates. Express/EJS is rendered at runtime; no frontend bundling is required.",
);
