use std::{borrow::Cow, collections::BinaryHeap};

use roaring::RoaringBitmap;
use rustc_hash::FxHashSet;
use smallvec::SmallVec;

/// Configuration for the production merge algorithm.
pub struct MergeConfig {
    pub min_chunk_size: usize,
    pub max_chunk_count_per_group: usize,
    pub max_merge_chunk_size: usize,
}

/// A pre-grouped set of items ready for the merge algorithm.
/// This is what production.rs produces after its own grouping phase.
pub struct GroupInput {
    /// Total size of all items in this group.
    pub size: usize,
    /// The chunk groups bitmap for this group.
    pub chunk_groups: Option<Cow<'static, RoaringBitmap>>,
    /// Index of an associated batch group, if any.
    pub batch_group_id: Option<usize>,
}

/// Result: which input groups ended up merged together in each output chunk.
#[derive(Debug)]
pub struct MergedGroupInfo {
    /// Indices into the original groups array.
    pub group_indices: Vec<usize>,
    /// Total size of all groups in this chunk.
    pub total_size: usize,
    /// The resulting chunk groups bitmap.
    #[allow(dead_code)]
    pub chunk_groups: Option<RoaringBitmap>,
    /// Collected batch group IDs from all merged groups.
    pub batch_group_ids: SmallVec<[usize; 1]>,
}

/// A chunk item with its estimated size and chunk group membership.
/// This is a Vc-free representation used by the pure merge algorithm's test wrapper.
#[cfg(test)]
pub struct ChunkItemForMerging {
    /// Estimated size in bytes.
    pub size: usize,
    /// Which chunk groups this item belongs to, or None if unknown.
    pub chunk_groups: Option<RoaringBitmap>,
}

/// Result: which items ended up in each output chunk (used by `merge_chunks`).
#[cfg(test)]
#[derive(Debug)]
pub struct MergedChunkInfo {
    /// Indices into the original items array.
    pub item_indices: Vec<usize>,
    /// Total size of all items in this chunk.
    pub total_size: usize,
    /// The resulting chunk groups bitmap (intersection of all merged items' bitmaps).
    pub chunk_groups: Option<RoaringBitmap>,
}

/// Groups items by bitmap + merges small groups per the production heuristics.
///
/// Returns a list of merged chunk infos. Each info contains the indices of items
/// that should be placed together, along with the merged bitmap and total size.
///
/// When `min_chunk_size == 0 && max_chunk_count_per_group == 0`, each distinct
/// bitmap group becomes its own chunk (no merging).
#[cfg(test)]
pub fn merge_chunks(items: &[ChunkItemForMerging], config: &MergeConfig) -> Vec<MergedChunkInfo> {
    // Group items by their chunk groups bitmap.
    let mut groups: Vec<GroupInput> = Vec::new();
    let mut item_indices_per_group: Vec<Vec<usize>> = Vec::new();
    let mut bitmap_map: std::collections::HashMap<u64, usize> =
        std::collections::HashMap::default();

    for (idx, item) in items.iter().enumerate() {
        let hash = hash_bitmap(&item.chunk_groups);
        let group_idx = *bitmap_map.entry(hash).or_insert_with(|| {
            groups.push(GroupInput {
                size: 0,
                chunk_groups: item.chunk_groups.as_ref().map(|bm| Cow::Owned(bm.clone())),
                batch_group_id: None,
            });
            item_indices_per_group.push(Vec::new());
            groups.len() - 1
        });
        groups[group_idx].size += item.size;
        item_indices_per_group[group_idx].push(idx);
    }

    let merged = merge_grouped_chunks(groups, config);

    // Map group indices back to item indices
    merged
        .into_iter()
        .map(|mg| {
            let item_indices: Vec<usize> = mg
                .group_indices
                .iter()
                .flat_map(|&gi| item_indices_per_group[gi].iter().copied())
                .collect();
            MergedChunkInfo {
                item_indices,
                total_size: mg.total_size,
                chunk_groups: mg.chunk_groups,
            }
        })
        .collect()
}

