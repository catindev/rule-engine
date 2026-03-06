const pred_equals = require("./predicate/equals");
const pred_not_equals = require("./predicate/not_equals");
const pred_not_empty = require("./predicate/not_empty");
const pred_is_empty = require("./predicate/is_empty");
const pred_matches_regex = require("./predicate/matches_regex");
const pred_in_dictionary = require("./predicate/in_dictionary");
const pred_contains = require("./predicate/contains");
const pred_greater_than = require("./predicate/greater_than");
const pred_less_than = require("./predicate/less_than");

const chk_not_empty = require("./check/not_empty");
const chk_is_empty = require("./check/is_empty");
const chk_length_equals = require("./check/length_equals");
const chk_length_max = require("./check/length_max");
const chk_matches_regex = require("./check/matches_regex");
const chk_in_dictionary = require("./check/in_dictionary");
const chk_equals = require("./check/equals");
const chk_not_equals = require("./check/not_equals");
const chk_contains = require("./check/contains");
const chk_greater_than = require("./check/greater_than");
const chk_less_than = require("./check/less_than");
const chk_field_less_than_field = require("./check/field_less_than_field");
const chk_field_greater_than_field = require("./check/field_greater_than_field");
const chk_any_filled = require("./check/any_filled");
const chk_valid_inn = require("./check/valid_inn");
const chk_valid_ogrn = require("./check/valid_ogrn");

const pred_field_equals_field = require("./predicate/field_equals_field");
const pred_field_not_equals_field = require("./predicate/field_not_equals_field");

const chk_field_equals_field = require("./check/field_equals_field");
const chk_field_not_equals_field = require("./check/field_not_equals_field");

const Operators = {
  predicate: {
    equals: pred_equals,
    not_equals: pred_not_equals,
    not_empty: pred_not_empty,
    is_empty: pred_is_empty,
    matches_regex: pred_matches_regex,
    in_dictionary: pred_in_dictionary,
    contains: pred_contains,
    greater_than: pred_greater_than,
    less_than: pred_less_than,
    field_equals_field: pred_field_equals_field,
    field_not_equals_field: pred_field_not_equals_field,
  },
  check: {
    not_empty: chk_not_empty,
    is_empty: chk_is_empty,
    length_equals: chk_length_equals,
    length_max: chk_length_max,
    matches_regex: chk_matches_regex,
    in_dictionary: chk_in_dictionary,
    equals: chk_equals,
    not_equals: chk_not_equals,
    contains: chk_contains,
    greater_than: chk_greater_than,
    less_than: chk_less_than,
    field_less_than_field: chk_field_less_than_field,
    field_greater_than_field: chk_field_greater_than_field,
    field_equals_field: chk_field_equals_field,
    field_not_equals_field: chk_field_not_equals_field,
    any_filled: chk_any_filled,
    valid_inn: chk_valid_inn,
    valid_ogrn: chk_valid_ogrn,
  },
};

module.exports = { Operators };
