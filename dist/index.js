#!/usr/bin/env node
import mysql from 'mysql2';
import util, { format, inspect } from 'util';
import fs$3, { readFileSync, statSync, readdirSync, writeFile } from 'fs';
import path, { normalize, resolve, dirname, basename, extname, relative, join } from 'path';
import yargs from 'yargs';
import { notStrictEqual, strictEqual } from 'assert';
import { fileURLToPath } from 'url';
import fs, { readdir, mkdir } from 'fs/promises';
import express from 'express';
import http from 'http';
import process$1 from 'node:process';
import { Buffer } from 'node:buffer';
import path$1 from 'node:path';
import { fileURLToPath as fileURLToPath$1 } from 'node:url';
import childProcess, { execFile } from 'node:child_process';
import fs$2, { constants } from 'node:fs/promises';
import os from 'node:os';
import fs$1 from 'node:fs';
import { promisify } from 'node:util';
import cors from 'cors';

function _arrayLikeToArray(r, a) {
  (null == a || a > r.length) && (a = r.length);
  for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
  return n;
}
function _arrayWithHoles(r) {
  if (Array.isArray(r)) return r;
}
function asyncGeneratorStep(n, t, e, r, o, a, c) {
  try {
    var i = n[a](c),
      u = i.value;
  } catch (n) {
    return void e(n);
  }
  i.done ? t(u) : Promise.resolve(u).then(r, o);
}
function _asyncToGenerator(n) {
  return function () {
    var t = this,
      e = arguments;
    return new Promise(function (r, o) {
      var a = n.apply(t, e);
      function _next(n) {
        asyncGeneratorStep(a, r, o, _next, _throw, "next", n);
      }
      function _throw(n) {
        asyncGeneratorStep(a, r, o, _next, _throw, "throw", n);
      }
      _next(undefined);
    });
  };
}
function _classCallCheck(a, n) {
  if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
}
function _defineProperties(e, r) {
  for (var t = 0; t < r.length; t++) {
    var o = r[t];
    o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
  }
}
function _createClass(e, r, t) {
  return _defineProperties(e.prototype, r), Object.defineProperty(e, "prototype", {
    writable: false
  }), e;
}
function _createForOfIteratorHelper(r, e) {
  var t = "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
  if (!t) {
    if (Array.isArray(r) || (t = _unsupportedIterableToArray(r)) || e) {
      t && (r = t);
      var n = 0,
        F = function () {};
      return {
        s: F,
        n: function () {
          return n >= r.length ? {
            done: true
          } : {
            done: false,
            value: r[n++]
          };
        },
        e: function (r) {
          throw r;
        },
        f: F
      };
    }
    throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
  }
  var o,
    a = true,
    u = false;
  return {
    s: function () {
      t = t.call(r);
    },
    n: function () {
      var r = t.next();
      return a = r.done, r;
    },
    e: function (r) {
      u = true, o = r;
    },
    f: function () {
      try {
        a || null == t.return || t.return();
      } finally {
        if (u) throw o;
      }
    }
  };
}
function _defineProperty(e, r, t) {
  return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
    value: t,
    enumerable: true,
    configurable: true,
    writable: true
  }) : e[r] = t, e;
}
function _iterableToArrayLimit(r, l) {
  var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
  if (null != t) {
    var e,
      n,
      i,
      u,
      a = [],
      f = true,
      o = false;
    try {
      if (i = (t = t.call(r)).next, 0 === l) ; else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0);
    } catch (r) {
      o = true, n = r;
    } finally {
      try {
        if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return;
      } finally {
        if (o) throw n;
      }
    }
    return a;
  }
}
function _nonIterableRest() {
  throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function ownKeys(e, r) {
  var t = Object.keys(e);
  if (Object.getOwnPropertySymbols) {
    var o = Object.getOwnPropertySymbols(e);
    r && (o = o.filter(function (r) {
      return Object.getOwnPropertyDescriptor(e, r).enumerable;
    })), t.push.apply(t, o);
  }
  return t;
}
function _objectSpread2(e) {
  for (var r = 1; r < arguments.length; r++) {
    var t = null != arguments[r] ? arguments[r] : {};
    r % 2 ? ownKeys(Object(t), true).forEach(function (r) {
      _defineProperty(e, r, t[r]);
    }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) {
      Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r));
    });
  }
  return e;
}
function _regeneratorRuntime() {
  _regeneratorRuntime = function () {
    return e;
  };
  var t,
    e = {},
    r = Object.prototype,
    n = r.hasOwnProperty,
    o = Object.defineProperty || function (t, e, r) {
      t[e] = r.value;
    },
    i = "function" == typeof Symbol ? Symbol : {},
    a = i.iterator || "@@iterator",
    c = i.asyncIterator || "@@asyncIterator",
    u = i.toStringTag || "@@toStringTag";
  function define(t, e, r) {
    return Object.defineProperty(t, e, {
      value: r,
      enumerable: true,
      configurable: true,
      writable: true
    }), t[e];
  }
  try {
    define({}, "");
  } catch (t) {
    define = function (t, e, r) {
      return t[e] = r;
    };
  }
  function wrap(t, e, r, n) {
    var i = e && e.prototype instanceof Generator ? e : Generator,
      a = Object.create(i.prototype),
      c = new Context(n || []);
    return o(a, "_invoke", {
      value: makeInvokeMethod(t, r, c)
    }), a;
  }
  function tryCatch(t, e, r) {
    try {
      return {
        type: "normal",
        arg: t.call(e, r)
      };
    } catch (t) {
      return {
        type: "throw",
        arg: t
      };
    }
  }
  e.wrap = wrap;
  var h = "suspendedStart",
    l = "suspendedYield",
    f = "executing",
    s = "completed",
    y = {};
  function Generator() {}
  function GeneratorFunction() {}
  function GeneratorFunctionPrototype() {}
  var p = {};
  define(p, a, function () {
    return this;
  });
  var d = Object.getPrototypeOf,
    v = d && d(d(values([])));
  v && v !== r && n.call(v, a) && (p = v);
  var g = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(p);
  function defineIteratorMethods(t) {
    ["next", "throw", "return"].forEach(function (e) {
      define(t, e, function (t) {
        return this._invoke(e, t);
      });
    });
  }
  function AsyncIterator(t, e) {
    function invoke(r, o, i, a) {
      var c = tryCatch(t[r], t, o);
      if ("throw" !== c.type) {
        var u = c.arg,
          h = u.value;
        return h && "object" == typeof h && n.call(h, "__await") ? e.resolve(h.__await).then(function (t) {
          invoke("next", t, i, a);
        }, function (t) {
          invoke("throw", t, i, a);
        }) : e.resolve(h).then(function (t) {
          u.value = t, i(u);
        }, function (t) {
          return invoke("throw", t, i, a);
        });
      }
      a(c.arg);
    }
    var r;
    o(this, "_invoke", {
      value: function (t, n) {
        function callInvokeWithMethodAndArg() {
          return new e(function (e, r) {
            invoke(t, n, e, r);
          });
        }
        return r = r ? r.then(callInvokeWithMethodAndArg, callInvokeWithMethodAndArg) : callInvokeWithMethodAndArg();
      }
    });
  }
  function makeInvokeMethod(e, r, n) {
    var o = h;
    return function (i, a) {
      if (o === f) throw Error("Generator is already running");
      if (o === s) {
        if ("throw" === i) throw a;
        return {
          value: t,
          done: true
        };
      }
      for (n.method = i, n.arg = a;;) {
        var c = n.delegate;
        if (c) {
          var u = maybeInvokeDelegate(c, n);
          if (u) {
            if (u === y) continue;
            return u;
          }
        }
        if ("next" === n.method) n.sent = n._sent = n.arg;else if ("throw" === n.method) {
          if (o === h) throw o = s, n.arg;
          n.dispatchException(n.arg);
        } else "return" === n.method && n.abrupt("return", n.arg);
        o = f;
        var p = tryCatch(e, r, n);
        if ("normal" === p.type) {
          if (o = n.done ? s : l, p.arg === y) continue;
          return {
            value: p.arg,
            done: n.done
          };
        }
        "throw" === p.type && (o = s, n.method = "throw", n.arg = p.arg);
      }
    };
  }
  function maybeInvokeDelegate(e, r) {
    var n = r.method,
      o = e.iterator[n];
    if (o === t) return r.delegate = null, "throw" === n && e.iterator.return && (r.method = "return", r.arg = t, maybeInvokeDelegate(e, r), "throw" === r.method) || "return" !== n && (r.method = "throw", r.arg = new TypeError("The iterator does not provide a '" + n + "' method")), y;
    var i = tryCatch(o, e.iterator, r.arg);
    if ("throw" === i.type) return r.method = "throw", r.arg = i.arg, r.delegate = null, y;
    var a = i.arg;
    return a ? a.done ? (r[e.resultName] = a.value, r.next = e.nextLoc, "return" !== r.method && (r.method = "next", r.arg = t), r.delegate = null, y) : a : (r.method = "throw", r.arg = new TypeError("iterator result is not an object"), r.delegate = null, y);
  }
  function pushTryEntry(t) {
    var e = {
      tryLoc: t[0]
    };
    1 in t && (e.catchLoc = t[1]), 2 in t && (e.finallyLoc = t[2], e.afterLoc = t[3]), this.tryEntries.push(e);
  }
  function resetTryEntry(t) {
    var e = t.completion || {};
    e.type = "normal", delete e.arg, t.completion = e;
  }
  function Context(t) {
    this.tryEntries = [{
      tryLoc: "root"
    }], t.forEach(pushTryEntry, this), this.reset(true);
  }
  function values(e) {
    if (e || "" === e) {
      var r = e[a];
      if (r) return r.call(e);
      if ("function" == typeof e.next) return e;
      if (!isNaN(e.length)) {
        var o = -1,
          i = function next() {
            for (; ++o < e.length;) if (n.call(e, o)) return next.value = e[o], next.done = false, next;
            return next.value = t, next.done = true, next;
          };
        return i.next = i;
      }
    }
    throw new TypeError(typeof e + " is not iterable");
  }
  return GeneratorFunction.prototype = GeneratorFunctionPrototype, o(g, "constructor", {
    value: GeneratorFunctionPrototype,
    configurable: true
  }), o(GeneratorFunctionPrototype, "constructor", {
    value: GeneratorFunction,
    configurable: true
  }), GeneratorFunction.displayName = define(GeneratorFunctionPrototype, u, "GeneratorFunction"), e.isGeneratorFunction = function (t) {
    var e = "function" == typeof t && t.constructor;
    return !!e && (e === GeneratorFunction || "GeneratorFunction" === (e.displayName || e.name));
  }, e.mark = function (t) {
    return Object.setPrototypeOf ? Object.setPrototypeOf(t, GeneratorFunctionPrototype) : (t.__proto__ = GeneratorFunctionPrototype, define(t, u, "GeneratorFunction")), t.prototype = Object.create(g), t;
  }, e.awrap = function (t) {
    return {
      __await: t
    };
  }, defineIteratorMethods(AsyncIterator.prototype), define(AsyncIterator.prototype, c, function () {
    return this;
  }), e.AsyncIterator = AsyncIterator, e.async = function (t, r, n, o, i) {
    undefined === i && (i = Promise);
    var a = new AsyncIterator(wrap(t, r, n, o), i);
    return e.isGeneratorFunction(r) ? a : a.next().then(function (t) {
      return t.done ? t.value : a.next();
    });
  }, defineIteratorMethods(g), define(g, u, "Generator"), define(g, a, function () {
    return this;
  }), define(g, "toString", function () {
    return "[object Generator]";
  }), e.keys = function (t) {
    var e = Object(t),
      r = [];
    for (var n in e) r.push(n);
    return r.reverse(), function next() {
      for (; r.length;) {
        var t = r.pop();
        if (t in e) return next.value = t, next.done = false, next;
      }
      return next.done = true, next;
    };
  }, e.values = values, Context.prototype = {
    constructor: Context,
    reset: function (e) {
      if (this.prev = 0, this.next = 0, this.sent = this._sent = t, this.done = false, this.delegate = null, this.method = "next", this.arg = t, this.tryEntries.forEach(resetTryEntry), !e) for (var r in this) "t" === r.charAt(0) && n.call(this, r) && !isNaN(+r.slice(1)) && (this[r] = t);
    },
    stop: function () {
      this.done = true;
      var t = this.tryEntries[0].completion;
      if ("throw" === t.type) throw t.arg;
      return this.rval;
    },
    dispatchException: function (e) {
      if (this.done) throw e;
      var r = this;
      function handle(n, o) {
        return a.type = "throw", a.arg = e, r.next = n, o && (r.method = "next", r.arg = t), !!o;
      }
      for (var o = this.tryEntries.length - 1; o >= 0; --o) {
        var i = this.tryEntries[o],
          a = i.completion;
        if ("root" === i.tryLoc) return handle("end");
        if (i.tryLoc <= this.prev) {
          var c = n.call(i, "catchLoc"),
            u = n.call(i, "finallyLoc");
          if (c && u) {
            if (this.prev < i.catchLoc) return handle(i.catchLoc, true);
            if (this.prev < i.finallyLoc) return handle(i.finallyLoc);
          } else if (c) {
            if (this.prev < i.catchLoc) return handle(i.catchLoc, true);
          } else {
            if (!u) throw Error("try statement without catch or finally");
            if (this.prev < i.finallyLoc) return handle(i.finallyLoc);
          }
        }
      }
    },
    abrupt: function (t, e) {
      for (var r = this.tryEntries.length - 1; r >= 0; --r) {
        var o = this.tryEntries[r];
        if (o.tryLoc <= this.prev && n.call(o, "finallyLoc") && this.prev < o.finallyLoc) {
          var i = o;
          break;
        }
      }
      i && ("break" === t || "continue" === t) && i.tryLoc <= e && e <= i.finallyLoc && (i = null);
      var a = i ? i.completion : {};
      return a.type = t, a.arg = e, i ? (this.method = "next", this.next = i.finallyLoc, y) : this.complete(a);
    },
    complete: function (t, e) {
      if ("throw" === t.type) throw t.arg;
      return "break" === t.type || "continue" === t.type ? this.next = t.arg : "return" === t.type ? (this.rval = this.arg = t.arg, this.method = "return", this.next = "end") : "normal" === t.type && e && (this.next = e), y;
    },
    finish: function (t) {
      for (var e = this.tryEntries.length - 1; e >= 0; --e) {
        var r = this.tryEntries[e];
        if (r.finallyLoc === t) return this.complete(r.completion, r.afterLoc), resetTryEntry(r), y;
      }
    },
    catch: function (t) {
      for (var e = this.tryEntries.length - 1; e >= 0; --e) {
        var r = this.tryEntries[e];
        if (r.tryLoc === t) {
          var n = r.completion;
          if ("throw" === n.type) {
            var o = n.arg;
            resetTryEntry(r);
          }
          return o;
        }
      }
      throw Error("illegal catch attempt");
    },
    delegateYield: function (e, r, n) {
      return this.delegate = {
        iterator: values(e),
        resultName: r,
        nextLoc: n
      }, "next" === this.method && (this.arg = t), y;
    }
  }, e;
}
function _slicedToArray(r, e) {
  return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest();
}
function _toPrimitive(t, r) {
  if ("object" != typeof t || !t) return t;
  var e = t[Symbol.toPrimitive];
  if (undefined !== e) {
    var i = e.call(t, r);
    if ("object" != typeof i) return i;
    throw new TypeError("@@toPrimitive must return a primitive value.");
  }
  return (String )(t);
}
function _toPropertyKey(t) {
  var i = _toPrimitive(t, "string");
  return "symbol" == typeof i ? i : i + "";
}
function _unsupportedIterableToArray(r, a) {
  if (r) {
    if ("string" == typeof r) return _arrayLikeToArray(r, a);
    var t = {}.toString.call(r).slice(8, -1);
    return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : undefined;
  }
}

class YError extends Error {
    constructor(msg) {
        super(msg || 'yargs error');
        this.name = 'YError';
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, YError);
        }
    }
}

function getProcessArgvBinIndex() {
    if (isBundledElectronApp())
        return 0;
    return 1;
}
function isBundledElectronApp() {
    return isElectronApp() && !process.defaultApp;
}
function isElectronApp() {
    return !!process.versions.electron;
}
function hideBin(argv) {
    return argv.slice(getProcessArgvBinIndex() + 1);
}
function getProcessArgvBin() {
    return process.argv[getProcessArgvBinIndex()];
}

/**
 * @license
 * Copyright (c) 2016, Contributors
 * SPDX-License-Identifier: ISC
 */
function camelCase(str) {
    // Handle the case where an argument is provided as camel case, e.g., fooBar.
    // by ensuring that the string isn't already mixed case:
    const isCamelCase = str !== str.toLowerCase() && str !== str.toUpperCase();
    if (!isCamelCase) {
        str = str.toLowerCase();
    }
    if (str.indexOf('-') === -1 && str.indexOf('_') === -1) {
        return str;
    }
    else {
        let camelcase = '';
        let nextChrUpper = false;
        const leadingHyphens = str.match(/^-+/);
        for (let i = leadingHyphens ? leadingHyphens[0].length : 0; i < str.length; i++) {
            let chr = str.charAt(i);
            if (nextChrUpper) {
                nextChrUpper = false;
                chr = chr.toUpperCase();
            }
            if (i !== 0 && (chr === '-' || chr === '_')) {
                nextChrUpper = true;
            }
            else if (chr !== '-' && chr !== '_') {
                camelcase += chr;
            }
        }
        return camelcase;
    }
}
function decamelize(str, joinString) {
    const lowercase = str.toLowerCase();
    joinString = joinString || '-';
    let notCamelcase = '';
    for (let i = 0; i < str.length; i++) {
        const chrLower = lowercase.charAt(i);
        const chrString = str.charAt(i);
        if (chrLower !== chrString && i > 0) {
            notCamelcase += `${joinString}${lowercase.charAt(i)}`;
        }
        else {
            notCamelcase += chrString;
        }
    }
    return notCamelcase;
}
function looksLikeNumber(x) {
    if (x === null || x === undefined)
        return false;
    // if loaded from config, may already be a number.
    if (typeof x === 'number')
        return true;
    // hexadecimal.
    if (/^0x[0-9a-f]+$/i.test(x))
        return true;
    // don't treat 0123 as a number; as it drops the leading '0'.
    if (/^0[^.]/.test(x))
        return false;
    return /^[-]?(?:\d+(?:\.\d*)?|\.\d+)(e[-+]?\d+)?$/.test(x);
}

/**
 * @license
 * Copyright (c) 2016, Contributors
 * SPDX-License-Identifier: ISC
 */
// take an un-split argv string and tokenize it.
function tokenizeArgString(argString) {
    if (Array.isArray(argString)) {
        return argString.map(e => typeof e !== 'string' ? e + '' : e);
    }
    argString = argString.trim();
    let i = 0;
    let prevC = null;
    let c = null;
    let opening = null;
    const args = [];
    for (let ii = 0; ii < argString.length; ii++) {
        prevC = c;
        c = argString.charAt(ii);
        // split on spaces unless we're in quotes.
        if (c === ' ' && !opening) {
            if (!(prevC === ' ')) {
                i++;
            }
            continue;
        }
        // don't split the string if we're in matching
        // opening or closing single and double quotes.
        if (c === opening) {
            opening = null;
        }
        else if ((c === "'" || c === '"') && !opening) {
            opening = c;
        }
        if (!args[i])
            args[i] = '';
        args[i] += c;
    }
    return args;
}

/**
 * @license
 * Copyright (c) 2016, Contributors
 * SPDX-License-Identifier: ISC
 */
var DefaultValuesForTypeKey;
(function (DefaultValuesForTypeKey) {
    DefaultValuesForTypeKey["BOOLEAN"] = "boolean";
    DefaultValuesForTypeKey["STRING"] = "string";
    DefaultValuesForTypeKey["NUMBER"] = "number";
    DefaultValuesForTypeKey["ARRAY"] = "array";
})(DefaultValuesForTypeKey || (DefaultValuesForTypeKey = {}));

/**
 * @license
 * Copyright (c) 2016, Contributors
 * SPDX-License-Identifier: ISC
 */
