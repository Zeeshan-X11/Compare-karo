const localities = Object.freeze(["Rajanukunte"]);
// Keep historical records readable/editable by administrators without publishing them.
const storedLocalities = Object.freeze(["Yelahanka", "Rajajinagar", ...localities]);

module.exports = { localities, storedLocalities };
