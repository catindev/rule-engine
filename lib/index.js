/**
 * Public API of the rule engine core.
 *
 * Keep this file small and stable: consumers should import from here.
 */
const { createEngine } = require("./engine");

module.exports = { createEngine };