let mixin$1;
class YargsParser {
    constructor(_mixin) {
        mixin$1 = _mixin;
    }
    parse(argsInput, options) {
        const opts = Object.assign({
            alias: undefined,
            array: undefined,
            boolean: undefined,
            config: undefined,
            configObjects: undefined,
            configuration: undefined,
            coerce: undefined,
            count: undefined,
            default: undefined,
            envPrefix: undefined,
            narg: undefined,
            normalize: undefined,
            string: undefined,
            number: undefined,
            __: undefined,
            key: undefined
        }, options);
        // allow a string argument to be passed in rather
        // than an argv array.
        const args = tokenizeArgString(argsInput);
        // tokenizeArgString adds extra quotes to args if argsInput is a string
        // only strip those extra quotes in processValue if argsInput is a string
        const inputIsString = typeof argsInput === 'string';
        // aliases might have transitive relationships, normalize this.
        const aliases = combineAliases(Object.assign(Object.create(null), opts.alias));
        const configuration = Object.assign({
            'boolean-negation': true,
            'camel-case-expansion': true,
            'combine-arrays': false,
            'dot-notation': true,
            'duplicate-arguments-array': true,
            'flatten-duplicate-arrays': true,
            'greedy-arrays': true,
            'halt-at-non-option': false,
            'nargs-eats-options': false,
            'negation-prefix': 'no-',
            'parse-numbers': true,
            'parse-positional-numbers': true,
            'populate--': false,
            'set-placeholder-key': false,
            'short-option-groups': true,
            'strip-aliased': false,
            'strip-dashed': false,
            'unknown-options-as-args': false
        }, opts.configuration);
        const defaults = Object.assign(Object.create(null), opts.default);
        const configObjects = opts.configObjects || [];
        const envPrefix = opts.envPrefix;
        const notFlagsOption = configuration['populate--'];
        const notFlagsArgv = notFlagsOption ? '--' : '_';
        const newAliases = Object.create(null);
        const defaulted = Object.create(null);
        // allow a i18n handler to be passed in, default to a fake one (util.format).
        const __ = opts.__ || mixin$1.format;
        const flags = {
            aliases: Object.create(null),
            arrays: Object.create(null),
            bools: Object.create(null),
            strings: Object.create(null),
            numbers: Object.create(null),
            counts: Object.create(null),
            normalize: Object.create(null),
            configs: Object.create(null),
            nargs: Object.create(null),
            coercions: Object.create(null),
            keys: []
        };
        const negative = /^-([0-9]+(\.[0-9]+)?|\.[0-9]+)$/;
        const negatedBoolean = new RegExp('^--' + configuration['negation-prefix'] + '(.+)');
        [].concat(opts.array || []).filter(Boolean).forEach(function (opt) {
            const key = typeof opt === 'object' ? opt.key : opt;
            // assign to flags[bools|strings|numbers]
            const assignment = Object.keys(opt).map(function (key) {
                const arrayFlagKeys = {
                    boolean: 'bools',
                    string: 'strings',
                    number: 'numbers'
                };
                return arrayFlagKeys[key];
            }).filter(Boolean).pop();
            // assign key to be coerced
            if (assignment) {
                flags[assignment][key] = true;
            }
            flags.arrays[key] = true;
            flags.keys.push(key);
        });
        [].concat(opts.boolean || []).filter(Boolean).forEach(function (key) {
            flags.bools[key] = true;
            flags.keys.push(key);
        });
        [].concat(opts.string || []).filter(Boolean).forEach(function (key) {
            flags.strings[key] = true;
            flags.keys.push(key);
        });
        [].concat(opts.number || []).filter(Boolean).forEach(function (key) {
            flags.numbers[key] = true;
            flags.keys.push(key);
        });
        [].concat(opts.count || []).filter(Boolean).forEach(function (key) {
            flags.counts[key] = true;
            flags.keys.push(key);
        });
        [].concat(opts.normalize || []).filter(Boolean).forEach(function (key) {
            flags.normalize[key] = true;
            flags.keys.push(key);
        });
        if (typeof opts.narg === 'object') {
            Object.entries(opts.narg).forEach(([key, value]) => {
                if (typeof value === 'number') {
                    flags.nargs[key] = value;
                    flags.keys.push(key);
                }
            });
        }
        if (typeof opts.coerce === 'object') {
            Object.entries(opts.coerce).forEach(([key, value]) => {
                if (typeof value === 'function') {
                    flags.coercions[key] = value;
                    flags.keys.push(key);
                }
            });
        }
        if (typeof opts.config !== 'undefined') {
            if (Array.isArray(opts.config) || typeof opts.config === 'string') {
                [].concat(opts.config).filter(Boolean).forEach(function (key) {
                    flags.configs[key] = true;
                });
            }
            else if (typeof opts.config === 'object') {
                Object.entries(opts.config).forEach(([key, value]) => {
                    if (typeof value === 'boolean' || typeof value === 'function') {
                        flags.configs[key] = value;
                    }
                });
            }
        }
        // create a lookup table that takes into account all
        // combinations of aliases: {f: ['foo'], foo: ['f']}
        extendAliases(opts.key, aliases, opts.default, flags.arrays);
        // apply default values to all aliases.
        Object.keys(defaults).forEach(function (key) {
            (flags.aliases[key] || []).forEach(function (alias) {
                defaults[alias] = defaults[key];
            });
        });
        let error = null;
        checkConfiguration();
        let notFlags = [];
        const argv = Object.assign(Object.create(null), { _: [] });
        // TODO(bcoe): for the first pass at removing object prototype  we didn't
        // remove all prototypes from objects returned by this API, we might want
        // to gradually move towards doing so.
        const argvReturn = {};
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            const truncatedArg = arg.replace(/^-{3,}/, '---');
            let broken;
            let key;
            let letters;
            let m;
            let next;
            let value;
            // any unknown option (except for end-of-options, "--")
            if (arg !== '--' && /^-/.test(arg) && isUnknownOptionAsArg(arg)) {
                pushPositional(arg);
                // ---, ---=, ----, etc,
            }
            else if (truncatedArg.match(/^---+(=|$)/)) {
                // options without key name are invalid.
                pushPositional(arg);
                continue;
                // -- separated by =
            }
            else if (arg.match(/^--.+=/) || (!configuration['short-option-groups'] && arg.match(/^-.+=/))) {
                // Using [\s\S] instead of . because js doesn't support the
                // 'dotall' regex modifier. See:
                // http://stackoverflow.com/a/1068308/13216
                m = arg.match(/^--?([^=]+)=([\s\S]*)$/);
                // arrays format = '--f=a b c'
                if (m !== null && Array.isArray(m) && m.length >= 3) {
                    if (checkAllAliases(m[1], flags.arrays)) {
                        i = eatArray(i, m[1], args, m[2]);
                    }
                    else if (checkAllAliases(m[1], flags.nargs) !== false) {
                        // nargs format = '--f=monkey washing cat'
                        i = eatNargs(i, m[1], args, m[2]);
                    }
                    else {
                        setArg(m[1], m[2], true);
                    }
                }
            }
            else if (arg.match(negatedBoolean) && configuration['boolean-negation']) {
                m = arg.match(negatedBoolean);
                if (m !== null && Array.isArray(m) && m.length >= 2) {
                    key = m[1];
                    setArg(key, checkAllAliases(key, flags.arrays) ? [false] : false);
                }
                // -- separated by space.
            }
            else if (arg.match(/^--.+/) || (!configuration['short-option-groups'] && arg.match(/^-[^-]+/))) {
                m = arg.match(/^--?(.+)/);
                if (m !== null && Array.isArray(m) && m.length >= 2) {
                    key = m[1];
                    if (checkAllAliases(key, flags.arrays)) {
                        // array format = '--foo a b c'
                        i = eatArray(i, key, args);
                    }
                    else if (checkAllAliases(key, flags.nargs) !== false) {
                        // nargs format = '--foo a b c'
                        // should be truthy even if: flags.nargs[key] === 0
                        i = eatNargs(i, key, args);
                    }
                    else {
                        next = args[i + 1];
                        if (next !== undefined && (!next.match(/^-/) ||
                            next.match(negative)) &&
                            !checkAllAliases(key, flags.bools) &&
                            !checkAllAliases(key, flags.counts)) {
                            setArg(key, next);
                            i++;
                        }
                        else if (/^(true|false)$/.test(next)) {
                            setArg(key, next);
                            i++;
                        }
                        else {
                            setArg(key, defaultValue(key));
                        }
                    }
                }
                // dot-notation flag separated by '='.
            }
            else if (arg.match(/^-.\..+=/)) {
                m = arg.match(/^-([^=]+)=([\s\S]*)$/);
                if (m !== null && Array.isArray(m) && m.length >= 3) {
                    setArg(m[1], m[2]);
                }
                // dot-notation flag separated by space.
            }
            else if (arg.match(/^-.\..+/) && !arg.match(negative)) {
                next = args[i + 1];
                m = arg.match(/^-(.\..+)/);
                if (m !== null && Array.isArray(m) && m.length >= 2) {
                    key = m[1];
                    if (next !== undefined && !next.match(/^-/) &&
                        !checkAllAliases(key, flags.bools) &&
                        !checkAllAliases(key, flags.counts)) {
                        setArg(key, next);
                        i++;
                    }
                    else {
                        setArg(key, defaultValue(key));
                    }
                }
            }
            else if (arg.match(/^-[^-]+/) && !arg.match(negative)) {
                letters = arg.slice(1, -1).split('');
                broken = false;
                for (let j = 0; j < letters.length; j++) {
                    next = arg.slice(j + 2);
                    if (letters[j + 1] && letters[j + 1] === '=') {
                        value = arg.slice(j + 3);
                        key = letters[j];
                        if (checkAllAliases(key, flags.arrays)) {
                            // array format = '-f=a b c'
                            i = eatArray(i, key, args, value);
                        }
                        else if (checkAllAliases(key, flags.nargs) !== false) {
                            // nargs format = '-f=monkey washing cat'
                            i = eatNargs(i, key, args, value);
                        }
                        else {
                            setArg(key, value);
                        }
                        broken = true;
                        break;
                    }
                    if (next === '-') {
                        setArg(letters[j], next);
                        continue;
                    }
                    // current letter is an alphabetic character and next value is a number
                    if (/[A-Za-z]/.test(letters[j]) &&
                        /^-?\d+(\.\d*)?(e-?\d+)?$/.test(next) &&
                        checkAllAliases(next, flags.bools) === false) {
                        setArg(letters[j], next);
                        broken = true;
                        break;
                    }
                    if (letters[j + 1] && letters[j + 1].match(/\W/)) {
                        setArg(letters[j], next);
                        broken = true;
                        break;
                    }
                    else {
                        setArg(letters[j], defaultValue(letters[j]));
                    }
                }
                key = arg.slice(-1)[0];
                if (!broken && key !== '-') {
                    if (checkAllAliases(key, flags.arrays)) {
                        // array format = '-f a b c'
                        i = eatArray(i, key, args);
                    }
                    else if (checkAllAliases(key, flags.nargs) !== false) {
                        // nargs format = '-f a b c'
                        // should be truthy even if: flags.nargs[key] === 0
                        i = eatNargs(i, key, args);
                    }
                    else {
                        next = args[i + 1];
                        if (next !== undefined && (!/^(-|--)[^-]/.test(next) ||
                            next.match(negative)) &&
                            !checkAllAliases(key, flags.bools) &&
                            !checkAllAliases(key, flags.counts)) {
                            setArg(key, next);
                            i++;
                        }
                        else if (/^(true|false)$/.test(next)) {
                            setArg(key, next);
                            i++;
                        }
                        else {
                            setArg(key, defaultValue(key));
                        }
                    }
                }
            }
            else if (arg.match(/^-[0-9]$/) &&
                arg.match(negative) &&
                checkAllAliases(arg.slice(1), flags.bools)) {
                // single-digit boolean alias, e.g: xargs -0
                key = arg.slice(1);
                setArg(key, defaultValue(key));
            }
            else if (arg === '--') {
                notFlags = args.slice(i + 1);
                break;
            }
            else if (configuration['halt-at-non-option']) {
                notFlags = args.slice(i);
                break;
            }
            else {
                pushPositional(arg);
            }
        }
        // order of precedence:
        // 1. command line arg
        // 2. value from env var
        // 3. value from config file
        // 4. value from config objects
        // 5. configured default value
        applyEnvVars(argv, true); // special case: check env vars that point to config file
        applyEnvVars(argv, false);
        setConfig(argv);
        setConfigObjects();
        applyDefaultsAndAliases(argv, flags.aliases, defaults, true);
        applyCoercions(argv);
        if (configuration['set-placeholder-key'])
            setPlaceholderKeys(argv);
        // for any counts either not in args or without an explicit default, set to 0
        Object.keys(flags.counts).forEach(function (key) {
            if (!hasKey(argv, key.split('.')))
                setArg(key, 0);
        });
        // '--' defaults to undefined.
        if (notFlagsOption && notFlags.length)
            argv[notFlagsArgv] = [];
        notFlags.forEach(function (key) {
            argv[notFlagsArgv].push(key);
        });
        if (configuration['camel-case-expansion'] && configuration['strip-dashed']) {
            Object.keys(argv).filter(key => key !== '--' && key.includes('-')).forEach(key => {
                delete argv[key];
            });
        }
        if (configuration['strip-aliased']) {
            [].concat(...Object.keys(aliases).map(k => aliases[k])).forEach(alias => {
                if (configuration['camel-case-expansion'] && alias.includes('-')) {
                    delete argv[alias.split('.').map(prop => camelCase(prop)).join('.')];
                }
                delete argv[alias];
            });
        }
        // Push argument into positional array, applying numeric coercion:
        function pushPositional(arg) {
            const maybeCoercedNumber = maybeCoerceNumber('_', arg);
            if (typeof maybeCoercedNumber === 'string' || typeof maybeCoercedNumber === 'number') {
                argv._.push(maybeCoercedNumber);
            }
        }
        // how many arguments should we consume, based
        // on the nargs option?
        function eatNargs(i, key, args, argAfterEqualSign) {
            let ii;
            let toEat = checkAllAliases(key, flags.nargs);
            // NaN has a special meaning for the array type, indicating that one or
            // more values are expected.
            toEat = typeof toEat !== 'number' || isNaN(toEat) ? 1 : toEat;
            if (toEat === 0) {
                if (!isUndefined(argAfterEqualSign)) {
                    error = Error(__('Argument unexpected for: %s', key));
                }
                setArg(key, defaultValue(key));
                return i;
            }
            let available = isUndefined(argAfterEqualSign) ? 0 : 1;
            if (configuration['nargs-eats-options']) {
                // classic behavior, yargs eats positional and dash arguments.
                if (args.length - (i + 1) + available < toEat) {
                    error = Error(__('Not enough arguments following: %s', key));
                }
                available = toEat;
            }
            else {
                // nargs will not consume flag arguments, e.g., -abc, --foo,
                // and terminates when one is observed.
                for (ii = i + 1; ii < args.length; ii++) {
                    if (!args[ii].match(/^-[^0-9]/) || args[ii].match(negative) || isUnknownOptionAsArg(args[ii]))
                        available++;
                    else
                        break;
                }
                if (available < toEat)
                    error = Error(__('Not enough arguments following: %s', key));
            }
            let consumed = Math.min(available, toEat);
            if (!isUndefined(argAfterEqualSign) && consumed > 0) {
                setArg(key, argAfterEqualSign);
                consumed--;
            }
            for (ii = i + 1; ii < (consumed + i + 1); ii++) {
                setArg(key, args[ii]);
            }
            return (i + consumed);
        }
        // if an option is an array, eat all non-hyphenated arguments
        // following it... YUM!
        // e.g., --foo apple banana cat becomes ["apple", "banana", "cat"]
        function eatArray(i, key, args, argAfterEqualSign) {
            let argsToSet = [];
            let next = argAfterEqualSign || args[i + 1];
            // If both array and nargs are configured, enforce the nargs count:
            const nargsCount = checkAllAliases(key, flags.nargs);
            if (checkAllAliases(key, flags.bools) && !(/^(true|false)$/.test(next))) {
                argsToSet.push(true);
            }
            else if (isUndefined(next) ||
                (isUndefined(argAfterEqualSign) && /^-/.test(next) && !negative.test(next) && !isUnknownOptionAsArg(next))) {
                // for keys without value ==> argsToSet remains an empty []
                // set user default value, if available
                if (defaults[key] !== undefined) {
                    const defVal = defaults[key];
                    argsToSet = Array.isArray(defVal) ? defVal : [defVal];
                }
            }
            else {
                // value in --option=value is eaten as is
                if (!isUndefined(argAfterEqualSign)) {
                    argsToSet.push(processValue(key, argAfterEqualSign, true));
                }
                for (let ii = i + 1; ii < args.length; ii++) {
                    if ((!configuration['greedy-arrays'] && argsToSet.length > 0) ||
                        (nargsCount && typeof nargsCount === 'number' && argsToSet.length >= nargsCount))
                        break;
                    next = args[ii];
                    if (/^-/.test(next) && !negative.test(next) && !isUnknownOptionAsArg(next))
                        break;
                    i = ii;
                    argsToSet.push(processValue(key, next, inputIsString));
                }
            }
            // If both array and nargs are configured, create an error if less than
            // nargs positionals were found. NaN has special meaning, indicating
            // that at least one value is required (more are okay).
            if (typeof nargsCount === 'number' && ((nargsCount && argsToSet.length < nargsCount) ||
                (isNaN(nargsCount) && argsToSet.length === 0))) {
                error = Error(__('Not enough arguments following: %s', key));
            }
            setArg(key, argsToSet);
            return i;
        }
        function setArg(key, val, shouldStripQuotes = inputIsString) {
            if (/-/.test(key) && configuration['camel-case-expansion']) {
                const alias = key.split('.').map(function (prop) {
                    return camelCase(prop);
                }).join('.');
                addNewAlias(key, alias);
            }
            const value = processValue(key, val, shouldStripQuotes);
            const splitKey = key.split('.');
            setKey(argv, splitKey, value);
            // handle populating aliases of the full key
            if (flags.aliases[key]) {
                flags.aliases[key].forEach(function (x) {
                    const keyProperties = x.split('.');
                    setKey(argv, keyProperties, value);
                });
            }
            // handle populating aliases of the first element of the dot-notation key
            if (splitKey.length > 1 && configuration['dot-notation']) {
                (flags.aliases[splitKey[0]] || []).forEach(function (x) {
                    let keyProperties = x.split('.');
                    // expand alias with nested objects in key
                    const a = [].concat(splitKey);
                    a.shift(); // nuke the old key.
                    keyProperties = keyProperties.concat(a);
                    // populate alias only if is not already an alias of the full key
                    // (already populated above)
                    if (!(flags.aliases[key] || []).includes(keyProperties.join('.'))) {
                        setKey(argv, keyProperties, value);
                    }
                });
            }
            // Set normalize getter and setter when key is in 'normalize' but isn't an array
            if (checkAllAliases(key, flags.normalize) && !checkAllAliases(key, flags.arrays)) {
                const keys = [key].concat(flags.aliases[key] || []);
                keys.forEach(function (key) {
                    Object.defineProperty(argvReturn, key, {
                        enumerable: true,
                        get() {
                            return val;
                        },
                        set(value) {
                            val = typeof value === 'string' ? mixin$1.normalize(value) : value;
                        }
                    });
                });
            }
        }
        function addNewAlias(key, alias) {
            if (!(flags.aliases[key] && flags.aliases[key].length)) {
                flags.aliases[key] = [alias];
                newAliases[alias] = true;
            }
            if (!(flags.aliases[alias] && flags.aliases[alias].length)) {
                addNewAlias(alias, key);
            }
        }
        function processValue(key, val, shouldStripQuotes) {
            // strings may be quoted, clean this up as we assign values.
            if (shouldStripQuotes) {
                val = stripQuotes(val);
            }
            // handle parsing boolean arguments --foo=true --bar false.
            if (checkAllAliases(key, flags.bools) || checkAllAliases(key, flags.counts)) {
                if (typeof val === 'string')
                    val = val === 'true';
            }
            let value = Array.isArray(val)
                ? val.map(function (v) { return maybeCoerceNumber(key, v); })
                : maybeCoerceNumber(key, val);
            // increment a count given as arg (either no value or value parsed as boolean)
            if (checkAllAliases(key, flags.counts) && (isUndefined(value) || typeof value === 'boolean')) {
                value = increment();
            }
            // Set normalized value when key is in 'normalize' and in 'arrays'
            if (checkAllAliases(key, flags.normalize) && checkAllAliases(key, flags.arrays)) {
                if (Array.isArray(val))
                    value = val.map((val) => { return mixin$1.normalize(val); });
                else
                    value = mixin$1.normalize(val);
            }
            return value;
        }
        function maybeCoerceNumber(key, value) {
            if (!configuration['parse-positional-numbers'] && key === '_')
                return value;
            if (!checkAllAliases(key, flags.strings) && !checkAllAliases(key, flags.bools) && !Array.isArray(value)) {
                const shouldCoerceNumber = looksLikeNumber(value) && configuration['parse-numbers'] && (Number.isSafeInteger(Math.floor(parseFloat(`${value}`))));
                if (shouldCoerceNumber || (!isUndefined(value) && checkAllAliases(key, flags.numbers))) {
                    value = Number(value);
                }
            }
            return value;
        }
        // set args from config.json file, this should be
        // applied last so that defaults can be applied.
        function setConfig(argv) {
            const configLookup = Object.create(null);
            // expand defaults/aliases, in-case any happen to reference
            // the config.json file.
            applyDefaultsAndAliases(configLookup, flags.aliases, defaults);
            Object.keys(flags.configs).forEach(function (configKey) {
                const configPath = argv[configKey] || configLookup[configKey];
                if (configPath) {
                    try {
                        let config = null;
                        const resolvedConfigPath = mixin$1.resolve(mixin$1.cwd(), configPath);
                        const resolveConfig = flags.configs[configKey];
                        if (typeof resolveConfig === 'function') {
                            try {
                                config = resolveConfig(resolvedConfigPath);
                            }
                            catch (e) {
                                config = e;
                            }
                            if (config instanceof Error) {
                                error = config;
                                return;
                            }
                        }
                        else {
                            config = mixin$1.require(resolvedConfigPath);
                        }
                        setConfigObject(config);
                    }
                    catch (ex) {
                        // Deno will receive a PermissionDenied error if an attempt is
                        // made to load config without the --allow-read flag:
                        if (ex.name === 'PermissionDenied')
                            error = ex;
                        else if (argv[configKey])
                            error = Error(__('Invalid JSON config file: %s', configPath));
                    }
                }
            });
        }
        // set args from config object.
        // it recursively checks nested objects.
        function setConfigObject(config, prev) {
            Object.keys(config).forEach(function (key) {
                const value = config[key];
                const fullKey = prev ? prev + '.' + key : key;
                // if the value is an inner object and we have dot-notation
                // enabled, treat inner objects in config the same as
                // heavily nested dot notations (foo.bar.apple).
                if (typeof value === 'object' && value !== null && !Array.isArray(value) && configuration['dot-notation']) {
                    // if the value is an object but not an array, check nested object
                    setConfigObject(value, fullKey);
                }
                else {
                    // setting arguments via CLI takes precedence over
                    // values within the config file.
                    if (!hasKey(argv, fullKey.split('.')) || (checkAllAliases(fullKey, flags.arrays) && configuration['combine-arrays'])) {
                        setArg(fullKey, value);
                    }
                }
            });
        }
        // set all config objects passed in opts
        function setConfigObjects() {
            if (typeof configObjects !== 'undefined') {
                configObjects.forEach(function (configObject) {
                    setConfigObject(configObject);
                });
            }
        }
        function applyEnvVars(argv, configOnly) {
            if (typeof envPrefix === 'undefined')
                return;
            const prefix = typeof envPrefix === 'string' ? envPrefix : '';
            const env = mixin$1.env();
            Object.keys(env).forEach(function (envVar) {
                if (prefix === '' || envVar.lastIndexOf(prefix, 0) === 0) {
                    // get array of nested keys and convert them to camel case
                    const keys = envVar.split('__').map(function (key, i) {
                        if (i === 0) {
                            key = key.substring(prefix.length);
                        }
                        return camelCase(key);
                    });
                    if (((configOnly && flags.configs[keys.join('.')]) || !configOnly) && !hasKey(argv, keys)) {
                        setArg(keys.join('.'), env[envVar]);
                    }
                }
            });
        }
        function applyCoercions(argv) {
            let coerce;
            const applied = new Set();
            Object.keys(argv).forEach(function (key) {
                if (!applied.has(key)) { // If we haven't already coerced this option via one of its aliases
                    coerce = checkAllAliases(key, flags.coercions);
                    if (typeof coerce === 'function') {
                        try {
                            const value = maybeCoerceNumber(key, coerce(argv[key]));
                            ([].concat(flags.aliases[key] || [], key)).forEach(ali => {
                                applied.add(ali);
                                argv[ali] = value;
                            });
                        }
                        catch (err) {
                            error = err;
                        }
                    }
                }
            });
        }
        function setPlaceholderKeys(argv) {
            flags.keys.forEach((key) => {
                // don't set placeholder keys for dot notation options 'foo.bar'.
                if (~key.indexOf('.'))
                    return;
                if (typeof argv[key] === 'undefined')
                    argv[key] = undefined;
            });
            return argv;
        }
        function applyDefaultsAndAliases(obj, aliases, defaults, canLog = false) {
            Object.keys(defaults).forEach(function (key) {
                if (!hasKey(obj, key.split('.'))) {
                    setKey(obj, key.split('.'), defaults[key]);
                    if (canLog)
                        defaulted[key] = true;
                    (aliases[key] || []).forEach(function (x) {
                        if (hasKey(obj, x.split('.')))
                            return;
                        setKey(obj, x.split('.'), defaults[key]);
                    });
                }
            });
        }
        function hasKey(obj, keys) {
            let o = obj;
            if (!configuration['dot-notation'])
                keys = [keys.join('.')];
            keys.slice(0, -1).forEach(function (key) {
                o = (o[key] || {});
            });
            const key = keys[keys.length - 1];
            if (typeof o !== 'object')
                return false;
            else
                return key in o;
        }
        function setKey(obj, keys, value) {
            let o = obj;
            if (!configuration['dot-notation'])
                keys = [keys.join('.')];
            keys.slice(0, -1).forEach(function (key) {
                // TODO(bcoe): in the next major version of yargs, switch to
                // Object.create(null) for dot notation:
                key = sanitizeKey(key);
                if (typeof o === 'object' && o[key] === undefined) {
                    o[key] = {};
                }
                if (typeof o[key] !== 'object' || Array.isArray(o[key])) {
                    // ensure that o[key] is an array, and that the last item is an empty object.
                    if (Array.isArray(o[key])) {
                        o[key].push({});
                    }
                    else {
                        o[key] = [o[key], {}];
                    }
                    // we want to update the empty object at the end of the o[key] array, so set o to that object
                    o = o[key][o[key].length - 1];
                }
                else {
                    o = o[key];
                }
            });
            // TODO(bcoe): in the next major version of yargs, switch to
            // Object.create(null) for dot notation:
            const key = sanitizeKey(keys[keys.length - 1]);
            const isTypeArray = checkAllAliases(keys.join('.'), flags.arrays);
            const isValueArray = Array.isArray(value);
            let duplicate = configuration['duplicate-arguments-array'];
            // nargs has higher priority than duplicate
            if (!duplicate && checkAllAliases(key, flags.nargs)) {
                duplicate = true;
                if ((!isUndefined(o[key]) && flags.nargs[key] === 1) || (Array.isArray(o[key]) && o[key].length === flags.nargs[key])) {
                    o[key] = undefined;
                }
            }
            if (value === increment()) {
                o[key] = increment(o[key]);
            }
            else if (Array.isArray(o[key])) {
                if (duplicate && isTypeArray && isValueArray) {
                    o[key] = configuration['flatten-duplicate-arrays'] ? o[key].concat(value) : (Array.isArray(o[key][0]) ? o[key] : [o[key]]).concat([value]);
                }
                else if (!duplicate && Boolean(isTypeArray) === Boolean(isValueArray)) {
                    o[key] = value;
                }
                else {
                    o[key] = o[key].concat([value]);
                }
            }
            else if (o[key] === undefined && isTypeArray) {
                o[key] = isValueArray ? value : [value];
            }
            else if (duplicate && !(o[key] === undefined ||
                checkAllAliases(key, flags.counts) ||
                checkAllAliases(key, flags.bools))) {
                o[key] = [o[key], value];
            }
            else {
                o[key] = value;
            }
        }
        // extend the aliases list with inferred aliases.
        function extendAliases(...args) {
            args.forEach(function (obj) {
                Object.keys(obj || {}).forEach(function (key) {
                    // short-circuit if we've already added a key
                    // to the aliases array, for example it might
                    // exist in both 'opts.default' and 'opts.key'.
                    if (flags.aliases[key])
                        return;
                    flags.aliases[key] = [].concat(aliases[key] || []);
                    // For "--option-name", also set argv.optionName
                    flags.aliases[key].concat(key).forEach(function (x) {
                        if (/-/.test(x) && configuration['camel-case-expansion']) {
                            const c = camelCase(x);
                            if (c !== key && flags.aliases[key].indexOf(c) === -1) {
                                flags.aliases[key].push(c);
                                newAliases[c] = true;
                            }
                        }
                    });
                    // For "--optionName", also set argv['option-name']
                    flags.aliases[key].concat(key).forEach(function (x) {
                        if (x.length > 1 && /[A-Z]/.test(x) && configuration['camel-case-expansion']) {
                            const c = decamelize(x, '-');
                            if (c !== key && flags.aliases[key].indexOf(c) === -1) {
                                flags.aliases[key].push(c);
                                newAliases[c] = true;
                            }
                        }
                    });
                    flags.aliases[key].forEach(function (x) {
                        flags.aliases[x] = [key].concat(flags.aliases[key].filter(function (y) {
                            return x !== y;
                        }));
                    });
                });
            });
        }
        function checkAllAliases(key, flag) {
            const toCheck = [].concat(flags.aliases[key] || [], key);
            const keys = Object.keys(flag);
            const setAlias = toCheck.find(key => keys.includes(key));
            return setAlias ? flag[setAlias] : false;
        }
        function hasAnyFlag(key) {
            const flagsKeys = Object.keys(flags);
            const toCheck = [].concat(flagsKeys.map(k => flags[k]));
            return toCheck.some(function (flag) {
                return Array.isArray(flag) ? flag.includes(key) : flag[key];
            });
        }
        function hasFlagsMatching(arg, ...patterns) {
            const toCheck = [].concat(...patterns);
            return toCheck.some(function (pattern) {
                const match = arg.match(pattern);
                return match && hasAnyFlag(match[1]);
            });
        }
        // based on a simplified version of the short flag group parsing logic
        function hasAllShortFlags(arg) {
            // if this is a negative number, or doesn't start with a single hyphen, it's not a short flag group
            if (arg.match(negative) || !arg.match(/^-[^-]+/)) {
                return false;
            }
            let hasAllFlags = true;
            let next;
            const letters = arg.slice(1).split('');
            for (let j = 0; j < letters.length; j++) {
                next = arg.slice(j + 2);
                if (!hasAnyFlag(letters[j])) {
                    hasAllFlags = false;
                    break;
                }
                if ((letters[j + 1] && letters[j + 1] === '=') ||
                    next === '-' ||
                    (/[A-Za-z]/.test(letters[j]) && /^-?\d+(\.\d*)?(e-?\d+)?$/.test(next)) ||
                    (letters[j + 1] && letters[j + 1].match(/\W/))) {
                    break;
                }
            }
            return hasAllFlags;
        }
        function isUnknownOptionAsArg(arg) {
            return configuration['unknown-options-as-args'] && isUnknownOption(arg);
        }
        function isUnknownOption(arg) {
            arg = arg.replace(/^-{3,}/, '--');
            // ignore negative numbers
            if (arg.match(negative)) {
                return false;
            }
            // if this is a short option group and all of them are configured, it isn't unknown
            if (hasAllShortFlags(arg)) {
                return false;
            }
            // e.g. '--count=2'
            const flagWithEquals = /^-+([^=]+?)=[\s\S]*$/;
            // e.g. '-a' or '--arg'
            const normalFlag = /^-+([^=]+?)$/;
            // e.g. '-a-'
            const flagEndingInHyphen = /^-+([^=]+?)-$/;
            // e.g. '-abc123'
            const flagEndingInDigits = /^-+([^=]+?\d+)$/;
            // e.g. '-a/usr/local'
            const flagEndingInNonWordCharacters = /^-+([^=]+?)\W+.*$/;
            // check the different types of flag styles, including negatedBoolean, a pattern defined near the start of the parse method
            return !hasFlagsMatching(arg, flagWithEquals, negatedBoolean, normalFlag, flagEndingInHyphen, flagEndingInDigits, flagEndingInNonWordCharacters);
        }
        // make a best effort to pick a default value
        // for an option based on name and type.
        function defaultValue(key) {
            if (!checkAllAliases(key, flags.bools) &&
                !checkAllAliases(key, flags.counts) &&
                `${key}` in defaults) {
                return defaults[key];
            }
            else {
                return defaultForType(guessType(key));
            }
        }
        // return a default value, given the type of a flag.,
        function defaultForType(type) {
            const def = {
                [DefaultValuesForTypeKey.BOOLEAN]: true,
                [DefaultValuesForTypeKey.STRING]: '',
                [DefaultValuesForTypeKey.NUMBER]: undefined,
                [DefaultValuesForTypeKey.ARRAY]: []
            };
            return def[type];
        }
        // given a flag, enforce a default type.
        function guessType(key) {
            let type = DefaultValuesForTypeKey.BOOLEAN;
            if (checkAllAliases(key, flags.strings))
                type = DefaultValuesForTypeKey.STRING;
            else if (checkAllAliases(key, flags.numbers))
                type = DefaultValuesForTypeKey.NUMBER;
            else if (checkAllAliases(key, flags.bools))
                type = DefaultValuesForTypeKey.BOOLEAN;
            else if (checkAllAliases(key, flags.arrays))
                type = DefaultValuesForTypeKey.ARRAY;
            return type;
        }
        function isUndefined(num) {
            return num === undefined;
        }
        // check user configuration settings for inconsistencies
        function checkConfiguration() {
            // count keys should not be set as array/narg
            Object.keys(flags.counts).find(key => {
                if (checkAllAliases(key, flags.arrays)) {
                    error = Error(__('Invalid configuration: %s, opts.count excludes opts.array.', key));
                    return true;
                }
                else if (checkAllAliases(key, flags.nargs)) {
                    error = Error(__('Invalid configuration: %s, opts.count excludes opts.narg.', key));
                    return true;
                }
                return false;
            });
        }
        return {
            aliases: Object.assign({}, flags.aliases),
            argv: Object.assign(argvReturn, argv),
            configuration: configuration,
            defaulted: Object.assign({}, defaulted),
            error: error,
            newAliases: Object.assign({}, newAliases)
        };
    }
}
// if any aliases reference each other, we should
// merge them together.
function combineAliases(aliases) {
    const aliasArrays = [];
    const combined = Object.create(null);
    let change = true;
    // turn alias lookup hash {key: ['alias1', 'alias2']} into
    // a simple array ['key', 'alias1', 'alias2']
    Object.keys(aliases).forEach(function (key) {
        aliasArrays.push([].concat(aliases[key], key));
    });
    // combine arrays until zero changes are
    // made in an iteration.
    while (change) {
        change = false;
        for (let i = 0; i < aliasArrays.length; i++) {
            for (let ii = i + 1; ii < aliasArrays.length; ii++) {
                const intersect = aliasArrays[i].filter(function (v) {
                    return aliasArrays[ii].indexOf(v) !== -1;
                });
                if (intersect.length) {
                    aliasArrays[i] = aliasArrays[i].concat(aliasArrays[ii]);
                    aliasArrays.splice(ii, 1);
                    change = true;
                    break;
                }
            }
        }
    }
    // map arrays back to the hash-lookup (de-dupe while
    // we're at it).
    aliasArrays.forEach(function (aliasArray) {
        aliasArray = aliasArray.filter(function (v, i, self) {
            return self.indexOf(v) === i;
        });
        const lastAlias = aliasArray.pop();
        if (lastAlias !== undefined && typeof lastAlias === 'string') {
            combined[lastAlias] = aliasArray;
        }
    });
    return combined;
}
// this function should only be called when a count is given as an arg
// it is NOT called to set a default value
// thus we can start the count at 1 instead of 0
function increment(orig) {
    return orig !== undefined ? orig + 1 : 1;
}
// TODO(bcoe): in the next major version of yargs, switch to
// Object.create(null) for dot notation:
function sanitizeKey(key) {
    if (key === '__proto__')
        return '___proto___';
    return key;
}
function stripQuotes(val) {
    return (typeof val === 'string' &&
        (val[0] === "'" || val[0] === '"') &&
        val[val.length - 1] === val[0])
        ? val.substring(1, val.length - 1)
        : val;
}

