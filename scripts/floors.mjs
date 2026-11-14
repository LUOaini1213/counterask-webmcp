// Floors for the benchmark CLIs, so `npm test` fails when a headline metric
// regresses instead of printing a worse number and passing.
//
//   --min-hit10=0.99 --min-hit1=0.86 --min-mrr=0.9   floors on the summary
//   --listening                                     agentbench only: every
//        listening check must be clean (nothing said is missed, nothing
//        refused comes back, no budget is broken, nothing is asked twice)

const METRICS = [['hit10', 'Hit@10'], ['hit1', 'Hit@1'], ['mrr', 'MRR']];

export function floorFailures(summary, args) {
  const failures = [];
  for (const [flag, key] of METRICS) {
    const arg = args.find((a) => a.startsWith(`--min-${flag}=`));
    if (!arg) continue;
    const floor = Number(arg.slice(arg.indexOf('=') + 1));
    if (!Number.isFinite(floor)) throw new Error(`bad floor: ${arg}`);
    if (!(summary[key] >= floor)) failures.push(`${key} ${summary[key]} is below the floor ${floor}`);
  }
  return failures;
}

export function listeningFailures(c) {
  const failures = [];
  if (c.statedFound !== c.statedFacets) failures.push(`stated attributes missed: ${c.statedFacets - c.statedFound} of ${c.statedFacets}`);
  if (c.wavedMissed !== 0) failures.push(`waved-through facets missed: ${c.wavedMissed} of ${c.waved}`);
  if (c.negInverted !== 0) failures.push(`refusals inverted into requirements: ${c.negInverted}`);
  if (c.negViolated !== 0) failures.push(`refused value in the top 10: ${c.negViolated}`);
  if (c.budgetViolated !== 0) failures.push(`budget broken in the top 10: ${c.budgetViolated}`);
  if (c.redundantAsks !== 0) failures.push(`questions about something already said: ${c.redundantAsks}`);
  if (c.reasks !== 0) failures.push(`questions re-asked after "no preference": ${c.reasks}`);
  return failures;
}

export function report(failures) {
  if (!failures.length) return;
  for (const f of failures) console.error(`FAIL: ${f}`);
  process.exitCode = 1;
}
