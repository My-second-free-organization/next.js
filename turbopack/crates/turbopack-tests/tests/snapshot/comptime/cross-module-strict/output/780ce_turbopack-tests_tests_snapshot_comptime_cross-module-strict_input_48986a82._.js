(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push(["output/780ce_turbopack-tests_tests_snapshot_comptime_cross-module-strict_input_48986a82._.js",
"[project]/turbopack/crates/turbopack-tests/tests/snapshot/comptime/cross-module-strict/input/other.js [test] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "NO_CONSTANT",
    ()=>NO_CONSTANT,
    "SOME_VALUE",
    ()=>SOME_VALUE
]);
'use turbopack constants';
const SOME_VALUE = 'x';
const NO_CONSTANT = globalThis.foo;
}),
"[project]/turbopack/crates/turbopack-tests/tests/snapshot/comptime/cross-module-strict/input/index.js [test] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([]);
var __TURBOPACK__imported__module__$5b$project$5d2f$turbopack$2f$crates$2f$turbopack$2d$tests$2f$tests$2f$snapshot$2f$comptime$2f$cross$2d$module$2d$strict$2f$input$2f$other$2e$js__$5b$test$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/turbopack/crates/turbopack-tests/tests/snapshot/comptime/cross-module-strict/input/other.js [test] (ecmascript)");
;
if ("TURBOPACK compile-time truthy", 1) {
    console.log('x');
} else //TURBOPACK unreachable
;
// --------------------------------------------------------------------------
if (__TURBOPACK__imported__module__$5b$project$5d2f$turbopack$2f$crates$2f$turbopack$2d$tests$2f$tests$2f$snapshot$2f$comptime$2f$cross$2d$module$2d$strict$2f$input$2f$other$2e$js__$5b$test$5d$__$28$ecmascript$29$__["NO_CONSTANT"]) {
    console.log('NO_CONSTANT 1');
} else {
    console.log('NO_CONSTANT 2');
}
console.log(__TURBOPACK__imported__module__$5b$project$5d2f$turbopack$2f$crates$2f$turbopack$2d$tests$2f$tests$2f$snapshot$2f$comptime$2f$cross$2d$module$2d$strict$2f$input$2f$other$2e$js__$5b$test$5d$__$28$ecmascript$29$__["NO_CONSTANT"]);
// --------------------------------------------------------------------------
if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
;
else {
    console.log('MISSING 2');
}
console.log(("TURBOPACK compile-time value", void 0));
}),
]);

//# sourceMappingURL=780ce_turbopack-tests_tests_snapshot_comptime_cross-module-strict_input_48986a82._.js.map