/**
 * @fileoverview Main entrypoint for libraries using yargs-parser in Node.js
 * CJS and ESM environments.
 *
 * @license
 * Copyright (c) 2016, Contributors
 * SPDX-License-Identifier: ISC
 */
var _a, _b, _c;
// See https://github.com/yargs/yargs-parser#supported-nodejs-versions for our
// version support policy. The YARGS_MIN_NODE_VERSION is used for testing only.
const minNodeVersion = (process && process.env && process.env.YARGS_MIN_NODE_VERSION)
    ? Number(process.env.YARGS_MIN_NODE_VERSION)
    : 12;
const nodeVersion = (_b = (_a = process === null || process === undefined ? undefined : process.versions) === null || _a === undefined ? undefined : _a.node) !== null && _b !== undefined ? _b : (_c = process === null || process === undefined ? undefined : process.version) === null || _c === undefined ? undefined : _c.slice(1);
if (nodeVersion) {
    const major = Number(nodeVersion.match(/^([^.]+)/)[1]);
    if (major < minNodeVersion) {
        throw Error(`yargs parser supports a minimum Node.js version of ${minNodeVersion}. Read our version support policy: https://github.com/yargs/yargs-parser#supported-nodejs-versions`);
    }
}
// Creates a yargs-parser instance using Node.js standard libraries:
const env = process ? process.env : {};
const parser = new YargsParser({
    cwd: process.cwd,
    env: () => {
        return env;
    },
    format,
    normalize,
    resolve,
    // TODO: figure  out a  way to combine ESM and CJS coverage, such  that
    // we can exercise all the lines below:
    require: (path) => {
        if (typeof require !== 'undefined') {
            return require(path);
        }
        else if (path.match(/\.json$/)) {
            // Addresses: https://github.com/yargs/yargs/issues/2040
            return JSON.parse(readFileSync(path, 'utf8'));
        }
        else {
            throw Error('only .json config files are supported in ESM');
        }
    }
});
const yargsParser = function Parser(args, opts) {
    const result = parser.parse(args.slice(), opts);
    return result.argv;
};
yargsParser.detailed = function (args, opts) {
    return parser.parse(args.slice(), opts);
};
yargsParser.camelCase = camelCase;
yargsParser.decamelize = decamelize;
yargsParser.looksLikeNumber = looksLikeNumber;

const align = {
    right: alignRight,
    center: alignCenter
};
const top = 0;
const right = 1;
const bottom = 2;
const left = 3;
class UI {
    constructor(opts) {
        var _a;
        this.width = opts.width;
        this.wrap = (_a = opts.wrap) !== null && _a !== undefined ? _a : true;
        this.rows = [];
    }
    span(...args) {
        const cols = this.div(...args);
        cols.span = true;
    }
    resetOutput() {
        this.rows = [];
    }
    div(...args) {
        if (args.length === 0) {
            this.div('');
        }
        if (this.wrap && this.shouldApplyLayoutDSL(...args) && typeof args[0] === 'string') {
            return this.applyLayoutDSL(args[0]);
        }
        const cols = args.map(arg => {
            if (typeof arg === 'string') {
                return this.colFromString(arg);
            }
            return arg;
        });
        this.rows.push(cols);
        return cols;
    }
    shouldApplyLayoutDSL(...args) {
        return args.length === 1 && typeof args[0] === 'string' &&
            /[\t\n]/.test(args[0]);
    }
    applyLayoutDSL(str) {
        const rows = str.split('\n').map(row => row.split('\t'));
        let leftColumnWidth = 0;
        // simple heuristic for layout, make sure the
        // second column lines up along the left-hand.
        // don't allow the first column to take up more
        // than 50% of the screen.
        rows.forEach(columns => {
            if (columns.length > 1 && mixin.stringWidth(columns[0]) > leftColumnWidth) {
                leftColumnWidth = Math.min(Math.floor(this.width * 0.5), mixin.stringWidth(columns[0]));
            }
        });
        // generate a table:
        //  replacing ' ' with padding calculations.
        //  using the algorithmically generated width.
        rows.forEach(columns => {
            this.div(...columns.map((r, i) => {
                return {
                    text: r.trim(),
                    padding: this.measurePadding(r),
                    width: (i === 0 && columns.length > 1) ? leftColumnWidth : undefined
                };
            }));
        });
        return this.rows[this.rows.length - 1];
    }
    colFromString(text) {
        return {
            text,
            padding: this.measurePadding(text)
        };
    }
    measurePadding(str) {
        // measure padding without ansi escape codes
        const noAnsi = mixin.stripAnsi(str);
        return [0, noAnsi.match(/\s*$/)[0].length, 0, noAnsi.match(/^\s*/)[0].length];
    }
    toString() {
        const lines = [];
        this.rows.forEach(row => {
            this.rowToString(row, lines);
        });
        // don't display any lines with the
        // hidden flag set.
        return lines
            .filter(line => !line.hidden)
            .map(line => line.text)
            .join('\n');
    }
    rowToString(row, lines) {
        this.rasterize(row).forEach((rrow, r) => {
            let str = '';
            rrow.forEach((col, c) => {
                const { width } = row[c]; // the width with padding.
                const wrapWidth = this.negatePadding(row[c]); // the width without padding.
                let ts = col; // temporary string used during alignment/padding.
                if (wrapWidth > mixin.stringWidth(col)) {
                    ts += ' '.repeat(wrapWidth - mixin.stringWidth(col));
                }
                // align the string within its column.
                if (row[c].align && row[c].align !== 'left' && this.wrap) {
                    const fn = align[row[c].align];
                    ts = fn(ts, wrapWidth);
                    if (mixin.stringWidth(ts) < wrapWidth) {
                        ts += ' '.repeat((width || 0) - mixin.stringWidth(ts) - 1);
                    }
                }
                // apply border and padding to string.
                const padding = row[c].padding || [0, 0, 0, 0];
                if (padding[left]) {
                    str += ' '.repeat(padding[left]);
                }
                str += addBorder(row[c], ts, '| ');
                str += ts;
                str += addBorder(row[c], ts, ' |');
                if (padding[right]) {
                    str += ' '.repeat(padding[right]);
                }
                // if prior row is span, try to render the
                // current row on the prior line.
                if (r === 0 && lines.length > 0) {
                    str = this.renderInline(str, lines[lines.length - 1]);
                }
            });
            // remove trailing whitespace.
            lines.push({
                text: str.replace(/ +$/, ''),
                span: row.span
            });
        });
        return lines;
    }
    // if the full 'source' can render in
    // the target line, do so.
    renderInline(source, previousLine) {
        const match = source.match(/^ */);
        const leadingWhitespace = match ? match[0].length : 0;
        const target = previousLine.text;
        const targetTextWidth = mixin.stringWidth(target.trimRight());
        if (!previousLine.span) {
            return source;
        }
        // if we're not applying wrapping logic,
        // just always append to the span.
        if (!this.wrap) {
            previousLine.hidden = true;
            return target + source;
        }
        if (leadingWhitespace < targetTextWidth) {
            return source;
        }
        previousLine.hidden = true;
        return target.trimRight() + ' '.repeat(leadingWhitespace - targetTextWidth) + source.trimLeft();
    }
    rasterize(row) {
        const rrows = [];
        const widths = this.columnWidths(row);
        let wrapped;
        // word wrap all columns, and create
        // a data-structure that is easy to rasterize.
        row.forEach((col, c) => {
            // leave room for left and right padding.
            col.width = widths[c];
            if (this.wrap) {
                wrapped = mixin.wrap(col.text, this.negatePadding(col), { hard: true }).split('\n');
            }
            else {
                wrapped = col.text.split('\n');
            }
            if (col.border) {
                wrapped.unshift('.' + '-'.repeat(this.negatePadding(col) + 2) + '.');
                wrapped.push("'" + '-'.repeat(this.negatePadding(col) + 2) + "'");
            }
            // add top and bottom padding.
            if (col.padding) {
                wrapped.unshift(...new Array(col.padding[top] || 0).fill(''));
                wrapped.push(...new Array(col.padding[bottom] || 0).fill(''));
            }
            wrapped.forEach((str, r) => {
                if (!rrows[r]) {
                    rrows.push([]);
                }
                const rrow = rrows[r];
                for (let i = 0; i < c; i++) {
                    if (rrow[i] === undefined) {
                        rrow.push('');
                    }
                }
                rrow.push(str);
            });
        });
        return rrows;
    }
    negatePadding(col) {
        let wrapWidth = col.width || 0;
        if (col.padding) {
            wrapWidth -= (col.padding[left] || 0) + (col.padding[right] || 0);
        }
        if (col.border) {
            wrapWidth -= 4;
        }
        return wrapWidth;
    }
    columnWidths(row) {
        if (!this.wrap) {
            return row.map(col => {
                return col.width || mixin.stringWidth(col.text);
            });
        }
        let unset = row.length;
        let remainingWidth = this.width;
        // column widths can be set in config.
        const widths = row.map(col => {
            if (col.width) {
                unset--;
                remainingWidth -= col.width;
                return col.width;
            }
            return undefined;
        });
        // any unset widths should be calculated.
        const unsetWidth = unset ? Math.floor(remainingWidth / unset) : 0;
        return widths.map((w, i) => {
            if (w === undefined) {
                return Math.max(unsetWidth, _minWidth(row[i]));
            }
            return w;
        });
    }
}
function addBorder(col, ts, style) {
    if (col.border) {
        if (/[.']-+[.']/.test(ts)) {
            return '';
        }
        if (ts.trim().length !== 0) {
            return style;
        }
        return '  ';
    }
    return '';
}
// calculates the minimum width of
// a column, based on padding preferences.
function _minWidth(col) {
    const padding = col.padding || [];
    const minWidth = 1 + (padding[left] || 0) + (padding[right] || 0);
    if (col.border) {
        return minWidth + 4;
    }
    return minWidth;
}
function getWindowWidth() {
    /* istanbul ignore next: depends on terminal */
    if (typeof process === 'object' && process.stdout && process.stdout.columns) {
        return process.stdout.columns;
    }
    return 80;
}
function alignRight(str, width) {
    str = str.trim();
    const strWidth = mixin.stringWidth(str);
    if (strWidth < width) {
        return ' '.repeat(width - strWidth) + str;
    }
    return str;
}
function alignCenter(str, width) {
    str = str.trim();
    const strWidth = mixin.stringWidth(str);
    /* istanbul ignore next */
    if (strWidth >= width) {
        return str;
    }
    return ' '.repeat((width - strWidth) >> 1) + str;
}
let mixin;
function cliui(opts, _mixin) {
    mixin = _mixin;
    return new UI({
        width: (opts === null || opts === undefined ? undefined : opts.width) || getWindowWidth(),
        wrap: opts === null || opts === undefined ? undefined : opts.wrap
    });
}

// Minimal replacement for ansi string helpers "wrap-ansi" and "strip-ansi".
// to facilitate ESM and Deno modules.
// TODO: look at porting https://www.npmjs.com/package/wrap-ansi to ESM.
// The npm application
// Copyright (c) npm, Inc. and Contributors
// Licensed on the terms of The Artistic License 2.0
// See: https://github.com/npm/cli/blob/4c65cd952bc8627811735bea76b9b110cc4fc80e/lib/utils/ansi-trim.js
const ansi = new RegExp('\x1b(?:\\[(?:\\d+[ABCDEFGJKSTm]|\\d+;\\d+[Hfm]|' +
    '\\d+;\\d+;\\d+m|6n|s|u|\\?25[lh])|\\w)', 'g');
