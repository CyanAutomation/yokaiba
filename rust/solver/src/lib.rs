#![deny(unsafe_code)]
#![deny(unsafe_op_in_unsafe_fn)]

#[cfg(target_arch = "wasm32")]
#[allow(unsafe_code)]
mod wasm_abi;

const WIRE_MAGIC: u32 = 0x594f_4b41;
const WIRE_VERSION: u32 = 1;
const HEADER_WORDS: usize = 8;
const CONSTRAINT_WORDS: usize = 6;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WireError {
    InvalidInput = 1,
    UnsupportedRows = 2,
    InvalidCategoryShape = 3,
    InvalidConstraint = 4,
}

#[derive(Clone, Copy, Debug)]
struct Term {
    category: usize,
    value: usize,
}

#[derive(Clone, Debug)]
enum Constraint {
    Matches {
        subject_row: usize,
        term: Term,
    },
    NotMatches {
        subject_row: usize,
        term: Term,
    },
    Before {
        left: Term,
        right: Term,
    },
    Adjacent {
        left: Term,
        right: Term,
    },
    SameRow {
        left: Term,
        right: Term,
    },
    Distance {
        left: Term,
        right: Term,
        distance: usize,
    },
}

impl Constraint {
    fn required_categories(&self, base_category: usize) -> Vec<usize> {
        let mut required = Vec::with_capacity(2);
        let mut add = |category: usize| {
            if category != base_category && !required.contains(&category) {
                required.push(category);
            }
        };

        match self {
            Self::Matches { term, .. } | Self::NotMatches { term, .. } => add(term.category),
            Self::Before { left, right }
            | Self::Adjacent { left, right }
            | Self::SameRow { left, right }
            | Self::Distance { left, right, .. } => {
                add(left.category);
                add(right.category);
            }
        }
        required
    }
}

#[derive(Debug)]
struct SolverInput {
    row_count: usize,
    category_count: usize,
    base_category: usize,
    limit: Option<usize>,
    canonical_values: Vec<Vec<usize>>,
    constraints: Vec<Constraint>,
}

#[derive(Debug)]
struct CandidateDimension {
    category: usize,
    degree: usize,
    permutations: Vec<Vec<usize>>,
}

struct SearchContext<'a> {
    candidates: &'a [CandidateDimension],
    ready_at_depth: &'a [Vec<usize>],
    constraints: &'a [Constraint],
    base_category: usize,
    canonical_values: &'a [Vec<usize>],
    limit: Option<usize>,
}

fn read_word(input: &[u32], index: usize) -> Result<u32, WireError> {
    input.get(index).copied().ok_or(WireError::InvalidInput)
}

fn checked_index(value: u32, bound: usize) -> Result<usize, WireError> {
    let index = value as usize;
    if index < bound {
        Ok(index)
    } else {
        Err(WireError::InvalidInput)
    }
}

fn parse_term(
    category_word: u32,
    value_word: u32,
    category_count: usize,
    row_count: usize,
) -> Result<Term, WireError> {
    Ok(Term {
        category: checked_index(category_word, category_count)?,
        value: checked_index(value_word, row_count)?,
    })
}

fn parse_input(words: &[u32]) -> Result<SolverInput, WireError> {
    if words.len() < HEADER_WORDS
        || read_word(words, 0)? != WIRE_MAGIC
        || read_word(words, 1)? != WIRE_VERSION
    {
        return Err(WireError::InvalidInput);
    }

    let row_count = read_word(words, 2)? as usize;
    if !(2..=5).contains(&row_count) {
        return Err(WireError::UnsupportedRows);
    }
    let category_count = read_word(words, 3)? as usize;
    if category_count == 0 {
        return Err(WireError::InvalidCategoryShape);
    }
    let base_category = checked_index(read_word(words, 4)?, category_count)?;
    let clue_count = read_word(words, 5)? as usize;
    let limit_mode = read_word(words, 6)?;
    let limit_count = read_word(words, 7)? as usize;
    let limit = match limit_mode {
        0 => None,
        1 => Some(limit_count),
        _ => return Err(WireError::InvalidInput),
    };

    let categories_end = HEADER_WORDS
        .checked_add(category_count)
        .ok_or(WireError::InvalidInput)?;
    let canonical_values_end = categories_end
        .checked_add(
            category_count
                .checked_mul(row_count)
                .ok_or(WireError::InvalidInput)?,
        )
        .ok_or(WireError::InvalidInput)?;
    let expected_len = canonical_values_end
        .checked_add(
            clue_count
                .checked_mul(CONSTRAINT_WORDS)
                .ok_or(WireError::InvalidInput)?,
        )
        .ok_or(WireError::InvalidInput)?;
    if words.len() != expected_len {
        return Err(WireError::InvalidInput);
    }

    let mut canonical_values = Vec::with_capacity(category_count);
    for category in 0..category_count {
        if read_word(words, HEADER_WORDS + category)? as usize != row_count {
            return Err(WireError::InvalidCategoryShape);
        }
        let mut values = Vec::with_capacity(row_count);
        for value in 0..row_count {
            values.push(checked_index(
                read_word(words, categories_end + category * row_count + value)?,
                row_count,
            )?);
        }
        canonical_values.push(values);
    }

    let mut constraints = Vec::with_capacity(clue_count);
    let clues_offset = categories_end + category_count * row_count;
    for clue in 0..clue_count {
        let offset = clues_offset + clue * CONSTRAINT_WORDS;
        let kind = read_word(words, offset)?;
        let a = read_word(words, offset + 1)?;
        let b = read_word(words, offset + 2)?;
        let c = read_word(words, offset + 3)?;
        let d = read_word(words, offset + 4)?;
        let e = read_word(words, offset + 5)?;
        let constraint = match kind {
            0 | 1 => {
                let subject_row = checked_index(a, row_count)?;
                let term = parse_term(b, c, category_count, row_count)?;
                if kind == 0 {
                    Constraint::Matches { subject_row, term }
                } else {
                    Constraint::NotMatches { subject_row, term }
                }
            }
            2..=5 => {
                let left = parse_term(a, b, category_count, row_count)?;
                let right = parse_term(c, d, category_count, row_count)?;
                match kind {
                    2 => Constraint::Before { left, right },
                    3 => Constraint::Adjacent { left, right },
                    4 => Constraint::SameRow { left, right },
                    5 if e > 0 => Constraint::Distance {
                        left,
                        right,
                        distance: e as usize,
                    },
                    _ => return Err(WireError::InvalidConstraint),
                }
            }
            _ => return Err(WireError::InvalidConstraint),
        };
        constraints.push(constraint);
    }

    Ok(SolverInput {
        row_count,
        category_count,
        base_category,
        limit,
        canonical_values,
        constraints,
    })
}

