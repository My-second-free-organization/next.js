(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push(["output/aaf3a_crates_turbopack-tests_tests_snapshot_comptime_cross-module_input_c931f804._.js",
"[project]/turbopack/crates/turbopack-tests/tests/snapshot/comptime/cross-module/input/other.js [test] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "IS_DEV",
    ()=>IS_DEV,
    "NO_CONSTANT",
    ()=>NO_CONSTANT,
    "SOME_VALUE",
    ()=>SOME_VALUE,
    "lower",
    ()=>lower
]);
const SOME_VALUE = 'x';
const node_env = ("TURBOPACK compile-time value", "development");
const development_ent = 'development';
const IS_DEV = node_env === development_ent;
const NO_CONSTANT = globalThis.foo;
const lower = 'lowercase';
}),
"[project]/turbopack/crates/turbopack-tests/tests/snapshot/comptime/cross-module/input/index.js [test] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([]);
var __TURBOPACK__imported__module__$5b$project$5d2f$turbopack$2f$crates$2f$turbopack$2d$tests$2f$tests$2f$snapshot$2f$comptime$2f$cross$2d$module$2f$input$2f$other$2e$js__$5b$test$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/turbopack/crates/turbopack-tests/tests/snapshot/comptime/cross-module/input/other.js [test] (ecmascript)");
;
if ("TURBOPACK compile-time truthy", 1) {
    console.log('x');
} else //TURBOPACK unreachable
;
console.log(("TURBOPACK compile-time value", "x"));
// --------------------------------------------------------------------------
if ("TURBOPACK compile-time truthy", 1) {
    console.log('x');
} else //TURBOPACK unreachable
;
console.log(("TURBOPACK compile-time value", true));
// --------------------------------------------------------------------------
if (__TURBOPACK__imported__module__$5b$project$5d2f$turbopack$2f$crates$2f$turbopack$2d$tests$2f$tests$2f$snapshot$2f$comptime$2f$cross$2d$module$2f$input$2f$other$2e$js__$5b$test$5d$__$28$ecmascript$29$__["NO_CONSTANT"]) {
    console.log('NO_CONSTANT 1');
} else {
    console.log('NO_CONSTANT 2');
}
console.log(__TURBOPACK__imported__module__$5b$project$5d2f$turbopack$2f$crates$2f$turbopack$2d$tests$2f$tests$2f$snapshot$2f$comptime$2f$cross$2d$module$2f$input$2f$other$2e$js__$5b$test$5d$__$28$ecmascript$29$__["NO_CONSTANT"]);
// --------------------------------------------------------------------------
if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
;
else {
    console.log('MISSING 2');
}
console.log(("TURBOPACK compile-time value", void 0));
}),
]);

//# sourceMappingURL=aaf3a_crates_turbopack-tests_tests_snapshot_comptime_cross-module_input_c931f804._.js.map