function stripAnsi(str) {
    return str.replace(ansi, '');
}
function wrap(str, width) {
    const [start, end] = str.match(ansi) || ['', ''];
    str = stripAnsi(str);
    let wrapped = '';
    for (let i = 0; i < str.length; i++) {
        if (i !== 0 && (i % width) === 0) {
            wrapped += '\n';
        }
        wrapped += str.charAt(i);
    }
    if (start && end) {
        wrapped = `${start}${wrapped}${end}`;
    }
    return wrapped;
}

// Bootstrap cliui with CommonJS dependencies:

function ui (opts) {
  return cliui(opts, {
    stringWidth: (str) => {
      return [...str].length
    },
    stripAnsi,
    wrap
  })
}

function escalade (start, callback) {
	let dir = resolve('.', start);
	let tmp, stats = statSync(dir);

	if (!stats.isDirectory()) {
		dir = dirname(dir);
	}

	while (true) {
		tmp = callback(dir, readdirSync(dir));
		if (tmp) return resolve(dir, tmp);
		dir = dirname(tmp = dir);
		if (tmp === dir) break;
	}
}

var shim$1 = {
    fs: {
        readFileSync,
        writeFile
    },
    format,
    resolve,
    exists: (file) => {
        try {
            return statSync(file).isFile();
        }
        catch (err) {
            return false;
        }
    }
};

let shim;
class Y18N {
    constructor(opts) {
        // configurable options.
        opts = opts || {};
        this.directory = opts.directory || './locales';
        this.updateFiles = typeof opts.updateFiles === 'boolean' ? opts.updateFiles : true;
        this.locale = opts.locale || 'en';
        this.fallbackToLanguage = typeof opts.fallbackToLanguage === 'boolean' ? opts.fallbackToLanguage : true;
        // internal stuff.
        this.cache = Object.create(null);
        this.writeQueue = [];
    }
    __(...args) {
        if (typeof arguments[0] !== 'string') {
            return this._taggedLiteral(arguments[0], ...arguments);
        }
        const str = args.shift();
        let cb = function () { }; // start with noop.
        if (typeof args[args.length - 1] === 'function')
            cb = args.pop();
        cb = cb || function () { }; // noop.
        if (!this.cache[this.locale])
            this._readLocaleFile();
        // we've observed a new string, update the language file.
        if (!this.cache[this.locale][str] && this.updateFiles) {
            this.cache[this.locale][str] = str;
            // include the current directory and locale,
            // since these values could change before the
            // write is performed.
            this._enqueueWrite({
                directory: this.directory,
                locale: this.locale,
                cb
            });
        }
        else {
            cb();
        }
        return shim.format.apply(shim.format, [this.cache[this.locale][str] || str].concat(args));
    }
    __n() {
        const args = Array.prototype.slice.call(arguments);
        const singular = args.shift();
        const plural = args.shift();
        const quantity = args.shift();
        let cb = function () { }; // start with noop.
        if (typeof args[args.length - 1] === 'function')
            cb = args.pop();
        if (!this.cache[this.locale])
            this._readLocaleFile();
        let str = quantity === 1 ? singular : plural;
        if (this.cache[this.locale][singular]) {
            const entry = this.cache[this.locale][singular];
            str = entry[quantity === 1 ? 'one' : 'other'];
        }
        // we've observed a new string, update the language file.
        if (!this.cache[this.locale][singular] && this.updateFiles) {
            this.cache[this.locale][singular] = {
                one: singular,
                other: plural
            };
            // include the current directory and locale,
            // since these values could change before the
            // write is performed.
            this._enqueueWrite({
                directory: this.directory,
                locale: this.locale,
                cb
            });
        }
        else {
            cb();
        }
        // if a %d placeholder is provided, add quantity
        // to the arguments expanded by util.format.
        const values = [str];
        if (~str.indexOf('%d'))
            values.push(quantity);
        return shim.format.apply(shim.format, values.concat(args));
    }
    setLocale(locale) {
        this.locale = locale;
    }
    getLocale() {
        return this.locale;
    }
    updateLocale(obj) {
        if (!this.cache[this.locale])
            this._readLocaleFile();
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                this.cache[this.locale][key] = obj[key];
            }
        }
    }
    _taggedLiteral(parts, ...args) {
        let str = '';
        parts.forEach(function (part, i) {
            const arg = args[i + 1];
            str += part;
            if (typeof arg !== 'undefined') {
                str += '%s';
            }
        });
        return this.__.apply(this, [str].concat([].slice.call(args, 1)));
    }
    _enqueueWrite(work) {
        this.writeQueue.push(work);
        if (this.writeQueue.length === 1)
            this._processWriteQueue();
    }
    _processWriteQueue() {
        const _this = this;
        const work = this.writeQueue[0];
        // destructure the enqueued work.
        const directory = work.directory;
        const locale = work.locale;
        const cb = work.cb;
        const languageFile = this._resolveLocaleFile(directory, locale);
        const serializedLocale = JSON.stringify(this.cache[locale], null, 2);
        shim.fs.writeFile(languageFile, serializedLocale, 'utf-8', function (err) {
            _this.writeQueue.shift();
            if (_this.writeQueue.length > 0)
                _this._processWriteQueue();
            cb(err);
        });
    }
    _readLocaleFile() {
        let localeLookup = {};
        const languageFile = this._resolveLocaleFile(this.directory, this.locale);
        try {
            // When using a bundler such as webpack, readFileSync may not be defined:
            if (shim.fs.readFileSync) {
                localeLookup = JSON.parse(shim.fs.readFileSync(languageFile, 'utf-8'));
            }
        }
        catch (err) {
            if (err instanceof SyntaxError) {
                err.message = 'syntax error in ' + languageFile;
            }
            if (err.code === 'ENOENT')
                localeLookup = {};
            else
                throw err;
        }
        this.cache[this.locale] = localeLookup;
    }
    _resolveLocaleFile(directory, locale) {
        let file = shim.resolve(directory, './', locale + '.json');
        if (this.fallbackToLanguage && !this._fileExistsSync(file) && ~locale.lastIndexOf('_')) {
            // attempt fallback to language only
            const languageFile = shim.resolve(directory, './', locale.split('_')[0] + '.json');
            if (this._fileExistsSync(languageFile))
                file = languageFile;
        }
        return file;
    }
    _fileExistsSync(file) {
        return shim.exists(file);
    }
}
function y18n$1(opts, _shim) {
    shim = _shim;
    const y18n = new Y18N(opts);
    return {
        __: y18n.__.bind(y18n),
        __n: y18n.__n.bind(y18n),
        setLocale: y18n.setLocale.bind(y18n),
        getLocale: y18n.getLocale.bind(y18n),
        updateLocale: y18n.updateLocale.bind(y18n),
        locale: y18n.locale
    };
}

const y18n = (opts) => {
  return y18n$1(opts, shim$1)
};

const REQUIRE_ERROR = 'require is not supported by ESM';
const REQUIRE_DIRECTORY_ERROR = 'loading a directory of commands is not supported yet for ESM';

let __dirname$3;
try {
  __dirname$3 = fileURLToPath(import.meta.url);
} catch (e) {
  __dirname$3 = process.cwd();
}
const mainFilename = __dirname$3.substring(0, __dirname$3.lastIndexOf('node_modules'));

({
  assert: {
    notStrictEqual,
    strictEqual
  },
  cliui: ui,
  findUp: escalade,
  getEnv: (key) => {
    return process.env[key]
  },
  inspect,
  getCallerFile: () => {
    throw new YError(REQUIRE_DIRECTORY_ERROR)
  },
  getProcessArgvBin,
  mainFilename: mainFilename || process.cwd(),
  Parser: yargsParser,
  path: {
    basename,
    dirname,
    extname,
    relative,
    resolve
  },
  process: {
    argv: () => process.argv,
    cwd: process.cwd,
    emitWarning: (warning, type) => process.emitWarning(warning, type),
    execPath: () => process.execPath,
    exit: process.exit,
    nextTick: process.nextTick,
    stdColumns: typeof process.stdout.columns !== 'undefined' ? process.stdout.columns : null
  },
  readFileSync,
  require: () => {
    throw new YError(REQUIRE_ERROR)
  },
  requireDirectory: () => {
    throw new YError(REQUIRE_DIRECTORY_ERROR)
  },
  stringWidth: (str) => {
    return [...str].length
  },
  y18n: y18n({
    directory: resolve(__dirname$3, '../../../locales'),
    updateFiles: false
  })
});

var isVerbose = false; // Global variable to manage verbosity

var setVerbose = function setVerbose(verbose) {
  isVerbose = verbose; // Function to set the verbosity level
};
var logger = function logger() {
  if (isVerbose) {
    var _console;
    (_console = console).log.apply(_console, arguments); // Log all arguments if verbose is enabled
  }
};
var logDifferences = function logDifferences(differences, database, dryRun) {
  var formattedDifferences = differences.map(function (diff) {
    switch (diff.type) {
      case 'missing_procedure':
        return {
          Type: diff.type,
          Name: diff.Name,
          Details: "Procedure ".concat(diff.Name, " is missing"),
          Action: 'Procedure is missing'
        };
      case 'mismatched_procedure':
        return {
          Type: diff.type,
          Name: diff.Name,
          Details: "Mismatched procedure ".concat(diff.Name),
          Action: 'Mismatched procedure'
        };
      case 'missing_field':
        return {
          Type: diff.type,
          Name: diff.tableName,
          Details: "Field ".concat(diff.field.Field, " is missing"),
          Action: 'Field is missing'
        };
      case 'missing_table':
        return {
          Type: diff.type,
          Name: diff.tableName,
          Details: "Table ".concat(diff.tableName, " is missing"),
          Action: 'Table is missing'
        };
      case 'extra_field':
        return {
          Type: diff.type,
          Name: diff.tableName,
          Details: "Field ".concat(diff.field.Field, " is extra"),
          Action: 'Field is extra'
        };
      case 'extra_table':
        return {
          Type: diff.type,
          Name: diff.tableName,
          Details: "Table ".concat(diff.tableName, " is extra"),
          Action: 'Table is extra'
        };
      case 'missing_view':
        return {
          Type: diff.type,
          Name: diff.viewName,
          Details: "View ".concat(diff.viewName, " is missing"),
          Action: 'View is missing'
        };
      case 'extra_index':
        return {
          Type: diff.type,
          Name: diff.tableName,
          Details: "Index ".concat(diff.index.Name, " is extra"),
          Action: 'Index is extra'
        };
      case 'missing_index':
        return {
          Type: diff.type,
          TableName: diff.tableName,
          Name: diff.index.Name,
          Details: "Index ".concat(diff.index.Name, " is missing"),
          Action: 'Index is missing'
        };
      case 'mismatched_index':
        return {
          Type: diff.type,
          TableName: diff.tableName,
          Name: diff.index.Name,
          From: diff.from,
          Details: "Index ".concat(diff.index.Name, " is mismatched"),
          Action: 'Index is mismatched'
        };
      case 'extra_trigger':
        return {
          Type: diff.type,
          Name: diff.trigger.Name,
          Details: "Trigger ".concat(diff.trigger.Name, " is extra"),
          Action: 'Trigger is extra'
        };
      case 'mismatched_trigger':
        return {
          Type: diff.type,
          Name: diff.trigger.Name,
          Details: "Trigger ".concat(diff.trigger.Name, " is mismatched"),
          Action: 'Trigger is mismatched'
        };
      case 'missing_trigger':
        console.log('missing_trigger', diff);
        return {
          Type: diff.type,
          Name: diff.trigger.Name,
          Details: "Trigger ".concat(diff.trigger.Name, " is missing"),
          Action: 'Trigger is missing'
        };
      default:
        return {
          Type: diff.type,
          Details: "Unhandled difference type: ".concat(diff.type)
        };
    }
  });

  // Filter out any undefined or null entries
  var filteredDifferences = formattedDifferences.filter(function (diff) {
    return diff;
  });

  // Log the differences in a table format
  if (filteredDifferences.length > 0) {
    if (dryRun) {
      logger("Dry Run: Differences for database ".concat(database, ":"));
    } else {
      logger("Differences applied for database ".concat(database, ":"));
    }
    console.table(filteredDifferences);
  } else {
    if (dryRun) {
      logger("Dry Run: No differences found. Database: ".concat(database));
    } else {
      logger("No differences found. Database: ".concat(database));
    }
  }
};

var cli = function cli() {
  var argv = yargs(hideBin(process.argv)).command('dump', 'Dump the database structure to files').command('compare', 'Compare the database structure with JSON dumps (dry run)').command('update', 'Update the database structure based on JSON dumps').command('ui', 'Open the UI').option('uiPort', {
    alias: 'U',
    describe: 'UI port',
    "default": 3600
  }).option('openUI', {
    alias: 'O',
    describe: 'Open UI',
    "default": true
  }).option('host', {
    alias: 'h',
    describe: 'Database host',
    "default": 'localhost'
  }).option('port', {
    alias: 'P',
    describe: 'Database port',
    "default": 3306
  }).option('user', {
    alias: 'u',
    describe: 'Database user',
    "default": 'root'
  }).option('password', {
    alias: 'p',
    describe: 'Database password',
    "default": ''
  }).option('database', {
    alias: 'd',
    describe: 'Target database',
    "default": null
  }).option('output', {
    alias: 'o',
    describe: 'Output directory for dumping. default is one level up from the current directory in a new folder called db-dump',
    "default": '../db-dump'
  }).option('verbose', {
    alias: 'v',
    describe: 'Enable verbose logging',
    type: 'boolean',
    "default": false
  })
  // .demandCommand(1)
  .help().argv;
  var command = argv._[0];
  var config = {
    host: argv.host,
    port: argv.port,
    user: argv.user,
    password: argv.password
  };
  setVerbose(argv.verbose);
  return {
    command: command,
    config: config,
    argv: argv
  };
};

var parseCreateTableSQL = function parseCreateTableSQL(createTableSQL) {
  if (!createTableSQL) return null;
  var name = createTableSQL.match(/CREATE TABLE\s+`([^`]+)`/)[1];
  var columns = [];
  var indexes = [];
  var constraints = [];
  var engine = null;
  var charset = null;
  var collate = null;

  // Split the SQL statement into lines and filter out empty lines
  var lines = createTableSQL.split('\n').map(function (line) {
    return line.trim();
  }).filter(function (line) {
    return line.length > 0;
  });

  // Regular expression to match column definitions
  var columnRegex = /`([^`]+)`\s+([^\s,]+)(\s+NOT NULL|\s+NULL)?(\s+DEFAULT\s+([^,\s]+))?(\s+AUTO_INCREMENT)?/;

  // Regular expression to match index definitions
  var indexRegex = /(PRIMARY|UNIQUE)?\s*KEY\s*`([^`]+)`\s*\(([^)]+)\)|PRIMARY KEY\s*\(([^)]+)\)/;

  // Regular expression to match table options (ENGINE, CHARSET, COLLATE)
  var optionsRegex = /ENGINE=(\w+)\s+DEFAULT\s+CHARSET=(\w+)(\s+COLLATE=(\w+))?/;

  // Process each line
  var _iterator = _createForOfIteratorHelper(lines),
    _step;
  try {
    for (_iterator.s(); !(_step = _iterator.n()).done;) {
      var line = _step.value;
      if (line.includes('CREATE TABLE')) {
        continue;
      }
      // Check if the line contains a column definition
      var columnMatch = columnRegex.exec(line);
      var indexMatch = indexRegex.exec(line);
      var constraintMatch = parseConstraint(line);
      if (columnMatch && !indexMatch && !constraintMatch) {
        var columnType = parseColumnType(line);
        var column = {
          Field: columnMatch[1],
          Type: columnType
        };

        // Set Null property based on NOT NULL presence
        if (columnMatch[3] && columnMatch[3].includes('NOT NULL')) {
          column.NotNull = true; // Set to false if NOT NULL is present
        }

        // Set Default property if it exists
        if (columnMatch[5]) {
          // console.log('columnMatch[5]', columnMatch[5], columnMatch[5].replace(/'/g, ''))
          column.Default = columnMatch[5].replace(/'/g, '');
        }

        // Set AutoIncrement property if it exists
        if (columnMatch[6]) {
          column.AutoIncrement = true; // Set to true if AUTO_INCREMENT is present
        }
        columns.push(column);
      } else if (indexMatch && !constraintMatch) {
        var isPrimary = line.includes("PRIMARY KEY"); // Check for PRIMARY in both patterns
        var isUnique = line.includes("UNIQUE KEY"); // Only set Unique if it matches

        var keyName = isPrimary ? null : indexMatch[2]; // Set KeyName to null if it's a primary key
        var columnNames = indexMatch[3] ? indexMatch[3].split(',').map(function (col) {
          return col.trim().replace(/`/g, '');
        }) // Remove backticks
        : indexMatch[4].split(',').map(function (col) {
          return col.trim().replace(/`/g, '');
        }); // Remove backticks
        var index = {
          ColumnName: columnNames
        };
        if (isPrimary) index.Primary = true, index.Name = "PRIMARY";
        if (isUnique) index.Unique = true;
        if (keyName) index.Name = keyName;
        indexes.push(index);
      } else if (constraintMatch) {
        constraints.push(constraintMatch);
      }
    }

    // Handle table options
  } catch (err) {
    _iterator.e(err);
  } finally {
    _iterator.f();
  }
  var optionsMatch = optionsRegex.exec(createTableSQL);
  if (optionsMatch) {
    engine = optionsMatch[1];
    charset = optionsMatch[2];
    collate = optionsMatch[4] || null; // Collate may not be present
  }
  return {
    name: name,
    columns: columns,
    indexes: indexes,
    constraints: constraints,
    engine: engine,
    charset: charset,
    collate: collate
  };
};
var parseConstraint = function parseConstraint(sql) {
  if (!sql) return null;
  var regex = /FOREIGN KEY \((`[^`]+`)\) REFERENCES (`[^`]+`)\s?\((`[^`]+`)\)(?:\sON DELETE (NO|CASCADE|SET NULL|SET DEFAULT))?(?:\sON UPDATE (NO ACTION|CASCADE|SET NULL|SET DEFAULT))?/i;
  var match = sql.match(regex);
  if (!match) {
    return null;
  }
  var onDelete = null;
  var onUpdate = null;
  if (sql.includes('ON DELETE CASCADE')) {
    onDelete = 'CASCADE';
  } else if (sql.includes('ON DELETE SET NULL')) {
    onDelete = 'SET NULL';
  } else if (sql.includes('ON DELETE SET DEFAULT')) {
    onDelete = 'SET DEFAULT';
  } else {
    onDelete = 'NO ACTION';
  }
  if (sql.includes('ON UPDATE CASCADE')) {
    onUpdate = 'CASCADE';
  } else if (sql.includes('ON UPDATE SET NULL')) {
    onUpdate = 'SET NULL';
  } else if (sql.includes('ON UPDATE SET DEFAULT')) {
    onUpdate = 'SET DEFAULT';
  } else {
    onUpdate = 'NO ACTION';
  }
  var columnName = match[1] || '';
  columnName = columnName.replace(/`/g, '');
  var table = match[2] || '';
  table = table.replace(/`/g, '');
  var column = match[3] || '';
  column = column.replace(/`/g, '');
  return {
    Name: "AlertRule",
    // Replace with actual constraint name if needed
    Type: "FOREIGN KEY",
    ColumnName: [columnName],
    // Column in the current table
    References: {
      Table: table,
      // Referenced table
      Column: column // Referenced column
    },
    OnDelete: onDelete,
    OnUpdate: onUpdate
  };
};
var parseColumnType = function parseColumnType(line) {
  // Match type pattern including parameters, handling both single and double parameter types
  var typeRegex = /`[^`]+`\s+([a-zA-Z]+(?:\([0-9]+(?:,[0-9]+)?\))?)/i;
  var match = line.match(typeRegex);
  if (!match) return null;
  return match[1]; // Returns the full type including parameters
};

var getDatabases = /*#__PURE__*/function () {
  var _ref = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee(connection) {
    var databases;
    return _regeneratorRuntime().wrap(function _callee$(_context) {
      while (1) switch (_context.prev = _context.next) {
        case 0:
          _context.next = 2;
          return connection.query('SHOW DATABASES');
        case 2:
          databases = _context.sent;
          return _context.abrupt("return", databases.map(function (db) {
            return db.Database;
          }).filter(function (db) {
            return !['information_schema', 'mysql', 'performance_schema', 'sys'].includes(db);
          }));
        case 4:
        case "end":
          return _context.stop();
      }
    }, _callee);
  }));
  return function getDatabases(_x) {
    return _ref.apply(this, arguments);
  };
}();
var getDatabaseStructure = /*#__PURE__*/function () {
  var _ref2 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee2(connection, database, command, options) {
    var tables, procedures, views, dbDir, tableDir, tableRows, _iterator, _step, row, tableName, createTableRow, createTableSQL, parsedTable, _tableDir, filePath, routineRows, _iterator2, _step2, _row, createSQLrow, createSQL, _filePath, triggerRows, _iterator3, _step3, _row2, triggerName, _tableName, triggerDefinitionRow, triggerDefinition, _tableDir2, triggerFilePath, viewRows, _iterator4, _step4, _row3, viewName, viewDefinition, _filePath2;
    return _regeneratorRuntime().wrap(function _callee2$(_context2) {
      while (1) switch (_context2.prev = _context2.next) {
        case 0:
          if (!(connection.state === 'disconnected')) {
            _context2.next = 3;
            break;
          }
          _context2.next = 3;
          return connection.reconnect();
        case 3:
          _context2.next = 5;
          return connection.query("USE `".concat(database, "`"));
        case 5:
          // Switch to the target database
          tables = {};
          procedures = [];
          views = {};
          dbDir = path.join(options.output, database); // Use argv.output for the base path
          // Create the output directory for the database if it doesn't exist
          if (!(command === 'dump')) {
            _context2.next = 13;
            break;
          }
          tableDir = path.join(dbDir, 'tables'); // Subfolder for table SQL files
          _context2.next = 13;
          return fs.mkdir(tableDir, {
            recursive: true
          });
        case 13:
          _context2.next = 15;
          return connection.query('SHOW FULL TABLES WHERE Table_Type != "VIEW"');
        case 15:
          tableRows = _context2.sent;
          _iterator = _createForOfIteratorHelper(tableRows);
          _context2.prev = 17;
          _iterator.s();
        case 19:
          if ((_step = _iterator.n()).done) {
            _context2.next = 41;
            break;
          }
          row = _step.value;
          tableName = Object.values(row)[0]; // Get the first value in the row object
          if (tableName) {
            _context2.next = 25;
            break;
          }
          logger("Undefined table name found in database ".concat(database), row);
          return _context2.abrupt("continue", 39);
        case 25:
          _context2.next = 27;
          return connection.query("SHOW CREATE TABLE `".concat(tableName, "`"));
        case 27:
          createTableRow = _context2.sent;
          createTableSQL = createTableRow[0]['Create Table'];
          parsedTable = parseCreateTableSQL(createTableSQL); // Structure the table object
          tables[tableName] = {
            columns: parsedTable.columns,
            // Array of columns
            indexes: parsedTable.indexes,
            // Array of indexes
            constraints: parsedTable.constraints,
            // Array of constraints
            triggers: [],
            // Initialize triggers array
            createSQL: createTableSQL // Store the CREATE TABLE SQL if needed
          };

          // Save the CREATE TABLE statement to an individual SQL file for each table
          if (!(command === 'dump')) {
            _context2.next = 39;
            break;
          }
          _tableDir = path.join(dbDir, 'tables'); // Subfolder for table SQL files
          filePath = path.join(_tableDir, "".concat(tableName, ".sql")); // Use the table directory for file saving
          _context2.next = 36;
          return fs.mkdir(path.dirname(filePath), {
            recursive: true
          });
        case 36:
          _context2.next = 38;
          return fs.writeFile(filePath, "".concat(createTableSQL, "\n"), 'utf-8');
        case 38:
          logger("Table structure saved to: ".concat(filePath));
        case 39:
          _context2.next = 19;
          break;
        case 41:
          _context2.next = 46;
          break;
        case 43:
          _context2.prev = 43;
          _context2.t0 = _context2["catch"](17);
          _iterator.e(_context2.t0);
        case 46:
          _context2.prev = 46;
          _iterator.f();
          return _context2.finish(46);
        case 49:
          _context2.next = 51;
          return connection.query("SHOW PROCEDURE STATUS WHERE Db = ?", [database]);
        case 51:
          routineRows = _context2.sent;
          _iterator2 = _createForOfIteratorHelper(routineRows);
          _context2.prev = 53;
          _iterator2.s();
        case 55:
          if ((_step2 = _iterator2.n()).done) {
            _context2.next = 71;
            break;
          }
          _row = _step2.value;
          _context2.next = 59;
          return connection.query("SHOW CREATE PROCEDURE `".concat(_row.Name, "`"));
        case 59:
          createSQLrow = _context2.sent;
          createSQL = createSQLrow[0]['Create Procedure'];
          procedures.push({
            Name: _row.Name,
            Definition: createSQL
          }); // Add procedure names to the array
          if (!(command === 'dump')) {
            _context2.next = 69;
            break;
          }
          _filePath = path.join(dbDir, 'procedures', "".concat(_row.Name, ".sql")); // Use the table directory for file saving
          _context2.next = 66;
          return fs.mkdir(path.dirname(_filePath), {
            recursive: true
          });
        case 66:
          _context2.next = 68;
          return fs.writeFile(_filePath, "".concat(createSQL, "\n"), 'utf-8');
        case 68:
          logger("Procedure definition saved to: ".concat(_filePath));
        case 69:
          _context2.next = 55;
          break;
        case 71:
          _context2.next = 76;
          break;
        case 73:
          _context2.prev = 73;
          _context2.t1 = _context2["catch"](53);
          _iterator2.e(_context2.t1);
        case 76:
          _context2.prev = 76;
          _iterator2.f();
          return _context2.finish(76);
        case 79:
          _context2.next = 81;
          return connection.query("\n        SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE\n        FROM INFORMATION_SCHEMA.TRIGGERS\n        WHERE TRIGGER_SCHEMA = ?\n    ", [database]);
        case 81:
          triggerRows = _context2.sent;
          _iterator3 = _createForOfIteratorHelper(triggerRows);
          _context2.prev = 83;
          _iterator3.s();
        case 85:
          if ((_step3 = _iterator3.n()).done) {
            _context2.next = 108;
            break;
          }
          _row2 = _step3.value;
          triggerName = _row2.TRIGGER_NAME;
          _tableName = _row2.EVENT_OBJECT_TABLE; // Ensure triggerDefinition is defined before using it
          _context2.next = 91;
          return connection.query("SHOW CREATE TRIGGER `".concat(triggerName, "`"));
        case 91:
          triggerDefinitionRow = _context2.sent;
          triggerDefinition = triggerDefinitionRow[0]['SQL Original Statement'];
          if (!triggerDefinition) {
            _context2.next = 105;
            break;
          }
          tables[_tableName].triggers.push({
            Name: triggerName,
            Definition: triggerDefinition
          });
          if (!(command === 'dump')) {
            _context2.next = 103;
            break;
          }
          _tableDir2 = path.join(dbDir, 'tables'); // Subfolder for table SQL files
          triggerFilePath = path.join(_tableDir2, 'triggers', "".concat(triggerName, ".sql"));
          _context2.next = 100;
          return fs.mkdir(path.dirname(triggerFilePath), {
            recursive: true
          });
        case 100:
          _context2.next = 102;
          return fs.writeFile(triggerFilePath, "".concat(triggerDefinition, "\n"), 'utf-8');
        case 102:
          logger("Trigger definition saved to: ".concat(triggerFilePath));
        case 103:
          _context2.next = 106;
          break;
        case 105:
          logger("Trigger ".concat(triggerName, " has no action statement."));
        case 106:
          _context2.next = 85;
          break;
        case 108:
          _context2.next = 113;
          break;
        case 110:
          _context2.prev = 110;
          _context2.t2 = _context2["catch"](83);
          _iterator3.e(_context2.t2);
        case 113:
          _context2.prev = 113;
          _iterator3.f();
          return _context2.finish(113);
        case 116:
          _context2.next = 118;
          return connection.query("SHOW FULL TABLES IN `".concat(database, "` WHERE TABLE_TYPE LIKE 'VIEW'"));
        case 118:
          viewRows = _context2.sent;
          _iterator4 = _createForOfIteratorHelper(viewRows);
          _context2.prev = 120;
          _iterator4.s();
        case 122:
          if ((_step4 = _iterator4.n()).done) {
            _context2.next = 147;
            break;
          }
          _row3 = _step4.value;
          viewName = _row3["Tables_in_".concat(database.toLowerCase())];
          if (!viewName) viewName = _row3["Tables_in_".concat(database)];
          logger("getting view Tables_in_".concat(database), viewName);
          _context2.prev = 127;
          _context2.next = 130;
          return connection.query("SHOW CREATE VIEW `".concat(viewName, "`"));
        case 130:
          viewDefinition = _context2.sent;
          views[viewName] = viewDefinition[0]['Create View'];
          if (!(command === 'dump')) {
            _context2.next = 139;
            break;
          }
          _filePath2 = path.join(dbDir, 'views', "".concat(viewName, ".sql")); // Use the table directory for file saving
          _context2.next = 136;
          return fs.mkdir(path.dirname(_filePath2), {
            recursive: true
          });
        case 136:
          _context2.next = 138;
          return fs.writeFile(_filePath2, "".concat(viewDefinition[0]['Create View'], "\n"), 'utf-8');
        case 138:
          logger("View definition saved to: ".concat(_filePath2));
        case 139:
          _context2.next = 145;
          break;
        case 141:
          _context2.prev = 141;
          _context2.t3 = _context2["catch"](127);
          logger("Error retrieving definition for view ".concat(viewName, ":"), _context2.t3.message);
          logger(_row3);
        case 145:
          _context2.next = 122;
          break;
        case 147:
          _context2.next = 152;
          break;
        case 149:
          _context2.prev = 149;
          _context2.t4 = _context2["catch"](120);
          _iterator4.e(_context2.t4);
        case 152:
          _context2.prev = 152;
          _iterator4.f();
          return _context2.finish(152);
        case 155:
          return _context2.abrupt("return", {
            tables: tables,
            procedures: procedures,
            views: views
          });
        case 156:
        case "end":
          return _context2.stop();
      }
    }, _callee2, null, [[17, 43, 46, 49], [53, 73, 76, 79], [83, 110, 113, 116], [120, 149, 152, 155], [127, 141]]);
  }));
  return function getDatabaseStructure(_x2, _x3, _x4, _x5) {
    return _ref2.apply(this, arguments);
  };
}();