/// Merges pre-grouped chunks using the production heuristics.
///
/// This is the core merge algorithm. It takes groups that have already been
/// grouped by their chunk-groups bitmap (as production.rs does via prehash)
/// and merges small groups together based on bitmap overlap and cost analysis.
///
/// Each `GroupInput` represents one bitmap group with its aggregate size.
/// Returns `MergedGroupInfo` items indicating which input groups were merged.
pub fn merge_grouped_chunks(groups: Vec<GroupInput>, config: &MergeConfig) -> Vec<MergedGroupInfo> {
    let MergeConfig {
        min_chunk_size,
        max_chunk_count_per_group,
        max_merge_chunk_size,
    } = *config;

    // Early exit: no merging needed
    if min_chunk_size == 0 && max_chunk_count_per_group == 0 {
        return groups
            .into_iter()
            .enumerate()
            .map(|(i, g)| MergedGroupInfo {
                group_indices: vec![i],
                total_size: g.size,
                chunk_groups: g.chunk_groups.map(|c| c.into_owned()),
                batch_group_ids: g.batch_group_id.into_iter().collect(),
            })
            .collect();
    }

    // Build a max-heap (largest first) of chunk candidates
    let mut heap: BinaryHeap<ChunkCandidate> = groups
        .into_iter()
        .enumerate()
        .map(|(i, g)| ChunkCandidate {
            size: g.size,
            group_indices: vec![i],
            batch_group_ids: g.batch_group_id.into_iter().collect(),
            chunk_groups: g.chunk_groups,
        })
        .collect();

    if min_chunk_size == 0 && max_chunk_count_per_group == 0 {
        return heap_to_output(heap);
    }

    let mut chunks_to_merge: BinaryHeap<MergeCandidate> = BinaryHeap::new();
    let mut chunks_to_merge_size = 0;

    // Determine chunks to merge: pop from heap while they're too small or there are too many
    loop {
        if let Some(smallest) = heap.peek() {
            let chunk_over_limit =
                max_merge_chunk_size != 0 && smallest.size > max_merge_chunk_size;
            if chunk_over_limit {
                break;
            }
            let merge_threshold = if min_chunk_size != 0 {
                min_chunk_size
            } else {
                smallest.size
            };
            let too_many_chunks = max_chunk_count_per_group != 0
                && heap.len() + chunks_to_merge_size / merge_threshold + 1
                    > max_chunk_count_per_group;
            let too_small_chunk = min_chunk_size != 0 && smallest.size < min_chunk_size;
            if too_many_chunks || too_small_chunk {
                let c = heap.pop().unwrap();
                chunks_to_merge_size += c.size;
                chunks_to_merge.push(MergeCandidate {
                    size: c.size,
                    group_indices: c.group_indices,
                    batch_group_ids: c.batch_group_ids,
                    chunk_groups: c.chunk_groups,
                });
                continue;
            }
        }
        break;
    }

    let merge_threshold = if min_chunk_size != 0 {
        min_chunk_size
    } else if let Some(smallest) = heap.peek() {
        smallest.size
    } else if let Some(merge_threshold) =
        chunks_to_merge_size.checked_div(max_chunk_count_per_group)
    {
        merge_threshold
    } else {
        unreachable!();
    };

    // Main merge loop
    while chunks_to_merge.len() > 1 {
        // Find best candidate
        let mut selection: Vec<MergeCandidate> = Vec::new();
        let mut best_combination: Option<(usize, usize, u64, i64)> = None;

        while let Some(candidate) = chunks_to_merge.pop() {
            // Exit early when no better overlaps are possible
            if let Some((_, _, best_overlap, _)) = best_combination.as_ref() {
                let candidate_best_possible_value = candidate.chunk_groups_len();

                /// Limit combinational complexity
                /// When we found a good merge combination we don't want to continue
                /// searching forever since the combinational complexity would be
                /// O(N^3). This limit makes it O(N * M * M) where M is the max
                /// combinational complexity. With a small and constant M this is
                /// effectively O(N).
                const MAX_COMBINATIONAL_COMPLEXITY: usize = 32;

                if *best_overlap > candidate_best_possible_value
                    || selection.len() > MAX_COMBINATIONAL_COMPLEXITY
                {
                    chunks_to_merge.push(candidate);
                    break;
                }
            }

            let is_big_candidate = candidate.size > merge_threshold;

            // Check all combinations with the new candidate
            for (i, other) in selection.iter().enumerate() {
                let overlap_val = overlap(&candidate.chunk_groups, &other.chunk_groups);
                // It need to have at least two chunk groups in common
                if overlap_val <= 1 {
                    continue;
                }
                // If the candidate is already big enough, avoid shrinking the sharing
                if is_big_candidate && overlap_val != candidate.chunk_groups_len() {
                    continue;
                }
                if other.size > merge_threshold && overlap_val != other.chunk_groups_len() {
                    continue;
                }
                let a_groups = candidate.chunk_groups_len() as i64;
                let a_size = candidate.size as i64;
                let b_groups = other.chunk_groups_len() as i64;
                let b_size = other.size as i64;
                let o_groups = overlap_val as i64;
                let groups = a_groups.max(b_groups);
                let a_rem = a_groups - o_groups;
                let b_rem = b_groups - o_groups;

                // It need to have some request count benefit
                if groups + o_groups <= 2 * (a_rem + b_rem) + 2 {
                    continue;
                }
                let rem_g = groups - 1;
                let c_req = 200000;
                // d3 = 3 * d
                let pre_d3 = c_req * (2 * rem_g + (5 * o_groups - 2 * a_groups - 2 * b_groups - 1))
                    - 2 * (a_rem * b_size + b_rem * a_size);
                // It need to have some runtime benefit of merging the chunks
                if pre_d3 < 0 {
                    continue;
                }
                let d3 = pre_d3 * o_groups / (rem_g * groups);
                let value = d3;

                if let Some((best_i1, best_i2, best_overlap, best_value)) =
                    best_combination.as_mut()
                {
                    if (overlap_val.cmp(best_overlap)).then_with(|| value.cmp(best_value))
                        == std::cmp::Ordering::Greater
                    {
                        *best_i1 = i;
                        *best_i2 = selection.len();
                        *best_overlap = overlap_val;
                        *best_value = value;
                    }
                } else {
                    best_combination = Some((i, selection.len(), overlap_val, value));
                }
            }
            selection.push(candidate);
        }

        let best_overlap_val = if let Some((best_i1, best_i2, best_overlap_val, _)) =
            best_combination.as_ref()
        {
            let other = selection.swap_remove(*best_i2);
            let mut candidate = selection.swap_remove(*best_i1);
            // Merge other into candidate
            candidate.size += other.size;
            candidate.group_indices.extend(other.group_indices);
            if other.batch_group_ids.len() + candidate.batch_group_ids.len() > 16 {
                let mut set: FxHashSet<usize> = candidate.batch_group_ids.iter().copied().collect();
                set.extend(other.batch_group_ids.iter().copied());
                candidate.batch_group_ids = set.into_iter().collect();
            } else {
                let mut bg = other.batch_group_ids;
                bg.retain(|b| !candidate.batch_group_ids.contains(b));
                candidate.batch_group_ids.extend(bg);
            }
            candidate.chunk_groups =
                merge_chunk_groups(&candidate.chunk_groups, &other.chunk_groups);

            // Merged candidate is pushed back into the queue
            chunks_to_merge.push(candidate);

            *best_overlap_val
        } else {
            u64::MAX
        };
        for unused in selection {
            // Candidates from selection that are already big enough move into the
            // heap again when no more merges are expected.
            // Since we can only merge into big enough candidates when overlap ==
            // chunk_groups_len we can use that as condition.
            if unused.size > merge_threshold && unused.chunk_groups_len() > best_overlap_val {
                heap.push(ChunkCandidate {
                    size: unused.size,
                    group_indices: unused.group_indices,
                    batch_group_ids: unused.batch_group_ids,
                    chunk_groups: unused.chunk_groups,
                });
            } else {
                chunks_to_merge.push(unused);
            }
        }
        if best_combination.is_none() {
            // No merges possible
            break;
        }
    }

    let mut remained_size = 0;
    let mut remained_group_indices = Vec::new();
    let mut remained_batch_group_ids = FxHashSet::default();
    for mc in chunks_to_merge.into_iter() {
        if mc.size > merge_threshold {
            heap.push(ChunkCandidate {
                size: mc.size,
                group_indices: mc.group_indices,
                batch_group_ids: mc.batch_group_ids,
                chunk_groups: mc.chunk_groups,
            });
        } else {
            remained_size += mc.size;
            remained_group_indices.extend(mc.group_indices);
            remained_batch_group_ids.extend(mc.batch_group_ids);
        }
    }

    // Left-over chunks are merged together forming the remainder chunk, which includes
    // all modules that are not sharable
    if !remained_group_indices.is_empty() {
        heap.push(ChunkCandidate {
            size: remained_size,
            group_indices: remained_group_indices,
            batch_group_ids: remained_batch_group_ids.into_iter().collect(),
            chunk_groups: None,
        });
    }

    heap_to_output(heap)
}