fn permutations(size: usize) -> Vec<Vec<usize>> {
    let mut current: Vec<usize> = (0..size).collect();
    let mut result = vec![current.clone()];
    let mut counters = vec![0; size];
    let mut index = 1;

    while index < size {
        if counters[index] < index {
            let swap_index = if index % 2 == 0 { 0 } else { counters[index] };
            current.swap(swap_index, index);
            result.push(current.clone());
            counters[index] += 1;
            index = 1;
        } else {
            counters[index] = 0;
            index += 1;
        }
    }
    result
}

fn value_position(
    term: Term,
    base_category: usize,
    canonical_values: &[Vec<usize>],
    assignments: &[Option<Vec<usize>>],
) -> usize {
    if term.category == base_category {
        return term.value;
    }

    let canonical = &canonical_values[term.category];
    assignments[term.category]
        .as_ref()
        .and_then(|assignment| {
            assignment
                .iter()
                .position(|value| canonical[*value] == term.value)
        })
        .expect("ready constraints only refer to assigned categories and valid values")
}

fn constraint_satisfied(
    constraint: &Constraint,
    base_category: usize,
    canonical_values: &[Vec<usize>],
    assignments: &[Option<Vec<usize>>],
) -> bool {
    match constraint {
        Constraint::Matches { subject_row, term } => {
            *subject_row == value_position(*term, base_category, canonical_values, assignments)
        }
        Constraint::NotMatches { subject_row, term } => {
            *subject_row != value_position(*term, base_category, canonical_values, assignments)
        }
        Constraint::Before { left, right } => {
            value_position(*left, base_category, canonical_values, assignments)
                < value_position(*right, base_category, canonical_values, assignments)
        }
        Constraint::Adjacent { left, right } => {
            value_position(*left, base_category, canonical_values, assignments).abs_diff(
                value_position(*right, base_category, canonical_values, assignments),
            ) == 1
        }
        Constraint::SameRow { left, right } => {
            value_position(*left, base_category, canonical_values, assignments)
                == value_position(*right, base_category, canonical_values, assignments)
        }
        Constraint::Distance {
            left,
            right,
            distance,
        } => {
            value_position(*left, base_category, canonical_values, assignments).abs_diff(
                value_position(*right, base_category, canonical_values, assignments),
            ) == *distance
        }
    }
}

fn constraints_satisfied(
    constraint_ids: &[usize],
    constraints: &[Constraint],
    base_category: usize,
    canonical_values: &[Vec<usize>],
    assignments: &[Option<Vec<usize>>],
) -> bool {
    constraint_ids.iter().all(|constraint_id| {
        constraint_satisfied(
            &constraints[*constraint_id],
            base_category,
            canonical_values,
            assignments,
        )
    })
}

fn visit(
    depth: usize,
    context: &SearchContext<'_>,
    assignments: &mut [Option<Vec<usize>>],
    results: &mut Vec<Vec<Vec<usize>>>,
) {
    if context
        .limit
        .is_some_and(|maximum| results.len() >= maximum)
    {
        return;
    }
    if depth == context.candidates.len() {
        results.push(
            assignments
                .iter()
                .enumerate()
                .filter(|(category, _)| *category != context.base_category)
                .map(|(_, assignment)| {
                    assignment
                        .clone()
                        .expect("all non-base categories are assigned")
                })
                .collect(),
        );
        return;
    }

    let dimension = &context.candidates[depth];
    for permutation in &dimension.permutations {
        if context
            .limit
            .is_some_and(|maximum| results.len() >= maximum)
        {
            break;
        }
        assignments[dimension.category] = Some(permutation.clone());
        if constraints_satisfied(
            &context.ready_at_depth[depth],
            context.constraints,
            context.base_category,
            context.canonical_values,
            assignments,
        ) {
            visit(depth + 1, context, assignments, results);
        }
        assignments[dimension.category] = None;
    }
}