// const require = createRequire(import.meta.url);
// const { version } = require('../package.json');

var dumpAllDatabases = /*#__PURE__*/function () {
  var _ref = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee(connection, command, options) {
    var response, databases, _iterator, _step, database, dbStructure;
    return _regeneratorRuntime().wrap(function _callee$(_context) {
      while (1) switch (_context.prev = _context.next) {
        case 0:
          response = {};
          _context.next = 3;
          return getDatabases(connection);
        case 3:
          databases = _context.sent;
          _iterator = _createForOfIteratorHelper(databases);
          _context.prev = 5;
          _iterator.s();
        case 7:
          if ((_step = _iterator.n()).done) {
            _context.next = 19;
            break;
          }
          database = _step.value;
          _context.next = 11;
          return getDatabaseStructure(connection, database, command, options);
        case 11:
          dbStructure = _context.sent;
          if (Object.keys(dbStructure.views).length === 0) {
            delete dbStructure.views;
          }
          if (Object.keys(dbStructure.procedures).length === 0) {
            delete dbStructure.procedures;
          }
          _context.next = 16;
          return fs.writeFile(path.join(options.output, database, "".concat(database, ".json")), JSON.stringify(dbStructure, null, 4), 'utf-8');
        case 16:
          response[database] = dbStructure;
        case 17:
          _context.next = 7;
          break;
        case 19:
          _context.next = 24;
          break;
        case 21:
          _context.prev = 21;
          _context.t0 = _context["catch"](5);
          _iterator.e(_context.t0);
        case 24:
          _context.prev = 24;
          _iterator.f();
          return _context.finish(24);
        case 27:
          _context.next = 29;
          return fs.writeFile(path.join(options.output, 'dumpInfo.json'), JSON.stringify({
            timestamp: new Date().toISOString()
          }, null, 4), 'utf-8');
        case 29:
          return _context.abrupt("return", response);
        case 30:
        case "end":
          return _context.stop();
      }
    }, _callee, null, [[5, 21, 24, 27]]);
  }));
  return function dumpAllDatabases(_x, _x2, _x3) {
    return _ref.apply(this, arguments);
  };
}();
var getDatabasesFromExistingDumps = /*#__PURE__*/function () {
  var _ref2 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee2(options) {
    var exists, response, databases, _iterator2, _step2, database, dbStructure;
    return _regeneratorRuntime().wrap(function _callee2$(_context2) {
      while (1) switch (_context2.prev = _context2.next) {
        case 0:
          logger('Getting databases from existing dumps in ', options.output);
          //check if the folder exists
          _context2.next = 3;
          return fs.stat(options.output)["catch"](function () {
            return false;
          });
        case 3:
          exists = _context2.sent;
          if (exists) {
            _context2.next = 7;
            break;
          }
          logger('Folder does not exist');
          return _context2.abrupt("return", {});
        case 7:
          //read directory above to get the dbs. each db is in a named folder with a matching .json. 
          //combine all the .jsons into a single object
          response = {};
          _context2.next = 10;
          return fs.readdir(path.join(options.output));
        case 10:
          databases = _context2.sent;
          _iterator2 = _createForOfIteratorHelper(databases);
          _context2.prev = 12;
          _iterator2.s();
        case 14:
          if ((_step2 = _iterator2.n()).done) {
            _context2.next = 25;
            break;
          }
          database = _step2.value;
          if (!(database.includes('diffs') || database.includes('dumpInfo'))) {
            _context2.next = 19;
            break;
          }
          logger('Skipping diffs folder');
          return _context2.abrupt("continue", 23);
        case 19:
          _context2.next = 21;
          return fs.readFile(path.join(options.output, database, "".concat(database, ".json")), 'utf8');
        case 21:
          dbStructure = _context2.sent;
          response[database] = JSON.parse(dbStructure);
        case 23:
          _context2.next = 14;
          break;
        case 25:
          _context2.next = 30;
          break;
        case 27:
          _context2.prev = 27;
          _context2.t0 = _context2["catch"](12);
          _iterator2.e(_context2.t0);
        case 30:
          _context2.prev = 30;
          _iterator2.f();
          return _context2.finish(30);
        case 33:
          return _context2.abrupt("return", response);
        case 34:
        case "end":
          return _context2.stop();
      }
    }, _callee2, null, [[12, 27, 30, 33]]);
  }));
  return function getDatabasesFromExistingDumps(_x4) {
    return _ref2.apply(this, arguments);
  };
}();

