# The frozen tool corpus

784 cases: 218 positive (one per tool), 436 nearest-neighbour confusers, 50
no-tool/clarification, 50 multi-step, 30 stale-catalog/adversarial.

It exists because every claim this project makes about tokens or quality has to
pass through something that can contradict it. Before this, the honest state of
those claims was: measured with a script, on a payload written to be measured.

## Why it is runnable without a model

`retrieval.ts` scores `searchCatalog` — the ranking behind `tool_catalog_search`
— directly. No provider key, no Studio, no budget. That is a deliberate ceiling
and a deliberate trade:

- **it measures** whether the right tool is in the shortlist an agent receives
  at all, and whether a near neighbour steals first place;
- **it does not measure** whether a model, holding that shortlist, picks
  correctly and fills the arguments. That is `run.ts`, and it costs money and
  needs Studio.

The second is the more interesting number. The first *caps* it: a tool that
never reaches the shortlist cannot be chosen by any model, however good. A
benchmark that costs money to run gets run once, at the moment it flatters you;
this one runs in CI on every commit.

## Why the queries avoid the tools' own words

A "positive" query written by paraphrasing a tool's `whenToUse` measures how
well a lexical retriever matches itself. It scores beautifully and predicts
nothing about a user who has never read the tool list.

`corpus-check.ts` therefore rejects any positive whose content words overlap its
own tool's name and description by more than 75%. The ceiling is not zero on
purpose: a real user does say "install the packages" for a tool whose
description says "install", and forcing that to zero would mean writing queries
nobody would type. The corpus currently sits at a mean overlap of **0.222**.

## Why the confusers are generated

`build-confusers.ts` derives them; do not hand-edit `confusers.generated.json`.

A hand-written negative is a query its author already believed was hard, which
measures the author's intuition about the retriever. A confuser derived from
nearest-neighbour distance is a query that is genuinely close in the space the
retriever scores in, and its gold answer is known-good because it is another
tool's positive case. For tool `T` with nearest neighbours `N1`/`N2`, the two
confusers are `N1`'s and `N2`'s own queries, asserting `T` does not outrank them.

`corpus-check.ts` regenerates and compares, so the derivation cannot drift away
from the catalog it was derived from.

## Reading the baseline

`baseline.json` is the committed result for the current retriever.
`retrieval.ts --check` fails on a regression beyond 1pp; `--update` re-baselines
deliberately. A baseline that moves on its own is not a baseline.

The first recorded run says the retrieval layer is the weak one:

| measure | value |
|---|---|
| positives, gold tool in the top 8 | **56.0%** (95% CI 49.5–62.4) |
| positives, gold tool ranked first | 23.4% |
| confusers, near neighbour takes first place | 3.4% |
| no-tool queries that still got a confident match | **90.0%** |
| multi-step gold steps reachable from one shortlist | 48.0% |
| adversarial pass | 80.0% |

Two of those are worth stating plainly rather than leaving in a table.

**44% of tools are not in the shortlist for a plainly-worded request.** Not
obscure ones: "Make Workspace.Door transparent" does not surface `set_property`.
The scorer weights whole name tokens at 12 and a `whenToUse` substring at 3, so
a request that shares no vocabulary with the tool's name scores almost nothing
— and the queries here were written to share as little as a real user would.

**A query with no tool answer gets a confident match 90% of the time.** The
ranking has no way to say "none of these". "Make my game more fun" returns eight
tools ranked by relevance, and nothing in the response marks them as a poor
match. This is the same failure shape as the audits that passed by not looking:
an answer that is indistinguishable from a good one.

Both are the corpus's findings, not its bugs. Fixing them is the next change;
the baseline exists so that fix has to prove itself.

## What is not covered

- **Argument accuracy and end-task success** need the model-driven harness.
- **The no-tool bucket is scored weakly** — the retriever cannot abstain, so
  the bucket measures how often it offers something rather than whether the
  layer above correctly declines. That becomes a real measurement when a
  confidence floor exists to score against.
- **The 30 adversarial cases with `absentTool`** only assert the catalog does
  not contain the named tool. Whether the server *says so* rather than
  substituting a neighbour is a model-driven question.
