use std::borrow::Cow;

use anyhow::Result;
use bincode::{Decode, Encode};
use either::Either;
use swc_core::{
    common::{DUMMY_SP, FileName, SourceMap, sync::Lrc},
    ecma::{
        ast::{
            ArrayLit, EsVersion, Expr, KeyValueProp, Lit, ObjectLit, Prop, PropName, PropOrSpread,
        },
        parser::{Syntax, parse_file_as_expr},
    },
    quote,
};
use turbo_rcstr::RcStr;
use turbo_tasks::{NonLocalValue, Vc, debug::ValueDebugFormat, trace::TraceRawVcs};
use turbopack_core::{chunk::ChunkingContext, compile_time_info::CompileTimeDefineValue};

use crate::{
    analyzer::{ConstantValue, JsValue, ObjectPart},
    code_gen::{CodeGen, CodeGeneration},
    create_visitor,
    references::AstPath,
};

#[derive(
    Clone, Debug, PartialEq, Eq, Hash, TraceRawVcs, ValueDebugFormat, NonLocalValue, Encode, Decode,
)]
enum JsValueOrParsableExpr {
    JsValue(JsValue),
    ParsableExpr(RcStr),
}

#[derive(
    Clone, Debug, PartialEq, Eq, Hash, TraceRawVcs, ValueDebugFormat, NonLocalValue, Encode, Decode,
)]
pub struct ConstantValueCodeGen {
    value: JsValueOrParsableExpr,
    path: AstPath,
}

impl ConstantValueCodeGen {
    pub fn new(value: CompileTimeDefineValue, path: AstPath) -> Self {
        ConstantValueCodeGen {
            value: compile_time_define_to_js_value(value),
            path,
        }
    }
    pub fn new_jsvalue(value: ConstantValue, path: AstPath) -> Self {
        ConstantValueCodeGen {
            value: JsValueOrParsableExpr::JsValue(JsValue::Constant(value)),
            path,
        }
    }
    pub async fn code_generation(
        &self,
        _chunking_context: Vc<Box<dyn ChunkingContext>>,
    ) -> Result<CodeGeneration> {
        let value = self.value.clone();

        let visitor = create_visitor!(self.path, visit_mut_expr, |expr: &mut Expr| {
            *expr = js_value_to_expr(match &value {
                JsValueOrParsableExpr::JsValue(js_value) => Either::Left(Cow::Borrowed(js_value)),
                JsValueOrParsableExpr::ParsableExpr(s) => Either::Right(s),
            });
        });

        Ok(CodeGeneration::visitors(vec![visitor]))
    }
}

impl From<ConstantValueCodeGen> for CodeGen {
    fn from(val: ConstantValueCodeGen) -> Self {
        CodeGen::ConstantValueCodeGen(val)
    }
}

fn compile_time_define_to_js_value(value: CompileTimeDefineValue) -> JsValueOrParsableExpr {
    JsValueOrParsableExpr::JsValue(match value {
        CompileTimeDefineValue::Null => JsValue::Constant(ConstantValue::Null),
        CompileTimeDefineValue::Undefined => JsValue::Constant(ConstantValue::Undefined),
        CompileTimeDefineValue::Bool(false) => JsValue::Constant(ConstantValue::False),
        CompileTimeDefineValue::Bool(true) => JsValue::Constant(ConstantValue::True),
        CompileTimeDefineValue::Number(s) => {
            JsValue::Constant(ConstantValue::Num(s.parse::<f64>().unwrap().into()))
        }
        CompileTimeDefineValue::String(s) => JsValue::Constant(ConstantValue::Str(s.into())),
        CompileTimeDefineValue::Array(items) => JsValue::frozen_array(
            items
                .into_iter()
                .map(compile_time_define_to_js_value)
                .map(|v| match v {
                    JsValueOrParsableExpr::JsValue(js_value) => js_value,
                    JsValueOrParsableExpr::ParsableExpr(_) => panic!(
                        "unexpected parsable expr in compile-time define array value: {:?}",
                        v
                    ),
                })
                .collect(),
        ),
        CompileTimeDefineValue::Object(items) => JsValue::frozen_object(
            items
                .into_iter()
                .map(|(k, v)| {
                    let value = compile_time_define_to_js_value(v);
                    ObjectPart::KeyValue(
                        k.into(),
                        match value {
                            JsValueOrParsableExpr::JsValue(js_value) => js_value,
                            JsValueOrParsableExpr::ParsableExpr(_) => panic!(
                                "unexpected parsable expr in compile-time define object value: \
                                 {:?}",
                                value
                            ),
                        },
                    )
                })
                .collect(),
        ),
        CompileTimeDefineValue::Evaluate(s) => {
            return JsValueOrParsableExpr::ParsableExpr(s);
        }
    })
}

