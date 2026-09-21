import { AiMemoryStore } from '../src/ai-memory-store.js';

function parseArgs(argv) {
  const args = { apply: false, allFailed: false, gameId: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--apply') args.apply = true;
    else if (value === '--all-failed') args.allFailed = true;
    else if (value === '--game-id') {
      args.gameId = argv[index + 1];
      index += 1;
    } else throw new Error(`Unknown argument: ${value}`);
  }
  if (args.gameId === '') throw new Error('--game-id requires a value');
  if (args.allFailed && args.gameId !== undefined) throw new Error('Use only one of --game-id or --all-failed');
  if (!args.apply && (args.allFailed || args.gameId !== undefined)) {
    throw new Error('Mutation flags require --apply');
  }
  if (args.apply && args.gameId === undefined && !args.allFailed) {
    throw new Error('--apply requires --game-id or --all-failed');
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = new AiMemoryStore();
  const result = await store.requeueFailedJobs({
    gameId: args.gameId,
    allFailed: args.allFailed || args.gameId === undefined,
    dryRun: !args.apply,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