// --- Internal types and helpers ---

struct ChunkCandidate {
    size: usize,
    group_indices: Vec<usize>,
    batch_group_ids: SmallVec<[usize; 1]>,
    chunk_groups: Option<Cow<'static, RoaringBitmap>>,
}

impl Ord for ChunkCandidate {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.size.cmp(&other.size).reverse()
    }
}

impl PartialOrd for ChunkCandidate {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Eq for ChunkCandidate {}

impl PartialEq for ChunkCandidate {
    fn eq(&self, other: &Self) -> bool {
        self.size == other.size
    }
}

struct MergeCandidate {
    size: usize,
    group_indices: Vec<usize>,
    batch_group_ids: SmallVec<[usize; 1]>,
    chunk_groups: Option<Cow<'static, RoaringBitmap>>,
}

impl MergeCandidate {
    fn chunk_groups_len(&self) -> u64 {
        self.chunk_groups.as_ref().map_or(0, |cg| cg.len())
    }
}

impl Ord for MergeCandidate {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.chunk_groups_len()
            .cmp(&other.chunk_groups_len())
            .then_with(|| self.size.cmp(&other.size).reverse())
    }
}

impl PartialOrd for MergeCandidate {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Eq for MergeCandidate {}

impl PartialEq for MergeCandidate {
    fn eq(&self, other: &Self) -> bool {
        self.size == other.size
    }
}

fn overlap(a: &Option<Cow<'_, RoaringBitmap>>, b: &Option<Cow<'_, RoaringBitmap>>) -> u64 {
    if let (Some(a), Some(b)) = (a, b) {
        a.intersection_len(b)
    } else {
        0
    }
}

fn merge_chunk_groups(
    a: &Option<Cow<'_, RoaringBitmap>>,
    b: &Option<Cow<'_, RoaringBitmap>>,
) -> Option<Cow<'static, RoaringBitmap>> {
    if let (Some(a), Some(b)) = (a, b) {
        Some(Cow::Owned(a.as_ref() & b.as_ref()))
    } else {
        None
    }
}