var normalizeSQLDefinition = function normalizeSQLDefinition(definition) {
  return definition.replace(/\s+/g, ' ') // Replace multiple whitespace with a single space
  .replace(/'/g, "\\'") // Escape single quotes
  .trim(); // Trim leading and trailing whitespace
};

var findDifferences = function findDifferences(expected, current) {
  var differences = [];

  // Detect extra tables
  if (!current.tables) throw new Error('No tables found in current');
  for (var _i = 0, _Object$keys = Object.keys(current.tables); _i < _Object$keys.length; _i++) {
    var tableName = _Object$keys[_i];
    if (!expected.tables[tableName]) {
      differences.push({
        type: 'extra_table',
        tableName: tableName
      });
    }
  }

  // Compare tables and fields
  if (!expected.tables) throw new Error('No tables found in expected');
  for (var _i2 = 0, _Object$entries = Object.entries(expected.tables); _i2 < _Object$entries.length; _i2++) {
    var _Object$entries$_i = _slicedToArray(_Object$entries[_i2], 2),
      _tableName = _Object$entries$_i[0],
      contents = _Object$entries$_i[1];
    //check if craete table matches from json, if so, we dont need to compare indexes, triggers, or fields
    var columns = contents.columns,
      indexes = contents.indexes,
      triggers = contents.triggers;
      contents.createSQL;
      contents.name;
      contents.engine;
      contents.charset;
      contents.collate;
    if (!current.tables[_tableName]) {
      logger('missing_table', contents);
      differences.push({
        type: 'missing_table',
        tableName: _tableName,
        createSQL: contents.createSQL
      });
      continue;
    }
    try {
      //verify triggers
      logger('Verifying triggers for table', _tableName);
      var _iterator = _createForOfIteratorHelper(triggers),
        _step;
      try {
        var _loop = function _loop() {
          var trigger = _step.value;
          var currentTrigger = current.tables[_tableName].triggers.find(function (t) {
            return t.Name === trigger.Name;
          });
          if (!currentTrigger) {
            logger('Missing trigger', trigger);
            differences.push({
              type: 'missing_trigger',
              tableName: _tableName,
              trigger: trigger
            });
          } else {
            // Compare additional properties if needed
            if (currentTrigger.Event !== trigger.Event || currentTrigger.Statement !== trigger.Statement) {
              logger('Mismatched trigger', {
                expected: trigger,
                current: currentTrigger
              });
              differences.push({
                type: 'mismatched_trigger',
                tableName: _tableName,
                trigger: trigger
              });
            }
          }
        };
        for (_iterator.s(); !(_step = _iterator.n()).done;) {
          _loop();
        }
      } catch (err) {
        _iterator.e(err);
      } finally {
        _iterator.f();
      }
      var _iterator2 = _createForOfIteratorHelper(current.tables[_tableName].triggers),
        _step2;
      try {
        var _loop2 = function _loop2() {
          var trigger = _step2.value;
          if (!triggers.some(function (t) {
            return t.Name === trigger.Name;
          })) {
            logger('Extra trigger', trigger);
            differences.push({
              type: 'extra_trigger',
              tableName: _tableName,
              trigger: trigger
            });
          }
        };
        for (_iterator2.s(); !(_step2 = _iterator2.n()).done;) {
          _loop2();
        }
      } catch (err) {
        _iterator2.e(err);
      } finally {
        _iterator2.f();
      }
    } catch (e) {
      logger("Error verifying triggers for table ".concat(_tableName), e);
    }
    var createTableSql = current.tables[_tableName].createSQL;
    if (createTableSql === contents.createSQL) {
      logger("Table ".concat(_tableName, " createSQL matches from json, skipping indexes, triggers, and fields"));
      continue;
    } else {
      logger("Table ".concat(_tableName, " createSQL does not match from json, comparing indexes, triggers, and fields"));
      logger(createTableSql);
      logger(contents.createSQL);
    }
    current.tables[_tableName].columns.map(function (f) {
      return f.Field;
    });
    var expectedFieldNames = columns.map(function (f) {
      return f.Field;
    });
    logger('Detecting missing fields for table', _tableName);
    // // Detect missing fields
    // for (const field of columns) {
    //     if (!currentFieldNames.includes(field.Field)) {
    //         differences.push({ type: 'missing_field', tableName, field });
    //     }
    // }

    logger('Detecting extra fields for table', _tableName);
    // Detect extra fields
    var _iterator3 = _createForOfIteratorHelper(current.tables[_tableName].columns),
      _step3;
    try {
      for (_iterator3.s(); !(_step3 = _iterator3.n()).done;) {
        var field = _step3.value;
        if (!expectedFieldNames.includes(field.Field)) {
          differences.push({
            type: 'extra_field',
            tableName: _tableName,
            field: field
          });
        }
      }

      // verify Type Null and Default
    } catch (err) {
      _iterator3.e(err);
    } finally {
      _iterator3.f();
    }
    logger('Verifying Type Null and Default for table', _tableName);
    var _iterator4 = _createForOfIteratorHelper(columns),
      _step4;
    try {
      var _loop3 = function _loop3() {
          var field = _step4.value;
          var currentField = current.tables[_tableName].columns.find(function (f) {
            return f.Field === field.Field;
          });
          if (!currentField) {
            logger('Current field not found for', field.Field, 'in table', _tableName);
            differences.push({
              type: 'missing_field',
              tableName: _tableName,
              field: field
            });
            return 0; // continue
          }
          if (field.Null !== currentField.Null) {
            differences.push({
              type: 'mismatched_field',
              info: "Null",
              tableName: _tableName,
              field: field,
              currentField: currentField
            });
          }
          if (field.Default !== currentField.Default) {
            differences.push({
              type: 'mismatched_field',
              info: "Default",
              tableName: _tableName,
              field: field,
              currentField: currentField
            });
          }
          if (field.Type !== currentField.Type) {
            if (field.Type == 'int' && currentField.Type.startsWith('int(')) return 0; // continue
            // int(11) is the default for int and used on older versions of mysql
            if (field.Type == 'smallint' && currentField.Type.startsWith('smallint(')) return 0; // continue
            // smallint(6) is the default for smallint and used on older versions of mysql
            if (field.Type == 'tinyint' && currentField.Type.startsWith('tinyint(')) return 0; // continue
            // tinyint(1) is the default for tinyint and used on older versions of mysql
            if (field.Type == 'varchar' && currentField.Type.startsWith('varchar(')) return 0; // continue
            // varchar(255) is the default for varchar and used on older versions of mysql
            if (field.Type == 'bigint' && currentField.Type.startsWith('bigint(')) return 0; // continue
            // bigint(20) is the default for bigint and used on older versions of mysql
            differences.push({
              type: 'mismatched_field',
              info: "Type",
              tableName: _tableName,
              field: field,
              currentField: currentField
            });
          }
        },
        _ret;
      for (_iterator4.s(); !(_step4 = _iterator4.n()).done;) {
        _ret = _loop3();
        if (_ret === 0) continue;
      }

      // verify indexes
    } catch (err) {
      _iterator4.e(err);
    } finally {
      _iterator4.f();
    }
    logger('Verifying indexes for table', _tableName);
    var _iterator5 = _createForOfIteratorHelper(indexes),
      _step5;
    try {
      var _loop4 = function _loop4() {
        var index = _step5.value;
        // Check if the current index matches the expected index structure
        var currentIndex = current.tables[_tableName].indexes.find(function (i) {
          return i.ColumnName.sort().join(', ') === index.ColumnName.sort().join(', ');
        });
        if (!currentIndex) {
          logger('Missing index', index);
          differences.push({
            type: 'missing_index',
            tableName: _tableName,
            indexName: index.Name,
            index: index
          });
        } else {
          // If needed, you can add further checks for uniqueness or other properties here
          if (currentIndex.Name == index.Name) {
            if (currentIndex.Unique !== index.Unique) {
              differences.push({
                type: 'mismatched_index',
                from: 'unique',
                tableName: _tableName,
                indexName: index.Name,
                index: index
              });
            } else if (currentIndex.Primary !== index.Primary) {
              differences.push({
                type: 'mismatched_index',
                from: 'primary',
                tableName: _tableName,
                indexName: index.Name,
                index: index
              });
            }
          }
        }
      };
      for (_iterator5.s(); !(_step5 = _iterator5.n()).done;) {
        _loop4();
      }
    } catch (err) {
      _iterator5.e(err);
    } finally {
      _iterator5.f();
    }
    var _iterator6 = _createForOfIteratorHelper(current.tables[_tableName].indexes),
      _step6;
    try {
      var _loop5 = function _loop5() {
        var index = _step6.value;
        logger('Checking index', index);
        var indexFound = false;

        // Sort the ColumnName array for proper comparison
        var sortedCurrentIndexColumns = index.ColumnName.sort().join(', ');
        if (!indexes.some(function (i) {
          return i.ColumnName.sort().join(', ') === sortedCurrentIndexColumns;
        })) {
          differences.push({
            type: 'extra_index',
            tableName: _tableName,
            indexName: index.Name,
            index: index
          });
        }
      };
      for (_iterator6.s(); !(_step6 = _iterator6.n()).done;) {
        _loop5();
      }
    } catch (err) {
      _iterator6.e(err);
    } finally {
      _iterator6.f();
    }
  }

  // Compare stored procedures
  if (!expected.procedures) {
    console.log('No procedures found in expected');
  } else {
    var _loop6 = function _loop6() {
      var _Object$entries2$_i = _slicedToArray(_Object$entries2[_i3], 2);
        _Object$entries2$_i[0];
        var contents = _Object$entries2$_i[1];
      var procName = contents.Name;
      var currentProc = current.procedures.find(function (p) {
        return p.Name === procName;
      });
      if (!currentProc) {
        console.log('missing_procedure', contents);
        differences.push(_objectSpread2({
          type: 'missing_procedure'
        }, contents));
        return 1; // continue
      }

      // Check if the procedure definition matches
      if (currentProc.Definition !== contents.Definition) {
        var normalizedCurrentDef = normalizeSQLDefinition(currentProc.Definition);
        var normalizedNewDef = normalizeSQLDefinition(contents.Definition);
        if (normalizedCurrentDef !== normalizedNewDef) {
          differences.push(_objectSpread2({
            type: 'mismatched_procedure'
          }, contents));
        }
      }
    };
    for (var _i3 = 0, _Object$entries2 = Object.entries(expected.procedures); _i3 < _Object$entries2.length; _i3++) {
      if (_loop6()) continue;
    }
  }

  // Compare views
  if (expected.views || current.views) {
    // Handle missing views (when expected has views but current doesn't have them)
    if (expected.views && !current.views) {
      for (var _i4 = 0, _Object$entries3 = Object.entries(expected.views); _i4 < _Object$entries3.length; _i4++) {
        var _Object$entries3$_i = _slicedToArray(_Object$entries3[_i4], 2),
          viewName = _Object$entries3$_i[0],
          expectedDefinition = _Object$entries3$_i[1];
        differences.push({
          type: 'missing_view',
          viewName: viewName,
          definition: expectedDefinition
        });
      }
    }
    // Handle extra views (when current has views but expected doesn't have them)
    else if (current.views && !expected.views) {
      for (var _i5 = 0, _Object$keys2 = Object.keys(current.views); _i5 < _Object$keys2.length; _i5++) {
        var _viewName = _Object$keys2[_i5];
        differences.push({
          type: 'extra_view',
          viewName: _viewName
        });
      }
    }
    // Compare views when both exist
    else if (expected.views && current.views) {
      // Check for missing and mismatched views
      for (var _i6 = 0, _Object$entries4 = Object.entries(expected.views); _i6 < _Object$entries4.length; _i6++) {
        var _Object$entries4$_i = _slicedToArray(_Object$entries4[_i6], 2),
          _viewName2 = _Object$entries4$_i[0],
          _expectedDefinition = _Object$entries4$_i[1];
        if (!current.views[_viewName2]) {
          differences.push({
            type: 'missing_view',
            viewName: _viewName2,
            definition: _expectedDefinition
          });
        } else if (current.views[_viewName2] !== _expectedDefinition) {
          differences.push({
            type: 'mismatched_view',
            viewName: _viewName2,
            definition: _expectedDefinition,
            current: current.views[_viewName2]
          });
        }
      }

      // Check for extra views
      for (var _i7 = 0, _Object$keys3 = Object.keys(current.views); _i7 < _Object$keys3.length; _i7++) {
        var _viewName3 = _Object$keys3[_i7];
        if (!expected.views[_viewName3]) {
          differences.push({
            type: 'extra_view',
            viewName: _viewName3
          });
        }
      }
    }
  }
  return differences;
};

var applyDifferences = /*#__PURE__*/function () {
  var _ref = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee(connection, database, differences) {
    var _iterator, _step, _loop, _ret;
    return _regeneratorRuntime().wrap(function _callee$(_context2) {
      while (1) switch (_context2.prev = _context2.next) {
        case 0:
          differences.sort(function (a, b) {
            //Sort to make sure we apply the differences in a logical order.
            var typePriority = {
              'missing_database': 1,
              'missing_table': 2,
              'extra_table': 2,
              'missing_field': 3,
              'extra_field': 3,
              'mismatched_field': 3,
              'missing_index': 4,
              'extra_index': 4,
              'mismatched_index': 4,
              'missing_procedure': 5,
              'mismatched_procedure': 5,
              'missing_view': 6,
              'mismatched_view': 6,
              'extra_view': 6,
              'missing_trigger': 7,
              'mismatched_trigger': 7,
              'extra_trigger': 7
            };
            return (typePriority[a.type] || 999) - (typePriority[b.type] || 999);
          });
          _iterator = _createForOfIteratorHelper(differences);
          _context2.prev = 2;
          _loop = /*#__PURE__*/_regeneratorRuntime().mark(function _loop() {
            var diff, createDatabaseSQL, tableName, createSQL, _tableName, dropTableSQL, addFieldSQL, modifyFieldSQL, defaultClause, _modifyFieldSQL, dropFieldSQL, _tableName2, field, currentField, isTimestamp, _defaultClause, hasOnUpdate, _modifyFieldSQL2, existingColumns, columnNames, missingColumns, indexColumns, primaryKeySQL, uniqueSQL, addIndexSQL, dropPrimaryKeySQL, dropIndexSQL, _tableName3, index, _dropPrimaryKeySQL, _dropIndexSQL, _uniqueSQL, addPrimaryKeySQL, _addIndexSQL, dropCurrentProcSQL, createProcSQL, dropViewSQL, createViewSQL, _dropViewSQL, _createViewSQL, _dropViewSQL2, createTriggerSQL, dropTriggerSQL, _createTriggerSQL, _dropTriggerSQL, _createDatabaseSQL;
            return _regeneratorRuntime().wrap(function _loop$(_context) {
              while (1) switch (_context.prev = _context.next) {
                case 0:
                  diff = _step.value;
                  _context.prev = 1;
                  if (!(diff.type == 'missing_database')) {
                    _context.next = 8;
                    break;
                  }
                  createDatabaseSQL = "CREATE DATABASE `".concat(differences[0].database, "`;");
                  console.log("Executing: ".concat(createDatabaseSQL));
                  _context.next = 7;
                  return connection.query(createDatabaseSQL);
                case 7:
                  return _context.abrupt("return", 0);
                case 8:
                  _context.next = 10;
                  return connection.query("USE `".concat(database, "`"));
                case 10:
                  if (!(diff.type === 'missing_table')) {
                    _context.next = 18;
                    break;
                  }
                  tableName = diff.tableName, createSQL = diff.createSQL;
                  logger("Creating missing table ".concat(tableName));
                  console.log("Executing: ".concat(createSQL));
                  _context.next = 16;
                  return connection.query(createSQL);
                case 16:
                  _context.next = 212;
                  break;
                case 18:
                  if (!(diff.type === 'extra_table')) {
                    _context.next = 27;
                    break;
                  }
                  _tableName = diff.tableName;
                  logger("Dropping extra table ".concat(_tableName));
                  dropTableSQL = "DROP TABLE `".concat(_tableName, "`;");
                  console.log("Executing: ".concat(dropTableSQL));
                  _context.next = 25;
                  return connection.query(dropTableSQL);
                case 25:
                  _context.next = 212;
                  break;
                case 27:
                  if (!(diff.type === 'missing_field')) {
                    _context.next = 45;
                    break;
                  }
                  // Step 1: Add column with DEFAULT NULL to handle existing records
                  addFieldSQL = "ALTER TABLE `".concat(diff.tableName, "` ADD `").concat(diff.field.Field, "` ").concat(diff.field.Type, " DEFAULT NULL;");
                  console.log("Executing: ".concat(addFieldSQL));
                  _context.next = 32;
                  return connection.query(addFieldSQL);
                case 32:
                  if (!(diff.field.NotNull && !diff.field.Default)) {
                    _context.next = 37;
                    break;
                  }
                  modifyFieldSQL = "ALTER TABLE `".concat(diff.tableName, "` MODIFY `").concat(diff.field.Field, "` ").concat(diff.field.Type, " NOT NULL;");
                  console.log("Executing: ".concat(modifyFieldSQL));
                  _context.next = 37;
                  return connection.query(modifyFieldSQL);
                case 37:
                  if (!diff.field.Default) {
                    _context.next = 43;
                    break;
                  }
                  defaultClause = diff.field.Default === 'CURRENT_TIMESTAMP' ? 'DEFAULT CURRENT_TIMESTAMP' : diff.field.Default !== undefined && diff.field.Default !== null ? "DEFAULT '".concat(diff.field.Default, "'") : '';
                  _modifyFieldSQL = "ALTER TABLE `".concat(diff.tableName, "` MODIFY `").concat(diff.field.Field, "` ").concat(diff.field.Type, " ").concat(defaultClause, ";");
                  console.log("Executing: ".concat(_modifyFieldSQL));
                  _context.next = 43;
                  return connection.query(_modifyFieldSQL);
                case 43:
                  _context.next = 212;
                  break;
                case 45:
                  if (!(diff.type === 'extra_field')) {
                    _context.next = 52;
                    break;
                  }
                  dropFieldSQL = "ALTER TABLE `".concat(diff.tableName, "` DROP COLUMN `").concat(diff.field.Field, "`;");
                  console.log("Executing: ".concat(dropFieldSQL));
                  _context.next = 50;
                  return connection.query(dropFieldSQL);
                case 50:
                  _context.next = 212;
                  break;
                case 52:
                  if (!(diff.type === 'mismatched_field')) {
                    _context.next = 63;
                    break;
                  }
                  _tableName2 = diff.tableName, field = diff.field, currentField = diff.currentField; // use alter table rather than adding fields
                  // // Helper function to determine if we need batch processing
                  // const needsBatchProcessing = () => {
                  //     const currentType = currentField.Type.toLowerCase();
                  //     const newType = field.Type.toLowerCase();
                  //     // Decimal changes
                  //     if (currentType.includes('decimal') && newType.includes('decimal')) {
                  //         return true;
                  //     }
                  //     // VARCHAR/CHAR length reductions
                  //     if ((currentType.includes('varchar') || currentType.includes('char')) &&
                  //         (newType.includes('varchar') || newType.includes('char'))) {
                  //         const currentLength = parseInt(currentType.match(/\((\d+)\)/)?.[1] || '0');
                  //         const newLength = parseInt(newType.match(/\((\d+)\)/)?.[1] || '0');
                  //         return newLength < currentLength;
                  //     }
                  //     // TEXT to VARCHAR conversions
                  //     if (currentType.includes('text') && newType.includes('varchar')) {
                  //         return true;
                  //     }
                  //     // Numeric type downgrades
                  //     const numericDowngrades = {
                  //         'bigint': ['int', 'mediumint', 'smallint', 'tinyint'],
                  //         'int': ['mediumint', 'smallint', 'tinyint'],
                  //         'mediumint': ['smallint', 'tinyint'],
                  //         'smallint': ['tinyint'],
                  //         'double': ['float', 'decimal'],
                  //         'float': ['decimal']
                  //     };
                  //     for (const [larger, smaller] of Object.entries(numericDowngrades)) {
                  //         if (currentType.includes(larger) && smaller.some(t => newType.includes(t))) {
                  //             return true;
                  //         }
                  //     }
                  //     return false;
                  // };
                  // if (needsBatchProcessing()) {
                  //     // Step 1: Add new column
                  //     const addColumnSQL = `ALTER TABLE \`${tableName}\` ADD COLUMN \`${field.Field}_new\` ${field.Type} DEFAULT NULL;`;
                  //     console.log(`Adding new column for type conversion: ${addColumnSQL}`);
                  //     await connection.query(addColumnSQL);
                  //     // Step 2: Copy data in batches
                  //     let totalUpdated = 0;
                  //     let batchSize = 10000;
                  //     let batchCount = 0;
                  //     while (true) {
                  //         const updateSQL = `
                  //             UPDATE \`${tableName}\` 
                  //             SET \`${field.Field}_new\` = \`${field.Field}\`
                  //             WHERE \`${field.Field}_new\` IS NULL 
                  //             AND \`${field.Field}\` IS NOT NULL
                  //             LIMIT ${batchSize};
                  //         `;
                  //         const result = await connection.query(updateSQL);
                  //         const rowsAffected = result.affectedRows;
                  //         if (rowsAffected === 0) break;
                  //         totalUpdated += rowsAffected;
                  //         batchCount++;
                  //         console.log(`Batch ${batchCount}: Converted ${rowsAffected} rows. Total converted: ${totalUpdated}`);
                  //     }
                  //     // Step 3: Verify data (optional)
                  //     const verifySQL = `
                  //         SELECT COUNT(*) as mismatch FROM \`${tableName}\`
                  //         WHERE \`${field.Field}\` IS NOT NULL 
                  //         AND \`${field.Field}_new\` IS NULL;
                  //     `;
                  //     const [verifyResult] = await connection.query(verifySQL);
                  //     if (verifyResult.mismatch > 0) {
                  //         console.log(`Warning: ${verifyResult.mismatch} rows may have failed conversion`);
                  //     }
                  //     // Step 4: Swap columns
                  //     const swapColumnsSQL = `
                  //         ALTER TABLE \`${tableName}\`
                  //         DROP COLUMN \`${field.Field}\`,
                  //         RENAME COLUMN \`${field.Field}_new\` TO \`${field.Field}\`
                  //     `;
                  //     console.log(`Executing: ${swapColumnsSQL}`);
                  //     await connection.query(swapColumnsSQL);
                  //     console.log(`Completed type conversion for ${field.Field}. Total rows converted: ${totalUpdated}`);
                  // } else {
                  // Original mismatched field handling for simple changes
                  isTimestamp = field.Type.toLowerCase().includes('timestamp'); // Handle timestamp specific attributes
                  _defaultClause = field.Default === 'CURRENT_TIMESTAMP' ? 'DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP' : field.Default === 'NULL' ? isTimestamp ? 'NULL DEFAULT NULL' : 'DEFAULT NULL' : field.Default !== undefined && field.Default !== null ? "DEFAULT '".concat(field.Default, "'") : isTimestamp ? 'NULL DEFAULT NULL' : 'DEFAULT NULL'; // Remove ON UPDATE CURRENT_TIMESTAMP if we're changing away from CURRENT_TIMESTAMP
                  hasOnUpdate = (currentField === null || currentField === undefined ? undefined : currentField.Default) === 'CURRENT_TIMESTAMP' && field.Default !== 'CURRENT_TIMESTAMP';
                  _modifyFieldSQL2 = "ALTER TABLE `".concat(_tableName2, "` CHANGE `").concat(field.Field, "` `").concat(field.Field, "` ").concat(field.Type, " ").concat(field.NotNull ? 'NOT NULL' : '', " ").concat(_defaultClause).concat(hasOnUpdate ? ' ON UPDATE CURRENT_TIMESTAMP' : '', ";");
                  console.log("Executing: ".concat(_modifyFieldSQL2));
                  _context.next = 61;
                  return connection.query(_modifyFieldSQL2);
                case 61:
                  _context.next = 212;
                  break;
                case 63:
                  if (!(diff.type === 'missing_index')) {
                    _context.next = 95;
                    break;
                  }
                  _context.next = 66;
                  return connection.query("SHOW COLUMNS FROM `".concat(diff.tableName, "`"));
                case 66:
                  existingColumns = _context.sent;
                  columnNames = existingColumns.map(function (col) {
                    return col.Field;
                  }); // Check if all columns for the index exist
                  missingColumns = Array.isArray(diff.index.ColumnName) ? diff.index.ColumnName.filter(function (col) {
                    return !columnNames.includes(col);
                  }) : [];
                  if (!(missingColumns.length > 0)) {
                    _context.next = 72;
                    break;
                  }
                  logger("Cannot create index ".concat(diff.index.Name, " on ").concat(diff.tableName, ". Missing columns: ").concat(missingColumns.join(', ')));
                  return _context.abrupt("return", 0);
                case 72:
                  // Prepare the index columns with proper formatting
                  indexColumns = diff.index.ColumnName.map(function (col) {
                    return "`".concat(col, "`");
                  }); // Format column names
                  // Handle PRIMARY index creation
                  if (!(diff.index.Name === 'PRIMARY')) {
                    _context.next = 84;
                    break;
                  }
                  if (!(indexColumns.length > 0)) {
                    _context.next = 81;
                    break;
                  }
                  primaryKeySQL = "ALTER TABLE `".concat(diff.tableName, "` ADD PRIMARY KEY (").concat(indexColumns.join(', '), ");");
                  console.log("Executing: ".concat(primaryKeySQL));
                  _context.next = 79;
                  return connection.query(primaryKeySQL);
                case 79:
                  _context.next = 82;
                  break;
                case 81:
                  logger("Cannot create PRIMARY index on ".concat(diff.tableName, ". ColumnName is undefined or empty."), diff.index);
                case 82:
                  _context.next = 93;
                  break;
                case 84:
                  // Create the new index with UNIQUE if applicable
                  uniqueSQL = diff.index.Unique ? 'UNIQUE ' : ''; // Check if the index is unique
                  if (!(indexColumns.length > 0)) {
                    _context.next = 92;
                    break;
                  }
                  addIndexSQL = "ALTER TABLE `".concat(diff.tableName, "` ADD ").concat(uniqueSQL, "INDEX `").concat(diff.index.Name, "` (").concat(indexColumns.join(', '), ");");
                  console.log("Executing: ".concat(addIndexSQL));
                  _context.next = 90;
                  return connection.query(addIndexSQL);
                case 90:
                  _context.next = 93;
                  break;
                case 92:
                  logger("Cannot create index ".concat(diff.index.Name, " on ").concat(diff.tableName, ". ColumnName is undefined or empty."), diff.index);
                case 93:
                  _context.next = 212;
                  break;
                case 95:
                  if (!(diff.type === 'extra_index')) {
                    _context.next = 109;
                    break;
                  }
                  if (!(diff.index.Name === 'PRIMARY')) {
                    _context.next = 103;
                    break;
                  }
                  dropPrimaryKeySQL = "ALTER TABLE `".concat(diff.tableName, "` DROP PRIMARY KEY;");
                  console.log("Executing: ".concat(dropPrimaryKeySQL));
                  _context.next = 101;
                  return connection.query(dropPrimaryKeySQL);
                case 101:
                  _context.next = 107;
                  break;
                case 103:
                  dropIndexSQL = "DROP INDEX `".concat(diff.index.Name, "` ON `").concat(diff.tableName, "`;");
                  console.log("Executing: ".concat(dropIndexSQL));
                  _context.next = 107;
                  return connection.query(dropIndexSQL);
                case 107:
                  _context.next = 212;
                  break;
                case 109:
                  if (!(diff.type === 'mismatched_index')) {
                    _context.next = 137;
                    break;
                  }
                  _tableName3 = diff.tableName, index = diff.index; // Drop the existing index
                  if (!(index.Name === 'PRIMARY')) {
                    _context.next = 118;
                    break;
                  }
                  _dropPrimaryKeySQL = "ALTER TABLE `".concat(_tableName3, "` DROP PRIMARY KEY;");
                  console.log("Executing: ".concat(_dropPrimaryKeySQL));
                  _context.next = 116;
                  return connection.query(_dropPrimaryKeySQL);
                case 116:
                  _context.next = 122;
                  break;
                case 118:
                  _dropIndexSQL = "DROP INDEX `".concat(index.Name, "` ON `").concat(_tableName3, "`;");
                  console.log("Executing: ".concat(_dropIndexSQL));
                  _context.next = 122;
                  return connection.query(_dropIndexSQL);
                case 122:
                  console.log('index', index);

                  // Create the new index
                  _uniqueSQL = index.Unique ? 'UNIQUE ' : ''; // Check if the index is unique
                  if (!(index.Name === 'PRIMARY')) {
                    _context.next = 131;
                    break;
                  }
                  addPrimaryKeySQL = "ALTER TABLE `".concat(_tableName3, "` ADD PRIMARY KEY (").concat(index.ColumnName.join(', '), ");");
                  console.log("Executing: ".concat(addPrimaryKeySQL));
                  _context.next = 129;
                  return connection.query(addPrimaryKeySQL);
                case 129:
                  _context.next = 135;
                  break;
                case 131:
                  _addIndexSQL = "ALTER TABLE `".concat(_tableName3, "` ADD ").concat(_uniqueSQL, "INDEX `").concat(index.Name, "` (").concat(index.ColumnName.join(', '), ");"); // Include UNIQUE if applicable
                  console.log("Executing: ".concat(_addIndexSQL));
                  _context.next = 135;
                  return connection.query(_addIndexSQL);
                case 135:
                  _context.next = 212;
                  break;
                case 137:
                  if (!(diff.type === 'missing_procedure' || diff.type === 'mismatched_procedure')) {
                    _context.next = 148;
                    break;
                  }
                  // Drop the procedure if it exists
                  dropCurrentProcSQL = "DROP PROCEDURE IF EXISTS `".concat(diff.Name, "`;");
                  console.log("Executing: ".concat(dropCurrentProcSQL));
                  _context.next = 142;
                  return connection.query(dropCurrentProcSQL);
                case 142:
                  // Create the procedure
                  createProcSQL = diff.Definition;
                  console.log("Executing: ".concat(createProcSQL)); // Log the SQL statement
                  _context.next = 146;
                  return connection.query(createProcSQL);
                case 146:
                  _context.next = 212;
                  break;
                case 148:
                  if (!(diff.type === 'missing_view')) {
                    _context.next = 159;
                    break;
                  }
                  dropViewSQL = "DROP VIEW IF EXISTS `".concat(diff.viewName, "`;");
                  console.log("Executing: ".concat(dropViewSQL));
                  _context.next = 153;
                  return connection.query(dropViewSQL);
                case 153:
                  createViewSQL = diff.definition; // Use the expected definition to create the view
                  console.log("Executing: ".concat(createViewSQL));
                  _context.next = 157;
                  return connection.query(createViewSQL);
                case 157:
                  _context.next = 212;
                  break;
                case 159:
                  if (!(diff.type === 'mismatched_view')) {
                    _context.next = 170;
                    break;
                  }
                  _dropViewSQL = "DROP VIEW IF EXISTS `".concat(diff.viewName, "`;");
                  console.log("Executing: ".concat(_dropViewSQL));
                  _context.next = 164;
                  return connection.query(_dropViewSQL);
                case 164:
                  _createViewSQL = diff.definition; // Use the expected definition to create the view
                  console.log("Executing: ".concat(_createViewSQL));
                  _context.next = 168;
                  return connection.query(_createViewSQL);
                case 168:
                  _context.next = 212;
                  break;
                case 170:
                  if (!(diff.type === 'extra_view')) {
                    _context.next = 177;
                    break;
                  }
                  _dropViewSQL2 = "DROP VIEW IF EXISTS `".concat(diff.viewName, "`;");
                  console.log("Executing: ".concat(_dropViewSQL2));
                  _context.next = 175;
                  return connection.query(_dropViewSQL2);
                case 175:
                  _context.next = 212;
                  break;
                case 177:
                  if (!(diff.type === 'missing_trigger')) {
                    _context.next = 185;
                    break;
                  }
                  createTriggerSQL = diff.trigger.Definition;
                  logger('fixing trigger', diff.trigger.Name);
                  console.log("Executing: ".concat(createTriggerSQL));
                  _context.next = 183;
                  return connection.query(createTriggerSQL);
                case 183:
                  _context.next = 212;
                  break;
                case 185:
                  if (!(diff.type === 'mismatched_trigger')) {
                    _context.next = 196;
                    break;
                  }
                  dropTriggerSQL = "DROP TRIGGER IF EXISTS `".concat(diff.trigger.Name, "`;");
                  console.log("Executing: ".concat(dropTriggerSQL));
                  _context.next = 190;
                  return connection.query(dropTriggerSQL);
                case 190:
                  _createTriggerSQL = diff.trigger.Definition;
                  console.log("Executing: ".concat(_createTriggerSQL));
                  _context.next = 194;
                  return connection.query(_createTriggerSQL);
                case 194:
                  _context.next = 212;
                  break;
                case 196:
                  if (!(diff.type === 'extra_trigger')) {
                    _context.next = 203;
                    break;
                  }
                  _dropTriggerSQL = "DROP TRIGGER IF EXISTS `".concat(diff.trigger.Name, "`;");
                  console.log("Executing: ".concat(_dropTriggerSQL));
                  _context.next = 201;
                  return connection.query(_dropTriggerSQL);
                case 201:
                  _context.next = 212;
                  break;
                case 203:
                  if (!(diff.type === 'missing_database')) {
                    _context.next = 211;
                    break;
                  }
                  logger('fixing missing database', diff.database);
                  _createDatabaseSQL = "CREATE DATABASE `".concat(diff.database, "`;");
                  console.log("Executing: ".concat(_createDatabaseSQL));
                  _context.next = 209;
                  return connection.query(_createDatabaseSQL);
                case 209:
                  _context.next = 212;
                  break;
                case 211:
                  logger("Error applying difference of type:".concat(diff.type), diff);
                case 212:
                  _context.next = 217;
                  break;
                case 214:
                  _context.prev = 214;
                  _context.t0 = _context["catch"](1);
                  logger("Error applying difference of type:".concat(diff.type, ". Error: ").concat(_context.t0.message), diff);
                case 217:
                case "end":
                  return _context.stop();
              }
            }, _loop, null, [[1, 214]]);
          });
          _iterator.s();
        case 5:
          if ((_step = _iterator.n()).done) {
            _context2.next = 12;
            break;
          }
          return _context2.delegateYield(_loop(), "t0", 7);
        case 7:
          _ret = _context2.t0;
          if (!(_ret === 0)) {
            _context2.next = 10;
            break;
          }
          return _context2.abrupt("continue", 10);
        case 10:
          _context2.next = 5;
          break;
        case 12:
          _context2.next = 17;
          break;
        case 14:
          _context2.prev = 14;
          _context2.t1 = _context2["catch"](2);
          _iterator.e(_context2.t1);
        case 17:
          _context2.prev = 17;
          _iterator.f();
          return _context2.finish(17);
        case 20:
        case "end":
          return _context2.stop();
      }
    }, _callee, null, [[2, 14, 17, 20]]);
  }));
  return function applyDifferences(_x, _x2, _x3) {
    return _ref.apply(this, arguments);
  };
}();

