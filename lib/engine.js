const { assert, isObject } = require("./utils");
const { compile } = require("./compiler");
const { runPipeline } = require("./runner");

/**
 * createEngine({ operators })
 *
 * The engine is a thin composition layer that binds operator packs to the core
 * compiler + runtime.
 */
function createEngine({ operators }) {
  assert(isObject(operators), "createEngine: operators must be provided");
  assert(isObject(operators.check), "createEngine: operators.check must be an object");
  assert(isObject(operators.predicate), "createEngine: operators.predicate must be an object");

  return {
    compile(artifacts) {
      // compiler will validate operator existence; it also returns operators
      return compile(artifacts, { operators });
    },

    runPipeline(compiled, pipelineId, payload) {
      // runtime uses compiled.operators; sanity-check here to surface misuse early
      if (!compiled.operators) compiled.operators = operators;
      return runPipeline(compiled, pipelineId, payload);
    },
  };
}

module.exports = { createEngine };
