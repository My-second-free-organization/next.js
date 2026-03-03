(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push(["output/780ce_turbopack-tests_tests_snapshot_comptime_cross-module-barrel_input_26b88884._.js",
"[project]/turbopack/crates/turbopack-tests/tests/snapshot/comptime/cross-module-barrel/input/library/constants.js [test] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "SOME_VALUE",
    ()=>SOME_VALUE
]);
const SOME_VALUE = 'x';
}),
"[project]/turbopack/crates/turbopack-tests/tests/snapshot/comptime/cross-module-barrel/input/library/runtime.js [test] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "foo",
    ()=>foo
]);
function foo() {
    return 123;
}
}),
"[project]/turbopack/crates/turbopack-tests/tests/snapshot/comptime/cross-module-barrel/input/index.js [test] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([]);
var __TURBOPACK__imported__module__$5b$project$5d2f$turbopack$2f$crates$2f$turbopack$2d$tests$2f$tests$2f$snapshot$2f$comptime$2f$cross$2d$module$2d$barrel$2f$input$2f$library$2f$constants$2e$js__$5b$test$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/turbopack/crates/turbopack-tests/tests/snapshot/comptime/cross-module-barrel/input/library/constants.js [test] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$turbopack$2f$crates$2f$turbopack$2d$tests$2f$tests$2f$snapshot$2f$comptime$2f$cross$2d$module$2d$barrel$2f$input$2f$library$2f$runtime$2e$js__$5b$test$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/turbopack/crates/turbopack-tests/tests/snapshot/comptime/cross-module-barrel/input/library/runtime.js [test] (ecmascript)");
;
// TODO ideally this would be inlined (reexport resolving with constants)
if (__TURBOPACK__imported__module__$5b$project$5d2f$turbopack$2f$crates$2f$turbopack$2d$tests$2f$tests$2f$snapshot$2f$comptime$2f$cross$2d$module$2d$barrel$2f$input$2f$library$2f$constants$2e$js__$5b$test$5d$__$28$ecmascript$29$__["SOME_VALUE"] === 'x') {
    console.log('x');
} else {
    (()=>{
        const e = new Error("Cannot find module './dead-code'");
        e.code = 'MODULE_NOT_FOUND';
        throw e;
    })();
}
console.log(__TURBOPACK__imported__module__$5b$project$5d2f$turbopack$2f$crates$2f$turbopack$2d$tests$2f$tests$2f$snapshot$2f$comptime$2f$cross$2d$module$2d$barrel$2f$input$2f$library$2f$constants$2e$js__$5b$test$5d$__$28$ecmascript$29$__["SOME_VALUE"]);
console.log((0, __TURBOPACK__imported__module__$5b$project$5d2f$turbopack$2f$crates$2f$turbopack$2d$tests$2f$tests$2f$snapshot$2f$comptime$2f$cross$2d$module$2d$barrel$2f$input$2f$library$2f$runtime$2e$js__$5b$test$5d$__$28$ecmascript$29$__["foo"])());
if ("TURBOPACK compile-time truthy", 1) {
    console.log('x');
} else //TURBOPACK unreachable
;
console.log(("TURBOPACK compile-time value", "barrel"));
}),
]);

//# sourceMappingURL=780ce_turbopack-tests_tests_snapshot_comptime_cross-module-barrel_input_26b88884._.js.map