var compareAllDatabases = /*#__PURE__*/function () {
  var _ref = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee(connection, inputDir) {
    var update,
      command,
      options,
      expectedDatabases,
      existingDatabases,
      allDifferences,
      missingDatabases,
      _iterator,
      _step,
      _database,
      _iterator2,
      _step2,
      database,
      _iterator3,
      _step3,
      _database2,
      filePath,
      fileContent,
      expectedStructure,
      currentStructure,
      differences,
      _args = arguments;
    return _regeneratorRuntime().wrap(function _callee$(_context) {
      while (1) switch (_context.prev = _context.next) {
        case 0:
          update = _args.length > 2 && _args[2] !== undefined ? _args[2] : false;
          command = _args.length > 3 ? _args[3] : undefined;
          options = _args.length > 4 ? _args[4] : undefined;
          if (!(connection.state === 'disconnected')) {
            _context.next = 6;
            break;
          }
          _context.next = 6;
          return connection.reconnect();
        case 6:
          _context.next = 8;
          return fs.readdir(inputDir);
        case 8:
          expectedDatabases = _context.sent;
          //filter out diffs.json
          expectedDatabases = expectedDatabases.filter(function (file) {
            return file !== 'diffs.json';
          });
          //filter out dumpInfo.json
          expectedDatabases = expectedDatabases.filter(function (file) {
            return file !== 'dumpInfo.json';
          });
          logger('Expected databases from input directory:', expectedDatabases);

          // Check existing databases
          _context.next = 14;
          return getDatabases(connection);
        case 14:
          existingDatabases = _context.sent;
          // console.log('Existing databases:', existingDatabases);
          allDifferences = {};
          missingDatabases = [];
          logger('All differences:', allDifferences);

          // Note missing databases and prepare to create them
          _iterator = _createForOfIteratorHelper(expectedDatabases);
          _context.prev = 19;
          _iterator.s();
        case 21:
          if ((_step = _iterator.n()).done) {
            _context.next = 28;
            break;
          }
          _database = _step.value;
          if (!(options && options.database && options.database !== _database)) {
            _context.next = 25;
            break;
          }
          return _context.abrupt("continue", 26);
        case 25:
          if (!existingDatabases.includes(_database)) {
            allDifferences[_database] = [{
              database: _database,
              type: 'missing_database',
              message: 'Database not found'
            }];
            missingDatabases.push(_database);
          }
        case 26:
          _context.next = 21;
          break;
        case 28:
          _context.next = 33;
          break;
        case 30:
          _context.prev = 30;
          _context.t0 = _context["catch"](19);
          _iterator.e(_context.t0);
        case 33:
          _context.prev = 33;
          _iterator.f();
          return _context.finish(33);
        case 36:
          if (!(missingDatabases.length > 0 && update)) {
            _context.next = 59;
            break;
          }
          logger('Creating missing databases:');
          _iterator2 = _createForOfIteratorHelper(missingDatabases);
          _context.prev = 39;
          _iterator2.s();
        case 41:
          if ((_step2 = _iterator2.n()).done) {
            _context.next = 49;
            break;
          }
          database = _step2.value;
          logger("Creating database ".concat(database, "..."));
          _context.next = 46;
          return connection.query("CREATE DATABASE `".concat(database, "`;"));
        case 46:
          logger("Database ".concat(database, " created."));
        case 47:
          _context.next = 41;
          break;
        case 49:
          _context.next = 54;
          break;
        case 51:
          _context.prev = 51;
          _context.t1 = _context["catch"](39);
          _iterator2.e(_context.t1);
        case 54:
          _context.prev = 54;
          _iterator2.f();
          return _context.finish(54);
        case 57:
          _context.next = 60;
          break;
        case 59:
          if (missingDatabases.length > 0 && !update) {
            logger('Missing databases found but update is not enabled. Please enable update to create missing databases.');
            logger('Please run the command again with the --update flag to create missing databases.');
            logger('Missing databases:');
            logger(missingDatabases);
          } else {
            logger('All expected databases exist.');
          }
        case 60:
          _iterator3 = _createForOfIteratorHelper(expectedDatabases);
          _context.prev = 61;
          _iterator3.s();
        case 63:
          if ((_step3 = _iterator3.n()).done) {
            _context.next = 101;
            break;
          }
          _database2 = _step3.value;
          if (!(options && options.database && options.database !== _database2)) {
            _context.next = 67;
            break;
          }
          return _context.abrupt("continue", 99);
        case 67:
          if (!missingDatabases.includes(_database2)) {
            _context.next = 70;
            break;
          }
          logger('Skipping database', _database2, 'because it is missing');
          return _context.abrupt("continue", 99);
        case 70:
          filePath = path.join(inputDir, _database2, "".concat(_database2, ".json"));
          _context.prev = 71;
          _context.next = 74;
          return fs.readFile(filePath, 'utf-8');
        case 74:
          fileContent = _context.sent;
          expectedStructure = JSON.parse(fileContent);
          logger('Getting database structure for', _database2);
          _context.next = 79;
          return getDatabaseStructure(connection, _database2, command, options);
        case 79:
          currentStructure = _context.sent;
          logger('Database structure for', _database2, 'obtained');
          differences = findDifferences(expectedStructure, currentStructure);
          logger('Differences for', _database2, 'obtained');
          if (update) {
            _context.next = 88;
            break;
          }
          logger('Logging differences for', _database2);
          logDifferences(differences, _database2, true);
          _context.next = 93;
          break;
        case 88:
          logger('Logging differences for', _database2);
          logDifferences(differences, _database2, false);
          logger('Applying differences for', _database2);
          _context.next = 93;
          return applyDifferences(connection, _database2, differences);
        case 93:
          allDifferences[_database2] = differences;
          _context.next = 99;
          break;
        case 96:
          _context.prev = 96;
          _context.t2 = _context["catch"](71);
          logger("Error processing database ".concat(_database2, ":"), _context.t2.message);
        case 99:
          _context.next = 63;
          break;
        case 101:
          _context.next = 106;
          break;
        case 103:
          _context.prev = 103;
          _context.t3 = _context["catch"](61);
          _iterator3.e(_context.t3);
        case 106:
          _context.prev = 106;
          _iterator3.f();
          return _context.finish(106);
        case 109:
          return _context.abrupt("return", allDifferences);
        case 110:
        case "end":
          return _context.stop();
      }
    }, _callee, null, [[19, 30, 33, 36], [39, 51, 54, 57], [61, 103, 106, 109], [71, 96]]);
  }));
  return function compareAllDatabases(_x, _x2) {
    return _ref.apply(this, arguments);
  };
}();

var __filename = fileURLToPath(import.meta.url);
var __dirname$2 = dirname(__filename);
var setConfig = function setConfig(config, argv) {
  if (!config.host && argv.host) {
    config.host = argv.host;
  }
  if (!config.port && argv.port) {
    config.port = argv.port;
  }
  if (!config.user && argv.user) {
    config.user = argv.user;
  }
  if (!config.password && argv.password) {
    config.password = argv.password;
  }
  if (!config.output && argv.output !== '../db-dump') {
    config.output = argv.output;
  }
  return config;
};

// Create a function to get the package root directory that works in both ESM and CJS
var getPackageRoot = function getPackageRoot() {
  if (typeof __dirname$2 !== 'undefined') {
    // CommonJS
    return join(__dirname$2, '..');
  } else {
    // ESM
    var _filename = fileURLToPath(import.meta.url);
    var _dirname = dirname(_filename);
    return join(_dirname, '..');
  }
};

// Use the function to get the root path
var packageRoot = getPackageRoot();
var startApiServer = function startApiServer(port, argv) {
  var app = express();
  app.use(cors({
    origin: '*'
  }));
  var server = http.createServer(app);
  app.use(express.json({
    limit: '50mb'
  }));
  app.use(express.urlencoded({
    limit: '50mb',
    extended: true
  }));
  console.log("Serving UI from ".concat(join(packageRoot, 'ui/dist/spa')));
  app.use(express["static"](join(packageRoot, 'ui/dist/spa')));
  app.post('/api/getDatabasesFromExistingDumps', /*#__PURE__*/function () {
    var _ref = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee(req, res) {
      var config, databases;
      return _regeneratorRuntime().wrap(function _callee$(_context) {
        while (1) switch (_context.prev = _context.next) {
          case 0:
            config = req.body.config;
            config = setConfig(config, argv);
            _context.next = 4;
            return getDatabasesFromExistingDumps(config);
          case 4:
            databases = _context.sent;
            res.json(databases);
          case 6:
          case "end":
            return _context.stop();
        }
      }, _callee);
    }));
    return function (_x, _x2) {
      return _ref.apply(this, arguments);
    };
  }());

  // API endpoint to dump the database
  app.post('/api/dump', /*#__PURE__*/function () {
    var _ref2 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee3(req, res) {
      var _req$body, config, database, checker;
      return _regeneratorRuntime().wrap(function _callee3$(_context3) {
        while (1) switch (_context3.prev = _context3.next) {
          case 0:
            _req$body = req.body, config = _req$body.config, database = _req$body.database;
            config = setConfig(config, argv);
            checker = new DBStructureChecker(config, database);
            checker.connection.on('error', function (err) {
              console.error('Database connection error in route dump:', err);
              res.status(500).json({
                message: 'Database connection failed',
                error: err.message
              });
            });
            checker.connection.on('connect', /*#__PURE__*/_asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee2() {
              return _regeneratorRuntime().wrap(function _callee2$(_context2) {
                while (1) switch (_context2.prev = _context2.next) {
                  case 0:
                    console.log('Connected to the database');
                    checker.targetDatabase = database;
                    checker.command = 'dump';
                    checker.options = req.body;
                    _context2.prev = 4;
                    console.log('Dumping the database structure to files');
                    _context2.next = 8;
                    return dumpAllDatabases(checker.connection, 'dump', config);
                  case 8:
                    res.json({
                      message: 'Dump completed successfully'
                    });
                    _context2.next = 14;
                    break;
                  case 11:
                    _context2.prev = 11;
                    _context2.t0 = _context2["catch"](4);
                    res.status(500).json({
                      message: _context2.t0.message
                    });
                  case 14:
                    _context2.prev = 14;
                    _context2.next = 17;
                    return checker.closeConnection();
                  case 17:
                    return _context2.finish(14);
                  case 18:
                  case "end":
                    return _context2.stop();
                }
              }, _callee2, null, [[4, 11, 14, 18]]);
            })));
          case 5:
          case "end":
            return _context3.stop();
        }
      }, _callee3);
    }));
    return function (_x3, _x4) {
      return _ref2.apply(this, arguments);
    };
  }());

  // API endpoint to compare the database
  app.post('/api/compare', /*#__PURE__*/function () {
    var _ref4 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee5(req, res) {
      var _req$body2, config, database, checker;
      return _regeneratorRuntime().wrap(function _callee5$(_context5) {
        while (1) switch (_context5.prev = _context5.next) {
          case 0:
            _req$body2 = req.body, config = _req$body2.config, database = _req$body2.database;
            config = setConfig(config, argv);
            checker = new DBStructureChecker(config, database);
            checker.connection.on('error', function (err) {
              console.error('Database connection error in route compare:', err);
              res.status(500).json({
                message: 'Database connection failed',
                error: err.message
              });
            });
            checker.connection.on('connect', /*#__PURE__*/_asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee4() {
              var diffs;
              return _regeneratorRuntime().wrap(function _callee4$(_context4) {
                while (1) switch (_context4.prev = _context4.next) {
                  case 0:
                    console.log('Connected to the database');
                    checker.targetDatabase = config.database;
                    checker.command = 'compare';
                    checker.options = req.body;
                    _context4.prev = 4;
                    delete req.body.output;
                    console.log('Comparing the database structure with JSON dumps (dry run)');
                    _context4.next = 9;
                    return compareAllDatabases(checker.connection, config.output, false, 'compare', config);
                  case 9:
                    diffs = _context4.sent;
                    res.json(diffs);
                    _context4.next = 18;
                    break;
                  case 13:
                    _context4.prev = 13;
                    _context4.t0 = _context4["catch"](4);
                    console.log(_context4.t0);
                    console.log(req.body);
                    res.status(500).json({
                      message: _context4.t0.message
                    });
                  case 18:
                    _context4.prev = 18;
                    _context4.next = 21;
                    return checker.closeConnection();
                  case 21:
                    return _context4.finish(18);
                  case 22:
                  case "end":
                    return _context4.stop();
                }
              }, _callee4, null, [[4, 13, 18, 22]]);
            })));
          case 5:
          case "end":
            return _context5.stop();
        }
      }, _callee5);
    }));
    return function (_x5, _x6) {
      return _ref4.apply(this, arguments);
    };
  }());

  // API endpoint to apply differences
  app.post('/api/apply', /*#__PURE__*/function () {
    var _ref6 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee7(req, res) {
      var _req$body3, config, database, diffs, checker;
      return _regeneratorRuntime().wrap(function _callee7$(_context7) {
        while (1) switch (_context7.prev = _context7.next) {
          case 0:
            _req$body3 = req.body, config = _req$body3.config, database = _req$body3.database, diffs = _req$body3.diffs;
            config = setConfig(config, argv);
            console.log('Applying differences:', diffs);
            checker = new DBStructureChecker(config, database);
            checker.connection.on('error', function (err) {
              console.error('Database connection error in route apply:', err);
              res.status(500).json({
                message: 'Database connection failed',
                error: err.message
              });
            });
            checker.connection.on('connect', /*#__PURE__*/_asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee6() {
              return _regeneratorRuntime().wrap(function _callee6$(_context6) {
                while (1) switch (_context6.prev = _context6.next) {
                  case 0:
                    console.log('Connected to the database');
                    checker.targetDatabase = database;
                    checker.command = 'apply';
                    checker.options = req.body;
                    _context6.prev = 4;
                    console.log('Applying the database structure based on JSON dumps');
                    _context6.next = 8;
                    return applyDifferences(checker.connection, database, diffs);
                  case 8:
                    res.json({
                      message: 'Apply completed successfully'
                    });
                    _context6.next = 14;
                    break;
                  case 11:
                    _context6.prev = 11;
                    _context6.t0 = _context6["catch"](4);
                    res.status(500).json({
                      message: _context6.t0.message
                    });
                  case 14:
                    _context6.prev = 14;
                    _context6.next = 17;
                    return checker.closeConnection();
                  case 17:
                    return _context6.finish(14);
                  case 18:
                  case "end":
                    return _context6.stop();
                }
              }, _callee6, null, [[4, 11, 14, 18]]);
            })));
          case 6:
          case "end":
            return _context7.stop();
        }
      }, _callee7);
    }));
    return function (_x7, _x8) {
      return _ref6.apply(this, arguments);
    };
  }());
  app.post('/api/browse-folders', /*#__PURE__*/function () {
    var _ref8 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee8(req, res) {
      var _req$body$currentPath, currentPath, resolvedPath, contents, items, sortedItems;
      return _regeneratorRuntime().wrap(function _callee8$(_context8) {
        while (1) switch (_context8.prev = _context8.next) {
          case 0:
            _context8.prev = 0;
            _req$body$currentPath = req.body.currentPath, currentPath = _req$body$currentPath === undefined ? packageRoot : _req$body$currentPath;
            console.log('Browsing folder:', currentPath);
            resolvedPath = currentPath.startsWith('/') || currentPath.match(/^[A-Z]:\\/) ? resolve(currentPath) : resolve(currentPath);
            console.log('Resolved path:', resolvedPath);
            _context8.next = 7;
            return readdir(resolvedPath, {
              withFileTypes: true
            });
          case 7:
            contents = _context8.sent;
            // Separate directories and files
            items = contents.map(function (dirent) {
              return {
                name: dirent.name,
                path: join(resolvedPath, dirent.name),
                isDirectory: dirent.isDirectory(),
                isParent: false
              };
            }); // Sort items: directories first, then files, both alphabetically
            sortedItems = items.sort(function (a, b) {
              if (a.isDirectory === b.isDirectory) {
                return a.name.localeCompare(b.name);
              }
              return a.isDirectory ? -1 : 1;
            }); // Add parent directory option if not at root
            if (resolvedPath !== resolve(resolvedPath, '..')) {
              sortedItems.unshift({
                name: '..',
                path: resolve(resolvedPath, '..'),
                isDirectory: true,
                isParent: true
              });
            }
            res.json({
              currentPath: resolvedPath,
              items: sortedItems
            });
            _context8.next = 17;
            break;
          case 14:
            _context8.prev = 14;
            _context8.t0 = _context8["catch"](0);
            res.status(500).json({
              error: _context8.t0.message
            });
          case 17:
          case "end":
            return _context8.stop();
        }
      }, _callee8, null, [[0, 14]]);
    }));
    return function (_x9, _x10) {
      return _ref8.apply(this, arguments);
    };
  }());
  app.post('/api/create-folder', /*#__PURE__*/function () {
    var _ref9 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee9(req, res) {
      var folderPath, resolvedPath;
      return _regeneratorRuntime().wrap(function _callee9$(_context9) {
        while (1) switch (_context9.prev = _context9.next) {
          case 0:
            _context9.prev = 0;
            folderPath = req.body.folderPath;
            console.log('Creating folder:', folderPath);
            resolvedPath = folderPath.startsWith('/') || folderPath.match(/^[A-Z]:\\/) ? resolve(folderPath) : resolve(packageRoot, folderPath);
            _context9.next = 6;
            return mkdir(resolvedPath, {
              recursive: true
            });
          case 6:
            res.json({
              success: true,
              path: resolvedPath
            });
            _context9.next = 12;
            break;
          case 9:
            _context9.prev = 9;
            _context9.t0 = _context9["catch"](0);
            res.status(500).json({
              error: _context9.t0.message
            });
          case 12:
          case "end":
            return _context9.stop();
        }
      }, _callee9, null, [[0, 9]]);
    }));
    return function (_x11, _x12) {
      return _ref9.apply(this, arguments);
    };
  }());

  // Start the server
  server.listen(port, function () {
    console.log("Server is running on http://localhost:".concat(port));
  });
};

let isDockerCached;

function hasDockerEnv() {
	try {
		fs$1.statSync('/.dockerenv');
		return true;
	} catch {
		return false;
	}
}

function hasDockerCGroup() {
	try {
		return fs$1.readFileSync('/proc/self/cgroup', 'utf8').includes('docker');
	} catch {
		return false;
	}
}

function isDocker() {
	// TODO: Use `??=` when targeting Node.js 16.
	if (isDockerCached === undefined) {
		isDockerCached = hasDockerEnv() || hasDockerCGroup();
	}

	return isDockerCached;
}

let cachedResult;

// Podman detection
const hasContainerEnv = () => {
	try {
		fs$1.statSync('/run/.containerenv');
		return true;
	} catch {
		return false;
	}
};

function isInsideContainer() {
	// TODO: Use `??=` when targeting Node.js 16.
	if (cachedResult === undefined) {
		cachedResult = hasContainerEnv() || isDocker();
	}

	return cachedResult;
}

const isWsl = () => {
	if (process$1.platform !== 'linux') {
		return false;
	}

	if (os.release().toLowerCase().includes('microsoft')) {
		if (isInsideContainer()) {
			return false;
		}

		return true;
	}

	try {
		return fs$1.readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft')
			? !isInsideContainer() : false;
	} catch {
		return false;
	}
};

var isWsl$1 = process$1.env.__IS_WSL_TEST__ ? isWsl : isWsl();

function defineLazyProperty(object, propertyName, valueGetter) {
	const define = value => Object.defineProperty(object, propertyName, {value, enumerable: true, writable: true});

	Object.defineProperty(object, propertyName, {
		configurable: true,
		enumerable: true,
		get() {
			const result = valueGetter();
			define(result);
			return result;
		},
		set(value) {
			define(value);
		}
	});

	return object;
}

const execFileAsync$3 = promisify(execFile);

async function defaultBrowserId() {
	if (process$1.platform !== 'darwin') {
		throw new Error('macOS only');
	}

	const {stdout} = await execFileAsync$3('defaults', ['read', 'com.apple.LaunchServices/com.apple.launchservices.secure', 'LSHandlers']);

	// `(?!-)` is to prevent matching `LSHandlerRoleAll = "-";`.
	const match = /LSHandlerRoleAll = "(?!-)(?<id>[^"]+?)";\s+?LSHandlerURLScheme = (?:http|https);/.exec(stdout);

	return match?.groups.id ?? 'com.apple.Safari';
}

const execFileAsync$2 = promisify(execFile);

async function runAppleScript(script, {humanReadableOutput = true} = {}) {
	if (process$1.platform !== 'darwin') {
		throw new Error('macOS only');
	}

	const outputArguments = humanReadableOutput ? [] : ['-ss'];

	const {stdout} = await execFileAsync$2('osascript', ['-e', script, outputArguments]);
	return stdout.trim();
}