#[cfg(test)]
fn hash_bitmap(bitmap: &Option<RoaringBitmap>) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = rustc_hash::FxHasher::default();
    match bitmap {
        None => 0u8.hash(&mut hasher),
        Some(bm) => {
            1u8.hash(&mut hasher);
            struct HasherWriter<'a, H: Hasher>(&'a mut H);
            impl<H: Hasher> std::io::Write for HasherWriter<'_, H> {
                fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
                    self.0.write(buf);
                    Ok(buf.len())
                }
                fn flush(&mut self) -> std::io::Result<()> {
                    Ok(())
                }
            }
            let _ = bm.serialize_into(HasherWriter(&mut hasher));
        }
    }
    hasher.finish()
}

fn heap_to_output(heap: BinaryHeap<ChunkCandidate>) -> Vec<MergedGroupInfo> {
    heap.into_iter()
        .map(|c| MergedGroupInfo {
            group_indices: c.group_indices,
            total_size: c.size,
            chunk_groups: c.chunk_groups.map(|c| c.into_owned()),
            batch_group_ids: c.batch_group_ids,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bitmap(bits: &[u32]) -> Option<RoaringBitmap> {
        let mut bm = RoaringBitmap::new();
        for &b in bits {
            bm.insert(b);
        }
        Some(bm)
    }

    fn production_config() -> MergeConfig {
        MergeConfig {
            min_chunk_size: 50_000,
            max_chunk_count_per_group: 40,
            max_merge_chunk_size: 200_000,
        }
    }

    /// Helper: check which output chunk(s) contain a given item index
    fn chunks_containing(results: &[MergedChunkInfo], item_idx: usize) -> Vec<usize> {
        results
            .iter()
            .enumerate()
            .filter(|(_, c)| c.item_indices.contains(&item_idx))
            .map(|(i, _)| i)
            .collect()
    }

    // -----------------------------------------------------------------------
    // Test 1: The exact vercel.com scenario
    // 18 modules with bitmap {0,1} + 1 module (360 bytes) with bitmap {0,1,2}
    // With min_chunk_size=50_000, both groups are below threshold (need merging).
    // The algorithm should merge them into a single chunk rather than creating
    // two near-identical chunks.
    // -----------------------------------------------------------------------
    #[test]
    fn test_near_duplicate_single_extra_module() {
        let mut items: Vec<ChunkItemForMerging> = Vec::new();

        // 18 modules each ~3.3KB, bitmap {0, 1}
        for _ in 0..18 {
            items.push(ChunkItemForMerging {
                size: 3_300,
                chunk_groups: bitmap(&[0, 1]),
            });
        }
        // 1 module, 360 bytes, bitmap {0, 1, 2}
        items.push(ChunkItemForMerging {
            size: 360,
            chunk_groups: bitmap(&[0, 1, 2]),
        });

        let config = production_config();
        let results = merge_chunks(&items, &config);

        // Both groups are below min_chunk_size (59400 + 360 < 50000 each individually
        // actually 18*3300=59400 > 50000 for the first group).
        // The first group (bitmap {0,1}) has size 59400 which is above 50000,
        // so it stays in the heap. The second group (bitmap {0,1,2}) has size 360
        // which is below 50000, so it goes to chunks_to_merge.
        // With only 1 item in chunks_to_merge, the merge loop doesn't run.
        // The 360-byte group ends up in the remainder chunk.

        // The extra module (index 18) should appear in exactly one chunk
        let extra_module_chunks = chunks_containing(&results, 18);
        assert_eq!(
            extra_module_chunks.len(),
            1,
            "Extra module should be in exactly one chunk, found in {:?}",
            extra_module_chunks,
        );

        // All items should appear in exactly one chunk
        for idx in 0..items.len() {
            let containing = chunks_containing(&results, idx);
            assert_eq!(
                containing.len(),
                1,
                "Item {} should be in exactly one chunk, but found in {:?}",
                idx,
                containing,
            );
        }
    }

    // -----------------------------------------------------------------------
    // Test 2: Large chunk with a tiny module
    // -----------------------------------------------------------------------
    #[test]
    fn test_large_chunk_with_tiny_module() {
        let mut items: Vec<ChunkItemForMerging> = Vec::new();

        // One large item (60KB), bitmap {0, 1}
        items.push(ChunkItemForMerging {
            size: 60_000,
            chunk_groups: bitmap(&[0, 1]),
        });
        // One tiny item (360 bytes), bitmap {0, 1, 2}
        items.push(ChunkItemForMerging {
            size: 360,
            chunk_groups: bitmap(&[0, 1, 2]),
        });

        let config = production_config();
        let results = merge_chunks(&items, &config);

        // Both items should appear in exactly one chunk each
        for idx in 0..items.len() {
            let containing = chunks_containing(&results, idx);
            assert_eq!(
                containing.len(),
                1,
                "Item {} should be in exactly one chunk, but found in {:?}",
                idx,
                containing,
            );
        }
    }

    // -----------------------------------------------------------------------
    // Test 3: Sibling pages sharing a layout
    // Layout modules (Header 30KB, Nav 25KB) in bitmap {0}
    // Shared lib (15KB) in bitmap {0, 1, 2}
    // Page A module (20KB) in {1}, Page B module (20KB) in {2}
    // -----------------------------------------------------------------------
    #[test]
    fn test_sibling_pages_shared_layout() {
        let items = vec![
            ChunkItemForMerging {
                size: 30_000,
                chunk_groups: bitmap(&[0]),
            }, // Header
            ChunkItemForMerging {
                size: 25_000,
                chunk_groups: bitmap(&[0]),
            }, // Nav
            ChunkItemForMerging {
                size: 15_000,
                chunk_groups: bitmap(&[0, 1, 2]),
            }, // Shared lib
            ChunkItemForMerging {
                size: 20_000,
                chunk_groups: bitmap(&[1]),
            }, // Page A
            ChunkItemForMerging {
                size: 20_000,
                chunk_groups: bitmap(&[2]),
            }, // Page B
        ];

        let config = production_config();
        let results = merge_chunks(&items, &config);

        // Each item should appear in exactly one chunk
        for idx in 0..items.len() {
            let containing = chunks_containing(&results, idx);
            assert_eq!(
                containing.len(),
                1,
                "Item {} should be in exactly one chunk, but found in {:?}",
                idx,
                containing,
            );
        }
    }

    // -----------------------------------------------------------------------
    // Test 4: Deep layout nesting
    // Root layout modules in {0, 1, 2}
    // Section layout modules in {1, 2}
    // Page module in {2}
    // Shared util in {0, 1, 2}
    // -----------------------------------------------------------------------
    #[test]
    fn test_deep_nesting() {
        let items = vec![
            ChunkItemForMerging {
                size: 40_000,
                chunk_groups: bitmap(&[0, 1, 2]),
            }, // Root header
            ChunkItemForMerging {
                size: 30_000,
                chunk_groups: bitmap(&[1, 2]),
            }, // Section nav
            ChunkItemForMerging {
                size: 20_000,
                chunk_groups: bitmap(&[2]),
            }, // Page content
            ChunkItemForMerging {
                size: 10_000,
                chunk_groups: bitmap(&[0, 1, 2]),
            }, // Shared util
        ];

        let config = production_config();
        let results = merge_chunks(&items, &config);

        // Each item should appear in exactly one chunk
        for idx in 0..items.len() {
            let containing = chunks_containing(&results, idx);
            assert_eq!(
                containing.len(),
                1,
                "Item {} should be in exactly one chunk, but found in {:?}",
                idx,
                containing,
            );
        }
    }

    // -----------------------------------------------------------------------
    // Test 5: Input order should not affect chunk assignments
    // -----------------------------------------------------------------------
    #[test]
    fn test_stable_output_regardless_of_input_order() {
        let make_items = |order: &[usize]| -> Vec<ChunkItemForMerging> {
            let base = vec![
                ChunkItemForMerging {
                    size: 30_000,
                    chunk_groups: bitmap(&[0, 1]),
                },
                ChunkItemForMerging {
                    size: 25_000,
                    chunk_groups: bitmap(&[0, 1]),
                },
                ChunkItemForMerging {
                    size: 20_000,
                    chunk_groups: bitmap(&[0]),
                },
                ChunkItemForMerging {
                    size: 15_000,
                    chunk_groups: bitmap(&[1]),
                },
            ];
            order
                .iter()
                .map(|&i| ChunkItemForMerging {
                    size: base[i].size,
                    chunk_groups: base[i].chunk_groups.clone(),
                })
                .collect()
        };

        let config = production_config();

        let results_a = merge_chunks(&make_items(&[0, 1, 2, 3]), &config);
        let results_b = merge_chunks(&make_items(&[3, 2, 1, 0]), &config);

        // Same number of output chunks
        assert_eq!(
            results_a.len(),
            results_b.len(),
            "Different input order produced different chunk count: {} vs {}",
            results_a.len(),
            results_b.len(),
        );
    }

    // -----------------------------------------------------------------------
    // Test 6: Characterize current behavior
    // Document what happens with the current algorithm so we can see improvements.
    // -----------------------------------------------------------------------
    #[test]
    fn test_characterize_current_behavior() {
        // Simulate a scenario with many small modules having slightly different bitmaps
        let mut items: Vec<ChunkItemForMerging> = Vec::new();

        // 10 modules shared by all 5 pages (bitmap {0,1,2,3,4})
        for _ in 0..10 {
            items.push(ChunkItemForMerging {
                size: 5_000,
                chunk_groups: bitmap(&[0, 1, 2, 3, 4]),
            });
        }

        // 1 module shared by only 4 of 5 pages (bitmap {0,1,2,3})
        items.push(ChunkItemForMerging {
            size: 400,
            chunk_groups: bitmap(&[0, 1, 2, 3]),
        });

        // 5 page-specific modules
        for i in 0..5 {
            items.push(ChunkItemForMerging {
                size: 10_000,
                chunk_groups: bitmap(&[i]),
            });
        }

        let config = production_config();
        let results = merge_chunks(&items, &config);

        // Basic invariant: every item appears in exactly one chunk
        for idx in 0..items.len() {
            let containing = chunks_containing(&results, idx);
            assert_eq!(
                containing.len(),
                1,
                "Item {} should be in exactly one chunk, but found in {:?}",
                idx,
                containing,
            );
        }

        // Total size across all chunks should equal total input size
        let total_input_size: usize = items.iter().map(|i| i.size).sum();
        let total_output_size: usize = results.iter().map(|c| c.total_size).sum();
        assert_eq!(total_input_size, total_output_size);
    }

    // -----------------------------------------------------------------------
    // Test 7: No merging when config has zero limits
    // -----------------------------------------------------------------------
    #[test]
    fn test_no_merging_config() {
        let items = vec![
            ChunkItemForMerging {
                size: 100,
                chunk_groups: bitmap(&[0, 1]),
            },
            ChunkItemForMerging {
                size: 200,
                chunk_groups: bitmap(&[0, 1]),
            },
            ChunkItemForMerging {
                size: 300,
                chunk_groups: bitmap(&[2]),
            },
        ];

        let config = MergeConfig {
            min_chunk_size: 0,
            max_chunk_count_per_group: 0,
            max_merge_chunk_size: 0,
        };

        let results = merge_chunks(&items, &config);

        // Items 0 and 1 share bitmap {0,1}, so they should be grouped together.
        // Item 2 has a different bitmap {2}, so it gets its own group.
        // With no merging, we should get 2 chunks (one per unique bitmap).
        assert_eq!(
            results.len(),
            2,
            "Should have 2 chunks (one per unique bitmap), got {}",
            results.len()
        );

        // Total size should be preserved
        let total_input_size: usize = items.iter().map(|i| i.size).sum();
        let total_output_size: usize = results.iter().map(|c| c.total_size).sum();
        assert_eq!(total_input_size, total_output_size);
    }
}
