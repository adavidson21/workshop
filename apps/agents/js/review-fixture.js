/* The mock review's data (review-api.js mockReviewApi): a synthetic local work item with three changed
   files in one repo (modified, added, renamed) and one in a second repo, so the repo switcher shows.
   Generic names only. */

export const FIXTURE = {
  id: 'L1',
  title: 'Round order totals to two decimals',
  folder: 'L1-round-order-totals',
  repos: {
    'shop-api': {
      branch: 'dev/feature/L1-round-order-totals',
      baseBranch: 'origin/main',
      base: {
        'src/orders/totals.ts': `import { Order } from "./types";

export function orderTotal(order: Order): number {
  let total = 0;
  for (const line of order.lines) {
    total += line.price * line.quantity;
  }
  return total;
}

export function orderTax(order: Order, rate: number): number {
  return orderTotal(order) * rate;
}
`,
        'docs/notes.md': `# Order notes

Totals are summed from each line's price and quantity.
`,
      },
      head: {
        'src/orders/totals.ts': `import { Order } from "./types";
import { roundMoney } from "./rounding";

export function orderTotal(order: Order): number {
  let total = 0;
  for (const line of order.lines) {
    total += line.price * line.quantity;
  }
  return roundMoney(total);
}

export function orderTax(order: Order, rate: number): number {
  const tax = orderTotal(order) * rate;
  return Math.round(tax * 100) / 100;
}
`,
        'src/orders/rounding.ts': `// Rounds an amount to two decimals, half away from zero.
export function roundMoney(amount: number): number {
  const sign = amount < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(amount) * 100)) / 100;
}
`,
        'docs/totals.md': `# Order totals

Totals are summed from each line's price and quantity, then rounded to two decimals.
`,
      },
      files: [
        { path: 'docs/totals.md', oldPath: 'docs/notes.md', status: 'renamed', additions: 2, deletions: 2, binary: false },
        { path: 'src/orders/rounding.ts', status: 'added', additions: 5, deletions: 0, binary: false },
        { path: 'src/orders/totals.ts', status: 'modified', additions: 4, deletions: 2, binary: false },
      ],
      // What the mock agent commits when changes are requested (round 2).
      revised: {
        'src/orders/totals.ts': `import { Order } from "./types";
import { roundMoney } from "./rounding";

export function orderTotal(order: Order): number {
  let total = 0;
  for (const line of order.lines) {
    total += line.price * line.quantity;
  }
  return roundMoney(total);
}

export function orderTax(order: Order, rate: number): number {
  return roundMoney(orderTotal(order) * rate);
}
`,
      },
      revisedFiles: [
        { path: 'docs/totals.md', oldPath: 'docs/notes.md', status: 'renamed', additions: 2, deletions: 2, binary: false },
        { path: 'src/orders/rounding.ts', status: 'added', additions: 5, deletions: 0, binary: false },
        { path: 'src/orders/totals.ts', status: 'modified', additions: 3, deletions: 2, binary: false },
      ],
      since: [{ path: 'src/orders/totals.ts', status: 'modified', additions: 1, deletions: 2, binary: false }],
    },
    'shop-web': {
      branch: 'dev/feature/L1-round-order-totals',
      baseBranch: 'origin/main',
      base: {
        'src/cart/summary.js': `export function formatTotal(total) {
  return "$" + total;
}
`,
      },
      head: {
        'src/cart/summary.js': `export function formatTotal(total) {
  return "$" + total.toFixed(2);
}
`,
      },
      files: [{ path: 'src/cart/summary.js', status: 'modified', additions: 1, deletions: 1, binary: false }],
    },
  },
};