async function bundleName(bundleId) {
	return runAppleScript(`tell application "Finder" to set app_path to application file id "${bundleId}" as string\ntell application "System Events" to get value of property list item "CFBundleName" of property list file (app_path & ":Contents:Info.plist")`);
}

const execFileAsync$1 = promisify(execFile);

// Windows doesn't have browser IDs in the same way macOS/Linux does so we give fake
// ones that look real and match the macOS/Linux versions for cross-platform apps.
const windowsBrowserProgIds = {
	AppXq0fevzme2pys62n3e0fbqa7peapykr8v: {name: 'Edge', id: 'com.microsoft.edge.old'},
	MSEdgeDHTML: {name: 'Edge', id: 'com.microsoft.edge'}, // On macOS, it's "com.microsoft.edgemac"
	MSEdgeHTM: {name: 'Edge', id: 'com.microsoft.edge'}, // Newer Edge/Win10 releases
	'IE.HTTP': {name: 'Internet Explorer', id: 'com.microsoft.ie'},
	FirefoxURL: {name: 'Firefox', id: 'org.mozilla.firefox'},
	ChromeHTML: {name: 'Chrome', id: 'com.google.chrome'},
	BraveHTML: {name: 'Brave', id: 'com.brave.Browser'},
	BraveBHTML: {name: 'Brave Beta', id: 'com.brave.Browser.beta'},
	BraveSSHTM: {name: 'Brave Nightly', id: 'com.brave.Browser.nightly'},
};

class UnknownBrowserError extends Error {}

async function defaultBrowser$1(_execFileAsync = execFileAsync$1) {
	const {stdout} = await _execFileAsync('reg', [
		'QUERY',
		' HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice',
		'/v',
		'ProgId',
	]);

	const match = /ProgId\s*REG_SZ\s*(?<id>\S+)/.exec(stdout);
	if (!match) {
		throw new UnknownBrowserError(`Cannot find Windows browser in stdout: ${JSON.stringify(stdout)}`);
	}

	const {id} = match.groups;

	const browser = windowsBrowserProgIds[id];
	if (!browser) {
		throw new UnknownBrowserError(`Unknown browser ID: ${id}`);
	}

	return browser;
}

const execFileAsync = promisify(execFile);

// Inlined: https://github.com/sindresorhus/titleize/blob/main/index.js
const titleize = string => string.toLowerCase().replaceAll(/(?:^|\s|-)\S/g, x => x.toUpperCase());

async function defaultBrowser() {
	if (process$1.platform === 'darwin') {
		const id = await defaultBrowserId();
		const name = await bundleName(id);
		return {name, id};
	}

	if (process$1.platform === 'linux') {
		const {stdout} = await execFileAsync('xdg-mime', ['query', 'default', 'x-scheme-handler/http']);
		const id = stdout.trim();
		const name = titleize(id.replace(/.desktop$/, '').replace('-', ' '));
		return {name, id};
	}

	if (process$1.platform === 'win32') {
		return defaultBrowser$1();
	}

	throw new Error('Only macOS, Linux, and Windows are supported');
}

// Path to included `xdg-open`.
const __dirname$1 = path$1.dirname(fileURLToPath$1(import.meta.url));
const localXdgOpenPath = path$1.join(__dirname$1, 'xdg-open');

const {platform, arch} = process$1;

/**
Get the mount point for fixed drives in WSL.

@inner
@returns {string} The mount point.
*/
const getWslDrivesMountPoint = (() => {
	// Default value for "root" param
	// according to https://docs.microsoft.com/en-us/windows/wsl/wsl-config
	const defaultMountPoint = '/mnt/';

	let mountPoint;

	return async function () {
		if (mountPoint) {
			// Return memoized mount point value
			return mountPoint;
		}

		const configFilePath = '/etc/wsl.conf';

		let isConfigFileExists = false;
		try {
			await fs$2.access(configFilePath, constants.F_OK);
			isConfigFileExists = true;
		} catch {}

		if (!isConfigFileExists) {
			return defaultMountPoint;
		}

		const configContent = await fs$2.readFile(configFilePath, {encoding: 'utf8'});
		const configMountPoint = /(?<!#.*)root\s*=\s*(?<mountPoint>.*)/g.exec(configContent);

		if (!configMountPoint) {
			return defaultMountPoint;
		}

		mountPoint = configMountPoint.groups.mountPoint.trim();
		mountPoint = mountPoint.endsWith('/') ? mountPoint : `${mountPoint}/`;

		return mountPoint;
	};
})();

const pTryEach = async (array, mapper) => {
	let latestError;

	for (const item of array) {
		try {
			return await mapper(item); // eslint-disable-line no-await-in-loop
		} catch (error) {
			latestError = error;
		}
	}

	throw latestError;
};

const baseOpen = async options => {
	options = {
		wait: false,
		background: false,
		newInstance: false,
		allowNonzeroExitCode: false,
		...options,
	};

	if (Array.isArray(options.app)) {
		return pTryEach(options.app, singleApp => baseOpen({
			...options,
			app: singleApp,
		}));
	}

	let {name: app, arguments: appArguments = []} = options.app ?? {};
	appArguments = [...appArguments];

	if (Array.isArray(app)) {
		return pTryEach(app, appName => baseOpen({
			...options,
			app: {
				name: appName,
				arguments: appArguments,
			},
		}));
	}

	if (app === 'browser' || app === 'browserPrivate') {
		// IDs from default-browser for macOS and windows are the same
		const ids = {
			'com.google.chrome': 'chrome',
			'google-chrome.desktop': 'chrome',
			'org.mozilla.firefox': 'firefox',
			'firefox.desktop': 'firefox',
			'com.microsoft.msedge': 'edge',
			'com.microsoft.edge': 'edge',
			'microsoft-edge.desktop': 'edge',
		};

		// Incognito flags for each browser in `apps`.
		const flags = {
			chrome: '--incognito',
			firefox: '--private-window',
			edge: '--inPrivate',
		};

		const browser = await defaultBrowser();
		if (browser.id in ids) {
			const browserName = ids[browser.id];

			if (app === 'browserPrivate') {
				appArguments.push(flags[browserName]);
			}

			return baseOpen({
				...options,
				app: {
					name: apps[browserName],
					arguments: appArguments,
				},
			});
		}

		throw new Error(`${browser.name} is not supported as a default browser`);
	}

	let command;
	const cliArguments = [];
	const childProcessOptions = {};

	if (platform === 'darwin') {
		command = 'open';

		if (options.wait) {
			cliArguments.push('--wait-apps');
		}

		if (options.background) {
			cliArguments.push('--background');
		}

		if (options.newInstance) {
			cliArguments.push('--new');
		}

		if (app) {
			cliArguments.push('-a', app);
		}
	} else if (platform === 'win32' || (isWsl$1 && !isInsideContainer() && !app)) {
		const mountPoint = await getWslDrivesMountPoint();

		command = isWsl$1
			? `${mountPoint}c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`
			: `${process$1.env.SYSTEMROOT || process$1.env.windir || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell`;

		cliArguments.push(
			'-NoProfile',
			'-NonInteractive',
			'-ExecutionPolicy',
			'Bypass',
			'-EncodedCommand',
		);

		if (!isWsl$1) {
			childProcessOptions.windowsVerbatimArguments = true;
		}

		const encodedArguments = ['Start'];

		if (options.wait) {
			encodedArguments.push('-Wait');
		}

		if (app) {
			// Double quote with double quotes to ensure the inner quotes are passed through.
			// Inner quotes are delimited for PowerShell interpretation with backticks.
			encodedArguments.push(`"\`"${app}\`""`);
			if (options.target) {
				appArguments.push(options.target);
			}
		} else if (options.target) {
			encodedArguments.push(`"${options.target}"`);
		}

		if (appArguments.length > 0) {
			appArguments = appArguments.map(argument => `"\`"${argument}\`""`);
			encodedArguments.push('-ArgumentList', appArguments.join(','));
		}

		// Using Base64-encoded command, accepted by PowerShell, to allow special characters.
		options.target = Buffer.from(encodedArguments.join(' '), 'utf16le').toString('base64');
	} else {
		if (app) {
			command = app;
		} else {
			// When bundled by Webpack, there's no actual package file path and no local `xdg-open`.
			const isBundled = !__dirname$1 || __dirname$1 === '/';

			// Check if local `xdg-open` exists and is executable.
			let exeLocalXdgOpen = false;
			try {
				await fs$2.access(localXdgOpenPath, constants.X_OK);
				exeLocalXdgOpen = true;
			} catch {}

			const useSystemXdgOpen = process$1.versions.electron
				?? (platform === 'android' || isBundled || !exeLocalXdgOpen);
			command = useSystemXdgOpen ? 'xdg-open' : localXdgOpenPath;
		}

		if (appArguments.length > 0) {
			cliArguments.push(...appArguments);
		}

		if (!options.wait) {
			// `xdg-open` will block the process unless stdio is ignored
			// and it's detached from the parent even if it's unref'd.
			childProcessOptions.stdio = 'ignore';
			childProcessOptions.detached = true;
		}
	}

	if (platform === 'darwin' && appArguments.length > 0) {
		cliArguments.push('--args', ...appArguments);
	}

	// This has to come after `--args`.
	if (options.target) {
		cliArguments.push(options.target);
	}

	const subprocess = childProcess.spawn(command, cliArguments, childProcessOptions);

	if (options.wait) {
		return new Promise((resolve, reject) => {
			subprocess.once('error', reject);

			subprocess.once('close', exitCode => {
				if (!options.allowNonzeroExitCode && exitCode > 0) {
					reject(new Error(`Exited with code ${exitCode}`));
					return;
				}

				resolve(subprocess);
			});
		});
	}

	subprocess.unref();

	return subprocess;
};

const open = (target, options) => {
	if (typeof target !== 'string') {
		throw new TypeError('Expected a `target`');
	}

	return baseOpen({
		...options,
		target,
	});
};

function detectArchBinary(binary) {
	if (typeof binary === 'string' || Array.isArray(binary)) {
		return binary;
	}

	const {[arch]: archBinary} = binary;

	if (!archBinary) {
		throw new Error(`${arch} is not supported`);
	}

	return archBinary;
}

function detectPlatformBinary({[platform]: platformBinary}, {wsl}) {
	if (wsl && isWsl$1) {
		return detectArchBinary(wsl);
	}

	if (!platformBinary) {
		throw new Error(`${platform} is not supported`);
	}

	return detectArchBinary(platformBinary);
}

const apps = {};

defineLazyProperty(apps, 'chrome', () => detectPlatformBinary({
	darwin: 'google chrome',
	win32: 'chrome',
	linux: ['google-chrome', 'google-chrome-stable', 'chromium'],
}, {
	wsl: {
		ia32: '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
		x64: ['/mnt/c/Program Files/Google/Chrome/Application/chrome.exe', '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe'],
	},
}));

defineLazyProperty(apps, 'firefox', () => detectPlatformBinary({
	darwin: 'firefox',
	win32: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
	linux: 'firefox',
}, {
	wsl: '/mnt/c/Program Files/Mozilla Firefox/firefox.exe',
}));

defineLazyProperty(apps, 'edge', () => detectPlatformBinary({
	darwin: 'microsoft edge',
	win32: 'msedge',
	linux: ['microsoft-edge', 'microsoft-edge-dev'],
}, {
	wsl: '/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
}));

defineLazyProperty(apps, 'browser', () => 'browser');

defineLazyProperty(apps, 'browserPrivate', () => 'browserPrivate');

var DBStructureChecker = /*#__PURE__*/function () {
  function DBStructureChecker(config) {
    var targetDatabase = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;
    _classCallCheck(this, DBStructureChecker);
    this.config = config;
    this.targetDatabase = targetDatabase;
    this.connection = mysql.createConnection(this.config);
    this.dumpAllDatabases = dumpAllDatabases;
    this.compareAllDatabases = compareAllDatabases;
    this.getDatabases = function () {
      fs$3.readFileSync(path.join(__dirname, 'databases.json'), 'utf8');
    };
    // this.connection.on('error', (err) => {
    //     this.emit('error', err);
    //     console.error('Database connection error:', err);
    // });
    this.connection.query = util.promisify(this.connection.query); // Promisify for async/await
  }
  return _createClass(DBStructureChecker, [{
    key: "reconnect",
    value: function () {
      var _reconnect = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee() {
        return _regeneratorRuntime().wrap(function _callee$(_context) {
          while (1) switch (_context.prev = _context.next) {
            case 0:
              this.connection = mysql.createConnection(this.config);
              this.connection.query = util.promisify(this.connection.query); // Promisify for async/await
              _context.next = 4;
              return this.connection.connect();
            case 4:
            case "end":
              return _context.stop();
          }
        }, _callee, this);
      }));
      function reconnect() {
        return _reconnect.apply(this, arguments);
      }
      return reconnect;
    }()
  }, {
    key: "closeConnection",
    value: function () {
      var _closeConnection = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee2() {
        return _regeneratorRuntime().wrap(function _callee2$(_context2) {
          while (1) switch (_context2.prev = _context2.next) {
            case 0:
              if (!(this.connection.state !== 'disconnected')) {
                _context2.next = 3;
                break;
              }
              _context2.next = 3;
              return this.connection.end();
            case 3:
            case "end":
              return _context2.stop();
          }
        }, _callee2, this);
      }));
      function closeConnection() {
        return _closeConnection.apply(this, arguments);
      }
      return closeConnection;
    }()
  }]);
}();
var compare = /*#__PURE__*/function () {
  var _ref = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee5(config, output) {
    return _regeneratorRuntime().wrap(function _callee5$(_context5) {
      while (1) switch (_context5.prev = _context5.next) {
        case 0:
          return _context5.abrupt("return", new Promise(/*#__PURE__*/function () {
            var _ref2 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee4(resolve, reject) {
              var checker;
              return _regeneratorRuntime().wrap(function _callee4$(_context4) {
                while (1) switch (_context4.prev = _context4.next) {
                  case 0:
                    _context4.prev = 0;
                    checker = new DBStructureChecker(config);
                    checker.connection.on('connect', /*#__PURE__*/_asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee3() {
                      var diffs;
                      return _regeneratorRuntime().wrap(function _callee3$(_context3) {
                        while (1) switch (_context3.prev = _context3.next) {
                          case 0:
                            _context3.next = 2;
                            return compareAllDatabases(checker.connection, output, false, 'compare', {
                              output: output
                            });
                          case 2:
                            diffs = _context3.sent;
                            resolve({
                              type: 'success',
                              diffs: diffs
                            });
                            _context3.next = 6;
                            return checker.closeConnection();
                          case 6:
                          case "end":
                            return _context3.stop();
                        }
                      }, _callee3);
                    })));
                    _context4.next = 10;
                    break;
                  case 5:
                    _context4.prev = 5;
                    _context4.t0 = _context4["catch"](0);
                    reject({
                      type: 'error',
                      error: _context4.t0.message
                    });
                    _context4.next = 10;
                    return checker.closeConnection();
                  case 10:
                  case "end":
                    return _context4.stop();
                }
              }, _callee4, null, [[0, 5]]);
            }));
            return function (_x3, _x4) {
              return _ref2.apply(this, arguments);
            };
          }()));
        case 1:
        case "end":
          return _context5.stop();
      }
    }, _callee5);
  }));
  return function compare(_x, _x2) {
    return _ref.apply(this, arguments);
  };
}();
var apply = /*#__PURE__*/function () {
  var _ref4 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee8(config, database, diffs) {
    return _regeneratorRuntime().wrap(function _callee8$(_context8) {
      while (1) switch (_context8.prev = _context8.next) {
        case 0:
          return _context8.abrupt("return", new Promise(function (resolve, reject) {
            var checker;
            try {
              checker = new DBStructureChecker(config, database);
              checker.connection.on('error', /*#__PURE__*/function () {
                var _ref5 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee6(err) {
                  return _regeneratorRuntime().wrap(function _callee6$(_context6) {
                    while (1) switch (_context6.prev = _context6.next) {
                      case 0:
                        console.error('Database connection error in route apply:', err);
                        reject({
                          type: 'error',
                          error: err.message
                        });
                        _context6.next = 4;
                        return checker.closeConnection();
                      case 4:
                      case "end":
                        return _context6.stop();
                    }
                  }, _callee6);
                }));
                return function (_x8) {
                  return _ref5.apply(this, arguments);
                };
              }());
              checker.connection.on('connect', /*#__PURE__*/_asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee7() {
                return _regeneratorRuntime().wrap(function _callee7$(_context7) {
                  while (1) switch (_context7.prev = _context7.next) {
                    case 0:
                      console.log('Connected to the database');
                      checker.targetDatabase = database;
                      checker.command = 'apply';
                      checker.options = {
                        config: config,
                        database: database,
                        diffs: diffs
                      };
                      _context7.prev = 4;
                      console.log('Applying the database structure based on JSON dumps');
                      _context7.next = 8;
                      return applyDifferences(checker.connection, database, diffs);
                    case 8:
                      resolve({
                        type: 'success',
                        message: 'Apply completed successfully'
                      });
                      _context7.next = 11;
                      return checker.closeConnection();
                    case 11:
                      _context7.next = 18;
                      break;
                    case 13:
                      _context7.prev = 13;
                      _context7.t0 = _context7["catch"](4);
                      reject({
                        type: 'error',
                        error: _context7.t0.message
                      });
                      _context7.next = 18;
                      return checker.closeConnection();
                    case 18:
                    case "end":
                      return _context7.stop();
                  }
                }, _callee7, null, [[4, 13]]);
              })));
            } catch (e) {
              reject({
                type: 'error',
                error: e.message
              });
            }
          }));
        case 1:
        case "end":
          return _context8.stop();
      }
    }, _callee8);
  }));
  return function apply(_x5, _x6, _x7) {
    return _ref4.apply(this, arguments);
  };
}();

// Only run this if this is the main module
var isMain = function () {
  try {
    // console.log('Checking if this is the main module');
    // console.log(require.main === module)
    // console.log(require.main);
    return require.main === module;
  } catch (e) {
    return false;
  }
}();
if (isMain) {
  _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee10() {
    var _cli, command, config, argv, PORT, checker;
    return _regeneratorRuntime().wrap(function _callee10$(_context10) {
      while (1) switch (_context10.prev = _context10.next) {
        case 0:
          _cli = cli(), command = _cli.command, config = _cli.config, argv = _cli.argv;
          console.log("MySQLsyncr started via command line");
          if (!(command === 'ui')) {
            _context10.next = 12;
            break;
          }
          PORT = argv.uiPort;
          startApiServer(PORT, argv); // Start the Socket.IO server
          console.log('Server started on port', PORT);
          console.log('Open http://localhost:' + PORT + ' in your browser to use the UI');
          if (!(argv.openUI && argv.openUI === true || argv.openUI === 'true')) {
            _context10.next = 10;
            break;
          }
          _context10.next = 10;
          return open("http://localhost:".concat(PORT));
        case 10:
          _context10.next = 14;
          break;
        case 12:
          // Handle other commands (dump, compare, update) as before
          checker = new DBStructureChecker(config, argv.database);
          checker.connection.on('connect', /*#__PURE__*/_asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee9() {
            var diffs, totalDiffs, _totalDiffs, previousDiffs, runCount, maxRuns, _diffs;
            return _regeneratorRuntime().wrap(function _callee9$(_context9) {
              while (1) switch (_context9.prev = _context9.next) {
                case 0:
                  console.log('Connected to the database');
                  checker.targetDatabase = argv.database;
                  checker.command = command;
                  checker.options = argv;
                  _context9.prev = 4;
                  if (!(command === 'dump')) {
                    _context9.next = 11;
                    break;
                  }
                  console.log('Dumping the database structure to files');
                  _context9.next = 9;
                  return dumpAllDatabases(checker.connection, command, argv);
                case 9:
                  _context9.next = 42;
                  break;
                case 11:
                  if (!(command === 'compare')) {
                    _context9.next = 21;
                    break;
                  }
                  console.log('Comparing the database structure with JSON dumps (dry run)');
                  _context9.next = 15;
                  return compareAllDatabases(checker.connection, argv.output, false, command, argv);
                case 15:
                  diffs = _context9.sent;
                  // Dry run
                  totalDiffs = Object.values(diffs).reduce(function (acc, arr) {
                    return acc + arr.length;
                  }, 0);
                  console.log('Total differences count:', totalDiffs);
                  fs$3.writeFileSync(path.join(argv.output, 'diffs.json'), JSON.stringify(diffs, null, 4));
                  _context9.next = 42;
                  break;
                case 21:
                  if (!(command === 'update')) {
                    _context9.next = 42;
                    break;
                  }
                  console.log('Updating the database structure based on JSON dumps');
                  _totalDiffs = Infinity; // Initialize with a large number
                  previousDiffs = _totalDiffs; // Store previous differences
                  runCount = 0; // Counter for the number of runs
                  maxRuns = 6;
                case 27:
                  if (!(runCount < maxRuns && _totalDiffs > 0 && (_totalDiffs < previousDiffs || previousDiffs === Infinity))) {
                    _context9.next = 42;
                    break;
                  }
                  console.log('Running update command. Run count:', runCount);
                  _context9.next = 31;
                  return compareAllDatabases(checker.connection, argv.output, true, command, argv);
                case 31:
                  _diffs = _context9.sent;
                  // Apply updates
                  previousDiffs = _totalDiffs; // Update previous differences
                  _totalDiffs = Object.values(_diffs).reduce(function (acc, arr) {
                    return acc + arr.length;
                  }, 0);
                  console.log('Total differences count:', _totalDiffs);
                  runCount++;
                  if (!(_totalDiffs > 0 && runCount < maxRuns)) {
                    _context9.next = 40;
                    break;
                  }
                  console.log('Total differences count is still greater than 0. Waiting 1 second before next run. Run count:', runCount);
                  _context9.next = 40;
                  return new Promise(function (resolve) {
                    return setTimeout(resolve, 1000);
                  });
                case 40:
                  _context9.next = 27;
                  break;
                case 42:
                  _context9.next = 47;
                  break;
                case 44:
                  _context9.prev = 44;
                  _context9.t0 = _context9["catch"](4);
                  console.error(_context9.t0.message);
                case 47:
                  _context9.prev = 47;
                  _context9.next = 50;
                  return checker.closeConnection();
                case 50:
                  return _context9.finish(47);
                case 51:
                case "end":
                  return _context9.stop();
              }
            }, _callee9, null, [[4, 44, 47, 51]]);
          })));
        case 14:
        case "end":
          return _context10.stop();
      }
    }, _callee10);
  }))();
}

export { DBStructureChecker, apply, compare, dumpAllDatabases, getDatabasesFromExistingDumps, startApiServer };