fn solve_input(input: SolverInput) -> Vec<u32> {
    let mut degree_by_category = vec![0; input.category_count];
    for constraint in &input.constraints {
        for category in constraint.required_categories(input.base_category) {
            degree_by_category[category] += 1;
        }
    }

    let mut candidates: Vec<CandidateDimension> = (0..input.category_count)
        .filter(|category| *category != input.base_category)
        .map(|category| CandidateDimension {
            category,
            degree: degree_by_category[category],
            permutations: permutations(input.row_count),
        })
        .collect();
    candidates.sort_by(|left, right| {
        right
            .degree
            .cmp(&left.degree)
            .then(left.category.cmp(&right.category))
    });

    let mut category_depth = vec![None; input.category_count];
    for (depth, candidate) in candidates.iter().enumerate() {
        category_depth[candidate.category] = Some(depth);
    }

    let mut ready_at_depth = vec![Vec::new(); candidates.len()];
    let mut root_constraints = Vec::new();
    for (constraint_id, constraint) in input.constraints.iter().enumerate() {
        let required = constraint.required_categories(input.base_category);
        if required.is_empty() {
            root_constraints.push(constraint_id);
        } else {
            let ready_depth = required
                .iter()
                .filter_map(|category| category_depth[*category])
                .max()
                .expect("every required category has a candidate dimension");
            ready_at_depth[ready_depth].push(constraint_id);
        }
    }

    let mut assignments = vec![None; input.category_count];
    let mut results = Vec::new();
    let context = SearchContext {
        candidates: &candidates,
        ready_at_depth: &ready_at_depth,
        constraints: &input.constraints,
        base_category: input.base_category,
        canonical_values: &input.canonical_values,
        limit: input.limit,
    };
    let root_is_satisfied = constraints_satisfied(
        &root_constraints,
        &input.constraints,
        input.base_category,
        &input.canonical_values,
        &assignments,
    );
    if root_is_satisfied && input.limit != Some(0) {
        visit(0, &context, &mut assignments, &mut results);
    }

    let mut encoded =
        Vec::with_capacity(1 + results.len() * (input.category_count - 1) * input.row_count);
    encoded.push(results.len() as u32);
    for solution in results {
        for dimension in solution {
            encoded.extend(dimension.into_iter().map(|value| value as u32));
        }
    }
    encoded
}

/// Solve one versioned compact request. The error is a stable wire error code.
pub fn solve_wire(words: &[u32]) -> Result<Vec<u32>, u32> {
    parse_input(words)
        .map(solve_input)
        .map_err(|error| error as u32)
}

#[cfg(test)]
mod tests {
    use super::{permutations, solve_wire, WIRE_MAGIC, WIRE_VERSION};

    fn request(row_count: u32, limit_mode: u32, limit_count: u32, clues: &[u32]) -> Vec<u32> {
        let mut words = vec![
            WIRE_MAGIC,
            WIRE_VERSION,
            row_count,
            2,
            0,
            (clues.len() / 6) as u32,
            limit_mode,
            limit_count,
            row_count,
            row_count,
        ];
        words.extend(0..row_count);
        words.extend(0..row_count);
        words.extend_from_slice(clues);
        words
    }

    #[test]
    fn heap_permutations_preserve_the_typescript_order() {
        assert_eq!(permutations(2), vec![vec![0, 1], vec![1, 0]]);
        assert_eq!(
            permutations(3),
            vec![
                vec![0, 1, 2],
                vec![1, 0, 2],
                vec![2, 0, 1],
                vec![0, 2, 1],
                vec![1, 2, 0],
                vec![2, 1, 0]
            ],
        );
    }

    #[test]
    fn unconstrained_requests_obey_zero_and_finite_solution_limits() {
        assert_eq!(solve_wire(&request(2, 1, 0, &[])).unwrap(), vec![0]);
        assert_eq!(solve_wire(&request(2, 1, 1, &[])).unwrap(), vec![1, 0, 1]);
        assert_eq!(
            solve_wire(&request(2, 0, 0, &[])).unwrap(),
            vec![2, 0, 1, 1, 0]
        );
    }

    #[test]
    fn direct_clues_prune_candidates_without_changing_order() {
        let matches_color_zero = [0, 0, 1, 0, 0, 0];
        assert_eq!(
            solve_wire(&request(2, 0, 0, &matches_color_zero)).unwrap(),
            vec![1, 0, 1],
        );
    }

    #[test]
    fn malformed_wire_data_is_rejected() {
        assert!(solve_wire(&[WIRE_MAGIC, WIRE_VERSION]).is_err());
        assert!(solve_wire(&request(6, 0, 0, &[])).is_err());
    }
}
