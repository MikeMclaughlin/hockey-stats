(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TableFilter = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function parseNumericFilter(raw) {
    var s = String(raw || "").trim();
    if (!s) return null;
    var range = s.match(/^(-?\d+(?:\.\d+)?)\s*[-:]\s*(-?\d+(?:\.\d+)?)$/);
    if (range) return { op: "range", lo: Number(range[1]), hi: Number(range[2]) };
    var cmp = s.match(/^(>=|<=|=|==|>|<)\s*(-?\d+(?:\.\d+)?)$/);
    if (cmp) return { op: cmp[1] === "==" ? "=" : cmp[1], n: Number(cmp[2]) };
    if (/^-?\d+(?:\.\d+)?$/.test(s)) return { op: "contains-or-eq", n: Number(s), text: s };
    return { op: "text", text: s };
  }

  function matchNumeric(value, spec) {
    if (spec == null) return true;
    if (value == null || !isFinite(Number(value))) {
      return spec.op === "text" && String(value || "").toLowerCase().indexOf(spec.text.toLowerCase()) !== -1;
    }
    var n = Number(value);
    if (spec.op === "range") return n >= spec.lo && n <= spec.hi;
    if (spec.op === ">=") return n >= spec.n;
    if (spec.op === "<=") return n <= spec.n;
    if (spec.op === ">") return n > spec.n;
    if (spec.op === "<") return n < spec.n;
    if (spec.op === "=") return n === spec.n;
    if (spec.op === "contains-or-eq") return n === spec.n || String(value).indexOf(spec.text) !== -1;
    return String(value).toLowerCase().indexOf(String(spec.text || "").toLowerCase()) !== -1;
  }

  function matchText(value, raw) {
    var q = String(raw || "").trim().toLowerCase();
    if (!q) return true;
    return String(value == null ? "" : value).toLowerCase().indexOf(q) !== -1;
  }

  function rowMatches(displayValues, filters, numericKeys) {
    numericKeys = numericKeys || {};
    for (var key in filters) {
      if (!Object.prototype.hasOwnProperty.call(filters, key)) continue;
      var raw = filters[key];
      if (raw == null || String(raw).trim() === "") continue;
      var val = displayValues[key];
      if (numericKeys[key]) {
        if (!matchNumeric(val, parseNumericFilter(raw))) return false;
      } else if (!matchText(val, raw)) {
        return false;
      }
    }
    return true;
  }

  return {
    parseNumericFilter: parseNumericFilter,
    matchNumeric: matchNumeric,
    matchText: matchText,
    rowMatches: rowMatches
  };
});