fn js_value_to_expr(value: Either<Cow<'_, JsValue>, &RcStr>) -> Expr {
    match value {
        Either::Left(value) => match &*value {
            JsValue::Constant(ConstantValue::Undefined) => {
                quote!("(\"TURBOPACK compile-time value\", void 0)" as Expr)
            }
            JsValue::Constant(ConstantValue::Null) => {
                quote!("(\"TURBOPACK compile-time value\", null)" as Expr)
            }
            JsValue::Constant(ConstantValue::True) => {
                quote!("(\"TURBOPACK compile-time value\", true)" as Expr)
            }
            JsValue::Constant(ConstantValue::False) => {
                quote!("(\"TURBOPACK compile-time value\", false)" as Expr)
            }
            JsValue::Constant(ConstantValue::Num(n)) => {
                quote!("(\"TURBOPACK compile-time value\", $e)" as Expr, e: Expr = n.0.into())
            }
            JsValue::Constant(ConstantValue::Str(s)) => {
                quote!("(\"TURBOPACK compile-time value\", $e)" as Expr, e: Expr = s.as_str().into())
            }
            JsValue::Array { items, .. } => {
                quote!("(\"TURBOPACK compile-time value\", $e)" as Expr, e: Expr = Expr::Array(ArrayLit {
                    span: DUMMY_SP,
                    elems: items.iter().map(|i| Some(js_value_to_expr(Either::Left(Cow::Borrowed(i))).into())).collect(),
                }))
            }
            JsValue::Object { parts, .. } => {
                let e = Expr::Object(ObjectLit {
                    span: DUMMY_SP,
                    props: parts
                        .iter()
                        .map(|p| match p {
                            ObjectPart::KeyValue(k, v) => PropOrSpread::Prop(
                                Prop::KeyValue(KeyValueProp {
                                    key: match js_value_to_expr(Either::Left(Cow::Borrowed(k))) {
                                        Expr::Lit(Lit::Str(s)) => PropName::Str(s),
                                        Expr::Lit(Lit::Num(n)) => PropName::Num(n.into()),
                                        _ => panic!(
                                            "unexpected value for compile-time define object key: \
                                             {}",
                                            k
                                        ),
                                    },
                                    value: js_value_to_expr(Either::Left(Cow::Borrowed(v))).into(),
                                })
                                .into(),
                            ),
                            ObjectPart::Spread(_) => {
                                panic!(
                                    "unexpected spread variant for compile-time define value: {}",
                                    value
                                );
                            }
                        })
                        .collect(),
                });
                quote!("(\"TURBOPACK compile-time value\", $e)" as Expr, e: Expr = e)
            }
            _ => {
                panic!(
                    "unexpected JsValue variant for compile-time define value: {}",
                    value
                );
            }
        },

        Either::Right(s) => parse_single_expr_lit(s),
    }
}

pub(crate) fn parse_single_expr_lit(expr_lit: &RcStr) -> Expr {
    let cm = Lrc::new(SourceMap::default());
    let fm = cm.new_source_file(FileName::Anon.into(), expr_lit.clone());
    parse_file_as_expr(
        &fm,
        Syntax::Es(Default::default()),
        EsVersion::latest(),
        None,
        &mut vec![],
    )
    .map_or(
        quote!("(\"Failed parsed TURBOPACK compile-time value\", $s)" as Expr, s: Expr = expr_lit.as_str().into()),
        |expr| quote!("(\"TURBOPACK compile-time value\", $e)" as Expr, e: Expr = *expr),
    )
}
