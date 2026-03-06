const { assert, isObject } = require("./utils");
const { compile } = require("./compiler/index.js");
const { runPipeline } = require("./runner");

/**
 * createEngine({ operators })
 *
 * The engine is a thin composition layer that binds operator packs to the core
 * compiler + runtime.
 */
function createEngine({ operators }) {
  assert(isObject(operators), "createEngine: operators must be provided");
  assert(
    isObject(operators.check),
    "createEngine: operators.check must be an object",
  );
  assert(
    isObject(operators.predicate),
    "createEngine: operators.predicate must be an object",
  );

  return {
    compile(artifacts, options = {}) {
      // compiler will validate operator existence; it also returns operators
      return compile(artifacts, { operators, sources: options.sources });
    },

    runPipeline(compiled, pipelineId, payload) {
      return runPipeline(compiled, pipelineId, payload);
    },
  };
}

module.exports = { createEngine };
