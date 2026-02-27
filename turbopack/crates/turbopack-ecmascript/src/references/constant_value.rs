use std::borrow::Cow;

use anyhow::Result;
use bincode::{Decode, Encode};
use either::Either;
use swc_core::{
    common::{DUMMY_SP, FileName, SourceMap, sync::Lrc},
    ecma::{
        ast::{ArrayLit, EsVersion, Expr, KeyValueProp, ObjectLit, Prop, PropName, Str},
        parser::{Syntax, parse_file_as_expr},
    },
    quote,
};
use turbo_rcstr::RcStr;
use turbo_tasks::{NonLocalValue, Vc, debug::ValueDebugFormat, trace::TraceRawVcs};
use turbopack_core::{chunk::ChunkingContext, compile_time_info::CompileTimeDefineValue};

use crate::{
    analyzer::ConstantValue,
    code_gen::{CodeGen, CodeGeneration},
    create_visitor,
    references::AstPath,
};

#[derive(
    Clone, Debug, PartialEq, Eq, Hash, TraceRawVcs, ValueDebugFormat, NonLocalValue, Encode, Decode,
)]
enum ConstantValueOrCompileTimeDefineValue {
    Constant(ConstantValue),
    Define(CompileTimeDefineValue),
}

#[derive(
    Clone, Debug, PartialEq, Eq, Hash, TraceRawVcs, ValueDebugFormat, NonLocalValue, Encode, Decode,
)]
pub struct ConstantValueCodeGen {
    value: ConstantValueOrCompileTimeDefineValue,
    path: AstPath,
}

impl ConstantValueCodeGen {
    pub fn new(value: CompileTimeDefineValue, path: AstPath) -> Self {
        ConstantValueCodeGen {
            value: ConstantValueOrCompileTimeDefineValue::Define(value),
            path,
        }
    }
    pub fn new_constant(value: ConstantValue, path: AstPath) -> Self {
        ConstantValueCodeGen {
            value: ConstantValueOrCompileTimeDefineValue::Constant(value),
            path,
        }
    }
    pub async fn code_generation(
        &self,
        _chunking_context: Vc<Box<dyn ChunkingContext>>,
    ) -> Result<CodeGeneration> {
        let value = self.value.clone();

        let visitor = create_visitor!(self.path, visit_mut_expr, |expr: &mut Expr| {
            *expr = value_to_expr(match &value {
                ConstantValueOrCompileTimeDefineValue::Constant(c) => Either::Left(c),
                ConstantValueOrCompileTimeDefineValue::Define(d) => Either::Right(d),
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
fn value_to_expr(value: Either<&ConstantValue, &CompileTimeDefineValue>) -> Expr {
    match value {
        Either::Right(CompileTimeDefineValue::Undefined)
        | Either::Left(ConstantValue::Undefined) => {
            quote!("(\"TURBOPACK compile-time value\", void 0)" as Expr)
        }
        Either::Right(CompileTimeDefineValue::Null) | Either::Left(ConstantValue::Null) => {
            quote!("(\"TURBOPACK compile-time value\", null)" as Expr)
        }
        Either::Right(CompileTimeDefineValue::Bool(true)) | Either::Left(ConstantValue::True) => {
            quote!("(\"TURBOPACK compile-time value\", true)" as Expr)
        }
        Either::Right(CompileTimeDefineValue::Bool(false)) | Either::Left(ConstantValue::False) => {
            quote!("(\"TURBOPACK compile-time value\", false)" as Expr)
        }

        Either::Right(CompileTimeDefineValue::Number(n)) => {
            quote!("(\"TURBOPACK compile-time value\", $e)" as Expr, e: Expr = n.parse::<f64>().unwrap().into())
        }
        Either::Left(ConstantValue::Num(n)) => {
            quote!("(\"TURBOPACK compile-time value\", $e)" as Expr, e: Expr = n.0.into())
        }

        Either::Right(CompileTimeDefineValue::String(s)) => {
            quote!("(\"TURBOPACK compile-time value\", $e)" as Expr, e: Expr = s.as_str().into())
        }
        Either::Left(ConstantValue::Str(s)) => {
            quote!("(\"TURBOPACK compile-time value\", $e)" as Expr, e: Expr = s.as_str().into())
        }

        Either::Right(CompileTimeDefineValue::Array(a)) => {
            quote!("(\"TURBOPACK compile-time value\", $e)" as Expr, e: Expr = Expr::Array(ArrayLit {
                span: DUMMY_SP,
                elems: a.into_iter().map(|i| Some(value_to_expr(Either::Right(i)).into())).collect(),
            }))
        }
        Either::Right(CompileTimeDefineValue::Object(m)) => {
            quote!("(\"TURBOPACK compile-time value\", $e)" as Expr, e: Expr = Expr::Object(ObjectLit {
                span: DUMMY_SP,
                props: m
                    .into_iter()
                    .map(|(k, v)| {
                        swc_core::ecma::ast::PropOrSpread::Prop(
                            Prop::KeyValue(KeyValueProp {
                                key: PropName::Str(Str::from(k.as_str())),
                                value: value_to_expr(Either::Right(v)).into(),
                            })
                            .into(),
                        )
                    })
                    .collect(),
            }))
        }
        Either::Right(CompileTimeDefineValue::Evaluate(s)) => parse_single_expr_lit(s),
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
