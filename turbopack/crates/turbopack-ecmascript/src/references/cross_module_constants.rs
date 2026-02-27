use anyhow::{Context, Result, bail};
use parking_lot::Mutex;
use rustc_hash::FxHashMap;
use swc_core::common::{GLOBALS, source_map::SmallPos};
use tracing::instrument;
use turbo_rcstr::{RcStr, rcstr};
use turbo_tasks::{ResolvedVc, TryJoinIterExt, Vc};
use turbo_tasks_fs::FileSystemPath;
use turbopack_core::{
    compile_time_info::CompileTimeInfo,
    issue::{
        Issue, IssueExt, IssueSeverity, IssueSource, IssueStage, OptionIssueSource,
        OptionStyledString, StyledString,
    },
    module::Module,
    reference::ModuleReference,
    source::Source,
};

use crate::{
    AnalyzeMode, EcmascriptInputTransforms, EcmascriptModuleAssetType,
    analyzer::{
        ConstantValue, JsValue, ModuleValue, ObjectPart, builtin::replace_builtin,
        graph::create_graph, linker::link, well_known::replace_well_known,
    },
    parse::{ParseResult, parse},
    references::{early_value_visitor, esm::EsmAssetReference},
};

#[instrument(level = "info", skip_all, name = "determine cross-module constants")]
pub async fn module_value_to_constants_module(
    module_value: &ModuleValue,
    compile_time_info: Vc<CompileTimeInfo>,
    import_references: &[ResolvedVc<EsmAssetReference>],
) -> Result<Option<JsValue>> {
    if !module_value.analyze_for_constants {
        return Ok(None);
    }
    let Some(reference_idx) = module_value.reference else {
        bail!("missing reference for constant value");
    };

    let import_reference = import_references
        .get(reference_idx)
        .with_context(|| format!("couldn't find import reference at index {reference_idx}"))?;

    // We are reusing the exect resovle options from EsmAssetReference here, which is good and gives
    // us side-effect-free barrel file resolving for free, but this causes the module to be
    // unnecessarily analyzed by analyze_ecmascript_module, just for us to extract the source of the
    // module again.
    let resolved = import_reference.resolve_reference().await?;
    let resolved = resolved.primary_modules_ref().await?;
    let Some(module) = resolved.first() else {
        // failed to resolve, issue was already emitted by resolve_reference
        return Ok(None);
    };
    let Some(source) = &*module.source().await? else {
        // should never actually happen
        return Ok(None);
    };

    let constants = get_constants(**source, compile_time_info).await?;

    if let Some(constants) = &*constants {
        Ok(Some(JsValue::frozen_object(
            constants
                .iter()
                .map(|(key, value)| {
                    ObjectPart::KeyValue(
                        JsValue::Constant(ConstantValue::Str(key.clone().into())),
                        if let Some(value) = value {
                            JsValue::Constant(value.clone())
                        } else {
                            JsValue::unknown_empty(false, "not a constant")
                        },
                    )
                })
                .collect(),
        )))
    } else {
        Ok(None)
    }
}

#[turbo_tasks::value(transparent)]
struct ConstantsModule(Option<Vec<(RcStr, Option<ConstantValue>)>>);

#[turbo_tasks::function]
pub async fn get_constants(
    source: ResolvedVc<Box<dyn Source>>,
    compile_time_info: Vc<CompileTimeInfo>,
) -> Result<Vc<ConstantsModule>> {
    let path = source.ident().path().await?;

    let result = &*parse(
        *source,
        if path.path.ends_with(".ts") {
            EcmascriptModuleAssetType::Typescript {
                tsx: false,
                analyze_types: false,
            }
        } else if path.path.ends_with(".tsx") {
            EcmascriptModuleAssetType::Typescript {
                tsx: true,
                analyze_types: false,
            }
        } else {
            EcmascriptModuleAssetType::Ecmascript
        },
        EcmascriptInputTransforms::empty(),
        false,
        false,
    )
    .await?;

    let ParseResult::Ok {
        program,
        eval_context,
        globals,
        ..
    } = result
    else {
        // The `parse` call has already emitted parse issues in case of `ParseResult::Unparsable`
        return Ok(Vc::cell(None));
    };

    let var_graph = {
        let _span = tracing::trace_span!("analyze variable values").entered();
        GLOBALS.set(globals, || {
            create_graph(program, eval_context, AnalyzeMode::Tracing)
        })
    };

    let fun_args_values = Mutex::new(FxHashMap::default());
    let var_cache = Mutex::new(FxHashMap::default());

    let compile_time_info_ref = compile_time_info.await?;

    let mut exports: Vec<(RcStr, Option<ConstantValue>)> = var_graph
        .exports
        .iter()
        .map(async |(export_name, (binding, span))| {
            let value = var_graph
                .values
                .get(binding)
                .with_context(|| format!("couldn't find constant binding: {export_name}"))?;

            let linked_value = link(
                &var_graph,
                value.value.clone(),
                &early_value_visitor,
                &async |v| {
                    if let Some((name, _)) = v.get_definable_name(Some(&var_graph))
                        && let Some(value) = compile_time_info_ref.defines.get(&name).await?
                    {
                        return Ok(((&*value).try_into()?, true));
                    }

                    let (mut v, mut modified) =
                        replace_well_known(v, compile_time_info, false).await?;
                    modified = replace_builtin(&mut v) || modified;
                    modified = modified || v.make_nested_operations_unknown();
                    Ok((v, modified))
                },
                &fun_args_values,
                &var_cache,
            )
            .await?;

            if let JsValue::Constant(constant) = linked_value.0 {
                Ok((export_name.as_str().into(), Some(constant)))
            } else {
                NonConstantIssue {
                    export: export_name.as_str().into(),
                    source: IssueSource::from_swc_offsets(
                        source,
                        span.lo.to_u32(),
                        span.hi.to_u32(),
                    ),
                    value: linked_value.0.explain(10, 5).0,
                }
                .resolved_cell()
                .emit();
                Ok((export_name.as_str().into(), None))
            }
        })
        .try_join()
        .await?;
    exports.sort_unstable_by(|(a, _), (b, _)| a.cmp(b));

    println!("{} constant exports: {:#?}", path.path, exports);

    Ok(Vc::cell(Some(exports)))
}

#[turbo_tasks::value]
struct NonConstantIssue {
    export: RcStr,
    source: IssueSource,
    value: String,
}

#[turbo_tasks::value_impl]
impl Issue for NonConstantIssue {
    fn severity(&self) -> IssueSeverity {
        IssueSeverity::Error
    }

    #[turbo_tasks::function]
    fn title(&self) -> Result<Vc<StyledString>> {
        Ok(StyledString::Line(vec![
            StyledString::Text(rcstr!("Export ")),
            StyledString::Code(self.export.clone()),
            StyledString::Text(rcstr!(" is not a constant")),
        ])
        .cell())
    }

    #[turbo_tasks::function]
    fn stage(&self) -> Vc<IssueStage> {
        IssueStage::Analysis.cell()
    }

    #[turbo_tasks::function]
    fn file_path(&self) -> Vc<FileSystemPath> {
        self.source.file_path()
    }

    #[turbo_tasks::function]
    async fn description(&self) -> Result<Vc<OptionStyledString>> {
        Ok(Vc::cell(Some(
            StyledString::Line(vec![
                StyledString::Text(rcstr!("It was analyzed to be ")),
                StyledString::Code(self.value.clone().into()),
            ])
            .resolved_cell(),
        )))
    }

    #[turbo_tasks::function]
    fn source(&self) -> Vc<OptionIssueSource> {
        Vc::cell(Some(self.source))
    }
}
