// node:test reporter for CI: prints each failing test as a GitHub Actions error annotation, so failures
// show on the pull request without opening the job log. Used next to the spec reporter in checks.yml.
import path from 'node:path';

const esc = s => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const prop = s => esc(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

export default async function* githubReporter(source) {
  for await (const event of source) {
    if (event.type !== 'test:fail' || event.data.details?.error?.failureType === 'subtestsFailed') continue;
    if (event.data.todo !== undefined && event.data.todo !== false) continue;
    const { name, file, line } = event.data;
    const err = event.data.details?.error;
    const cause = err?.cause ?? err;
    const msg = `${name}: ${cause?.message ?? err?.message ?? 'failed'}`.slice(0, 4000);
    const where = file ? `file=${prop(path.relative(process.cwd(), file.replace(/^file:\/\//, '')))}${line ? `,line=${line}` : ''}` : '';
    yield `::error ${where}::${esc(`[${process.platform}] ${msg}`)}\n`;
  }
}
